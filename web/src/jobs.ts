/**
 * 跑一个任务直到结束，以及每台服务器「最近一次查到的状态」。
 * 首页列表和服务器详情共用这份状态：同一台服务器同一时间只查一次（后端也不允许同一台服务器上同时跑两个任务）。
 */
import { reactive } from 'vue';
import { api } from './api.ts';
import type { Action, JobResult, JobView, StatusInfo } from './types.ts';

/** 怎么连这台服务器：记住的用 serverId；没记住的用这次填的地址和密码（只放在网页内存里） */
export type Conn =
  | { serverId: string; password?: string }
  | { host: string; port: number; user: string; password: string; remember?: boolean };

export type JobFailure = { code: string; message: string };

/** 开始一个任务，每 0.7 秒取一次进度，结束时返回最后的样子。onUpdate 每次拿到进度都会调用 */
export async function runJob(action: Action, conn: Conn, onUpdate?: (job: JobView, newLines: string[]) => void): Promise<JobView | JobFailure> {
  const body: Record<string, unknown> = { action, ...conn };
  if ('serverId' in conn && !conn.password) delete body.password;
  const r = await api<JobView>('/api/jobs', { method: 'POST', body });
  if (!r.ok) return r.error;
  let job = r.data;
  onUpdate?.(job, job.lines);
  while (job.state === 'running') {
    await new Promise((ok) => setTimeout(ok, 700));
    const p = await api<JobView>(`/api/jobs/${job.id}?from=${job.next}`);
    if (!p.ok) return p.error;
    job = p.data;
    onUpdate?.(job, job.lines);
  }
  return job;
}

export function isFailure(x: JobView | JobFailure): x is JobFailure {
  return !('id' in x);
}

export type Health = 'checking' | 'running' | 'stopped' | 'partial' | 'not-installed' | 'unreachable' | 'unknown';

export interface ServerState {
  checking: boolean;
  result: JobResult | null;
  error: JobFailure | null;
  lines: string[];
  /** 上次查完的时间（毫秒），0 表示还没查过 */
  checkedAt: number;
}

const states = reactive<Record<string, ServerState>>({});
const inflight = new Map<string, Promise<void>>();

export function serverState(key: string): ServerState {
  if (!states[key]) states[key] = { checking: false, result: null, error: null, lines: [], checkedAt: 0 };
  return states[key] as ServerState;
}

export function forgetState(key: string): void {
  delete states[key];
}

/** 查一遍状态；同一台正在查就等它查完，不重复连 */
export function checkStatus(key: string, conn: Conn): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const s = serverState(key);
  s.checking = true;
  const p = (async () => {
    const lines: string[] = [];
    const job = await runJob('status', conn, (_j, more) => { lines.push(...more); });
    s.lines = lines;
    if (isFailure(job)) {
      s.error = job;
    } else if (job.state === 'failed') {
      s.error = job.error ?? { code: 'ERROR', message: '查看状态没有成功' };
    } else {
      s.error = null;
      s.result = job.result;
    }
    s.checking = false;
    s.checkedAt = Date.now();
    inflight.delete(key);
  })();
  inflight.set(key, p);
  return p;
}

/** 别的操作（安装、停止……）拿到了新结果，直接记下来，省一次查询 */
export function setResult(key: string, result: JobResult | null): void {
  const s = serverState(key);
  s.result = result;
  s.error = null;
  s.checkedAt = Date.now();
}

/** 最近查过就不再查（首页和详情页来回切换时不反复连服务器） */
export function checkIfStale(key: string, conn: Conn, maxAgeMs = 60_000): void {
  const s = serverState(key);
  if (s.checking || Date.now() - s.checkedAt < maxAgeMs) return;
  void checkStatus(key, conn);
}

export function unitsOf(result: JobResult | null): StatusInfo['units'] {
  return result?.status?.units ?? [];
}

export function healthOf(s: ServerState): Health {
  if (s.checking && !s.result && !s.error) return 'checking';
  if (s.error) return 'unreachable';
  const r = s.result;
  if (!r) return 'unknown';
  if (r.kind === 'not-installed' || r.kind === 'uninstalled') return 'not-installed';
  if (r.kind === 'stopped') return 'stopped';
  if (r.kind === 'installed' || r.kind === 'started') return 'running';
  const st = r.status;
  if (!st) return 'running';
  if (st.stopped) return 'stopped';
  const units = st.units;
  if (units.length === 0) return 'running';
  const active = units.filter((u) => u.active === 'active').length;
  if (active === units.length) return 'running';
  if (active === 0) return 'stopped';
  return 'partial';
}

export const HEALTH_TEXT: Record<Health, string> = {
  checking: '正在查看…',
  running: '运行中',
  stopped: '已停止',
  partial: '部分没在运行',
  'not-installed': '未安装',
  unreachable: '连不上',
  unknown: '未知',
};
