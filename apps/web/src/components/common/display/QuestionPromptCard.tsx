import { useEffect, useState, useRef, useCallback, type CSSProperties } from 'react';
import type { PendingQuestionRequest } from '@openAwork/web-client';
import { OptionSelectIndicator } from './OptionSelectIndicator.js';
import { QuestionOptionPreview } from './QuestionOptionPreview.js';

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
  const progressPercentage = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

  // 状态持久化
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const stateKey = `qpc-state-${request.requestId}`;
    const state = {
      answers,
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(stateKey, JSON.stringify(state));
    } catch (e) {
      // localStorage 可能已满或被禁用，静默失败
    }
  }, [answers, request.requestId]);

  // 提交或取消时清除保存的状态
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pendingAction !== null) {
      const stateKey = `qpc-state-${request.requestId}`;
      try {
        localStorage.removeItem(stateKey);
      } catch (e) {
        // 静默失败
      }
    }
  }, [pendingAction, request.requestId]);

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

      {/* 进度条 */}
      {totalQuestions > 1 && (
        <div style={progressBarWrapperStyle}>
          <div style={progressBarStyle}>
            <div style={{ ...progressBarFillStyle, width: `${progressPercentage}%` }} />
          </div>
        </div>
      )}

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
        {request.questions.map((question, questionIndex) => (
          <QuestionSection
            key={`${request.requestId}:${questionIndex}`}
            question={question}
            questionIndex={questionIndex}
            questionCount={totalQuestions}
            selectedAnswers={answers[questionIndex] ?? []}
            isSubmitting={isSubmitting}
            onToggleOption={onToggleOption}
          />
        ))}
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

interface QuestionSectionProps {
  question: PendingQuestionRequest['questions'][number];
  questionIndex: number;
  questionCount: number;
  selectedAnswers: string[];
  isSubmitting: boolean;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
}

