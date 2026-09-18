import type {
  FileBackupRef,
  FileDiffContent,
  ModifiedFilesSummaryContent,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import type { ChatInputImageItem } from './message-model.js';
import { normalizeOptionalString } from './message-coercion.js';
import { collectTextCandidateFields, isReasoningRecord } from './reasoning-content.js';

export function extractDisplayText(rawContent: unknown[]): string {
  return extractTextFragments(rawContent).join('\n').trim();
}

export function extractInputImages(rawContent: unknown[]): ChatInputImageItem[] {
  return rawContent.flatMap((item) => parseInputImageContent(item));
}

export function extractTextFragments(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextFragments(item));
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const content = value as Record<string, unknown>;
  const type = content['type'];

  if (type === 'tool_call' || type === 'tool_result') {
    return [];
  }

  if (isReasoningRecord(content)) {
    return [];
  }

  if (
    (type === 'text' || type === 'input_text' || type === 'output_text') &&
    typeof content['text'] === 'string'
  ) {
    // Synthetic text parts (e.g. `<system-reminder>` capability blocks
    // and `[thinking-hint]` trailing tags) are persisted on the user
    // message body so the prompt-cache prefix stays byte-stable across
    // turns, but they are *internal* state: they must never surface in
    // the chat transcript. Without this filter, recovery payloads put
    // the system reminder + hint around the user's typed text, which
    // makes the user feel their message was lost / replaced after a
    // refresh — see persistStreamUserMessage's `synthetic: true` parts.
    if (content['synthetic'] === true) {
      return [];
    }
    return content['text'].trim().length > 0 ? [content['text']] : [];
  }

  return collectTextCandidateFields(content).flatMap((item) => extractTextFragments(item));
}

export function extractToolCalls(
  rawContent: unknown[],
): Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }> {
  return rawContent.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const content = item as Record<string, unknown>;
    if (
      content['type'] === 'tool_call' &&
      typeof content['toolCallId'] === 'string' &&
      typeof content['toolName'] === 'string' &&
      content['input'] &&
      typeof content['input'] === 'object' &&
      !Array.isArray(content['input'])
    ) {
      return [
        {
          toolCallId: content['toolCallId'],
          toolName: content['toolName'],
          input: content['input'] as Record<string, unknown>,
        },
      ];
    }
    return [];
  });
}

function parseInputImageContent(value: unknown): ChatInputImageItem[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const content = value as Record<string, unknown>;
  if (content['type'] !== 'input_image') {
    return [];
  }

  return [
    {
      ...(typeof content['artifactId'] === 'string' ? { artifactId: content['artifactId'] } : {}),
      ...(content['detail'] === 'auto' ||
      content['detail'] === 'high' ||
      content['detail'] === 'low' ||
      content['detail'] === 'original'
        ? { detail: content['detail'] }
        : {}),
      ...(typeof content['fileId'] === 'string' ? { fileId: content['fileId'] } : {}),
      ...(typeof content['fileName'] === 'string' ? { fileName: content['fileName'] } : {}),
      ...(typeof content['imageUrl'] === 'string' ? { imageUrl: content['imageUrl'] } : {}),
      ...(typeof content['mimeType'] === 'string' ? { mimeType: content['mimeType'] } : {}),
    } satisfies ChatInputImageItem,
  ];
}

