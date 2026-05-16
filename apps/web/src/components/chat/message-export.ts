import type { ChatMessage } from '../session-conversation/runtime/support.js';
import { readAssistantTracePayload } from '../session-conversation/runtime/support.js';

export type ExportFormat = 'markdown' | 'json' | 'text';

/**
 * Export selected chat messages to the specified format.
 * Returns the formatted string content.
 */
export function exportMessages(messages: ChatMessage[], format: ExportFormat): string {
  switch (format) {
    case 'markdown':
      return exportAsMarkdown(messages);
    case 'json':
      return exportAsJson(messages);
    case 'text':
      return exportAsPlainText(messages);
  }
}

/**
 * Trigger a file download in the browser with the given content.
 */
export function downloadExport(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Copy exported content to clipboard.
 */
export async function copyExportToClipboard(
  messages: ChatMessage[],
  format: ExportFormat,
): Promise<boolean> {
  const content = exportMessages(messages, format);
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Format implementations
// ---------------------------------------------------------------------------

function exportAsMarkdown(messages: ChatMessage[]): string {
  const lines: string[] = [];
  lines.push('# 对话导出');
  lines.push('');
  lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`> 消息数量：${messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const message of messages) {
    const roleLabel = message.role === 'user' ? '👤 用户' : '🤖 助手';
    const timestamp = message.createdAt ? `  _${formatTimestamp(message.createdAt)}_` : '';

    lines.push(`## ${roleLabel}${timestamp}`);
    lines.push('');

    if (message.role === 'assistant') {
      const trace = readAssistantTracePayload(message);
      if (trace) {
        // Reasoning blocks
        if (trace.reasoningBlocks && trace.reasoningBlocks.length > 0) {
          for (const block of trace.reasoningBlocks) {
            lines.push('<details>');
            lines.push('<summary>💭 思考过程</summary>');
            lines.push('');
            lines.push(block);
            lines.push('');
            lines.push('</details>');
            lines.push('');
          }
        }

        // Main text
        if (trace.text.trim()) {
          lines.push(trace.text);
          lines.push('');
        }

        // Tool calls
        if (trace.toolCalls.length > 0) {
          for (const toolCall of trace.toolCalls) {
            lines.push(`### 🔧 工具调用：${toolCall.toolName}`);
            lines.push('');
            lines.push('**输入：**');
            lines.push('```json');
            lines.push(JSON.stringify(toolCall.input, null, 2));
            lines.push('```');
            if (toolCall.output !== undefined) {
              lines.push('');
              lines.push('**输出：**');
              lines.push('```json');
              lines.push(
                typeof toolCall.output === 'string'
                  ? toolCall.output
                  : JSON.stringify(toolCall.output, null, 2),
              );
              lines.push('```');
            }
            lines.push('');
          }
        }
      } else {
        lines.push(message.content);
        lines.push('');
      }
    } else {
      lines.push(message.content);
      lines.push('');
    }

    // Usage info
    if (message.role === 'assistant' && message.providerUsage) {
      const usage = message.providerUsage;
      const parts: string[] = [];
      if (usage.inputTokens) parts.push(`输入 ${usage.inputTokens} tokens`);
      if (usage.outputTokens) parts.push(`输出 ${usage.outputTokens} tokens`);
      if (message.durationMs) parts.push(`耗时 ${(message.durationMs / 1000).toFixed(1)}s`);
      if (parts.length > 0) {
        lines.push(`> ${parts.join(' · ')}`);
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function exportAsJson(messages: ChatMessage[]): string {
  const exportData = {
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      model: m.model,
      providerId: m.providerId,
      createdAt: m.createdAt,
      durationMs: m.durationMs,
      tokenEstimate: m.tokenEstimate,
      providerUsage: m.providerUsage,
      toolCallCount: m.toolCallCount,
    })),
  };
  return JSON.stringify(exportData, null, 2);
}

function exportAsPlainText(messages: ChatMessage[]): string {
  const lines: string[] = [];

  for (const message of messages) {
    const roleLabel = message.role === 'user' ? '[用户]' : '[助手]';
    const timestamp = message.createdAt ? ` (${formatTimestamp(message.createdAt)})` : '';
    lines.push(`${roleLabel}${timestamp}`);

    if (message.role === 'assistant') {
      const trace = readAssistantTracePayload(message);
      if (trace) {
        if (trace.text.trim()) {
          lines.push(trace.text);
        }
        for (const toolCall of trace.toolCalls) {
          lines.push(`  [工具: ${toolCall.toolName}]`);
        }
      } else {
        lines.push(message.content);
      }
    } else {
      lines.push(message.content);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function formatTimestamp(value: number | string): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
