import { color } from '../tokens.js';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
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
  onDecide: (requestId: string, decision: PermissionDecision) => void;
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
  sessionTitle,
  onNavigateToSession,
  style,
}: PermissionPromptProps) {
  const riskColor = RISK_COLORS[riskLevel] ?? 'var(--fg-muted, #7b8a9e)';
  const decisionOptions = getPermissionDecisionOptions(riskLevel);
  const activeDecision = pendingDecision
    ? (decisionOptions.find((option) => option.decision === pendingDecision) ?? null)
    : null;
  const isSubmitting = activeDecision !== null;

  // Dedupe always patterns against scope so we don't render "批准会覆盖：`ls -la`"
  // when the user already sees `ls -la` in the command preview directly above.
  const broadPatterns =
    always && always.length > 0 ? always.filter((pattern) => pattern !== scope) : [];

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
        onDecide(requestId, 'reject');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onDecide(requestId, 'session');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, onDecide, requestId]);

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
        background: 'var(--bg-overlay, #121721)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 440,
        boxShadow: '0 22px 56px rgba(15, 23, 42, 0.45)',
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
            color: 'var(--fg-muted, #7b8a9e)',
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
                color: 'var(--accent, #5cd4c0)',
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
                color: 'var(--fg-strong, #f1f4f8)',
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
            color: 'var(--accent, #5cd4c0)',
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
          color: 'var(--fg-strong, #f1f4f8)',
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
            color: 'var(--fg-strong, #f1f4f8)',
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          {previewAction ?? scope}
        </code>
      </PromptSection>

      {broadPatterns.length > 0 && (
        <PromptSection label="本会话 / 永久允许会覆盖">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {broadPatterns.map((pattern) => (
              <code
                key={pattern}
                style={{
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 10.5,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(99,102,241,0.12)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  color: 'var(--accent, #5cd4c0)',
                }}
              >
                {pattern}
              </code>
            ))}
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
            color: errorMessage ? '#fecaca' : 'var(--fg-strong, #f1f4f8)',
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
              onClick={() => onDecide(requestId, option.decision)}
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
            color: 'var(--fg-muted, #7b8a9e)',
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
          color: 'var(--fg-muted, #7b8a9e)',
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
      fg: 'var(--bg-overlay, #121721)',
      bg: 'var(--accent, #5cd4c0)',
      border: color.aux,
    },
    secondary: {
      fg: 'var(--fg-strong, #f1f4f8)',
      bg: 'rgba(99,102,241,0.14)',
      border: 'rgba(99,102,241,0.36)',
    },
    subtle: {
      fg: 'var(--fg-muted, #7b8a9e)',
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
    transform: options?.active ? 'translateY(-1px)' : undefined,
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
  color: 'var(--fg-strong, #f1f4f8)',
  marginRight: 2,
};
