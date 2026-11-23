/**
 * 复制文本到系统剪贴板。
 *
 * `navigator.clipboard` 只在安全上下文（HTTPS / localhost）存在：通过
 * `http://<内网 IP 或域名>` 访问时它是 `undefined`，直接取 `.writeText` 会抛
 * `TypeError: Cannot read properties of undefined`，并顺着 React 事件派发把页面打崩。
 * Tauri WebView 的部分版本同样没有该 API。
 *
 * 因此不可用时回落 `execCommand('copy')` + 隐藏 textarea。
 *
 * `apps/web` 的 `layout/file-tree/file-tree-actions.ts` 里另有一份等价实现：
 * apps 与 shared-ui 不能互相依赖内部模块，故各自保留一份，语义需保持一致。
 *
 * @throws 两条路径都失败时抛错，调用方据此展示「复制失败」。
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  copyWithHiddenTextArea(text);
}

function copyWithHiddenTextArea(text: string): void {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('当前环境不支持复制操作。');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('浏览器未允许当前复制操作。');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
