/**
 * 令牌：从启动链接的 # 后面读出来，立刻把地址栏清掉；在当前标签页的 sessionStorage 里留一份，刷新页面不用重新进。
 * 借鉴自 envBuilder/install-panel 的 api.ts。
 */
import type { ApiResult } from './types.ts';

const KEY = 'evps-token';
const TOKEN_RE = /^[a-f0-9]{16,}$/;
let token = '';

export function initToken(): boolean {
  const match = /(?:^|&)t=([a-f0-9]{16,})/.exec(location.hash.slice(1));
  if (match) {
    token = match[1] ?? '';
    try { sessionStorage.setItem(KEY, token); } catch { /* 只放内存 */ }
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try {
      const saved = sessionStorage.getItem(KEY) ?? '';
      token = TOKEN_RE.test(saved) ? saved : '';
    } catch {
      token = '';
    }
  }
  return token !== '';
}

export async function api<T>(path: string, opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = { method: opts.method ?? 'GET', headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: { code: 'OFFLINE', message: 'evps 没有响应。是不是把黑窗口关掉了？请重新运行那一行命令。' } };
  }
  let data: unknown = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    if (response.status === 401) { try { sessionStorage.removeItem(KEY); } catch { /* 同上 */ } }
    const e = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    return {
      ok: false,
      status: response.status,
      error: { code: typeof e?.code === 'string' ? e.code : 'ERROR', message: typeof e?.message === 'string' ? e.message : '程序内部错误' },
    };
  }
  return { ok: true, data: data as T };
}

/** 粘贴什么都尽量认（和后端 server/validate.ts 的 parseTarget 同一套规则，后端还会再校验一次） */
export function splitTarget(raw: string): { host: string; port: number | null; user: string | null } {
  let s = raw.replace(/[　\s]+/g, ' ').trim().replace(/^ssh /i, '');
  let port: number | null = null;
  let user: string | null = null;
  const p = /(^| )-p ?(\d{1,5})( |$)/.exec(s);
  if (p) {
    port = Number(p[2]);
    s = (s.slice(0, p.index) + ' ' + s.slice(p.index + p[0].length)).trim();
  }
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (!s.startsWith('[')) s = s.split('/')[0] ?? '';
  const at = s.lastIndexOf('@');
  if (at > 0) { user = s.slice(0, at); s = s.slice(at + 1); }
  let m: RegExpExecArray | null;
  if ((m = /^\[([^\]]+)\]:(\d{1,5})$/.exec(s))) return { host: m[1] as string, port: Number(m[2]), user };
  if ((m = /^\[([^\]]+)\]$/.exec(s))) return { host: m[1] as string, port, user };
  if ((m = /^([^:]+):(\d{1,5})$/.exec(s))) return { host: m[1] as string, port: Number(m[2]), user };
  return { host: s, port, user };
}