function QuestionSection({
  question,
  questionIndex,
  questionCount,
  selectedAnswers,
  isSubmitting,
  onToggleOption,
}: QuestionSectionProps) {
  const multiple = question.multiple === true;
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const answered = selectedAnswers.length > 0;

  // 搜索过滤
  const filteredOptions = question.options.filter((option) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      option.label.toLowerCase().includes(query) ||
      option.description?.toLowerCase().includes(query) ||
      false
    );
  });

  const showSearch = question.options.length > 5;
  const selectedPreview = multiple
    ? undefined
    : question.options.find((option) => selectedAnswers.includes(option.label))?.preview;

  // 键盘导航
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isSubmitting) return;

      // 数字快捷键 (1-9)
      if (e.key >= '1' && e.key <= '9' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        const isEditable =
          target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if (isEditable) return;

        const index = parseInt(e.key, 10) - 1;
        if (index < filteredOptions.length && index >= 0) {
          const option = filteredOptions[index];
          if (option) {
            e.preventDefault();
            onToggleOption(questionIndex, option.label, multiple);
          }
        }
        return;
      }

      // 方向键导航
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const target = e.target as HTMLElement;
        const isInSearch = target === searchRef.current;

        if (!isInSearch && focusedIndex === -1) return;

        e.preventDefault();
        const maxIndex = filteredOptions.length - 1;
        let newIndex = focusedIndex;

        if (e.key === 'ArrowDown') {
          newIndex = focusedIndex >= maxIndex ? 0 : focusedIndex + 1;
        } else {
          newIndex = focusedIndex <= 0 ? maxIndex : focusedIndex - 1;
        }

        setFocusedIndex(newIndex);
        optionRefs.current[newIndex]?.focus();
        return;
      }

      // Space 切换选中状态
      if (e.key === ' ' && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON') {
          e.preventDefault();
          const option = filteredOptions[focusedIndex];
          if (option) {
            onToggleOption(questionIndex, option.label, multiple);
          }
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSubmitting, focusedIndex, filteredOptions, questionIndex, multiple, onToggleOption]);

  return (
    <section style={questionBlockStyle}>
      <div style={questionHeaderStyle}>
        {questionCount > 1 && (
          <span style={answered ? questionNumDoneStyle : questionNumStyle} aria-hidden>
            {answered ? '✓' : questionIndex + 1}
          </span>
        )}
        <span>{question.header}</span>
        {multiple && (
          <span style={multiBadgeStyle} title="该问题可选择多个选项">
            可多选
          </span>
        )}
      </div>
      <div style={questionTextStyle}>{question.question}</div>

      {/* 搜索框 */}
      {showSearch && (
        <div style={searchWrapperStyle}>
          <input
            ref={searchRef}
            type="text"
            style={searchInputStyle}
            placeholder="搜索选项..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setFocusedIndex(-1);
            }}
            disabled={isSubmitting}
          />
          {searchQuery && (
            <button
              type="button"
              style={searchClearStyle}
              onClick={() => {
                setSearchQuery('');
                searchRef.current?.focus();
              }}
              aria-label="清除搜索"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* 批量操作（多选时） */}
      {multiple && filteredOptions.length > 1 && (
        <div style={bulkActionsStyle}>
          <button
            type="button"
            style={bulkBtnStyle}
            disabled={isSubmitting}
            onClick={() => {
              filteredOptions.forEach((option) => {
                if (!selectedAnswers.includes(option.label)) {
                  onToggleOption(questionIndex, option.label, multiple);
                }
              });
            }}
          >
            全选
          </button>
          <button
            type="button"
            style={bulkBtnStyle}
            disabled={isSubmitting}
            onClick={() => {
              filteredOptions.forEach((option) => {
                if (selectedAnswers.includes(option.label)) {
                  onToggleOption(questionIndex, option.label, multiple);
                }
              });
            }}
          >
            取消全选
          </button>
          {selectedAnswers.length > 0 && (
            <span style={selectedCountStyle}>已选 {selectedAnswers.length} 项</span>
          )}
        </div>
      )}

      <div style={optionGridStyle}>
        {filteredOptions.length === 0 && searchQuery ? (
          <div style={noResultsStyle}>未找到匹配的选项</div>
        ) : (
          filteredOptions.map((option, index) => {
            const selected = selectedAnswers.includes(option.label);
            return (
              <button
                key={option.label}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                disabled={isSubmitting}
                onClick={() => onToggleOption(questionIndex, option.label, multiple)}
                onFocus={() => setFocusedIndex(index)}
                style={optionButtonStyle(selected, isSubmitting)}
                aria-pressed={selected}
                aria-label={`${showSearch && index < 9 ? `按 ${index + 1} 键或` : ''}${option.label}${option.description ? `: ${option.description}` : ''}`}
              >
                <OptionSelectIndicator selected={selected} multiple={multiple} />
                <span style={optionContentStyle}>
                  <span style={optionLabelStyle}>
                    {showSearch && index < 9 && <kbd style={optionKbdStyle}>{index + 1}</kbd>}
                    {option.label}
                  </span>
                  <span style={optionDescriptionStyle}>{option.description}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      {selectedPreview !== undefined && <QuestionOptionPreview preview={selectedPreview} />}
    </section>
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

const progressBarWrapperStyle: CSSProperties = {
  marginTop: -4,
  marginBottom: 4,
};

const progressBarStyle: CSSProperties = {
  height: 4,
  background: 'var(--surface-3)',
  borderRadius: 999,
  overflow: 'hidden',
  position: 'relative',
};

const progressBarFillStyle: CSSProperties = {
  height: '100%',
  background: 'var(--accent)',
  borderRadius: 999,
  transition: 'width 320ms cubic-bezier(0.22, 1, 0.36, 1)',
  position: 'relative',
};

const questionNumStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: '50%',
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  flexShrink: 0,
};

const questionNumDoneStyle: CSSProperties = {
  ...questionNumStyle,
  color: 'var(--fg-on-accent)',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
};

const searchWrapperStyle: CSSProperties = {
  position: 'relative',
  marginBottom: 8,
};

const searchInputStyle: CSSProperties = {
  width: '100%',
  padding: '7px 30px 7px 10px',
  borderRadius: 7,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
  transition: 'border-color 120ms ease',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const searchClearStyle: CSSProperties = {
  position: 'absolute',
  right: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 20,
  height: 20,
  border: 'none',
  background: 'var(--surface-3)',
  color: 'var(--fg-muted)',
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
  transition: 'background 120ms ease',
};

const bulkActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 8,
  padding: '6px 8px',
  background: 'var(--bg-surface)',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
};

const bulkBtnStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 5,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 120ms ease',
  fontFamily: 'inherit',
};

const selectedCountStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--accent)',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const noResultsStyle: CSSProperties = {
  padding: 16,
  textAlign: 'center',
  fontSize: 12,
  color: 'var(--fg-muted)',
  border: '1px dashed var(--border-subtle)',
  borderRadius: 8,
  background: 'var(--bg-surface)',
};

const optionKbdStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  marginRight: 6,
  fontSize: 9,
  fontWeight: 700,
  fontFamily: 'var(--font-mono, monospace)',
  color: 'var(--fg-muted)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 3,
  lineHeight: 1,
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
