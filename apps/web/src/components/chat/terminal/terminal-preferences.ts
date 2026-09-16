/**
 * 终端侧轻量偏好（localStorage 持久化）。
 *
 * 放在 localStorage 而不是 Zustand store：这两项只影响单个终端组件的行为，
 * 没有跨组件订阅需求，也不该让全局 store 承担终端细节。读写全部包了
 * try/catch —— 隐私模式 / 沙箱 iframe 下 localStorage 会直接抛错，
 * 此时偏好退化成默认值即可，不能让终端挂掉。
 */

export const TERMINAL_PREFERENCE_KEYS = {
  /** 「粘贴保护」确认框不再提示（用户勾选后永久跳过）。 */
  pasteGuardDisabled: 'openAwork.terminal.pasteGuardDisabled',
  /** 「选中即复制」开关，默认关闭。 */
  copyOnSelect: 'openAwork.terminal.copyOnSelect',
} as const;

export type TerminalPreferenceKey = keyof typeof TERMINAL_PREFERENCE_KEYS;

export function readTerminalPreference(key: TerminalPreferenceKey): boolean {
  try {
    return globalThis.localStorage?.getItem(TERMINAL_PREFERENCE_KEYS[key]) === '1';
  } catch {
    /* localStorage 不可用（隐私模式）→ 走默认值 */
    return false;
  }
}

export function writeTerminalPreference(key: TerminalPreferenceKey, enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(TERMINAL_PREFERENCE_KEYS[key], enabled ? '1' : '0');
  } catch {
    /* 写不进去只影响下次打开的记忆，不影响本次会话行为 */
  }
}
