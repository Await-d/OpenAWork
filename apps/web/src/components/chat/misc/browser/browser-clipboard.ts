/**
 * 内置浏览器面板与外部世界的两个出口：系统剪贴板、聊天输入框。
 *
 * 抽成独立模块的原因：事件名 `openawork:composer:insert` 原本以字面量散落在
 * 组件里，任何一处改字都会静默失效（dispatch 没有监听者不会报错）。集中到
 * 这里，字符串只出现一次，也便于单测。
 */

import type { ConsoleEntry } from './browser-console-types.js';
import { formatEntryForComposer } from './browser-console-format.js';

/** 与 composer 约定的插入事件；Listener 在 Composer 侧监听。 */
export const COMPOSER_INSERT_EVENT = 'openawork:composer:insert';

export type ComposerInsertMode = 'append' | 'replace';

/**
 * 复制文本到系统剪贴板。
 *
 * `navigator.clipboard` 在非安全上下文（http 非 localhost）与无权限时不可用，
 * 因此回落 `execCommand('copy')` + 隐藏 textarea。
 *
 * @returns 是否复制成功（供 UI 显示"已复制 / 复制失败"）。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文 —— 继续走回落路径
  }
  return copyViaTextarea(text);
}

function copyViaTextarea(text: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // 留在视口内但不可见，否则 iOS 上 execCommand 会失效。
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 把文本插入聊天输入框（走既有事件桥，不直接操作 composer 内部状态）。 */
export function insertTextIntoComposer(text: string, mode: ComposerInsertMode = 'append'): void {
  if (text.length === 0) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail: { text, mode } }));
}

/** 把一条控制台/网络记录引用进输入框，文案为给 LLM 读的版本。 */
export function quoteEntryIntoComposer(entry: ConsoleEntry): void {
  insertTextIntoComposer(formatEntryForComposer(entry));
}
