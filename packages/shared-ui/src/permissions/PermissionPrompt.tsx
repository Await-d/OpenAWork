import { color } from '../tokens.js';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PermissionDecision, PermissionRiskLevel } from '@openAwork/shared';

export type { PermissionDecision } from '@openAwork/shared';

/**
 * Visual hierarchy (opencode-aligned, high-contrast variant):
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ [⚠︎ 工具名]                         [风险标签]         │
 *   │ 需要执行工作区命令                                     │
 *   │ ─── 本次执行 ───────────────────────────────────────── │
 *   │   `ls -la /tmp`                                      │
 *   │ ─── 本会话允许会同时覆盖 ─────────────────────────────── │
 *   │   [ ls * ]  (chips)                                  │
 *   │                                                      │
 *   │ [拒绝]  [允许一次]  [本会话允许]★  [永久允许]           │
 *   │ Enter=本会话允许 · Esc=拒绝                            │
 *   └──────────────────────────────────────────────────────┘
 *
 * The "本会话允许" button is the recommended action (starred) because it
 * mirrors opencode's "always" reply — covers the arity-prefix pattern for
 * the entire session without persisting to the workspace config file.
 */

interface PermissionDecisionOption {
  decision: PermissionDecision;
  label: string;
  hint: string;
  tone: 'primary' | 'secondary' | 'subtle' | 'danger';
}

/**
 * Represents a categorized scope level for the "always" patterns.
 * The patterns are ordered from most specific (full command) to broadest (base).
 */
export interface AlwaysScopeLevel {
  /** Display label for this scope level. */
  label: string;
  description: string;
  /** The pattern string for this level. */
  pattern: string;
  /** Category identifier: 'full' | 'partial' | 'base'. */
  category: 'full' | 'partial' | 'base';
}

const BASH_PREVIEW_PREFIXES = ['执行命令:', '执行 tmux 命令:'] as const;
const NAMESPACE_PATTERN_SEGMENT = /^(?:\*|[A-Za-z0-9._-]+)$/;
const SHELL_CONTROL_TOKENS = new Set(['|', '||', '&&', ';', '&', '>', '>>', '<', '<<']);

function isBashLikePreviewAction(previewAction: string | undefined): boolean {
  if (!previewAction) {
    return false;
  }

  return BASH_PREVIEW_PREFIXES.some((prefix) => previewAction.startsWith(prefix));
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      pushCurrent();
      continue;
    }

    if (
      !inSingle &&
      !inDouble &&
      (ch === '|' || ch === '&' || ch === ';' || ch === '<' || ch === '>')
    ) {
      pushCurrent();
      tokens.push(ch);
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return tokens;
}

function readPrimaryCommandTokens(tokens: string[]): string[] {
  const primary: string[] = [];

  for (const token of tokens) {
    if (SHELL_CONTROL_TOKENS.has(token)) {
      break;
    }
    primary.push(token);
  }

  return primary;
}

function deriveBashLikeAlwaysPatterns(previewAction: string | undefined, scope: string): string[] {
  if (!isBashLikePreviewAction(previewAction)) {
    return [];
  }

  const primaryTokens = readPrimaryCommandTokens(tokenizeShellCommand(scope.trim()));
  if (primaryTokens.length === 0) {
    return [];
  }

  const patterns = new Set<string>();

  if (primaryTokens.length > 2) {
    patterns.add(`${primaryTokens.slice(0, -1).join(' ')} *`);
  }

  if (primaryTokens[0]) {
    patterns.add(`${primaryTokens[0]} *`);
  }

  patterns.delete(scope.trim());
  return [...patterns];
}

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

function countNonControlTokens(pattern: string): number {
  return tokenizeShellCommand(pattern).filter((token) => !SHELL_CONTROL_TOKENS.has(token)).length;
}

function countPatternSpecificity(pattern: string): number {
  const namespaceSegments = parseNamespaceLikeSegments(pattern);
  if (namespaceSegments) {
    let meaningfulCount = namespaceSegments.length;
    while (meaningfulCount > 0 && namespaceSegments[meaningfulCount - 1] === '*') {
      meaningfulCount -= 1;
    }
    return meaningfulCount;
  }

  return countNonControlTokens(pattern);
}

function isValidBashLikeAlwaysPattern(pattern: string): boolean {
  const tokens = tokenizeShellCommand(pattern.trim());
  if (tokens.length === 0) {
    return false;
  }

  return readPrimaryCommandTokens(tokens).length === tokens.length;
}

