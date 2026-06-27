import type { CSSProperties, ReactElement } from 'react';
import MarkdownMessageContent from '../../../../components/chat/markdown/markdown-message-content.js';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { buildTeamAssistantPresentation } from './team-assistant-presentation.js';
import { IncidentReadableCard, tryParseIncidentJson } from './incident-readable-card.js';

const JSON_PREFERRED_KEYS = [
  'summary',
  'message',
  'title',
  'description',
  'detail',
  'content',
  'text',
  'result',
  'error',
  'reason',
] as const;

const DEFAULT_TEXT_STYLE: CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.6,
  color: 'var(--fg-default)',
  overflowWrap: 'anywhere',
};

const DEFAULT_JSON_STYLE: CSSProperties = {
  ...DEFAULT_TEXT_STYLE,
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 11.5,
  whiteSpace: 'pre',
  overflowX: 'auto',
};

export interface TeamMessageBodyProps {
  message: ChatMessage;
  textStyle?: CSSProperties;
  jsonStyle?: CSSProperties;
}

export interface TeamRichTextContentProps {
  content: string;
  fallback?: string;
  textStyle?: CSSProperties;
  jsonStyle?: CSSProperties;
}

export function getTeamRichTextPreviewText(content: string, maxLen = 140): string {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return '（空消息）';
  }

  const incident = tryParseIncidentJson(normalizedContent);
  if (incident) {
    const preview = [incident.category ?? incident.code ?? '事件', incident.message]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(' · ');
    return truncatePreviewText(preview || '事件通知', maxLen);
  }

  const jsonSummary = summarizeJsonPreview(normalizedContent);
  if (jsonSummary) {
    return truncatePreviewText(jsonSummary, maxLen);
  }

  return truncatePreviewText(stripMarkdownForPreview(normalizedContent), maxLen);
}

export function getTeamMessageDetailText(message: ChatMessage): string {
  if (message.role === 'user') {
    return message.content || '（空消息）';
  }

  const presentation = buildTeamAssistantPresentation(message);
  return presentation.detailText || presentation.summaryText || message.content || '（空消息）';
}

export function getTeamMessagePreviewText(message: ChatMessage, maxLen = 140): string {
  return getTeamRichTextPreviewText(getTeamMessageDetailText(message), maxLen);
}

export function TeamMessageBody({
  message,
  textStyle,
  jsonStyle,
}: TeamMessageBodyProps): ReactElement {
  return (
    <TeamRichTextContent
      content={getTeamMessageDetailText(message)}
      textStyle={textStyle}
      jsonStyle={jsonStyle}
    />
  );
}

export function TeamRichTextContent({
  content,
  fallback = '（空消息）',
  textStyle,
  jsonStyle,
}: TeamRichTextContentProps): ReactElement {
  const normalizedContent = content.trim().length > 0 ? content : fallback;
  const incident = tryParseIncidentJson(normalizedContent);

  if (incident) {
    return <IncidentReadableCard data={incident} />;
  }

  const formattedJson = tryFormatJsonContent(normalizedContent);
  if (formattedJson) {
    return <pre style={{ ...DEFAULT_JSON_STYLE, ...jsonStyle }}>{formattedJson}</pre>;
  }

  return (
    <div style={{ ...DEFAULT_TEXT_STYLE, ...textStyle }}>
      <MarkdownMessageContent content={normalizedContent} />
    </div>
  );
}

function tryFormatJsonContent(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function summarizeJsonPreview(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractJsonPreviewValue(parsed);
  } catch {
    return null;
  }
}

function extractJsonPreviewValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const preview = stripMarkdownForPreview(value);
    return preview.length > 0 ? preview : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const summary = extractJsonPreviewValue(item);
      if (summary) {
        return summary;
      }
    }
    return value.length > 0 ? `${value.length} 项数据` : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of JSON_PREFERRED_KEYS) {
    const summary = extractJsonPreviewValue(record[key]);
    if (summary) {
      return summary;
    }
  }

  const primitiveEntries = Object.entries(record)
    .map(([key, entryValue]) => {
      if (
        typeof entryValue === 'string' ||
        typeof entryValue === 'number' ||
        typeof entryValue === 'boolean'
      ) {
        return `${key}: ${String(entryValue)}`;
      }
      if (Array.isArray(entryValue)) {
        return `${key}: ${entryValue.length} 项`;
      }
      return null;
    })
    .filter((entry): entry is string => entry !== null)
    .slice(0, 3);

  return primitiveEntries.length > 0 ? primitiveEntries.join(' · ') : null;
}

function stripMarkdownForPreview(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[^\n]*\n?/g, '\n')
    .replace(/```/g, '\n')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncatePreviewText(text: string, maxLen: number): string {
  const normalized = text.trim();
  if (!normalized) {
    return '（空消息）';
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}
