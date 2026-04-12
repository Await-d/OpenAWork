export type SessionDialogueMode = 'clarify' | 'coding' | 'programmer';

interface ParsedSessionMetadata {
  dialogueMode: SessionDialogueMode;
  modelId?: string;
  parentSessionId?: string;
  workingDirectory: string | null;
  yoloMode: boolean;
}

const FALLBACK_PARSED_SESSION_METADATA: ParsedSessionMetadata = {
  dialogueMode: 'clarify',
  workingDirectory: null,
  yoloMode: false,
};

const SESSION_METADATA_CACHE_MAX_SIZE = 500;
const sessionMetadataCache = new Map<string, ParsedSessionMetadata>();

const DIALOGUE_MODE_LABELS: Record<SessionDialogueMode, string> = {
  clarify: '澄清(方案)',
  coding: '编程',
  programmer: '程序员',
};

export function extractWorkingDirectory(metadataJson?: string): string | null {
  return parseSessionMetadata(metadataJson).workingDirectory;
}

export function extractParentSessionId(metadataJson?: string): string | null {
  return parseSessionMetadata(metadataJson).parentSessionId ?? null;
}

export function getSessionModeLabels(metadataJson?: string): string[] {
  const metadata = parseSessionMetadata(metadataJson);
  const labels = [DIALOGUE_MODE_LABELS[metadata.dialogueMode]];

  if (metadata.yoloMode) {
    labels.push('YOLO');
  }

  const formattedModelLabel = formatModelLabel(metadata.modelId);
  if (formattedModelLabel) {
    labels.push(formattedModelLabel);
  }

  return labels;
}

export function hasParentSession(metadataJson?: string): boolean {
  return extractParentSessionId(metadataJson) !== null;
}

function parseSessionMetadata(metadataJson?: string): ParsedSessionMetadata {
  if (!metadataJson) {
    return FALLBACK_PARSED_SESSION_METADATA;
  }

  const cached = sessionMetadataCache.get(metadataJson);
  if (cached) {
    return cached;
  }

  try {
    const parsed = JSON.parse(metadataJson) as {
      dialogueMode?: unknown;
      modelId?: unknown;
      parentSessionId?: unknown;
      workingDirectory?: unknown;
      yoloMode?: unknown;
    };

    const metadata: ParsedSessionMetadata = {
      dialogueMode:
        parsed.dialogueMode === 'clarify' ||
        parsed.dialogueMode === 'coding' ||
        parsed.dialogueMode === 'programmer'
          ? parsed.dialogueMode
          : FALLBACK_PARSED_SESSION_METADATA.dialogueMode,
      modelId: normalizeOptionalString(parsed.modelId),
      parentSessionId: normalizeOptionalString(parsed.parentSessionId),
      workingDirectory: normalizeOptionalString(parsed.workingDirectory) ?? null,
      yoloMode: parsed.yoloMode === true,
    };

    setCachedSessionMetadata(metadataJson, metadata);
    return metadata;
  } catch {
    setCachedSessionMetadata(metadataJson, FALLBACK_PARSED_SESSION_METADATA);
    return FALLBACK_PARSED_SESSION_METADATA;
  }
}

function setCachedSessionMetadata(metadataJson: string, metadata: ParsedSessionMetadata): void {
  if (sessionMetadataCache.size >= SESSION_METADATA_CACHE_MAX_SIZE) {
    const oldestKey = sessionMetadataCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      sessionMetadataCache.delete(oldestKey);
    }
  }

  sessionMetadataCache.set(metadataJson, metadata);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function formatModelLabel(modelId?: string): string | null {
  const normalized = normalizeOptionalString(modelId);
  if (!normalized) {
    return null;
  }

  if (/^gpt[-_]/iu.test(normalized)) {
    return normalized.replace(/^gpt/iu, 'GPT');
  }

  return normalized
    .split(/[-_/]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (/^\d+(?:\.\d+)?$/u.test(segment)) {
        return segment;
      }

      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join(' ');
}
