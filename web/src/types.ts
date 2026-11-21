/** 和后端 server/jobs.ts、server/http.ts 对应的类型（只放页面用到的字段） */
export type Action = 'install' | 'status' | 'stop' | 'start' | 'uninstall';
export type StepState = 'pending' | 'running' | 'done' | 'warn' | 'failed';

export interface Step { id: string; label: string; state: StepState }

export interface PanelInfo {
  address: string | null;
  domainAddress: string | null;
  user: string | null;
  pass: string | null;
  version: string | null;
}

export interface UnitState { name: string; active: string; enabled: string }

export interface StatusInfo extends PanelInfo {
  installed: boolean;
  stopped: boolean;
  units: UnitState[];
  unitLabels: Record<string, string>;
}

export interface JobResult {
  kind: 'installed' | 'already' | 'status' | 'stopped' | 'started' | 'uninstalled' | 'not-installed';
  panel?: PanelInfo;
  status?: StatusInfo;
  reach?: { ok: boolean; port: number };
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
  lines: string[];
  next: number;
  result: JobResult | null;
  error: { code: string; message: string } | null;
}

export interface SavedServer { id: string; host: string; port: number; user: string; fingerprint: string; addedAt: string }

export interface Provider { name: string; url: string; note: string }
export interface Highlight { icon: string; title: string; desc: string }
export interface Info { version: string; promo: { providers: Provider[]; intro: string; highlights: Highlight[]; reasons: string[]; tips: string[] }; platform: string }

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: { code: string; message: string } };
