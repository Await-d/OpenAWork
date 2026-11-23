import type { Message } from '@openAwork/shared';

/**
 * 渠道回复正文提取：只取 `text` 类型的内容片段。
 *
 * 与网关侧的 `extractMessageText` **刻意不同**（该同名实现有两份、内容一致：
 * `session-message-store.ts` 与 `routes/message-text-utils.ts`）：它们服务于
 * `/compact` 摘要与 loop 上下文续写，会把 `reasoning` / `tool_call` /
 * `tool_result` 一并拉平成一段文本。那段文本一旦原样回给 IM，就相当于把模型的
 * 思维链、工具入参与工具输出直接贴进聊天窗口 —— 用户看到的是「思考过程」而不是
 * 回复。渠道侧只应呈现模型最终对用户说的话。
 *
 * 只有 `text` 是面向用户的产物；拿不到正文时返回空串，由调用方决定降级文案
 * （未生成文本提示 / 权限提示等），**不得**用思考内容兜底。
 */
export function extractChannelReplyText(message: Message | undefined): string {
  if (!message) {
    return '';
  }
  return message.content
    .map((content) => (content.type === 'text' ? content.text : ''))
    .filter((text) => text.trim().length > 0)
    .join('\n')
    .trim();
}
