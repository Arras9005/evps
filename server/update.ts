/**
 * 新版本提醒：启动时问一下 npm 上最新的版本号（只是一个公开的 GET，不发送任何信息），
 * 比当前的新就在网页上提示怎么更新。用 npm i -g 装的用户不会自动更新，官方脚本的提问一变，旧版就会停下，所以要提醒。
 * 一行命令启动的（EVPS_BOOTSTRAP=1）每次都运行最新版，不用查。
 */
const PACKAGE = '@zhangbo9005/easy-vps';
const REGISTRIES = ['https://registry.npmmirror.com', 'https://registry.npmjs.org'];

/**
 * evps 是怎么启动的，决定更新提示里给哪条命令：
 * npx 运行时包在 npm 缓存的 _npx 目录里；其他情况（npm i -g、源码）按全局安装算。
 */
export function launchKind(root: string): 'npx' | 'global' {
  return /[\\/]_npx[\\/]/.test(root) ? 'npx' : 'global';
}

/** a 比 b 新（只比较 x.y.z 三段数字；带 -beta 之类的预发布版本不算新版本） */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): number[] | null => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] as number) !== (y[i] as number)) return (x[i] as number) > (y[i] as number);
  }
  return false;
}

export async function latestVersion(timeoutMs = 4000): Promise<string | null> {
  for (const base of REGISTRIES) {
    try {
      const r = await fetch(`${base}/${PACKAGE}/latest`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (!r.ok) continue;
      const v = ((await r.json()) as { version?: unknown }).version;
      if (typeof v === 'string') return v;
    } catch {
      // 换下一个源；都不通就算了
    }
  }
  return null;
}

/** 有更新就返回新版本号，否则 null */
export async function checkUpdate(current: string): Promise<string | null> {
  const latest = await latestVersion();
  return latest && isNewer(latest, current) ? latest : null;
}