function resolveAlwaysCandidates(
  previewAction: string | undefined,
  scope: string,
  always: string[] | undefined,
): string[] {
  const fallbackPatterns = [
    ...deriveBashLikeAlwaysPatterns(previewAction, scope),
    ...deriveNamespaceLikeAlwaysPatterns(scope),
  ];
  const shouldFilterAsBash = isBashLikePreviewAction(previewAction);
  if (!shouldFilterAsBash && (!always || always.length === 0)) {
    return fallbackPatterns;
  }

  const candidates = new Map<string, number>();

  for (const pattern of always ?? []) {
    const trimmed = pattern.trim();
    if (trimmed.length === 0 || trimmed === scope) {
      continue;
    }
    if (shouldFilterAsBash && !isValidBashLikeAlwaysPattern(trimmed)) {
      continue;
    }
    candidates.set(trimmed, countPatternSpecificity(trimmed));
  }

  for (const pattern of fallbackPatterns) {
    const trimmed = pattern.trim();
    if (trimmed.length === 0 || trimmed === scope) {
      continue;
    }
    candidates.set(
      trimmed,
      Math.max(candidates.get(trimmed) ?? 0, countPatternSpecificity(trimmed)),
    );
  }

  return [...candidates.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return right[0].length - left[0].length;
    })
    .map(([pattern]) => pattern);
}

/**
 * Categorize the `always` patterns + previewAction/scope into three levels:
 * - Full command: the complete command (most specific, narrowest approval)
 * - Partial: intermediate pattern (moderate breadth)
 * - Base: the broadest pattern (widest approval)
 *
 * Always returns the three visible approval levels. When the gateway does not
 * provide enough distinct broader patterns, the missing levels safely fall back
 * to `scope` so choosing them never persists `previewAction` or an invented
 * broad pattern.
 */
export function categorizeAlwaysPatterns(
  previewAction: string | undefined,
  scope: string,
  always: string[] | undefined,
): AlwaysScopeLevel[] {
  const fullCommand = scope;
  const seenPatterns = new Set<string>([fullCommand]);
  const uniqueAlways: string[] = [];
  const alwaysCandidates = resolveAlwaysCandidates(previewAction, scope, always);

  for (const pattern of alwaysCandidates) {
    if (pattern.trim().length === 0 || seenPatterns.has(pattern)) continue;
    seenPatterns.add(pattern);
    uniqueAlways.push(pattern);
  }

  const hasPartialPattern = uniqueAlways.length >= 1;
  const hasBasePattern = uniqueAlways.length >= 2;
  const partialPattern = hasPartialPattern ? uniqueAlways[0]! : fullCommand;
  const basePattern = hasBasePattern ? uniqueAlways[uniqueAlways.length - 1]! : fullCommand;

  return [
    {
      label: '仅本次指令',
      description: '只覆盖当前命令，不会扩大到其它参数或子命令。',
      pattern: fullCommand,
      category: 'full',
    },
    {
      label: '同子命令',
      description: hasPartialPattern
        ? '覆盖网关提供的相同子命令模式。'
        : '当前没有可用的同子命令规则，选择后仍只覆盖当前命令。',
      pattern: partialPattern,
      category: 'partial',
    },
    {
      label: '同类指令',
      description: hasBasePattern
        ? '覆盖网关提供的同类指令模式。'
        : '当前没有可用的同类指令规则，选择后仍只覆盖当前命令。',
      pattern: basePattern,
      category: 'base',
    },
  ];
}

export interface PermissionPromptProps {
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: PermissionRiskLevel;
  previewAction?: string;
  /**
   * Broad-approval patterns (e.g. `["ls *"]`). When present and different
   * from `scope`, rendered as chips under "本会话允许会同时覆盖" so the
   * user understands the widening effect of picking session/permanent.
   */
  always?: string[];
  pendingDecision?: PermissionDecision | null;
  errorMessage?: string;
  onDecide: (
    requestId: string,
    decision: PermissionDecision,
    scopeLevel?: AlwaysScopeLevel,
  ) => void;
  /**
   * Callback invoked when the user selects a scope level from the categorized
   * "always" patterns. The parent can use this to adjust the approval scope
   * sent to the gateway. When omitted, the default behavior (approve with
   * the broadest pattern) is used.
   */
  onScopeLevelChange?: (level: AlwaysScopeLevel) => void;
  /**
   * Title of the session that originated the permission request.
   * When provided, rendered above the tool name so the user knows which
   * session is asking. When omitted, the session indicator is hidden.
   */
  sessionTitle?: string;
  /**
   * Callback invoked when the user clicks the session title link.
   * Typically navigates to `/chat/<sessionId>`. When omitted, the
   * session title is rendered as plain text (no link).
   */
  onNavigateToSession?: () => void;
  style?: CSSProperties;
}

const RISK_COLORS: Record<string, string> = {
  low: color.success,
  medium: color.contrast,
  high: color.danger,
};

