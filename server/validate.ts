/** 输入校验。所有来自页面的值都先过这里。主机地址规则借鉴自 envBuilder/install-panel，加了 IPv6。 */
import { randomInt } from 'node:crypto';
import { isIPv6 } from 'node:net';

export function validHost(host: unknown): host is string {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) return false;
  if (host.includes(':')) return isIPv6(host);
  if (/[\s'";/\\$`|&<>(){}*?!]/.test(host)) return false;
  if (/^(\d+\.){3}\d+$/.test(host)) {
    return host.split('.').every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && (part === '0' || !part.startsWith('0')));
  }
  // 最后一段全是数字又不是标准四段 IPv4（如 1.2.3），系统会把它当成别的地址，直接拒绝
  if (/\.\d+$/.test(host)) return false;
  return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host);
}

export function validPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function validUser(user: unknown): user is string {
  return typeof user === 'string' && /^[a-z_][a-z0-9_.-]{0,31}$/i.test(user);
}

export function validPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 1 && password.length <= 512 && !/[\r\n]/.test(password);
}

export interface ParsedTarget {
  host: string;
  port: number | null;
  user: string | null;
}

/**
 * 用户粘贴什么都尽量认：1.2.3.4、root@1.2.3.4、1.2.3.4:2222、[2001:db8::1]:22、
 * ssh root@1.2.3.4 -p 2222、带 http:// 的。认不出返回 null。
 */
export function parseTarget(raw: unknown): ParsedTarget | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[　\s]+/g, ' ').trim();
  let port: number | null = null;
  let user: string | null = null;
  s = s.replace(/^ssh /i, '');
  const p = /(^| )-p ?(\d{1,5})( |$)/.exec(s);
  if (p) {
    port = Number(p[2]);
    s = (s.slice(0, p.index) + ' ' + s.slice(p.index + p[0].length)).trim();
  }
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (!s.startsWith('[')) s = s.split('/')[0] ?? '';
  const at = s.lastIndexOf('@');
  if (at > 0) {
    user = s.slice(0, at);
    s = s.slice(at + 1);
  }
  let host = s;
  let m: RegExpExecArray | null;
  if ((m = /^\[([^\]]+)\]:(\d{1,5})$/.exec(s))) {
    host = m[1] as string;
    port = Number(m[2]);
  } else if ((m = /^\[([^\]]+)\]$/.exec(s))) {
    host = m[1] as string;
  } else if ((m = /^([^:]+):(\d{1,5})$/.exec(s))) {
    host = m[1] as string;
    port = Number(m[2]);
  }
  if (!validHost(host)) return null;
  if (port !== null && !validPort(port)) return null;
  if (user !== null && !validUser(user)) return null;
  return { host, port, user };
}

// 去掉容易看错的 0 O o 1 l I：用户可能要照着屏幕手敲
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const ALNUM = LETTERS + '23456789';

function pick(alphabet: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface PanelCreds {
  port: number;
  user: string;
  pass: string;
}

/** 面板的端口、用户名、密码：随机生成。端口在 20000 到 59999，避开 SSH 端口 */
export function newPanelCreds(sshPort: number): PanelCreds {
  let port = 20000 + randomInt(40000);
  if (port === sshPort) port += 1;
  return { port, user: pick(LETTERS, 1) + pick(ALNUM, 9), pass: pick(ALNUM, 16) };
}
