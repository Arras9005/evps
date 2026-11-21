/**
 * 界面走查：真的后端 + 假 SSH 服务器 + 假 VPS，用无头 Chrome 把每个页面点一遍、截图，并检查几件事：
 * 页面没有报错（包括内容安全策略拦截）、购买链接不出现在页面里、SSH 密码和面板密码不出现在日志里。
 * 用法：node --experimental-strip-types dev/walkthrough.mjs <截图目录> [README 配图目录]
 * 给了第二个目录，就顺便截 README 用的几张图（只截关键区域，示例地址统一换成文档专用的 203.0.113.7）。
 * 需要 Linux（unshare、script）和 Chrome（找不到时设 CHROME_BIN）。
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';
import { startFakeSsh } from './fake-ssh-server.mjs';
import { createFakeVps } from './fake-vps.mjs';
import { createHttpServer } from '../server/http.ts';
import { Jobs } from '../server/jobs.ts';
import { rootFile } from '../server/paths.ts';
import { loadPromo } from '../server/promo.ts';
import { Store } from '../server/store.ts';

const out = process.argv[2] ?? '/tmp/evps-walk';
const docs = process.argv[3] ?? null;
mkdirSync(out, { recursive: true });
if (docs) mkdirSync(docs, { recursive: true });
const DEMO = '203.0.113.7';
const PASSWORD = 'Demo-Pass-2026';
// 假安装每一步停 1.2 秒，才截得到「安装中」
const fake = await startFakeSsh({ password: PASSWORD, env: { EVPS_FAKE_DELAY: '1.2' } });
const vps = createFakeVps();
const home = mkdtempSync(join(tmpdir(), 'evps-walk-home-'));
const store = new Store(home);
const reach = { ok: true };
const jobs = new Jobs({ store, vpsScript: vps.vpsScript, probe: async () => reach.ok });
const promo = loadPromo();
const token = 'ab'.repeat(24);
const port = 6899;
const server = createHttpServer({ token, port, webDir: rootFile('dist', 'web'), version: '0.1.0', jobs, store, promo, onQuit: () => undefined });
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const b = await launch({ width: 1280, height: 900 });
if (!b) {
  console.log('找不到 Chrome，跳过（设 CHROME_BIN）');
  process.exit(0);
}
const shots = [];
const shot = async (name, full = true) => {
  const path = join(out, name + '.png');
  // 整页截图：先回到顶部（不然吸顶的标题栏会出现在页面中间），再等进场动画结束
  if (full) await b.eval('window.scrollTo(0, 0)');
  await b.sleep(450);
  await b.shot(path, { full });
  shots.push(path);
};
const text = () => b.eval('document.body.innerText');
/** README 配图：先把页面上测试用的本机地址换成示例地址，等动画结束再截 */
const docShot = async (name, selector) => {
  if (!docs) return;
  await b.eval(`document.querySelectorAll('.job .card-head .mono').forEach((e) => { e.textContent = 'root@${DEMO}'; })`);
  await b.eval('window.scrollTo(0, 0)');
  await b.sleep(450);
  // .wrap 自己带内边距，不用再往外多截（多截会截到页脚）
  await b.shotElement(join(docs, name + '.png'), selector, { pad: selector === '.wrap' ? 0 : 12 });
};
const setValue = (selector, value) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input')); })()`);
const waitJob = async (timeout = 60000) => {
  await b.waitFor(`document.querySelector('[data-test=job] .badge') && !document.querySelector('[data-test=job] .badge.busy')`, timeout);
};

