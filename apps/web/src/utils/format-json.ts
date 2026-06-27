/**
 * JSON 格式化工具
 *
 * 检测字符串是否为 JSON，如果是则格式化后返回；
 * 否则返回原始文本。用于消息内容、报告数据等场景中
 * 自动美化原始 JSON 字符串的显示。
 */

/** 尝试将文本解析为 JSON 并格式化；非 JSON 文本原样返回。 */
export function tryFormatJson(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  // 快速排除明显不是 JSON 的文本
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return text;

  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

/** 判断文本是否看起来像 JSON 字符串。 */
export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
