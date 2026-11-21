import { reactive, readonly } from 'vue';

export interface ToastItem {
  id: number;
  text: string;
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });
let next = 1;

/** 短暂的成功或进度提示。出错用页面顶部的提示条，不用 toast（toast 会自己消失，错误不能）。 */
export function showToast(text: string, ms = 2600): void {
  const id = next;
  next += 1;
  state.items.push({ id, text });
  if (state.items.length > 3) state.items.shift();
  setTimeout(() => {
    const i = state.items.findIndex((t) => t.id === id);
    if (i >= 0) state.items.splice(i, 1);
  }, ms);
}

export function useToasts() {
  return readonly(state);
}
