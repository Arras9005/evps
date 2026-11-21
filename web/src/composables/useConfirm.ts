import { reactive, readonly } from 'vue';

export interface ConfirmRequest {
  title: string;
  body: string[];
  ok: string;
  danger?: boolean;
}

const state = reactive<{ current: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null }>({ current: null });

/** 页面自己的确认框（不用浏览器自带的 confirm）。App.vue 里放一个 ConfirmHost 显示它 */
export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  state.current?.resolve(false);
  return new Promise((resolve) => {
    state.current = { ...req, resolve };
  });
}

export function answerConfirm(ok: boolean): void {
  const c = state.current;
  state.current = null;
  c?.resolve(ok);
}

export function useConfirm() {
  return readonly(state);
}
