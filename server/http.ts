/**
 * 本机网页服务：只监听 127.0.0.1。接口要令牌，改动类请求还要核对来源。
 * Host 校验防 DNS 重绑定；接口要令牌；页面有内容安全策略。
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { PanelError } from './ssh.ts';
import type { Jobs, JobRequest } from './jobs.ts';
import type { Promo } from './promo.ts';
import type { Store } from './store.ts';

export interface HttpOptions {
  token: string;
  port: number;
  webDir: string;
  version: string;
  jobs: Jobs;
  store: Store;
  promo: Promo;
  /** 页面点「退出」或「清理本机文件」时调用 */
  onQuit: (cleanup: boolean) => void;
  /** 每次收到页面的请求时调用（用来判断页面还开着没有） */
  onActivity?: () => void;
  /** npm 上有更新的版本时给出版本号（启动时开始查，查不到是 null） */
  update?: Promise<string | null>;
}

const MAX_BODY = 16 * 1024;
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const STATUS: Readonly<Record<string, number>> = {
  BAD_INPUT: 400, NOT_FOUND: 404, BUSY: 409, UNAUTHORIZED: 401,
};

/** 页面的内容安全策略：只允许加载自己这个源的东西（不允许 data: 图片，样式里的图标要用 CSS 或内联 SVG） */
export const PAGE_CSP = "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-origin',
    'content-security-policy': PAGE_CSP,
    ...extra,
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, headers({ 'content-type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(body));
}

function fail(res: ServerResponse, error: unknown): void {
  if (error instanceof PanelError) {
    send(res, STATUS[error.code] ?? 502, { error: { code: error.code, message: error.message } });
    return;
  }
  send(res, 500, { error: { code: 'INTERNAL', message: '程序内部错误' } });
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw new PanelError('BAD_INPUT', '请求格式不对');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new PanelError('BAD_INPUT', '请求太大');
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new PanelError('BAD_INPUT', '请求内容不是合法的 JSON 对象');
  }
}

/** 网页文件读一次就放在内存里（一共几百 KB），不用每次读盘 */
const fileCache = new Map<string, Buffer>();

function serveStatic(webDir: string, urlPath: string, res: ServerResponse): void {
  let rel: string;
  try {
    rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
  } catch {
    rel = '';
  }
  const full = normalize(join(webDir, rel));
  const type = TYPES[extname(full)];
  let body = fileCache.get(full);
  if (!body && type && full.startsWith(webDir + sep) && !rel.includes('\0') && existsSync(full) && statSync(full).isFile()) {
    body = readFileSync(full);
    fileCache.set(full, body);
  }
  if (!type || !body) {
    res.writeHead(404, headers({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Not found');
    return;
  }
  // assets/ 里的文件名带内容指纹，内容变了名字就变，可以放心让浏览器一直缓存；index.html 每次都要新的
  const immutable = rel.startsWith('assets/');
  res.writeHead(200, headers({ 'content-type': type, ...(immutable ? { 'cache-control': 'private, max-age=31536000, immutable' } : {}) }));
  res.end(body);
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function createHttpServer(opts: HttpOptions): Server {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const origins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => fail(res, error));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 防 DNS 重绑定：Host 必须是本机地址加这个端口
    if (!hosts.has(req.headers.host ?? '')) {
      send(res, 403, { error: { code: 'FORBIDDEN', message: '不允许的 Host' } });
      return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const method = req.method ?? 'GET';

    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, headers());
        res.end();
        return;
      }
      serveStatic(opts.webDir, url.pathname, res);
      return;
    }

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), opts.token)) {
      send(res, 401, { error: { code: 'UNAUTHORIZED', message: '令牌不对。请关掉这个网页，回到黑窗口重新运行那一行命令。' } });
      return;
    }
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin !== undefined && !origins.has(origin)) {
        send(res, 403, { error: { code: 'FORBIDDEN', message: '不允许的来源' } });
        return;
      }
    }
    opts.onActivity?.();

    const path = url.pathname;
    if (method === 'GET' && path === '/api/info') {
      send(res, 200, { version: opts.version, promo: opts.promo, platform: process.platform });
      return;
    }
    if (method === 'GET' && path === '/api/update') {
      send(res, 200, { latest: (await opts.update) ?? null, current: opts.version });
      return;
    }
    if (method === 'GET' && path === '/api/servers') {
      send(res, 200, { servers: opts.store.list().map(({ hostKey: _hostKey, ...rest }) => rest) });
      return;
    }
    const forget = /^\/api\/servers\/([a-f0-9]{16})$/.exec(path);
    if (forget && method === 'DELETE') {
      if (!opts.store.forget(forget[1] as string)) throw new PanelError('NOT_FOUND', '没有这台服务器');
      send(res, 200, { forgotten: true });
      return;
    }
    if (method === 'POST' && path === '/api/jobs') {
      const body = await readJson(req);
      const request: JobRequest = {
        action: body.action as JobRequest['action'],
        ...(optionalString(body.serverId) !== undefined ? { serverId: body.serverId as string } : {}),
        ...(optionalString(body.host) !== undefined ? { host: body.host as string } : {}),
        ...(typeof body.port === 'number' ? { port: body.port } : {}),
        ...(optionalString(body.user) !== undefined ? { user: body.user as string } : {}),
        ...(optionalString(body.password) !== undefined ? { password: body.password as string } : {}),
        remember: body.remember === true,
      };
      send(res, 202, opts.jobs.start(request));
      return;
    }
    const job = /^\/api\/jobs\/([a-f0-9]{16})$/.exec(path);
    if (job && method === 'GET') {
      const from = Number(url.searchParams.get('from') ?? '0');
      send(res, 200, opts.jobs.get(job[1] as string, Number.isInteger(from) && from >= 0 ? from : 0));
      return;
    }
    if (method === 'POST' && path === '/api/ping') {
      send(res, 200, { ok: true });
      return;
    }
    if (method === 'POST' && (path === '/api/quit' || path === '/api/cleanup')) {
      if (opts.jobs.running()) throw new PanelError('BUSY', '还有操作没做完，请等它结束再退出');
      send(res, 200, { ok: true });
      setTimeout(() => opts.onQuit(path === '/api/cleanup'), 200);
      return;
    }
    send(res, 404, { error: { code: 'NOT_FOUND', message: '没有这个接口' } });
  }
}
