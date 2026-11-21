/**
 * 页面上的五个按钮各对应一个「任务」：install / status / stop / start / uninstall。
 * 任务在后台跑，页面用 get(id, from) 轮询进度和日志。密码只在这次任务的内存里，任务结束就丢掉。
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import type { Client as SshClient } from 'ssh2';
import {
  advanceInstall, completeStep, failRunning, initialSteps, INSTALL_STEPS, markers, parseInstallResult, parseStatus,
  PROMPTS, startFirst, stripAnsi, SUDO_PROMPT, unitLabel,
} from './geto.ts';
import type { PanelInfo, StatusInfo, Step } from './geto.ts';
import { connect, exec, PanelError, runPty } from './ssh.ts';
import type { Auth, PtyControl, Target } from './ssh.ts';
import { rootFile } from './paths.ts';
import type { Store } from './store.ts';
import { newPanelCreds, validHost, validPassword, validPort, validUser } from './validate.ts';
import type { PanelCreds } from './validate.ts';

export const ACTIONS = ['install', 'status', 'stop', 'start', 'uninstall'] as const;
export type Action = (typeof ACTIONS)[number];

const ACTION_LABEL: Record<Action, string> = {
  install: '安装面板', status: '查看状态', stop: '停止', start: '启动 / 重启', uninstall: '卸载',
};

const TIMEOUT_MS: Record<Action, number> = {
  install: 40 * 60_000, status: 3 * 60_000, stop: 3 * 60_000, start: 3 * 60_000, uninstall: 15 * 60_000,
};

export const MAX_LINES = 600;
const MAX_JOBS = 30;

export const INSTALL_KEY_CMD =
  `sh -c 'umask 077; d="$HOME/.ssh"; f="$d/authorized_keys"; mkdir -p "$d"; touch "$f"; read -r k; [ -n "$k" ] || exit 2; ` +
  `grep -qxF "$k" "$f" || { [ -z "$(tail -c1 "$f")" ] || echo >> "$f"; printf "%s\\n" "$k" >> "$f"; }'`;

export const REVOKE_KEY_CMD =
  `sh -c 'f="$HOME/.ssh/authorized_keys"; read -r k; [ -n "$k" ] || exit 2; [ -f "$f" ] || exit 0; ` +
  `grep -vxF "$k" "$f" > "$f.new"; rc=$?; [ "$rc" -le 1 ] || exit 1; chmod 600 "$f.new"; mv "$f.new" "$f"'`;

export interface JobRequest {
  action: Action;
  /** 记住的服务器：用它的地址和密钥，主机密钥必须一致 */
  serverId?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  /** 这次登录成功后记住这台服务器（装一把 evps 专用的公钥） */
  remember?: boolean;
}

export interface Reach {
  ok: boolean;
  port: number;
}

export interface JobResult {
  /** install：新装好的；already：已经装过 */
  kind: 'installed' | 'already' | 'status' | 'stopped' | 'started' | 'uninstalled' | 'not-installed';
  panel?: PanelInfo;
  status?: StatusInfo & { unitLabels: Record<string, string> };
  reach?: Reach;
  /** 这次记住了服务器，或卸载后忘掉了 */
  remembered?: string;
  forgotten?: boolean;
}

export interface JobView {
  id: string;
  action: Action;
  label: string;
  target: { host: string; port: number; user: string };
  state: 'running' | 'ok' | 'failed';
  steps: Step[];
  /** 从 from 开始的日志行；next 是下一次轮询要给的 from */
  lines: string[];
  next: number;
  result: JobResult | null;
  error: { code: string; message: string } | null;
  startedAt: string;
}

interface Job {
  id: string;
  action: Action;
  target: Target;
  state: JobView['state'];
  steps: Step[];
  lines: string[];
  /** 已经丢掉的最早的行数（只保留最近 MAX_LINES 行） */
  dropped: number;
  result: JobResult | null;
  error: { code: string; message: string } | null;
  startedAt: string;
}

