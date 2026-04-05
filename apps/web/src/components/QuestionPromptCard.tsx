import type { CSSProperties } from 'react';
import type { PendingQuestionRequest } from '@openAwork/web-client';

interface QuestionPromptCardProps {
  answers: string[][];
  errorMessage?: string;
  onDismiss: () => void;
  onSubmit: () => void;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
  pendingAction?: 'answered' | 'dismissed' | null;
  request: PendingQuestionRequest;
}

export default function QuestionPromptCard({
  answers,
  errorMessage,
  onDismiss,
  onSubmit,
  onToggleOption,
  pendingAction = null,
  request,
}: QuestionPromptCardProps) {
  const isSubmitting = pendingAction !== null;
  const isSubmitDisabled =
    isSubmitting ||
    request.questions.some((question, index) => (answers[index]?.length ?? 0) === 0);
  const pendingLabel = pendingAction === 'dismissed' ? '正在处理跳过…' : '正在提交回答…';

  return (
    <div style={containerStyle} aria-busy={isSubmitting}>
      <div style={headerRowStyle}>
        <span style={labelStyle}>会话等待回答</span>
        <span style={toolStyle}>{request.toolName}</span>
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
              <div style={questionHeaderStyle}>{question.header}</div>
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
                      <span style={optionLabelStyle}>{option.label}</span>
                      <span style={optionDescriptionStyle}>{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div style={actionsStyle}>
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
  background: 'var(--surface)',
  border: '1px solid var(--border)',
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
  color: 'var(--text)',
};

const toolStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'var(--text-3)',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
};

const questionBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const questionHeaderStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const questionTextStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text)',
};

const optionGridStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const optionButtonStyle = (selected: boolean, disabled: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-subtle)'}`,
  background: selected ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--surface-2)',
  color: 'var(--text)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  textAlign: 'left',
  opacity: disabled ? 0.68 : 1,
  transition: 'opacity 120ms ease, border-color 120ms ease, background 120ms ease',
});

const optionLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
};

const optionDescriptionStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  lineHeight: 1.5,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 4,
};

const statusPanelStyle = (error: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '0.6rem 0.7rem',
  borderRadius: 10,
  border: error ? '1px solid rgba(248,113,113,0.28)' : '1px solid rgba(99,102,241,0.22)',
  background: error ? 'rgba(127, 29, 29, 0.22)' : 'rgba(99,102,241,0.1)',
  color: error ? '#fecaca' : 'var(--text)',
  fontSize: 11,
  lineHeight: 1.5,
});

const secondaryButtonStyle = (disabled: boolean): CSSProperties => ({
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
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
  color: disabled ? 'var(--text-3)' : 'var(--accent-text)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled && !active ? 0.8 : 1,
});
