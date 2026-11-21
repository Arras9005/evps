/**
 * 本机数据：记住的服务器和 evps 专用的 SSH 密钥。不保存密码。
 * 位置：Windows 是 %LOCALAPPDATA%\evps，其他系统是 ~/.evps。启动脚本下载的便携 Node 和 npm 缓存也在这里，
 * 所以「清理本机文件」删掉这一个目录就干净了。
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
import { fingerprintOf } from './ssh.ts';
import { validHost, validPort, validUser } from './validate.ts';

export const KEY_COMMENT = 'evps';

export interface ServerEntry {
  id: string;
  host: string;
  port: number;
  user: string;
  /** 主机公钥（base64）。之后每次连接都必须和它一致 */
  hostKey: string;
  fingerprint: string;
  addedAt: string;
}

export function defaultHome(): string {
  if (process.env.EVPS_HOME) return process.env.EVPS_HOME;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, 'evps');
  return join(homedir(), '.evps');
}

function tryChmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows 上 chmod 基本无效，权限由用户目录的访问控制保证
  }
}

function isEntry(value: unknown): value is ServerEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' && /^[a-f0-9]{16}$/.test(e.id) && validHost(e.host) && validPort(e.port) && validUser(e.user) &&
    typeof e.hostKey === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(e.hostKey) && typeof e.fingerprint === 'string' && typeof e.addedAt === 'string'
  );
}

/**
 * 生成 ed25519 密钥，并立刻用 ssh2 自己解析一遍。
 * ssh2 生成的密钥偶尔自己都解析不了（实测约十几分之一），解析不了就重新生成。
 */
export function generateUsableKeyPair(
  generate: () => { private: string; public: string } = () => ssh2.utils.generateKeyPairSync('ed25519', { comment: KEY_COMMENT }),
): { private: string; public: string } {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pair = generate();
    if (!(ssh2.utils.parseKey(pair.private) instanceof Error) && !(ssh2.utils.parseKey(pair.public) instanceof Error)) return pair;
  }
  throw new Error('生成密钥失败，请重试');
}

export class Store {
  readonly home: string;

  constructor(home: string = defaultHome()) {
    this.home = home;
    mkdirSync(home, { recursive: true });
    tryChmod(home, 0o700);
  }

  private get file(): string {
    return join(this.home, 'servers.json');
  }

  list(): ServerEntry[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { servers?: unknown };
      return Array.isArray(raw.servers) ? raw.servers.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  get(id: string): ServerEntry | undefined {
    return this.list().find((e) => e.id === id);
  }

  find(host: string, port: number, user: string): ServerEntry | undefined {
    return this.list().find((e) => e.host === host && e.port === port && e.user === user);
  }

  private write(servers: ServerEntry[]): void {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  remember(target: { host: string; port: number; user: string }, hostKey: Buffer): ServerEntry {
    const servers = this.list().filter((e) => !(e.host === target.host && e.port === target.port && e.user === target.user));
    const entry: ServerEntry = {
      id: randomBytes(8).toString('hex'),
      host: target.host,
      port: target.port,
      user: target.user,
      hostKey: hostKey.toString('base64'),
      fingerprint: fingerprintOf(hostKey),
      addedAt: new Date().toISOString(),
    };
    servers.push(entry);
    this.write(servers);
    return entry;
  }

  forget(id: string): boolean {
    const servers = this.list();
    const next = servers.filter((e) => e.id !== id);
    if (next.length === servers.length) return false;
    this.write(next);
    return true;
  }

  /** evps 专用的密钥：第一次用到时生成 */
  keyPair(): { privateKey: string; publicKey: string } {
    const priv = join(this.home, 'id_ed25519');
    const pub = priv + '.pub';
    if (!existsSync(priv) || !existsSync(pub)) {
      const pair = generateUsableKeyPair();
      writeFileSync(priv, pair.private, { mode: 0o600 });
      writeFileSync(pub, pair.public.trim() + '\n', { mode: 0o644 });
      tryChmod(priv, 0o600);
    }
    return { privateKey: readFileSync(priv, 'utf8'), publicKey: readFileSync(pub, 'utf8').trim() };
  }
}
