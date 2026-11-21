/**
 * 假的 SSH 服务器（用 ssh2 自带的服务端实现），给测试和本机预览用。
 * - 密码登录、公钥登录；装公钥 / 撤销公钥两条命令在内存里模拟，不碰本机的 ~/.ssh；
 * - 别的命令在本机真的执行：用 unshare -r 假装 root，HOME 指到一个临时目录；
 *   要终端的命令（evps 跑 vps.sh 时）用 util-linux 的 script 给它一个真的终端。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
import { INSTALL_KEY_CMD, REVOKE_KEY_CMD } from '../server/jobs.ts';
import { generateUsableKeyPair } from '../server/store.ts';

const { Server, utils } = ssh2;

function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * @param {{ password?: string, user?: string, port?: number, hostKey?: { private: string, public: string }, env?: Record<string, string> }} [opts]
 */
export async function startFakeSsh(opts = {}) {
  const password = opts.password ?? 'correct-password';
  const loginUser = opts.user ?? 'root';
  const hostKey = opts.hostKey ?? generateUsableKeyPair();
  /** @type {string[]} */
  const authorizedKeys = [];
  const home = mkdtempSync(join(tmpdir(), 'evps-fake-home-'));
  /** @type {Set<import('ssh2').Connection>} */
  const clients = new Set();
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set();
  const state = { passwordAttempts: 0, keyLogins: 0, commands: /** @type {string[]} */ ([]) };

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.username !== loginUser) return ctx.reject(['password', 'publickey']);
      if (ctx.method === 'password') {
        state.passwordAttempts += 1;
        return ctx.password === password ? ctx.accept() : ctx.reject(['password']);
      }
      if (ctx.method === 'keyboard-interactive') {
        state.passwordAttempts += 1;
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], (answers) => {
          if (answers[0] === password) ctx.accept(); else ctx.reject(['password']);
        });
      }
      if (ctx.method === 'publickey') {
        const found = authorizedKeys.some((line) => {
          const parsed = utils.parseKey(line);
          if (parsed instanceof Error) return false;
          if (ctx.key.algo !== parsed.type || !ctx.key.data.equals(parsed.getPublicSSH())) return false;
          return ctx.signature ? parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true : true;
        });
        if (found) {
          if (ctx.signature) state.keyLogins += 1;
          return ctx.accept();
        }
        return ctx.reject(['publickey', 'password']);
      }
      return ctx.reject(['publickey', 'password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        let wantPty = false;
        session.on('pty', (acceptPty) => { wantPty = true; acceptPty?.(); });
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          const command = info.command;
          state.commands.push(command);
          const finish = (stdout, code = 0) => {
            if (stdout) stream.write(stdout);
            stream.exit(code);
            stream.end();
          };
          if (command === INSTALL_KEY_CMD || command === REVOKE_KEY_CMD) {
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
              const key = Buffer.concat(chunks).toString('utf8').trim();
              const i = authorizedKeys.indexOf(key);
              if (command === INSTALL_KEY_CMD && key && i < 0) authorizedKeys.push(key);
              if (command === REVOKE_KEY_CMD && i >= 0) authorizedKeys.splice(i, 1);
              finish('');
            });
            return;
          }
          const env = { ...process.env, HOME: home, TERM: 'dumb', ...(opts.env ?? {}) };
          if (!wantPty) {
            const child = spawn('unshare', ['-r', 'sh', '-c', command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
            children.add(child);
            child.stdout.on('data', (c) => stream.write(c));
            child.stderr.on('data', (c) => stream.stderr.write(c));
            stream.on('data', (c) => child.stdin.write(c));
            stream.on('end', () => child.stdin.end());
            child.on('close', (code) => { children.delete(child); finish('', code ?? 255); });
            return;
          }
          // 要终端：script 给一个真的终端。script 在命令结束后还会等标准输入关掉，所以退出码写进文件，看到就收尾
          const dir = mkdtempSync(join(tmpdir(), 'evps-fake-pty-'));
          const rcFile = join(dir, 'rc');
          const wrapped = `sh -c ${shellQuote(command)}; echo $? > ${shellQuote(rcFile)}`;
          const child = spawn('unshare', ['-r', 'script', '-qfc', wrapped, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
          children.add(child);
          child.stdout.on('data', (c) => stream.write(c));
          child.stderr.on('data', (c) => stream.write(c));
          stream.on('data', (c) => { if (!child.stdin.destroyed) child.stdin.write(c); });
          child.stdin.on('error', () => undefined);
          let done = false;
          const end = (code) => {
            if (done) return;
            done = true;
            clearInterval(timer);
            children.delete(child);
            try { child.kill('SIGKILL'); } catch { /* 已经退出 */ }
            rmSync(dir, { recursive: true, force: true });
            finish('', code);
          };
          const timer = setInterval(() => {
            if (existsSync(rcFile)) {
              const code = Number(readFileSync(rcFile, 'utf8').trim() || '255');
              // 留一点时间把最后的输出送完
              setTimeout(() => end(code), 150);
              clearInterval(timer);
            }
          }, 100);
          child.on('close', () => setTimeout(() => end(existsSync(rcFile) ? Number(readFileSync(rcFile, 'utf8').trim()) : 255), 200));
          // 客户端关掉会话（比如 evps 发现提问不对、停下）：把命令也停掉
          stream.on('close', () => end(255));
        });
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    port: address.port,
    authorizedKeys,
    state,
    hostKey,
    close: () => new Promise((resolve) => {
      for (const c of [...children]) { try { c.kill('SIGKILL'); } catch { /* 已经退出 */ } }
      for (const c of [...clients]) c.end();
      server.close(() => {
        rmSync(home, { recursive: true, force: true });
        resolve(undefined);
      });
    }),
  };
}
