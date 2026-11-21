/** 包的根目录：源码运行时在 server/ 的上一级，发布后在 dist/server/ 的上两级。往上找本包的标志文件，不依赖 npm 包名。 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'promo.json')) && existsSync(join(dir, 'w.ps1'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('找不到 evps 的安装目录');
}

export const ROOT = findRoot();

export function rootFile(...parts: string[]): string {
  return join(ROOT, ...parts);
}

export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(rootFile('package.json'), 'utf8')) as { version?: string }).version ?? '0';
  } catch {
    return '0';
  }
}
