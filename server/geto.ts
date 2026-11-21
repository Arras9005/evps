/**
 * 和官方安装脚本（https://www.geto.im/panel/install.sh）打交道的部分：
 * - 认提问：只认「面板端口 → 面板用户名 → 面板密码（回车随机）」这三个，按顺序；出现别的提问就停下；
 * - 认进度：把官方脚本的 [OK]/[INFO] 行对应到页面上的步骤；
 * - 认结果：官方脚本最后打印的地址、用户名、密码，以及 vps.sh 的 @@EVPS 行。
 */

export const PROMPTS: readonly { key: 'port' | 'user' | 'pass'; re: RegExp }[] = [
  { key: 'port', re: /面板端口 \[\d+\]: $/ },
  { key: 'user', re: /面板用户名 \[[^\]\n]*\]: $/ },
  { key: 'pass', re: /面板密码（回车随机）: $/ },
];


export const SUDO_PROMPT = '@@EVPS_SUDO@@ ';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(ANSI, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export type StepState = 'pending' | 'running' | 'done' | 'warn' | 'failed';

export interface Step {
  id: string;
  label: string;
  state: StepState;
}

interface StepRule {
  id: string;
  label: string;
  /** 这一步完成的标志（出现在输出的某一整行里） */
  done?: RegExp;
  warn?: RegExp;
}

export const INSTALL_STEPS: readonly StepRule[] = [
  { id: 'connect', label: '连接服务器' },
  { id: 'download', label: '下载官方安装脚本', done: /^@@EVPS INSTALL_START/ },
  { id: 'answer', label: '自动填写端口、用户名、密码' },
  { id: 'deps', label: '安装系统依赖（较慢）', done: /依赖就绪/ },
  { id: 'files', label: '下载面板文件', done: /面板文件$/ },
  { id: 'python', label: '准备 Python 环境', done: /Python 环境就绪/ },
  { id: 'service', label: '启动面板服务', done: /面板服务已启动/ },
  { id: 'cores', label: '安装并启动 Xray / Hysteria2（较慢）', done: /Xray \/ Hysteria2 已启动/, warn: /核心启动未完成/ },
  { id: 'finish', label: '完成', done: /^@@EVPS INSTALL_RC 0$/ },
];

export function initialSteps(rules: readonly StepRule[]): Step[] {
  return rules.map((r) => ({ id: r.id, label: r.label, state: 'pending' as StepState }));
}

/** 标记某一步完成，并把下一步设成进行中。前面没完成的一并算完成（官方脚本有的步骤不打印） */
export function completeStep(steps: Step[], id: string, state: 'done' | 'warn' = 'done'): void {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0) return;
  for (let j = 0; j < i; j += 1) {
    const s = steps[j] as Step;
    if (s.state === 'pending' || s.state === 'running') s.state = 'done';
  }
  (steps[i] as Step).state = state;
  const next = steps[i + 1];
  if (next && next.state === 'pending') next.state = 'running';
}

export function startFirst(steps: Step[]): void {
  const first = steps[0];
  if (first && first.state === 'pending') first.state = 'running';
}

export function failRunning(steps: Step[]): void {
  for (const s of steps) if (s.state === 'running') s.state = 'failed';
}

/** 按输出的一整行推进安装步骤 */
export function advanceInstall(steps: Step[], line: string): void {
  for (const rule of INSTALL_STEPS) {
    if (rule.warn && rule.warn.test(line)) completeStep(steps, rule.id, 'warn');
    else if (rule.done && rule.done.test(line)) completeStep(steps, rule.id, 'done');
  }
}

export interface PanelInfo {
  address: string | null;
  domainAddress: string | null;
  user: string | null;
  pass: string | null;
  version: string | null;
}

/** 官方安装脚本最后的那一块：「  地址   : http://…」「  用户名 : …」「  密码   : …」 */
export function parseInstallResult(lines: readonly string[]): PanelInfo {
  const info: PanelInfo = { address: null, domainAddress: null, user: null, pass: null, version: null };
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^\s*地址\s*:\s*(\S+)\s*$/.exec(line))) info.address = m[1] as string;
    else if ((m = /^\s*用户名\s*:\s*(\S+)\s*$/.exec(line))) info.user = m[1] as string;
    else if ((m = /^\s*密码\s*:\s*(\S+)\s*$/.exec(line))) info.pass = m[1] as string;
    else if ((m = /^@@EVPS INSTALL_START (\S+)$/.exec(line))) info.version = m[1] as string;
  }
  return info;
}

export interface UnitState {
  name: string;
  active: string;
  enabled: string;
}

export interface StatusInfo extends PanelInfo {
  installed: boolean;
  stopped: boolean;
  units: UnitState[];
}

/** vps.sh status 的 @@EVPS 行 */
export function parseStatus(lines: readonly string[]): StatusInfo {
  const s: StatusInfo = { installed: false, stopped: false, units: [], address: null, domainAddress: null, user: null, pass: null, version: null };
  for (const line of lines) {
    if (!line.startsWith('@@EVPS ')) continue;
    const rest = line.slice(7);
    const sp = rest.indexOf(' ');
    const key = sp < 0 ? rest : rest.slice(0, sp);
    const value = sp < 0 ? '' : rest.slice(sp + 1).trim();
    if (key === 'INSTALLED') s.installed = value === '1';
    else if (key === 'STOPPED') s.stopped = value === '1';
    else if (key === 'UNIT') {
      const [name, active, enabled] = value.split(/\s+/);
      if (name) s.units.push({ name, active: active ?? '', enabled: enabled ?? '' });
    } else if (key === 'ADDR') s.address = value || null;
    else if (key === 'DOMAIN_ADDR') s.domainAddress = value || null;
    else if (key === 'USER') s.user = value || null;
    else if (key === 'PASS') s.pass = value.startsWith('（') ? null : value || null;
    else if (key === 'VERSION') s.version = value || null;
  }
  return s;
}

export function markers(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const line of lines) if (line.startsWith('@@EVPS ')) out.add((line.slice(7).split(' ')[0] ?? '').trim());
  return out;
}

/** 给人看的服务名 */
export function unitLabel(name: string): string {
  if (name === 'np-panel') return '面板';
  if (name === 'xray') return 'Xray';
  if (name === 'hysteria-server') return 'Hysteria2';
  const m = /^np-hysteria2?-(.+)$/.exec(name);
  return m ? `Hysteria2（${m[1]}）` : name;
}
