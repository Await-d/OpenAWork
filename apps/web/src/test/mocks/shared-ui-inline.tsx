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

export function categorizeAlwaysPatterns(
  _previewAction: string | undefined,
  scope: string,
  always: string[] | undefined,
): AlwaysScopeLevel[] {
  const seenPatterns = new Set<string>([scope]);
  const uniqueAlways: string[] = [];

  for (const pattern of always ?? []) {
    if (pattern.trim().length === 0 || seenPatterns.has(pattern)) continue;
    seenPatterns.add(pattern);
    uniqueAlways.push(pattern);
  }

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
        uniqueAlways.length >= 2
          ? '覆盖网关提供的相同子命令模式。'
          : '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
      pattern: uniqueAlways.length >= 2 ? uniqueAlways[0]! : scope,
      category: 'partial',
    },
    {
      label: '同类指令',
      description:
        uniqueAlways.length >= 1
          ? '覆盖网关提供的同类指令模式。'
          : '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
      pattern: uniqueAlways.length >= 1 ? uniqueAlways[uniqueAlways.length - 1]! : scope,
      category: 'base',
    },
  ];
}
