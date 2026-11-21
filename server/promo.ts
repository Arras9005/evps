/**
 * 「看看我推荐的 VPS」页面的内容。在包根目录的 promo.json 里，改链接、改文案只改那个文件。
 * 只接受 https 链接；文件坏了就不显示推荐入口，不影响安装。
 */
import { readFileSync } from 'node:fs';
import { rootFile } from './paths.ts';

export interface Provider {
  name: string;
  url: string;
  note: string;
}

/** 推荐页上的核心卖点：图标 + 短标题 + 一句说明 */
export interface Highlight {
  icon: string;
  title: string;
  desc: string;
}

/** 卖点能用的图标（web/src/components/AppIcon.vue 里有的） */
export const HIGHLIGHT_ICONS = ['tag', 'globe', 'search', 'shield', 'clock', 'cpu', 'check'] as const;

export interface Promo {
  providers: Provider[];
  /** 页面开头的一句话：为什么推荐、不强制 */
  intro: string;
  /** 核心卖点，最多 4 条 */
  highlights: Highlight[];
  /** 作者为什么推荐这家，一条一行（没有 highlights 时才显示） */
  reasons: string[];
  /** 买 VPS 时的注意事项，一条一行 */
  tips: string[];
}

const EMPTY: Promo = { providers: [], intro: '', highlights: [], tips: [], reasons: [] };

function text(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f<>]/.test(v) ? v.trim() : null;
}

export function parsePromo(raw: unknown): Promo {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as { providers?: unknown; tips?: unknown; reasons?: unknown; intro?: unknown; highlights?: unknown };
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
  const reasons = (Array.isArray(r.reasons) ? r.reasons : []).map((t) => text(t, 200)).filter((t): t is string => t !== null).slice(0, 6);
  const highlights: Highlight[] = [];
  for (const h of Array.isArray(r.highlights) ? r.highlights.slice(0, 4) : []) {
    const title = text((h as Highlight)?.title, 16);
    const desc = text((h as Highlight)?.desc, 60);
    const icon = text((h as Highlight)?.icon, 20);
    if (!title || !desc) continue;
    highlights.push({ title, desc, icon: icon && (HIGHLIGHT_ICONS as readonly string[]).includes(icon) ? icon : 'check' });
  }
  return { providers, intro: text(r.intro, 200) ?? '', highlights, tips, reasons };
}

export function loadPromo(): Promo {
  try {
    return parsePromo(JSON.parse(readFileSync(rootFile('promo.json'), 'utf8')));
  } catch {
    return EMPTY;
  }
}
