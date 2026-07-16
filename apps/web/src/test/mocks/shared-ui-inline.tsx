import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

export interface InlineEditorProps {
  label: string;
  value: string;
  onSave: (value: string) => void;
}

export function InlineEditor({ label, value, onSave }: InlineEditorProps): ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function saveDraft() {
    const trimmed = draft.trim();
    if (trimmed.length > 0) onSave(trimmed);
    setIsEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      saveDraft();
      return;
    }
    if (event.key === 'Escape') {
      setDraft(value);
      setIsEditing(false);
    }
  }

  return isEditing ? (
    <input
      aria-label={label}
      value={draft}
      onBlur={saveDraft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={handleKeyDown}
    />
  ) : (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      onDoubleClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
    >
      {value}
    </button>
  );
}

export interface GenerativeUIMessage {
  payload?: Record<string, unknown>;
  type?: string;
}

export function GenerativeUIRenderer(_props: { message: GenerativeUIMessage }): ReactNode {
  return null;
}

export interface UnifiedCodeDiffProps {
  afterText?: string;
  beforeText?: string;
  chrome?: 'default' | 'minimal';
  diffText?: string;
  filePath?: string;
  maxHeight?: number;
  viewMode?: 'split' | 'unified';
}

export function UnifiedCodeDiff(props: UnifiedCodeDiffProps): ReactElement {
  return (
    <div data-testid="unified-code-diff">
      {props.filePath ? <div>{props.filePath}</div> : null}
      <pre>{props.diffText ?? `${props.beforeText ?? ''}${props.afterText ?? ''}`}</pre>
    </div>
  );
}

export interface AlwaysScopeLevel {
  label: string;
  description: string;
  pattern: string;
  category: 'full' | 'partial' | 'base';
}

export type PermissionDecision = 'reject' | 'once' | 'session' | 'permanent';

export interface PermissionPromptProps {
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
  always?: string[];
  pendingDecision?: PermissionDecision | null;
  errorMessage?: string;
  onDecide: (
    requestId: string,
    decision: PermissionDecision,
    scopeLevel?: AlwaysScopeLevel,
  ) => void;
  onScopeLevelChange?: (level: AlwaysScopeLevel) => void;
  sessionTitle?: string;
  onNavigateToSession?: () => void;
}

export function PermissionPrompt(props: PermissionPromptProps): ReactElement {
  return (
    <div>
      <div>{props.toolName}</div>
      <div>{props.reason}</div>
      <div>{props.previewAction ?? props.scope}</div>
      {props.sessionTitle ? (
        props.onNavigateToSession ? (
          <button type="button" onClick={props.onNavigateToSession}>
            {props.sessionTitle}
          </button>
        ) : (
          <span>{props.sessionTitle}</span>
        )
      ) : null}
      {props.errorMessage ? <div>{props.errorMessage}</div> : null}
    </div>
  );
}

const NAMESPACE_PATTERN_SEGMENT = /^(?:\*|[A-Za-z0-9._-]+)$/;

function parseNamespaceLikeSegments(value: string): string[] | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed) || !trimmed.includes(':')) {
    return null;
  }

  const segments = trimmed.split(':');
  if (segments.length < 2) {
    return null;
  }

  return segments.every((segment) => NAMESPACE_PATTERN_SEGMENT.test(segment)) ? segments : null;
}

function deriveNamespaceLikeAlwaysPatterns(scope: string): string[] {
  const segments = parseNamespaceLikeSegments(scope);
  if (!segments) {
    return [];
  }

  const patterns = new Set<string>();
  for (let keepCount = segments.length - 1; keepCount >= 1; keepCount -= 1) {
    patterns.add(`${segments.slice(0, keepCount).join(':')}:*`);
  }

  patterns.delete(scope.trim());
  return [...patterns];
}

function countPatternSpecificity(pattern: string): number {
  const namespaceSegments = parseNamespaceLikeSegments(pattern);
  if (!namespaceSegments) {
    return 1;
  }

  let meaningfulCount = namespaceSegments.length;
  while (meaningfulCount > 0 && namespaceSegments[meaningfulCount - 1] === '*') {
    meaningfulCount -= 1;
  }
  return meaningfulCount;
}

export function categorizeAlwaysPatterns(
  _previewAction: string | undefined,
  scope: string,
  always: string[] | undefined,
): AlwaysScopeLevel[] {
  const fallbackPatterns = deriveNamespaceLikeAlwaysPatterns(scope);
  const seenPatterns = new Set<string>([scope]);
  const uniqueAlways = new Map<string, number>();

  for (const pattern of [...(always ?? []), ...fallbackPatterns]) {
    if (pattern.trim().length === 0 || seenPatterns.has(pattern)) continue;
    seenPatterns.add(pattern);
    uniqueAlways.set(
      pattern,
      Math.max(uniqueAlways.get(pattern) ?? 0, countPatternSpecificity(pattern)),
    );
  }

  const sortedPatterns = [...uniqueAlways.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return right[0].length - left[0].length;
    })
    .map(([pattern]) => pattern);

  return [
    {
      label: '仅本次指令',
      description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
      pattern: scope,
      category: 'full',
    },
    {
      label: '同子命令',
      description:
        sortedPatterns.length >= 1
          ? '覆盖网关提供的相同子命令模式。'
          : '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
      pattern: sortedPatterns.length >= 1 ? sortedPatterns[0]! : scope,
      category: 'partial',
    },
    {
      label: '同类指令',
      description:
        sortedPatterns.length >= 2
          ? '覆盖网关提供的同类指令模式。'
          : '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
      pattern: sortedPatterns.length >= 2 ? sortedPatterns[sortedPatterns.length - 1]! : scope,
      category: 'base',
    },
  ];
}