try {
  await b.scheme('light');
  await b.goto(`http://127.0.0.1:${port}/#t=${token}`);
  await b.waitFor(`document.querySelector('[data-test=have]')`);
  assert.equal(await b.eval('location.hash'), '', '令牌应该从地址栏清掉');
  const html = await b.eval('document.documentElement.outerHTML');
  assert.ok(!html.includes('qsu.hk'), '购买链接不应该出现在页面里');
  await shot('01-首页');
  await docShot('home', '.wrap');
  await b.scheme('dark');
  await shot('01b-首页-深色');
  await b.scheme('light');

  await b.click('[data-test=need]');
  await b.waitFor(`document.querySelector('[data-test=bought]')`);
  await shot('02-没有VPS-购买指引');
  await docShot('buy', '.wrap .card');
  await b.click('[data-test=bought]');
  await b.waitFor(`document.querySelector('[data-test=host]')`);

  if (docs) {
    // README 配图用示例值填一遍，截完再换成真正的测试地址
    await setValue('[data-test=host]', DEMO);
    await setValue('[data-test=password]', 'example-password');
    await docShot('form', '.wrap .card');
    await setValue('[data-test=host]', '');
    await setValue('[data-test=password]', '');
  }
  // 粘贴 root@IP:端口 这种写法，自动拆开
  await b.type('[data-test=host]', `root@127.0.0.1:${fake.port}`);
  await b.click('[data-test=password]');
  assert.equal(await b.eval(`document.querySelector('[data-test=host]').value`), '127.0.0.1');
  assert.equal(await b.eval(`document.querySelector('[data-test=port]').value`), String(fake.port));
  await b.type('[data-test=password]', PASSWORD);
  await b.click('.check input');
  await shot('03-填写服务器信息');

  await b.click('[data-test=install]');
  await b.waitFor(`[...document.querySelectorAll('.steps li.done')].length >= 3`, 30000);
  await shot('04-安装中');
  await docShot('installing', '[data-test=job]');
  await waitJob();
  await b.waitFor(`document.querySelector('[data-test=result]')`);
  await docShot('installed', '[data-test=job]');
  await b.click('.log-head .btn');
  await shot('05-安装完成');
  const page = await text();
  assert.ok(!page.includes(PASSWORD), 'SSH 密码不应该出现在页面上');
  const pass = await b.eval(`[...document.querySelectorAll('.login dd .sel')][2].textContent`);
  assert.match(pass, /^[A-Za-z0-9]{16}$/);
  const log = await b.eval(`document.querySelector('.log').textContent`);
  assert.ok(!log.includes(pass), '面板密码不应该出现在日志里');
  assert.ok(/面板端口 \[2053\]: \d+/.test(log), '日志里应该看得到自动回答的提问');

  // 首页出现「记住的服务器」
  await b.click('.back');
  await b.waitFor(`document.querySelector('.saved-row')`);
  await shot('06-首页-记住的服务器');
  await b.click('.saved-row');
  await b.waitFor(`document.querySelector('[data-test=status]')`);

  await b.click('[data-test=status]');
  await waitJob();
  await shot('07-查看状态');
  if (docs) {
    await b.eval(`document.querySelectorAll('.saved-target .mono').forEach((e) => { e.textContent = 'root@${DEMO}'; }); document.querySelectorAll('.saved-target .tag.mono').forEach((e) => { e.textContent = 'SSH 端口 22'; })`);
    await docShot('manage', '.wrap');
  }

  await b.click('[data-test=stop]');
  await b.waitFor(`document.querySelector('[data-test=confirm]')`);
  await shot('08-停止-确认', false);
  await b.click('[data-test=confirm-ok]');
  await waitJob();
  await shot('09-已停止');

  await b.click('[data-test=start]');
  await waitJob();
  reach.ok = false;
  await b.click('[data-test=status]');
  await waitJob();
  await b.waitFor(`document.querySelector('[data-test=reach-warn]')`);
  await shot('10-状态-端口连不上的提示');
  await docShot('port-blocked', '[data-test=reach-warn]');
  reach.ok = true;

  await b.click('[data-test=uninstall]');
  await b.waitFor(`document.querySelector('[data-test=confirm]')`);
  await shot('11-卸载-确认', false);
  await b.click('[data-test=confirm-ok]');
  await waitJob();
  await shot('12-已卸载');
  assert.equal(store.list().length, 0, '卸载后应该忘掉这台服务器');

  // 窄屏（手机宽度）看一眼首页
  await b.click('.back');
  await b.viewport(390, 844, 2);
  await b.waitFor(`document.querySelector('[data-test=have]')`);
  await shot('13-首页-窄屏');

  assert.deepEqual(b.errors, [], '页面不应该有报错');
  console.log('走查通过，截图：\n' + shots.join('\n'));
} finally {
  await b.close();
  server.close();
  await fake.close();
  vps.cleanup();
  rmSync(home, { recursive: true, force: true });
}
