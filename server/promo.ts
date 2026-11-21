/**
 * 首页「我还没有 VPS」按钮的推荐链接。内容在包根目录的 promo.json 里，改链接只改那个文件。
 * 只接受 https 链接；文件坏了就不显示这个按钮，不影响安装。
 */
import { readFileSync } from 'node:fs';
import { rootFile } from './paths.ts';

export interface Provider {
  name: string;
  url: string;
  note: string;
}

export interface Promo {
  providers: Provider[];
  /** 买 VPS 时的注意事项，一条一行 */
  tips: string[];
}

const EMPTY: Promo = { providers: [], tips: [] };

function text(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f<>]/.test(v) ? v.trim() : null;
}

export function parsePromo(raw: unknown): Promo {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as { providers?: unknown; tips?: unknown };
  const providers: Provider[] = [];
  for (const p of Array.isArray(r.providers) ? r.providers.slice(0, 5) : []) {
    const name = text((p as Provider)?.name, 40);
    const url = text((p as Provider)?.url, 500);
    const note = text((p as Provider)?.note, 120) ?? '';
    if (!name || !url) continue;
    try {
      if (new URL(url).protocol !== 'https:') continue;
    } catch {
      continue;
    }
    providers.push({ name, url, note });
  }
  const tips = (Array.isArray(r.tips) ? r.tips : []).map((t) => text(t, 120)).filter((t): t is string => t !== null).slice(0, 8);
  return { providers, tips };
}

export function loadPromo(): Promo {
  try {
    return parsePromo(JSON.parse(readFileSync(rootFile('promo.json'), 'utf8')));
  } catch {
    return EMPTY;
  }
}