export interface JobsOptions {
  store: Store;
  /** vps.sh 的内容；测试可以换 */
  vpsScript?: string;
  /** 面板端口可达性检测；测试可以换 */
  probe?: (host: string, port: number) => Promise<boolean>;
}

export function readVpsScript(): string {
  return readFileSync(rootFile('remote', 'vps.sh'), 'utf8');
}

/** 从这台电脑连一下面板端口：能建立 TCP 连接就算通 */
export function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function probeRepeatedly(probe: (h: string, p: number) => Promise<boolean>, host: string, port: number): Promise<boolean> {
  for (let i = 0; i < 4; i += 1) {
    if (await probe(host, port)) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function hostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** 远端命令：把 vps.sh 用 base64 送过去执行，用完删掉 */
export function remoteCommand(script: string, action: Action, isRoot: boolean): string {
  const b64 = Buffer.from(script.replace(/\r/g, ''), 'utf8').toString('base64');
  const run = isRoot
    ? 'bash "$d/v.sh"'
    : `command -v sudo >/dev/null 2>&1 || { echo '@@EVPS NO_SUDO'; exit 3; }; sudo -p '${SUDO_PROMPT}' bash "$d/v.sh"`;
  return `d=$(mktemp -d) && printf %s ${b64} | base64 -d > "$d/v.sh" && { ${run} ${action}; }; rc=$?; rm -rf "$d"; exit $rc`;
}

const FAILURES: Record<string, string> = {
  NO_SUDO: '这个账号不是 root，服务器上也没有 sudo。请改用 root 账号。',
  NEED_ROOT: '需要 root 权限。请改用 root 账号。',
  NO_DOWNLOADER: '服务器上没有 curl 也没有 wget，而且自动安装失败了。请确认服务器能上网。',
  DOWNLOAD_FAILED: '服务器下载不了官方安装脚本。请确认这台 VPS 能上网、能访问 www.geto.im。',
  PROMPT_CHANGED: '官方安装脚本的提问变了。为了不乱填，已经停下，什么都没装。请等 evps 更新后再试。',
  STOP_FAILED: '停止后面板服务仍在运行，请再试一次。',
  START_FAILED: '面板服务没能启动，上面的日志里有原因。',
  UNINSTALL_FAILED: '卸载没有完成，服务器上还留有面板文件。请再试一次。',
};

export class Jobs {
  private readonly jobs = new Map<string, Job>();
  private readonly store: Store;
  private readonly vpsScript: string;
  private readonly probe: (host: string, port: number) => Promise<boolean>;

  constructor(opts: JobsOptions) {
    this.store = opts.store;
    this.vpsScript = opts.vpsScript ?? readVpsScript();
    this.probe = opts.probe ?? ((h, p) => tcpProbe(h, p));
  }

  start(req: JobRequest): JobView {
    if (!ACTIONS.includes(req.action)) throw new PanelError('BAD_INPUT', '不认识的操作');
    let target: Target;
    let expected: Buffer | null = null;
    const auth: Auth = {};
    const password = req.password === undefined || req.password === '' ? undefined : req.password;
    if (password !== undefined && !validPassword(password)) throw new PanelError('BAD_INPUT', '密码不能含换行');
    if (req.serverId !== undefined) {
      const entry = this.store.get(req.serverId);
      if (!entry) throw new PanelError('NOT_FOUND', '没有这台记住的服务器');
      target = { host: entry.host, port: entry.port, user: entry.user };
      expected = Buffer.from(entry.hostKey, 'base64');
      auth.privateKey = this.store.keyPair().privateKey;
      if (password !== undefined) auth.password = password;
    } else {
      if (!validHost(req.host)) throw new PanelError('BAD_INPUT', '服务器 IP 不对');
      if (!validPort(req.port)) throw new PanelError('BAD_INPUT', 'SSH 端口要在 1 到 65535');
      if (!validUser(req.user)) throw new PanelError('BAD_INPUT', 'SSH 用户名不对');
      if (password === undefined) throw new PanelError('BAD_INPUT', '请输入 SSH 密码');
      target = { host: req.host, port: req.port, user: req.user };
      auth.password = password;
      const known = this.store.find(target.host, target.port, target.user);
      if (known) expected = Buffer.from(known.hostKey, 'base64');
    }
    for (const job of this.jobs.values()) {
      if (job.state === 'running' && job.target.host === target.host && job.target.port === target.port) {
        throw new PanelError('BUSY', '这台服务器上还有操作没做完，请等它结束');
      }
    }
    const job: Job = {
      id: randomBytes(8).toString('hex'),
      action: req.action,
      target,
      state: 'running',
      steps: req.action === 'install' ? initialSteps(INSTALL_STEPS) : [],
      lines: [],
      dropped: 0,
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
    };
    startFirst(job.steps);
    this.jobs.set(job.id, job);
    this.prune();
    void this.run(job, auth, expected, req.remember === true && req.serverId === undefined).catch((error: unknown) => {
      const e = error instanceof PanelError ? error : new PanelError('INTERNAL', '程序内部错误：' + String((error as Error)?.message ?? error).slice(0, 200));
      job.error = { code: e.code, message: e.message };
      job.state = 'failed';
      failRunning(job.steps);
    });
    return this.view(job, 0);
  }

  get(id: string, from = 0): JobView {
    const job = this.jobs.get(id);
    if (!job) throw new PanelError('NOT_FOUND', '没有这个任务');
    return this.view(job, from);
  }

  running(): boolean {
    for (const job of this.jobs.values()) if (job.state === 'running') return true;
    return false;
  }

  private view(job: Job, from: number): JobView {
    const start = Math.max(0, from - job.dropped);
    return {
      id: job.id,
      action: job.action,
      label: ACTION_LABEL[job.action],
      target: { ...job.target },
      state: job.state,
      steps: job.steps.map((s) => ({ ...s })),
      lines: job.lines.slice(start),
      next: job.dropped + job.lines.length,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
    };
  }

  private prune(): void {
    if (this.jobs.size <= MAX_JOBS) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (job.state !== 'running') this.jobs.delete(id);
    }
  }

  private log(job: Job, line: string): void {
    job.lines.push(line);
    if (job.lines.length > MAX_LINES) {
      const cut = job.lines.length - MAX_LINES;
      job.lines.splice(0, cut);
      job.dropped += cut;
    }
  }

  private async run(job: Job, auth: Auth, expected: Buffer | null, remember: boolean): Promise<void> {
    this.log(job, `[evps] 正在连接 ${job.target.user}@${job.target.host}（SSH 端口 ${job.target.port}）…`);
    const { conn, hostKey } = await connect(job.target, auth, expected);
    try {
      this.log(job, '[evps] 已连上服务器');
      if (job.action === 'install') completeStep(job.steps, 'connect');
      let remembered: string | undefined;
      if (remember) {
        const { publicKey } = this.store.keyPair();
        const r = await exec(conn, INSTALL_KEY_CMD, { stdin: publicKey + '\n' });
        if (r.code === 0) {
          remembered = this.store.remember(job.target, hostKey).id;
          this.log(job, '[evps] 已记住这台服务器，下次不用再输密码');
        } else {
          this.log(job, '[evps] 没能记住这台服务器（写入公钥失败），这次操作照常进行');
        }
      }
      const creds = newPanelCreds(job.target.port);
      const { lines, code } = await this.runVps(job, conn, auth.password, creds);
      await this.finish(job, conn, lines, code, creds, remembered);
    } finally {
      conn.end();
    }
  }

  /** 在服务器上跑 vps.sh，边看边回答提问；返回去掉颜色后的全部输出行和退出码 */
  private async runVps(job: Job, conn: SshClient, password: string | undefined, creds: PanelCreds): Promise<{ lines: string[]; code: number }> {
    const isRoot = job.target.user === 'root';
    if (!isRoot && password === undefined) {
      throw new PanelError('NEED_PASSWORD', '这个账号不是 root，要用 sudo，请在密码框里输入这个账号的密码再试。');
    }
    const all: string[] = [];
    let partial = '';
    /** 刚回答过的提问文字：接到回显的那一行前面，日志里看起来就是「面板端口 [2053]: 34567」 */
    let prefix = '';
    let answered = 0;
    let sudoTries = 0;
    const failure: { error: PanelError | null } = { error: null };
    let control: PtyControl | undefined;
    const secrets = [creds.pass, ...(password ? [password] : [])];
    const hide = (text: string): string => secrets.reduce((t, s) => (s.length >= 4 ? t.split(s).join('••••••') : t), text);
    const stop = (e: PanelError): void => {
      if (!failure.error) failure.error = e;
      control?.close();
    };

    const session = await runPty(conn, remoteCommand(this.vpsScript, job.action, isRoot), (chunk, ctl) => {
      control = ctl;
      partial += stripAnsi(chunk.replace(/\r\n/g, '\n')).replace(/\r/g, '\n');
      const parts = partial.split('\n');
      partial = parts.pop() ?? '';
      for (const raw of parts) {
        const line = (prefix + raw).replace(/\s+$/, '');
        prefix = '';
        all.push(line);
        if (job.action === 'install') advanceInstall(job.steps, line);
        if (/is not in the sudoers|不在 sudoers/.test(line)) stop(new PanelError('NO_SUDO', '这个账号没有 sudo 权限。请改用 root 账号。'));
        if (!line.startsWith('@@EVPS ') && line.trim() !== '') this.log(job, hide(line));
      }
      // 还没换行的那一截：可能是在等输入
      if (partial.endsWith(SUDO_PROMPT) || partial.endsWith(SUDO_PROMPT.trim())) {
        sudoTries += 1;
        partial = '';
        if (sudoTries > 1 || password === undefined) {
          stop(new PanelError('SUDO_PASSWORD', 'sudo 密码不对。'));
          return;
        }
        ctl.write(password + '\n');
        return;
      }
      if (job.action !== 'install' || partial === '') return;
      const expect = PROMPTS[answered];
      if (expect && expect.re.test(partial)) {
        const answer = expect.key === 'port' ? String(creds.port) : expect.key === 'user' ? creds.user : creds.pass;
        answered += 1;
        prefix = partial;
        partial = '';
        ctl.write(answer + '\n');
        if (answered === PROMPTS.length) completeStep(job.steps, 'answer');
        return;
      }
      // 不按顺序出现的提问（比如官方脚本说端口不合法、让重新输入）：不乱填，停下
      if (PROMPTS.some((p) => p.re.test(partial))) stop(new PanelError('PROMPT_CHANGED', FAILURES.PROMPT_CHANGED as string));
    });
    control = session;
    const timer = setTimeout(() => {
      stop(new PanelError('TIMEOUT', `${ACTION_LABEL[job.action]}超过 ${Math.round(TIMEOUT_MS[job.action] / 60000)} 分钟还没结束，已经停下。`));
    }, TIMEOUT_MS[job.action]);
    const code = await session.done;
    clearTimeout(timer);
    const tail = (prefix + partial).trim();
    if (tail) {
      all.push(tail);
      if (!tail.startsWith('@@EVPS ')) this.log(job, hide(tail));
    }
    if (failure.error) throw failure.error;
    const seen = markers(all);
    for (const key of Object.keys(FAILURES)) {
      if (seen.has(key)) throw new PanelError(key, FAILURES[key] as string);
    }
    if (code === null) {
      throw new PanelError('DISCONNECTED', '和服务器的连接断开了，操作可能没做完。稍后点「查看状态」看看。');
    }
    return { lines: all, code };
  }

  private async finish(job: Job, conn: SshClient, lines: string[], code: number, creds: PanelCreds, remembered: string | undefined): Promise<void> {
    const seen = markers(lines);
    const notInstalled = lines.includes('@@EVPS INSTALLED 0');
    const withLabels = (s: StatusInfo): StatusInfo & { unitLabels: Record<string, string> } => ({
      ...s, unitLabels: Object.fromEntries(s.units.map((u) => [u.name, unitLabel(u.name)])),
    });
    const base: Partial<JobResult> = remembered ? { remembered } : {};
    switch (job.action) {
      case 'install': {
        if (seen.has('ALREADY')) {
          const status = parseStatus(lines);
          job.result = { ...base, kind: 'already', status: withLabels(status), panel: status };
          this.log(job, '[evps] 这台服务器已经装过面板，没有重装。下面是现在的登录信息。');
          break;
        }
        const rc = /^@@EVPS INSTALL_RC (\d+)$/.exec(lines.find((l) => l.startsWith('@@EVPS INSTALL_RC')) ?? '');
        if (!rc || rc[1] !== '0' || code !== 0) {
          throw new PanelError('INSTALL_FAILED', `安装没有完成（退出码 ${rc ? rc[1] : code}）。请展开下面的日志看原因。`);
        }
        const got = parseInstallResult(lines);
        const panel: PanelInfo = {
          address: got.address ?? `http://${hostForUrl(job.target.host)}:${creds.port}`,
          domainAddress: null,
          user: got.user ?? creds.user,
          pass: got.pass ?? creds.pass,
          version: got.version,
        };
        const port = Number(/:(\d+)\/?$/.exec(panel.address ?? '')?.[1] ?? creds.port);
        this.log(job, '[evps] 正在从这台电脑测试能不能打开面板…');
        const ok = await probeRepeatedly(this.probe, job.target.host, port);
        // 从这台电脑连，用的是 SSH 的地址；官方脚本打印的是服务器自己查到的公网 IP，一般一样
        job.result = { ...base, kind: 'installed', panel, reach: { ok, port } };
        completeStep(job.steps, 'finish');
        break;
      }
      case 'status': {
        if (code !== 0) throw new PanelError('REMOTE', `查看状态没有完成（退出码 ${code}）。请展开下面的日志看原因。`);
        const status = parseStatus(lines);
        const result: JobResult = { ...base, kind: status.installed ? 'status' : 'not-installed', status: withLabels(status), panel: status };
        const port = Number(/:(\d+)\/?$/.exec(status.address ?? '')?.[1] ?? NaN);
        if (status.installed && Number.isInteger(port) && !status.stopped) result.reach = { ok: await probeRepeatedly(this.probe, job.target.host, port), port };
        job.result = result;
        break;
      }
      case 'stop':
      case 'start':
      case 'uninstall': {
        const okMark = job.action === 'stop' ? 'STOPPED_OK' : job.action === 'start' ? 'STARTED_OK' : 'UNINSTALLED_OK';
        if (!notInstalled && (code !== 0 || !seen.has(okMark))) {
          throw new PanelError('REMOTE', `${ACTION_LABEL[job.action]}没有完成（退出码 ${code}）。请展开下面的日志看原因。`);
        }
        const kind = notInstalled ? 'not-installed' : job.action === 'stop' ? 'stopped' : job.action === 'start' ? 'started' : 'uninstalled';
        job.result = { ...base, kind };
        if (job.action === 'uninstall') await this.forgetAfterUninstall(job, conn);
        break;
      }
    }
    job.state = 'ok';
  }

  /** 卸载后，把 evps 装过的公钥也从服务器上拿掉，并忘掉这台服务器 */
  private async forgetAfterUninstall(job: Job, conn: SshClient): Promise<void> {
    const entry = this.store.find(job.target.host, job.target.port, job.target.user);
    if (!entry || !job.result) return;
    const { publicKey } = this.store.keyPair();
    try {
      const r = await exec(conn, REVOKE_KEY_CMD, { stdin: publicKey + '\n' });
      this.log(job, r.code === 0 ? '[evps] 已从服务器上移除 evps 的登录公钥' : '[evps] 移除 evps 的登录公钥失败，可以在服务器的 ~/.ssh/authorized_keys 里手动删掉末尾是 evps 的那一行');
    } catch {
      this.log(job, '[evps] 移除 evps 的登录公钥失败，可以在服务器的 ~/.ssh/authorized_keys 里手动删掉末尾是 evps 的那一行');
    }
    this.store.forget(entry.id);
    job.result.forgotten = true;
  }
}
