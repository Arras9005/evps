/**
 * 把后端（server/*.ts）和 ssh2 一起打成一个文件 dist/server/main.js。
 * 这样发布的包没有任何运行时依赖：
 * - npx / npm i -g 只下载这一个包，不再拉 ssh2、nan、cpu-features 等七八个包，首次启动快得多；
 * - 不会在用户电脑上跑任何安装脚本（ssh2 和 cpu-features 的安装脚本会尝试编译 C++，Windows 上没有编译器就报一堆错）；
 * - 依赖的代码在发布时就固定下来，不会因为某个依赖被投毒而受影响。
 * ssh2 里两处可选的本机加速模块（cpu-features、sshcrypto.node）本来就包在 try 里，找不到就用纯 JS，所以标成外部、不打进来。
 * 打进来的第三方代码的许可证写到 dist/server/THIRD-PARTY-LICENSES.txt。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'server');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const optionalNative = (id) => id === 'cpu-features' || id.endsWith('.node');
const bundled = new Set();

const bundle = await rolldown({
  input: join(root, 'server', 'main.ts'),
  platform: 'node',
  external: (id) => builtins.has(id) || optionalNative(id),
  plugins: [{
    name: 'record-packages',
    // 记下打进来了哪些 npm 包，后面写许可证
    load(id) {
      const m = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
      if (m) bundled.add(m[1].replace(/\\/g, '/'));
      return null;
    },
  }],
});
await bundle.write({
  file: join(outDir, 'main.js'),
  format: 'esm',
  // ssh2 是 CommonJS，有一处用到 __dirname（Windows 的 Pageant 代理，evps 用不到）；ESM 里没有它，补上
  intro: "import { fileURLToPath as __evpsPath } from 'node:url'; const __filename = __evpsPath(import.meta.url); const __dirname = __evpsPath(new URL('.', import.meta.url));",
  minify: false,
});
await bundle.close();

const licenses = [];
for (const name of [...bundled].sort()) {
  const dir = join(root, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'COPYING'].map((f) => join(dir, f)).find((f) => existsSync(f));
  licenses.push(`${name}@${pkg.version}（${pkg.license ?? '见下文'}）\n${'-'.repeat(60)}\n${file ? readFileSync(file, 'utf8').trim() : '（包里没有许可证文件）'}\n`);
}
writeFileSync(join(outDir, 'THIRD-PARTY-LICENSES.txt'), `dist/server/main.js 里打包了下面这些开源代码：\n\n${licenses.join('\n\n')}`);
console.log(`dist/server/main.js 已生成，打包了：${[...bundled].sort().join(', ')}`);
