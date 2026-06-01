import { useEffect, type CSSProperties } from 'react';
import type { PendingQuestionRequest } from '@openAwork/web-client';
import { OptionSelectIndicator } from './OptionSelectIndicator.js';

interface QuestionPromptCardProps {
  answers: string[][];
  errorMessage?: string;
  onDismiss: () => void;
  onSubmit: () => void;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
  pendingAction?: 'answered' | 'dismissed' | null;
  request: PendingQuestionRequest;
  style?: CSSProperties;
}

export default function QuestionPromptCard({
  answers,
  errorMessage,
  onDismiss,
  onSubmit,
  onToggleOption,
  pendingAction = null,
  request,
  style,
}: QuestionPromptCardProps) {
  const isSubmitting = pendingAction !== null;
  const answeredCount = request.questions.filter(
    (_, index) => (answers[index]?.length ?? 0) > 0,
  ).length;
  const totalQuestions = request.questions.length;
  const isSubmitDisabled =
    isSubmitting ||
    request.questions.some((question, index) => (answers[index]?.length ?? 0) === 0);
  const pendingLabel = pendingAction === 'dismissed' ? '正在处理跳过…' : '正在提交回答…';

  // Enter 提交：与 InlineQuestionPanel / PermissionPrompt 的键盘语义一致。
  // 仅在未提交、且所有问题都已回答（!isSubmitDisabled）时触发；焦点在任何
  // 编辑控件里时不接管 Enter，避免劫持输入框自身的回车行为。
  useEffect(() => {
    if (typeof window === 'undefined' || isSubmitDisabled) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable === true;
        if (isEditable) return;
      }
      event.preventDefault();
      onSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitDisabled, onSubmit]);

  return (
    <div style={{ ...containerStyle, ...style }} aria-busy={isSubmitting}>
      <div style={headerRowStyle}>
        <span style={labelStyle}>会话等待回答</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {totalQuestions > 1 && (
            <span style={progressStyle} title={`已回答 ${answeredCount} / ${totalQuestions} 题`}>
              {answeredCount}/{totalQuestions}
            </span>
          )}
          <span style={toolStyle} title={request.toolName}>
            询问用户
          </span>
        </div>
      </div>
      <div style={titleStyle}>{request.title}</div>

      {(isSubmitting || errorMessage) && (
        <div
          role={errorMessage ? 'alert' : 'status'}
          style={statusPanelStyle(Boolean(errorMessage))}
        >
          <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1.2 }}>
            {errorMessage ? '⚠' : '⏳'}
          </span>
          <span>{errorMessage ?? pendingLabel}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {request.questions.map((question, questionIndex) => {
          const selectedAnswers = answers[questionIndex] ?? [];
          const multiple = question.multiple === true;
          return (
            <section key={`${request.requestId}:${questionIndex}`} style={questionBlockStyle}>
              <div style={questionHeaderStyle}>
                <span>{question.header}</span>
                {multiple && (
                  <span style={multiBadgeStyle} title="该问题可选择多个选项">
                    可多选
                  </span>
                )}
              </div>
              <div style={questionTextStyle}>{question.question}</div>
              <div style={optionGridStyle}>
                {question.options.map((option) => {
                  const selected = selectedAnswers.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onToggleOption(questionIndex, option.label, multiple)}
                      style={optionButtonStyle(selected, isSubmitting)}
                    >
                      <OptionSelectIndicator selected={selected} multiple={multiple} />
                      <span style={optionContentStyle}>
                        <span style={optionLabelStyle}>{option.label}</span>
                        <span style={optionDescriptionStyle}>{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div style={actionsStyle}>
        {!isSubmitDisabled && (
          <span style={kbdHintStyle}>
            <kbd style={kbdStyle}>Enter</kbd> 提交
          </span>
        )}
        <button
          type="button"
          disabled={isSubmitting}
          onClick={onDismiss}
          style={secondaryButtonStyle(isSubmitting)}
        >
          {pendingAction === 'dismissed' ? '处理中…' : '暂不回答'}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitDisabled}
          style={primaryButtonStyle(isSubmitDisabled, pendingAction === 'answered')}
        >
          {pendingAction === 'answered' ? '提交中…' : '提交回答'}
        </button>
      </div>
    </div>
  );
}

const containerStyle: CSSProperties = {
  position: 'fixed',
  right: 24,
  bottom: 24,
  zIndex: 500,
  width: 420,
  maxWidth: 'min(92vw, 420px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '1rem',
  borderRadius: 12,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-lg)',
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg-strong)',
};

const toolStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'var(--fg-muted)',
};

const progressStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
  padding: '1px 7px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg-strong)',
};

const questionBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const questionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const multiBadgeStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'none',
  color: 'var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
  borderRadius: 999,
  padding: '1px 6px',
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
};

const questionTextStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--fg-strong)',
};

const optionGridStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const optionButtonStyle = (selected: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`,
  background: selected ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg-surface)',
  color: 'var(--fg-strong)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  textAlign: 'left',
  opacity: disabled ? 0.68 : 1,
  transition: 'opacity 120ms ease, border-color 120ms ease, background 120ms ease',
});

const optionContentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const optionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
};

const optionDescriptionStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
};

const kbdHintStyle: CSSProperties = {
  marginRight: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const kbdStyle: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: 9,
  lineHeight: 1,
  padding: '2px 5px',
  borderRadius: 4,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-default)',
};

const statusPanelStyle = (error: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '0.6rem 0.7rem',
  borderRadius: 10,
  border: error
    ? '1px solid color-mix(in srgb, var(--danger) 28%, transparent)'
    : '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
  background: error
    ? 'color-mix(in srgb, var(--danger) 10%, transparent)'
    : 'color-mix(in srgb, var(--accent) 8%, transparent)',
  color: error ? 'var(--danger)' : 'var(--fg-strong)',
  fontSize: 11,
  lineHeight: 1.5,
});

const secondaryButtonStyle = (disabled: boolean): CSSProperties => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-default)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.68 : 1,
});

const primaryButtonStyle = (disabled: boolean, active: boolean): CSSProperties => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--accent)',
  background: disabled
    ? active
      ? 'color-mix(in srgb, var(--accent) 22%, var(--surface-3))'
      : 'var(--surface-3)'
    : 'var(--accent)',
  color: disabled ? 'var(--fg-muted)' : 'var(--fg-on-accent)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled && !active ? 0.8 : 1,
});
