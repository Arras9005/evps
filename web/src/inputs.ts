/**
 * 输入框不要浏览器和密码管理器插手：不弹历史记录、不弹「使用已保存的密码」、提交后不问「要保存密码吗」。
 * - 普通输入框：autocomplete=off，再加上常见密码管理器（LastPass、1Password、Bitwarden、Dashlane）认的忽略标记；
 * - 密码框：支持 -webkit-text-security 的浏览器（Chrome、Edge、Safari）用普通文本框 + 圆点遮罩，
 *   浏览器就不把它当成密码框，自然不会弹保存提示；不支持的浏览器退回 type=password + autocomplete=new-password。
 */
export const noFill = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: 'false',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

export const canMask = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
