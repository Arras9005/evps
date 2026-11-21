/**
 * 所有 SSH 操作都在这里，用纯 JS 的 ssh2，不依赖电脑上的 ssh 命令。
 * 借鉴自 envBuilder/install-panel 的 ssh.ts。区别：
 * - 主机密钥：第一次连接时记下（不要求用户手工核对指纹），记住的服务器之后每次都必须一致；
 * - 接受常见的主机密钥类型（不只 ed25519），普通 VPS 都能连；
 * - 多了 runPty：要一个终端执行命令，边看输出边回答（官方安装脚本要求在终端里交互）。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import ssh2 from 'ssh2';
import type { Client as SshClient, ClientChannel } from 'ssh2';

const { Client } = ssh2;

export class PanelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const MAX_OUTPUT = 256 * 1024;

export function fingerprintOf(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

function sameBlob(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function describeError(error: unknown): PanelError {
  if (error instanceof PanelError) return error;
  const e = error as NodeJS.ErrnoException & { level?: string };
  if (e.level === 'client-authentication') {
    return new PanelError('AUTH', '登录失败：用户名或密码不对。如果确认没错，可能是这台服务器只允许密钥登录，需要到服务商后台开启密码登录。');
  }
  if (e.level === 'client-timeout' || e.code === 'ETIMEDOUT') return new PanelError('TIMEOUT', '连接超时：请检查 IP 和 SSH 端口，以及服务器是否开机。');
  if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return new PanelError('DNS', '找不到这个地址，请检查 IP 有没有写错。');
  if (e.code === 'ECONNREFUSED') return new PanelError('REFUSED', '连接被拒绝：SSH 端口可能不对。');
  if (e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH') return new PanelError('UNREACHABLE', '连不上这个地址，请检查网络。');
  if (e.code === 'ECONNRESET') return new PanelError('RESET', '连接被服务器断开了，请稍后再试。');
  return new PanelError('SSH', '连接失败：' + (e.message ?? '未知错误').slice(0, 200));
}

export const HOSTKEY_CHANGED = new PanelError(
  'HOSTKEY_CHANGED',
  '这台服务器的身份和上次记住的不一样。如果你刚重装过系统，这是正常的：请先「忘记」这台服务器，再重新连接；如果没有重装过，请先不要继续。',
);

export interface Target {
  host: string;
  port: number;
  user: string;
}

export interface Auth {
  password?: string;
  privateKey?: string;
}

export interface Connected {
  conn: SshClient;
  /** 这次连接时服务器出示的主机公钥 */
  hostKey: Buffer;
}

/**
 * 登录。expectedHostKey 给了（记住的服务器）就必须一致；没给就接受并把它带回来，由调用方决定要不要记住。
 */
export function connect(target: Target, auth: Auth, expectedHostKey: Buffer | null, timeoutMs = 20000): Promise<Connected> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let mismatch = false;
    let seen: Buffer | null = null;
    conn.once('ready', () => {
      // ssh2 默认不关 Nagle，交互式的小包会多等一次延迟确认
      conn.setNoDelay(true);
      if (!seen) {
        conn.end();
        reject(new PanelError('SSH', '没有拿到服务器的主机密钥'));
        return;
      }
      resolve({ conn, hostKey: seen });
    });
    conn.once('error', (error) => {
      conn.destroy();
      reject(mismatch ? HOSTKEY_CHANGED : describeError(error));
    });
    if (auth.password !== undefined) {
      const password = auth.password;
      conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => password)));
    }
    conn.connect({
      host: target.host,
      port: target.port,
      username: target.user,
      readyTimeout: timeoutMs,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      hostVerifier: (key: Buffer) => {
        const blob = Buffer.from(key);
        if (expectedHostKey && !sameBlob(blob, expectedHostKey)) {
          mismatch = true;
          return false;
        }
        seen = blob;
        return true;
      },
      ...(auth.password !== undefined ? { password: auth.password, tryKeyboard: true } : {}),
      ...(auth.privateKey !== undefined ? { privateKey: auth.privateKey } : {}),
    });
  });
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 执行一条固定命令。stdin 里的内容当数据传过去，不拼进命令。 */
export function exec(conn: SshClient, command: string, opts: { stdin?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        reject(describeError(error));
        return;
      }
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let size = 0;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        stream.close();
        reject(new PanelError('TIMEOUT', '服务器上的命令超时'));
      }, opts.timeoutMs ?? 30000);
      const keep = (list: Buffer[], chunk: Buffer): void => {
        if (size >= MAX_OUTPUT) return;
        list.push(chunk);
        size += chunk.length;
      };
      stream.on('data', (chunk: Buffer) => keep(out, chunk));
      stream.stderr.on('data', (chunk: Buffer) => keep(err, chunk));
      stream.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
      });
      if (opts.stdin !== undefined) stream.end(opts.stdin);
      else stream.end();
    });
  });
}

export interface PtySession {
  /** 往终端里输入（回答提问） */
  write(text: string): void;
  /** 结束这次会话 */
  close(): void;
  /** 命令退出后给出退出码；连接断了是 null */
  done: Promise<number | null>;
}

/** 要一个终端执行命令。输出（已合并标准错误）通过 onData 一块块送出来。 */
/** 输出回调里直接给出 write / close：输出可能在 runPty 返回之前就到了（和「命令已启动」在同一次网络读取里） */
export type PtyControl = Pick<PtySession, 'write' | 'close'>;

export function runPty(conn: SshClient, command: string, onData: (text: string, control: PtyControl) => void): Promise<PtySession> {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: { term: 'dumb', cols: 160, rows: 50 } }, (error, stream: ClientChannel) => {
      if (error) {
        reject(describeError(error));
        return;
      }
      let code: number | null = null;
      stream.on('exit', (c: number | null) => { code = typeof c === 'number' ? c : null; });
      const control: PtyControl = {
        write: (text) => { stream.write(text); },
        close: () => { stream.close(); },
      };
      const outText = new TextDecoder('utf-8');
      const errText = new TextDecoder('utf-8');
      stream.on('data', (chunk: Buffer) => onData(outText.decode(chunk, { stream: true }), control));
      stream.stderr.on('data', (chunk: Buffer) => onData(errText.decode(chunk, { stream: true }), control));
      const done = new Promise<number | null>((res) => stream.on('close', () => res(code)));
      resolve({
        ...control,
        done,
      });
    });
  });
}
