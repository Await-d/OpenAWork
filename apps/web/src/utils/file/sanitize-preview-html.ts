/**
 * 预览 iframe 的内容净化与隔离配置。
 *
 * 抽成共享模块是因为 `utils/file/file-preview.ts`（文件编辑器预览）与
 * `components/chat/markdown/markdown-message-content.tsx`（对话内代码块预览）
 * 各自维护了一份**完全相同**的 `stripScriptTags` / `getPreviewSandbox`，两处
 * 独立演化正是「同一缺陷修一处漏一处」的根源。
 */

/**
 * 预览 iframe 的 sandbox 取值。
 *
 * 必须保留 `allow-scripts`：高度同步用的 `RESIZE_SCRIPT` 本身就是注入进去的
 * `<script>`，去掉它预览框就再也拿不到正确高度。
 *
 * 安全性不依赖这一项，而是靠两点：
 * 1. 不给 `allow-same-origin` —— 预览内容处于不透明源（opaque origin），读不到
 *    宿主的 DOM / localStorage / cookie，也无法操作 `top`；
 * 2. 送入 iframe 前先经 `stripActivePreviewContent` 剥离脚本与事件处理器。
 *
 * 这两条约束曾经配有一段「隔离预览：…」的界面文案，但它会占掉预览框顶部一大块
 * 高度且不含任何用户可操作信息，已从界面移除——行为约束以本注释为准。
 */
export const PREVIEW_SANDBOX = 'allow-scripts';

/**
 * 剥离文档中的可执行内容。
 *
 * 仅用于 `html` / `svg` 预览；`javascript` 预览是**故意**要执行用户脚本的，
 * 不走这里。
 *
 * 旧实现只删「成对闭合的 `<script>…</script>`」，有两个缺口：
 * 1. `<script/src="x">` —— `<script` 后是 `/`，不匹配 `[\s>]`，标签连同内容留存；
 * 2. 从不处理内联事件处理器 —— `<img src=x onerror=...>` 会照常执行（旧实现
 *    也从不剥离**无引号**的 `on*=`）。
 */
export function stripActivePreviewContent(html: string): string {
  return (
    html
      // 成对闭合的 script（`$` 分支兜底覆盖未闭合的情况）
      .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/giu, '')
      // 残留的开标签：`<script>` / `<script/>` / `<script/src=...>`
      .replace(/<script\b[^>]*>?/giu, '')
      // 任何 on* 事件属性：双引号、单引号、无引号都覆盖
      .replace(/\son[a-z][a-z0-9:-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/giu, '')
      // javascript: / vbscript: 伪协议，以及可执行的 data:text/html
      .replace(
        /\s(href|src|xlink:href|action|formaction)\s*=\s*("|')?\s*(javascript|vbscript|data:text\/html)[^"'\s>]*("|')?/giu,
        '',
      )
  );
}