const RISK_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export function PermissionPrompt({
  requestId,
  toolName,
  scope,
  reason,
  riskLevel,
  previewAction,
  always,
  pendingDecision = null,
  errorMessage,
  onDecide,
  onScopeLevelChange,
  sessionTitle,
  onNavigateToSession,
  style,
}: PermissionPromptProps) {
  const riskColor = RISK_COLORS[riskLevel] ?? 'var(--fg-muted)';
  const decisionOptions = getPermissionDecisionOptions(riskLevel);
  const activeDecision = pendingDecision
    ? (decisionOptions.find((option) => option.decision === pendingDecision) ?? null)
    : null;
  const isSubmitting = activeDecision !== null;

  // Categorize always patterns into selectable scope levels
  const scopeLevels = categorizeAlwaysPatterns(previewAction, scope, always);
  const [selectedLevelIndex, setSelectedLevelIndex] = useState(scopeLevels.length - 1);
  const selectedScopeLevel = scopeLevels[selectedLevelIndex] ?? scopeLevels[scopeLevels.length - 1];

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Keyboard shortcuts: Enter = session (primary / recommended), Esc = reject.
  // We only bind while this prompt is mounted and only act when no other
  // modal input has focus (the popup itself or its buttons are fine, text
  // inputs elsewhere are not — we check `event.target` to avoid hijacking
  // typing in chat composers behind the popup).
  useEffect(() => {
    if (typeof window === 'undefined' || isSubmitting) return;

    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable === true;
        // Allow Esc/Enter from inside the prompt itself (buttons), block
        // when the user is actively typing in a chat composer / text field.
        if (isEditable && !containerRef.current?.contains(target)) return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        onDecide(requestId, 'reject', selectedScopeLevel);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onDecide(requestId, 'session', selectedScopeLevel);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, onDecide, requestId, selectedScopeLevel]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="权限请求"
      aria-busy={isSubmitting}
      style={{
        border: `1px solid ${riskLevel === 'high' ? 'rgba(248,113,113,0.45)' : 'var(--border-default, hsla(215, 18%, 50%, 0.12))'}`,
        borderRadius: 12,
        padding: 14,
        background: 'var(--bg-overlay)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 440,
        minWidth: 340,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(148,163,184,0.25) transparent',
        boxShadow: '0 22px 56px rgba(15, 23, 42, 0.45)',
        willChange: 'transform, opacity',
        ...style,
      }}
    >
      {sessionTitle && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--fg-muted)',
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 12 }}>
            💬
          </span>
          <span>来自</span>
          {onNavigateToSession ? (
            <button
              type="button"
              onClick={onNavigateToSession}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--accent)',
                fontWeight: 600,
                fontSize: 11,
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`跳转到会话：${sessionTitle}`}
            >
              {sessionTitle}
            </button>
          ) : (
            <span
              style={{
                fontWeight: 600,
                color: 'var(--fg-strong)',
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sessionTitle}
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: `${riskColor}22`,
            color: riskColor,
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          ⚠
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--accent)',
            letterSpacing: '-0.01em',
          }}
        >
          {toolName}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 999,
            background: `${riskColor}22`,
            color: riskColor,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {RISK_LABELS[riskLevel]}
        </span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: 'var(--fg-strong)',
          lineHeight: 1.55,
        }}
      >
        {reason}
      </div>

      <PromptSection label="本次执行">
        <code
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 11.5,
            padding: '6px 8px',
            background: 'rgba(15,23,42,0.45)',
            border: '1px solid rgba(148,163,184,0.18)',
            borderRadius: 6,
            color: 'var(--fg-strong)',
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
            maxHeight: 120,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(148,163,184,0.25) transparent',
          }}
        >
          {previewAction ?? scope}
        </code>
      </PromptSection>

      {scopeLevels.length > 1 && (
        <PromptSection label={'审批范围（选择后\u201c本会话/永久允许\u201d将覆盖该模式）'}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {scopeLevels.map((level, index) => {
              const isSelected = index === selectedLevelIndex;
              return (
                <button
                  key={level.category}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setSelectedLevelIndex(index);
                    onScopeLevelChange?.(level);
                  }}
                  style={{
                    appearance: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: isSelected
                      ? '1px solid rgba(99,102,241,0.55)'
                      : '1px solid rgba(148,163,184,0.15)',
                    background: isSelected ? 'rgba(99,102,241,0.10)' : 'rgba(15,23,42,0.30)',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
                    textAlign: 'left',
                    transition: 'border-color 120ms ease, background 120ms ease',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                      letterSpacing: 0.3,
                    }}
                  >
                    {level.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--fg-muted)',
                      lineHeight: 1.45,
                    }}
                  >
                    {level.description}
                  </span>
                  <code
                    style={{
                      display: 'block',
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 11,
                      color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                      wordBreak: 'break-all',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.4,
                      maxHeight: 60,
                      overflowY: 'auto',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(148,163,184,0.25) transparent',
                    }}
                  >
                    {level.pattern}
                  </code>
                </button>
              );
            })}
          </div>
        </PromptSection>
      )}

      {(isSubmitting || errorMessage) && (
        <div
          role={errorMessage ? 'alert' : 'status'}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '0.5rem 0.7rem',
            borderRadius: 8,
            border: errorMessage ? '1px solid rgba(248,113,113,0.28)' : `1px solid ${riskColor}33`,
            background: errorMessage ? 'rgba(127, 29, 29, 0.22)' : `${riskColor}12`,
            color: errorMessage ? '#fecaca' : 'var(--fg-strong)',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1.2 }}>
            {errorMessage ? '⚠' : '⏳'}
          </span>
          <span>{errorMessage ?? `正在提交“${activeDecision?.label ?? '审批'}”，请稍候…`}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        {decisionOptions.map((option) => {
          const isActive = pendingDecision === option.decision;
          const isPrimary = option.tone === 'primary';
          return (
            <button
              key={option.decision}
              type="button"
              aria-busy={isActive}
              disabled={isSubmitting}
              onClick={() => onDecide(requestId, option.decision, selectedScopeLevel)}
              title={option.hint}
              style={btnStyle(option.tone, {
                active: isActive,
                disabled: isSubmitting,
                primary: isPrimary,
              })}
            >
              {option.label}
              {isPrimary && !isSubmitting && (
                <span
                  aria-hidden="true"
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    opacity: 0.75,
                  }}
                >
                  推荐
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!isSubmitting && !errorMessage && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            lineHeight: 1.5,
            letterSpacing: 0.1,
          }}
        >
          <kbd style={kbdStyle}>Enter</kbd> 本会话允许 · <kbd style={kbdStyle}>Esc</kbd> 拒绝
        </div>
      )}
    </div>
  );
}

function PromptSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export function getPermissionDecisionOptions(
  _riskLevel: PermissionRiskLevel,
): PermissionDecisionOption[] {
  // Button order: destructive → narrowest allow → broader allow → broadest allow.
  // Left-to-right reading order climbs the safety-cost axis so the primary /
  // recommended action (本会话允许) sits after the explicit "just this once"
  // option and before the workspace-persisting "永久" action.
  return [
    { decision: 'reject', label: '拒绝', hint: '阻止本次调用，工具不会继续执行。', tone: 'danger' },
    {
      decision: 'once',
      label: '允许一次',
      hint: '只批准当前这一次工具调用，下一次相同命令仍会再次询问。',
      tone: 'secondary',
    },
    {
      decision: 'session',
      label: '本会话允许',
      hint: '本会话内自动批准同类命令（按 Enter 快速确认）。',
      tone: 'primary',
    },
    {
      decision: 'permanent',
      label: '永久允许',
      hint: '会写入工作区配置并在后续任意会话自动批准同类请求，请在确认风险后再使用。',
      tone: 'subtle',
    },
  ];
}

function btnStyle(
  tone: 'primary' | 'secondary' | 'subtle' | 'danger',
  options?: { active?: boolean; disabled?: boolean; primary?: boolean },
): CSSProperties {
  const base: Record<typeof tone, { fg: string; bg: string; border: string }> = {
    primary: {
      fg: 'var(--bg-overlay)',
      bg: 'var(--accent)',
      border: color.aux,
    },
    secondary: {
      fg: 'var(--fg-strong)',
      bg: 'rgba(99,102,241,0.14)',
      border: 'rgba(99,102,241,0.36)',
    },
    subtle: {
      fg: 'var(--fg-muted)',
      bg: 'transparent',
      border: 'rgba(148,163,184,0.28)',
    },
    danger: {
      fg: color.danger,
      bg: 'rgba(248,113,113,0.08)',
      border: 'rgba(248,113,113,0.32)',
    },
  } as const;
  const palette = base[tone];
  return {
    background: options?.active
      ? tone === 'primary'
        ? color.aux
        : 'rgba(99,102,241,0.28)'
      : palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
    borderRadius: 7,
    padding: tone === 'primary' ? '0.4rem 0.85rem' : '0.35rem 0.75rem',
    fontSize: 12,
    cursor: options?.disabled ? 'not-allowed' : 'pointer',
    fontWeight: tone === 'primary' ? 700 : 600,
    opacity: options?.disabled ? 0.72 : 1,
    transform: options?.active ? 'translateY(-1px)' : 'translateY(0)',
    transition: 'opacity 120ms ease, transform 120ms ease, background 120ms ease',
    display: 'inline-flex',
    alignItems: 'center',
  };
}

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 10,
  padding: '1px 5px',
  borderRadius: 4,
  background: 'rgba(148,163,184,0.12)',
  border: '1px solid rgba(148,163,184,0.28)',
  color: 'var(--fg-strong)',
  marginRight: 2,
};
