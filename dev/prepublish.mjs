/**
 * npm publish 之前自动运行：类型检查、测试、打包。
 * 测试要用 Linux 的 unshare 和 script 模拟 VPS，在 Windows / Mac 上发布时跳过测试（发布前请确认 Linux 上 npm run verify 通过过）。
 */
import { spawnSync } from 'node:child_process';

const run = (script) => {
  const r = spawnSync('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('typecheck');
if (process.platform === 'linux') run('test');
else console.log('\n这台电脑不是 Linux，跳过测试（测试要在 Linux 上跑）。\n');
run('build');