export function extractToolResults(rawContent: unknown[]): Array<{
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  toolCallId: string;
  toolName?: string;
  output: unknown;
  isError: boolean;
  observability?: ToolCallObservabilityAnnotation;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
}> {
  return rawContent.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const content = item as Record<string, unknown>;
    if (content['type'] === 'tool_result' && typeof content['toolCallId'] === 'string') {
      return [
        {
          ...(typeof content['clientRequestId'] === 'string'
            ? { clientRequestId: content['clientRequestId'] }
            : {}),
          ...(Array.isArray(content['fileDiffs'])
            ? { fileDiffs: content['fileDiffs'].flatMap((item) => parseFileDiffContent(item)) }
            : {}),
          toolCallId: content['toolCallId'],
          ...(typeof content['toolName'] === 'string' ? { toolName: content['toolName'] } : {}),
          output: content['output'],
          isError: content['isError'] === true,
          ...(parseToolCallObservability(content['observability'])
            ? { observability: parseToolCallObservability(content['observability']) }
            : {}),
          ...(typeof content['pendingPermissionRequestId'] === 'string'
            ? { pendingPermissionRequestId: content['pendingPermissionRequestId'] }
            : {}),
          ...(content['resumedAfterApproval'] === true ? { resumedAfterApproval: true } : {}),
        },
      ];
    }
    return [];
  });
}

export function extractModifiedFilesSummary(
  rawContent: unknown[],
): ModifiedFilesSummaryContent | null {
  for (const item of rawContent) {
    const summary = parseModifiedFilesSummaryContent(item);
    if (summary) {
      return summary;
    }
  }
  return null;
}

export function parseModifiedFilesSummaryContent(
  value: unknown,
): ModifiedFilesSummaryContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    record['type'] !== 'modified_files_summary' ||
    typeof record['title'] !== 'string' ||
    typeof record['summary'] !== 'string' ||
    !Array.isArray(record['files'])
  ) {
    return null;
  }

  const files = record['files'].flatMap((item) => parseFileDiffContent(item));
  if (files.length === 0) {
    return null;
  }

  return {
    type: 'modified_files_summary',
    title: record['title'],
    summary: record['summary'],
    files,
  };
}

export function parseToolCallObservability(
  value: unknown,
): ToolCallObservabilityAnnotation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const presentedToolName = normalizeOptionalString(record['presentedToolName']);
  const canonicalToolName = normalizeOptionalString(record['canonicalToolName']);
  const adapterVersion = normalizeOptionalString(record['adapterVersion']);

  if (!presentedToolName && !canonicalToolName && !adapterVersion) {
    return undefined;
  }

  return {
    presentedToolName,
    canonicalToolName,
    adapterVersion,
  };
}

function parseFileBackupRef(value: unknown): FileBackupRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const backupId = normalizeOptionalString(record['backupId']);
  const kind = normalizeOptionalString(record['kind']);
  if (!backupId || !kind) {
    return undefined;
  }

  return {
    backupId,
    kind,
    storagePath: normalizeOptionalString(record['storagePath']),
    artifactId: normalizeOptionalString(record['artifactId']),
    contentHash: normalizeOptionalString(record['contentHash']),
  } as FileBackupRef;
}

export function parseFileDiffContent(value: unknown): FileDiffContent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record['file'] !== 'string' ||
    typeof record['before'] !== 'string' ||
    typeof record['after'] !== 'string' ||
    typeof record['additions'] !== 'number' ||
    typeof record['deletions'] !== 'number'
  ) {
    return [];
  }

  return [
    {
      file: record['file'],
      before: record['before'],
      after: record['after'],
      additions: record['additions'],
      deletions: record['deletions'],
      clientRequestId: normalizeOptionalString(record['clientRequestId']),
      requestId: normalizeOptionalString(record['requestId']),
      toolName: normalizeOptionalString(record['toolName']),
      toolCallId: normalizeOptionalString(record['toolCallId']),
      sourceKind: normalizeOptionalString(record['sourceKind']) as FileDiffContent['sourceKind'],
      guaranteeLevel: normalizeOptionalString(
        record['guaranteeLevel'],
      ) as FileDiffContent['guaranteeLevel'],
      backupBeforeRef: parseFileBackupRef(record['backupBeforeRef']),
      backupAfterRef: parseFileBackupRef(record['backupAfterRef']),
      observability: parseToolCallObservability(record['observability']),
      status:
        record['status'] === 'added' ||
        record['status'] === 'deleted' ||
        record['status'] === 'modified'
          ? record['status']
          : undefined,
    },
  ];
}
