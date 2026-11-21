/** 五个操作的完整流程：假 SSH 服务器 + 假 VPS 环境，vps.sh 是真的（只换了路径） */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startFakeSsh } from '../dev/fake-ssh-server.mjs';
import { createFakeVps } from '../dev/fake-vps.mjs';
import { Jobs } from '../server/jobs.ts';
import type { JobView } from '../server/jobs.ts';
import { Store } from '../server/store.ts';

type Fake = Awaited<ReturnType<typeof startFakeSsh>>;

async function waitDone(jobs: Jobs, id: string, timeoutMs = 60_000): Promise<JobView & { all: string[] }> {
  const deadline = Date.now() + timeoutMs;
  const all: string[] = [];
  let from = 0;
  for (;;) {
    const v = jobs.get(id, from);
    all.push(...v.lines);
    from = v.next;
    if (v.state !== 'running') return { ...v, all };
    if (Date.now() > deadline) throw new Error('任务超时：\n' + all.join('\n'));
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('evps 任务（假服务器）', () => {
  let fake: Fake;
  let vps: ReturnType<typeof createFakeVps>;
  let home: string;
  let store: Store;
  let jobs: Jobs;
  const probed: Array<{ host: string; port: number }> = [];
  const target = () => ({ host: '127.0.0.1', port: fake.port, user: 'root', password: 'correct-password' });

  before(async () => {
    fake = await startFakeSsh();
    vps = createFakeVps();
    home = mkdtempSync(join(tmpdir(), 'evps-test-home-'));
    store = new Store(home);
    jobs = new Jobs({ store, vpsScript: vps.vpsScript, probe: async (host, port) => { probed.push({ host, port }); return true; } });
  });
  after(async () => {
    await fake.close();
    vps.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

  it('密码不对：说清楚是登录失败', async () => {
    const v = await waitDone(jobs, jobs.start({ action: 'status', ...target(), password: 'wrong' }).id);
    assert.equal(v.state, 'failed');
    assert.equal(v.error?.code, 'AUTH');
  });

  it('还没装：查看状态说没装', async () => {
    const v = await waitDone(jobs, jobs.start({ action: 'status', ...target() }).id);
    assert.equal(v.state, 'ok', JSON.stringify(v.error));
    assert.equal(v.result?.kind, 'not-installed');
  });

  it('提问多了一个：下载后校验就发现，不安装', async () => {
    vps.setVariant('extra-prompt');
    const v = await waitDone(jobs, jobs.start({ action: 'install', ...target() }).id);
    vps.setVariant('normal');
    assert.equal(v.state, 'failed');
    assert.equal(v.error?.code, 'PROMPT_CHANGED');
  });

  it('官方脚本再问一次端口：不乱填，停下', async () => {
    vps.setVariant('strict-port');
    const v = await waitDone(jobs, jobs.start({ action: 'install', ...target() }).id);
    vps.setVariant('normal');
    assert.equal(v.state, 'failed');
    assert.equal(v.error?.code, 'PROMPT_CHANGED', v.all.join('\n'));
  });

  it('安装到一半失败：报安装没有完成，日志里有官方的报错', async () => {
    vps.setVariant('fail');
    const v = await waitDone(jobs, jobs.start({ action: 'install', ...target() }).id);
    vps.setVariant('normal');
    assert.equal(v.state, 'failed');
    assert.equal(v.error?.code, 'INSTALL_FAILED');
    assert.ok(v.all.some((l) => l.includes('python3 安装失败')), v.all.join('\n'));
    assert.ok(v.steps.some((s) => s.state === 'failed'));
  });

  let installed: JobView & { all: string[] };
  it('安装：三个提问按顺序自动回答，步骤全部完成，结果和日志对得上', async () => {
    rmSync(vps.nodeHome, { recursive: true, force: true });
    installed = await waitDone(jobs, jobs.start({ action: 'install', ...target(), remember: true }).id);
    assert.equal(installed.state, 'ok', JSON.stringify(installed.error) + '\n' + installed.all.join('\n'));
    assert.equal(installed.result?.kind, 'installed');
    const panel = installed.result?.panel;
    assert.match(panel?.address ?? '', /^http:\/\/203\.0\.113\.7:\d+$/);
    assert.match(panel?.user ?? '', /^[A-Za-z][A-Za-z0-9]{9}$/);
    assert.match(panel?.pass ?? '', /^[A-Za-z0-9]{16}$/);
    assert.deepEqual(installed.steps.map((s) => s.state), installed.steps.map(() => 'done'));
    // 日志里看得到提问和回答（端口、用户名），面板密码被遮住
    assert.ok(installed.all.some((l) => /^面板端口 \[2053\]: \d+$/.test(l)), installed.all.join('\n'));
    assert.ok(installed.all.some((l) => l === `面板用户名 [admin]: ${panel?.user}`));
    assert.ok(!installed.all.some((l) => l.includes(panel?.pass ?? '@@')), '日志里不该出现面板密码');
    assert.ok(!installed.all.some((l) => l.startsWith('@@EVPS')), '给程序读的行不该显示');
    // 从这台电脑测的是 SSH 地址上的面板端口
    assert.deepEqual(probed.at(-1), { host: '127.0.0.1', port: Number(panel?.address?.split(':').at(-1)) });
    assert.equal(installed.result?.reach?.ok, true);
  });

  it('记住了服务器：公钥装上了，之后用 serverId 不输密码就能查看状态', async () => {
    assert.equal(fake.authorizedKeys.length, 1);
    const entry = store.list()[0];
    assert.ok(entry && installed.result?.remembered === entry.id);
    const v = await waitDone(jobs, jobs.start({ action: 'status', serverId: entry.id }).id);
    assert.equal(v.state, 'ok', JSON.stringify(v.error));
    assert.equal(v.result?.kind, 'status');
    assert.equal(v.result?.status?.user, installed.result?.panel?.user);
    assert.equal(v.result?.status?.pass, installed.result?.panel?.pass);
    assert.deepEqual(v.result?.status?.units.map((u) => [u.name, u.active, u.enabled]), [['np-panel', 'active', 'enabled'], ['xray', 'active', 'enabled']]);
  });

  it('已经装过：不重装，带回现在的登录信息', async () => {
    const v = await waitDone(jobs, jobs.start({ action: 'install', ...target() }).id);
    assert.equal(v.state, 'ok', JSON.stringify(v.error));
    assert.equal(v.result?.kind, 'already');
    assert.equal(v.result?.panel?.pass, installed.result?.panel?.pass);
  });

  it('停止：服务停下并取消自启；再启动：恢复', async () => {
    const id = store.list()[0]?.id as string;
    const s = await waitDone(jobs, jobs.start({ action: 'stop', serverId: id }).id);
    assert.equal(s.state, 'ok', JSON.stringify(s.error) + s.all.join('\n'));
    assert.equal(s.result?.kind, 'stopped');
    assert.deepEqual(vps.unitState('np-panel'), { active: 'inactive', enabled: 'disabled' });
    assert.deepEqual(vps.unitState('xray'), { active: 'inactive', enabled: 'disabled' });
    const st = await waitDone(jobs, jobs.start({ action: 'status', serverId: id }).id);
    assert.equal(st.result?.status?.stopped, true);
    const r = await waitDone(jobs, jobs.start({ action: 'start', serverId: id }).id);
    assert.equal(r.state, 'ok', JSON.stringify(r.error) + r.all.join('\n'));
    assert.equal(r.result?.kind, 'started');
    assert.deepEqual(vps.unitState('np-panel'), { active: 'active', enabled: 'enabled' });
    assert.deepEqual(vps.unitState('xray'), { active: 'active', enabled: 'enabled' });
  });

  it('主机密钥变了（服务器重装过或被冒充）：拒绝连接', async () => {
    const other = await startFakeSsh();
    try {
      const entry = store.list()[0];
      assert.ok(entry);
      const pretend = new Store(mkdtempSync(join(tmpdir(), 'evps-test-home2-')));
      pretend.remember({ host: '127.0.0.1', port: other.port, user: 'root' }, Buffer.from(entry.hostKey, 'base64'));
      const j2 = new Jobs({ store: pretend, vpsScript: vps.vpsScript, probe: async () => true });
      const v = await waitDone(j2, j2.start({ action: 'status', ...target(), port: other.port }).id);
      assert.equal(v.state, 'failed');
      assert.equal(v.error?.code, 'HOSTKEY_CHANGED');
      rmSync(pretend.home, { recursive: true, force: true });
    } finally {
      await other.close();
    }
  });

  it('卸载：调用官方卸载，撤掉 evps 的公钥，并忘掉这台服务器', async () => {
    const id = store.list()[0]?.id as string;
    const v = await waitDone(jobs, jobs.start({ action: 'uninstall', serverId: id }).id);
    assert.equal(v.state, 'ok', JSON.stringify(v.error) + v.all.join('\n'));
    assert.equal(v.result?.kind, 'uninstalled');
    assert.equal(v.result?.forgotten, true);
    assert.ok(v.all.some((l) => l.includes('Geto 已卸载干净')));
    assert.equal(fake.authorizedKeys.length, 0);
    assert.equal(store.list().length, 0);
    const st = await waitDone(jobs, jobs.start({ action: 'status', ...target() }).id);
    assert.equal(st.result?.kind, 'not-installed');
  });

  it('同一台服务器上一个操作没做完，不能再开第二个', async () => {
    const first = jobs.start({ action: 'status', ...target() });
    assert.throws(() => jobs.start({ action: 'status', ...target() }), /还有操作没做完/);
    await waitDone(jobs, first.id);
  });
});
