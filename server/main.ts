#!/usr/bin/env node
/**
 * evps 入口：生成本次运行的令牌，只监听 127.0.0.1，打开浏览器。
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHttpServer } from './http.ts';
import { Jobs } from './jobs.ts';
import { packageVersion, rootFile } from './paths.ts';
import { loadPromo } from './promo.ts';
import { Store } from './store.ts';

/** 页面关掉（不再发心跳）这么久，又没有操作在跑，就自己退出 */
const IDLE_EXIT_MS = 15 * 60_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function openBrowser(url: string): void {
  try {
    const child =
      process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], { stdio: 'ignore', detached: true })
      : process.platform === 'darwin' ? spawn('open', [url], { stdio: 'ignore', detached: true })
      : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // 打不开浏览器就算了，链接已经打印出来
  }
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  process.stdout.write('用法：evps [--port 端口] [--no-open]\n在浏览器里给自己的 VPS 安装、查看、停止、重启、卸载 Geto 面板。\n');
  process.exit(0);
}

const wanted = Number(arg('--port') ?? 6790);
if (!Number.isInteger(wanted) || wanted < 1024 || wanted > 65000) {
  process.stderr.write('--port 必须是 1024 到 65000 的整数\n');
  process.exit(2);
}

const token = randomBytes(24).toString('hex');
const store = new Store();
const jobs = new Jobs({ store });
const promo = loadPromo();
const version = packageVersion();
let lastActivity = Date.now();

let stopping = false;
function quit(cleanup: boolean): void {
  if (stopping) return;
  stopping = true;
  if (cleanup) {
    for (const f of ['servers.json', 'id_ed25519', 'id_ed25519.pub']) rmSync(join(store.home, f), { force: true });
    // 用启动脚本运行时，便携 Node 和 npm 缓存也在这个目录里，正在用着删不掉，交给启动脚本在退出后删
    if (process.env.EVPS_BOOTSTRAP === '1') writeFileSync(join(store.home, 'cleanup-requested'), 'yes\n');
    process.stdout.write('\n已清理本机文件。\n');
  }
  process.stdout.write('evps 已退出，可以关掉这个窗口了。服务器上已经装好的面板不受影响。\n');
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
}

// 端口要先确定才能创建带 Host 校验的服务，所以逐个试
let port = wanted;
const make = (p: number) => createHttpServer({
  token, port: p, webDir: rootFile('dist', 'web'), version, jobs, store, promo, onQuit: quit, onActivity: () => { lastActivity = Date.now(); },
});
let server = make(port);
for (; port < wanted + 30; port += 1) {
  server = make(port);
  const ok = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (ok) break;
}
if (!server.listening) {
  process.stderr.write('找不到空闲端口\n');
  process.exit(1);
}

// 令牌放在链接的 # 后面：不会发给服务器，页面读到后马上从地址栏清掉
const url = `http://127.0.0.1:${port}/#t=${token}`;
const willOpen = !process.argv.includes('--no-open') && process.env.EVPS_NO_OPEN !== '1';
process.stdout.write(
  `\nevps ${version} 已启动${willOpen ? '，正在打开浏览器' : ''}。\n` +
  `如果浏览器没有自动打开，请复制下面这个地址到浏览器里打开：\n  ${url}\n\n` +
  '用完之前请不要关闭这个窗口。关掉它，网页就用不了了（服务器上已经装好的面板不受影响）。\n',
);
if (willOpen) openBrowser(url);

setInterval(() => {
  if (!jobs.running() && Date.now() - lastActivity > IDLE_EXIT_MS) {
    process.stdout.write('\n网页已经关闭了一段时间，evps 自动退出。\n');
    quit(false);
  }
}, 30_000).unref();

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => quit(false));
