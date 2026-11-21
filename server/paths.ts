/** 包的根目录：源码运行时在 server/ 的上一级，发布后在 dist/server/ 的上两级。往上找 package.json 定位。 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i += 1) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name;
        if (name === '@zhangbo9005/easy-vps' || name === 'evps') return dir;
      } catch {
        // 不是我们的 package.json，继续往上找
      }
    }
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
