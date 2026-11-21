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
  await b.eval(`document.querySelectorAll('.detail-host, .srv-name').forEach((e) => { e.textContent = '${DEMO}'; }); document.querySelectorAll('.detail-head .hint').forEach((e) => { e.textContent = 'root · SSH 端口 22 · 已记住'; })`);
  await b.eval('window.scrollTo(0, 0)');
  await b.sleep(450);
  // 「返回」链接在截图区域外面一点点，截的时候先藏起来
  await b.eval(`document.querySelectorAll('.back-row').forEach((e) => { e.style.visibility = 'hidden'; })`);
  await b.shotElement(join(docs, name + '.png'), selector, { pad: 16 });
  await b.eval(`document.querySelectorAll('.back-row').forEach((e) => { e.style.visibility = ''; })`);
};
const setValue = (selector, value) => b.eval(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const pill = () => b.eval(`document.querySelector('[data-test=pill]')?.textContent ?? ''`);
/** 详情页：等状态查完（刷新按钮能点了），并且状态标签是想要的那个 */
const waitPill = (want, timeout = 60000) => b.waitFor(`(() => { const p = document.querySelector('[data-test=pill]'); const r = document.querySelector('[data-test=status]'); return p && r && !r.disabled && p.textContent === ${JSON.stringify(want)}; })()`, timeout);

try {
  await b.scheme('light');
  await b.goto(`http://127.0.0.1:${port}/#t=${token}`);
  await b.waitFor(`document.querySelector('[data-test=have]')`);
  assert.equal(await b.eval('location.hash'), '', '令牌应该从地址栏清掉');
  const html = await b.eval('document.documentElement.outerHTML');
  assert.ok(!html.includes('qsu.hk'), '购买链接不应该出现在页面里');
  await b.waitFor(`[...document.images].every((i) => i.complete && i.naturalWidth > 0)`);
  await shot('01-首页');
  await docShot('home', '.welcome');
  await b.scheme('dark');
  await shot('01b-首页-深色');
  await b.scheme('light');

  await b.click('[data-test=need]');
  await b.waitFor(`document.querySelector('[data-test=bought]')`);
  await shot('02-没有VPS-购买指引');
  await docShot('buy', '.page');
  await b.click('[data-test=bought]');
  await b.waitFor(`document.querySelector('[data-test=host]')`);
  assert.equal(await b.eval(`document.querySelector('[data-test=remember]').checked`), true, '「记住这台服务器」应该默认勾上');

  if (docs) {
    // README 配图用示例值填一遍，截完再换成真正的测试地址
    await setValue('[data-test=host]', DEMO);
    await setValue('[data-test=password]', 'example-password');
    await docShot('form', '.page');
    await setValue('[data-test=host]', '');
    await setValue('[data-test=password]', '');
  }
  // 粘贴 root@IP:端口 这种写法，自动拆开，端口不是 22 时自动展开「高级」
  await b.type('[data-test=host]', `root@127.0.0.1:${fake.port}`);
  await b.click('[data-test=password]');
  assert.equal(await b.eval(`document.querySelector('[data-test=host]').value`), '127.0.0.1');
  assert.equal(await b.eval(`document.querySelector('[data-test=port]').value`), String(fake.port));

  // 密码不对：退回表单，原因显示在按钮上面，填过的都还在
  await b.type('[data-test=password]', 'wrong-password');
  await b.click('[data-test=install]');
  await b.waitFor(`document.querySelector('[data-test=form-error]')`, 30000);
  assert.equal(await b.eval(`document.querySelector('[data-test=host]').value`), '127.0.0.1');
  await shot('03a-密码不对');
  await setValue('[data-test=password]', PASSWORD);
  assert.equal(await b.eval(`!!document.querySelector('[data-test=form-error]')`), false, '改了密码，旧的出错提示应该消失');
  await shot('03-填写服务器信息');

  await b.click('[data-test=install]');
  await b.waitFor(`document.querySelectorAll('.mini-steps li.done').length >= 3`, 30000);
  await shot('04-安装中');
  await docShot('installing', '.page');
  await b.waitFor(`document.querySelector('[data-test=result]')`, 60000);
  await docShot('installed', '.page');
  await b.click('[data-test=log-toggle]');
  await shot('05-安装完成');
  const page = await text();
  assert.ok(!page.includes(PASSWORD), 'SSH 密码不应该出现在页面上');
  const pass = await b.eval(`[...document.querySelectorAll('.cred-row .cred-v')][2].textContent`);
  assert.match(pass, /^[A-Za-z0-9]{16}$/);
  const log = await b.eval(`document.querySelector('.log').textContent`);
  assert.ok(!log.includes(pass), '面板密码不应该出现在日志里');
  assert.ok(/面板端口 \[2053\]: \d+/.test(log), '日志里应该看得到自动回答的提问');
  assert.equal(store.list().length, 1, '默认勾上「记住」，装完应该记住这台服务器');

  // 管理这台服务器：直接用安装的结果，不用再查
  await b.click('[data-test=manage]');
  await waitPill('面板运行中');
  await shot('06-服务器详情');

  // 首页变成「我的服务器」
  await b.click('[data-test=home]');
  await b.waitFor(`document.querySelector('[data-test=server-row]')`);
  await shot('07-首页-我的服务器');
  await b.click('[data-test=server-row]');
  await b.waitFor(`document.querySelector('[data-test=status]')`);
  await b.click('[data-test=status]');
  await waitPill('面板运行中');
  if (docs) await docShot('manage', '.page');

  await b.click('[data-test=stop]');
  await b.waitFor(`document.querySelector('[data-test=confirm][open]')`);
  await shot('08-停止-确认', false);
  await b.click('[data-test=confirm-ok]');
  await waitPill('已停止');
  await shot('09-已停止');

  await b.click('[data-test=start]');
  await waitPill('面板运行中');
  reach.ok = false;
  await b.click('[data-test=status]');
  await b.waitFor(`document.querySelector('[data-test=reach-warn]')`, 60000);
  await waitPill('面板运行中');
  await shot('10-状态-端口连不上的提示');
  await docShot('port-blocked', '.detail-card');
  reach.ok = true;

  await b.click('[data-test=menu]');
  await b.waitFor(`document.querySelector('.menu')`);
  await shot('11-右上角菜单', false);
  await b.press('Escape');

  await b.click('[data-test=uninstall]');
  await b.waitFor(`document.querySelector('[data-test=confirm][open]')`);
  await shot('12-卸载-确认', false);
  await b.click('[data-test=confirm-ok]');
  // 卸载后忘掉这台服务器，回到首页
  await b.waitFor(`document.querySelector('[data-test=have]')`, 60000);
  await shot('13-已卸载回到首页');
  assert.equal(store.list().length, 0, '卸载后应该忘掉这台服务器');

  // 窄屏（手机宽度）看一眼首页
  await b.viewport(390, 844, 2);
  await b.waitFor(`document.querySelector('[data-test=have]')`);
  await shot('14-首页-窄屏');

  assert.deepEqual(b.errors, [], '页面不应该有报错');
  console.log('走查通过，截图：\n' + shots.join('\n'));
} finally {
  await b.close();
  server.close();
  await fake.close();
  vps.cleanup();
  rmSync(home, { recursive: true, force: true });
}
