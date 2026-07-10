import type { InputImageContent } from '@openAwork/shared';
import type { MobileChatMessage } from '../chat/chat-message-content.js';

export interface ChatMessageSearchMatch {
  index: number;
  messageId: string;
  preview: string;
}

export interface ChatScrollMetrics {
  contentHeight: number;
  offsetY: number;
  viewportHeight: number;
}

export interface ChatDraftSummary {
  attachmentCount: number;
  charCount: number;
  lineCount: number;
  modeLabel: string;
}

export interface MobilePromptTemplate {
  id: string;
  label: string;
  prompt: string;
}

export type MobileMessageSegment =
  { kind: 'text'; text: string } | { code: string; kind: 'code'; language?: string };

export interface MobileCodeBlockSummary {
  collapsedCode: string;
  lineCount: number;
  shouldCollapse: boolean;
}

const DEFAULT_BOTTOM_THRESHOLD_PX = 72;
const DEFAULT_CODE_COLLAPSE_LINE_LIMIT = 14;

export const MOBILE_PROMPT_TEMPLATES = [
  {
    id: 'fix',
    label: '修复',
    prompt: '请定位并修复下面的问题，说明根因并给出验证方式：',
  },
  {
    id: 'explain',
    label: '解释',
    prompt: '请用简洁步骤解释下面这段内容/代码的工作方式：',
  },
  {
    id: 'test',
    label: '测试',
    prompt: '请为下面的改动补充必要测试，并说明覆盖的边界情况：',
  },
  {
    id: 'summarize',
    label: '总结',
    prompt: '请总结当前上下文中的关键结论、风险和下一步行动：',
  },
] satisfies readonly MobilePromptTemplate[];

export function toInputImageParts(
  message: Pick<MobileChatMessage, 'inputImages'>,
): InputImageContent[] {
  return (message.inputImages ?? [])
    .filter((image) => Boolean(image.artifactId))
    .map((image) => ({
      type: 'input_image',
      artifactId: image.artifactId,
      ...(image.fileName ? { fileName: image.fileName } : {}),
      ...(image.mimeType ? { mimeType: image.mimeType } : {}),
    }));
}

export function findPreviousUserMessage<Message extends Pick<MobileChatMessage, 'id' | 'role'>>(
  messages: Message[],
  assistantMessageId: string,
): Message | null {
  const messageIndex = messages.findIndex((entry) => entry.id === assistantMessageId);
  const searchEnd = messageIndex >= 0 ? messageIndex : messages.length;

  for (let index = searchEnd - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }

  return null;
}

function buildSearchText(message: Pick<MobileChatMessage, 'content' | 'inputImages'>): string {
  const imageText = (message.inputImages ?? [])
    .map((image) => image.fileName ?? image.artifactId ?? '')
    .join(' ');
  return `${message.content} ${imageText}`.trim();
}

export function findChatMessageMatches<
  Message extends Pick<MobileChatMessage, 'content' | 'id' | 'inputImages'>,
>(messages: Message[], query: string): ChatMessageSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return messages.flatMap((message, index) => {
    const searchableText = buildSearchText(message);
    if (!searchableText.toLocaleLowerCase().includes(normalizedQuery)) {
      return [];
    }

    return [
      {
        index,
        messageId: message.id,
        preview: searchableText.slice(0, 80),
      },
    ];
  });
}

export function moveChatSearchCursor(
  currentIndex: number,
  matchCount: number,
  direction: 'next' | 'previous',
): number {
  if (matchCount <= 0) {
    return -1;
  }

  if (currentIndex < 0) {
    return direction === 'next' ? 0 : matchCount - 1;
  }

  return direction === 'next'
    ? (currentIndex + 1) % matchCount
    : (currentIndex - 1 + matchCount) % matchCount;
}

export function isNearChatBottom(
  metrics: ChatScrollMetrics,
  thresholdPx = DEFAULT_BOTTOM_THRESHOLD_PX,
): boolean {
  const distanceFromBottom = metrics.contentHeight - (metrics.offsetY + metrics.viewportHeight);
  return distanceFromBottom <= thresholdPx;
}

export function getChatRestoreFocusLabel(hasStreamingContent: boolean): string {
  return hasStreamingContent ? '有新内容 · 恢复聚焦' : '定位最新对话';
}

export function buildChatDraftSummary(params: {
  attachmentCount: number;
  imageGenerationMode: boolean;
  text: string;
}): ChatDraftSummary {
  const normalizedText = params.text.replace(/\r\n/g, '\n');
  const trimmedText = normalizedText.trim();

  return {
    attachmentCount: params.attachmentCount,
    charCount: Array.from(trimmedText).length,
    lineCount: trimmedText.length > 0 ? trimmedText.split('\n').length : 0,
    modeLabel: params.imageGenerationMode ? '图片生成' : '文本对话',
  };
}

export function parseMobileMessageSegments(content: string): MobileMessageSegment[] {
  const segments: MobileMessageSegment[] = [];
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', text: content.slice(lastIndex, match.index) });
    }

    const language = match[1]?.trim();
    segments.push({
      kind: 'code',
      ...(language ? { language } : {}),
      code: match[2] ?? '',
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: 'text', text: content.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', text: content }];
}

export function summarizeMobileCodeBlock(
  code: string,
  lineLimit = DEFAULT_CODE_COLLAPSE_LINE_LIMIT,
): MobileCodeBlockSummary {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const lineCount = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  const shouldCollapse = lineCount > lineLimit;

  return {
    collapsedCode: shouldCollapse ? lines.slice(0, lineLimit).join('\n') : code.trimEnd(),
    lineCount,
    shouldCollapse,
  };
}

export function insertMobilePromptTemplate(currentText: string, templatePrompt: string): string {
  const trimmedCurrent = currentText.trim();
  if (!trimmedCurrent) {
    return `${templatePrompt}\n`;
  }

  return `${templatePrompt}\n\n${trimmedCurrent}`;
}
