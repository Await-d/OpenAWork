import { useState, useCallback, useRef, useEffect } from 'react';
import type { PendingQuestionRequest } from '@openAwork/web-client';
import { OptionSelectIndicator } from '../../common/display/OptionSelectIndicator.js';

interface InlineQuestionPanelProps {
  answers: string[][];
  customInputs: string[];
  editorMode?: boolean;
  errorMessage?: string;
  onDismiss: () => void;
  onSubmit: () => void;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
  onCustomInputChange: (questionIndex: number, value: string) => void;
  pendingAction?: 'answered' | 'dismissed' | null;
  request: PendingQuestionRequest;
}

export function InlineQuestionPanel({
  answers,
  customInputs,
  editorMode = false,
  errorMessage,
  onDismiss,
  onSubmit,
  onToggleOption,
  onCustomInputChange,
  pendingAction = null,
  request,
}: InlineQuestionPanelProps) {
  const isSubmitting = pendingAction !== null;
  const answeredFlags = request.questions.map(
    (_, index) =>
      (answers[index]?.length ?? 0) > 0 || (customInputs[index]?.trim().length ?? 0) > 0,
  );
  const answeredCount = answeredFlags.filter(Boolean).length;
  const totalQuestions = request.questions.length;
  // 必须每个问题都已回答才能提交（与 QuestionPromptCard 语义一致）——多题时
  // 之前只要任意一题有答案就能提交，会让用户漏答其余问题。
  const allAnswered = answeredFlags.every(Boolean);
  const isSubmitDisabled = isSubmitting || !allAnswered;
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [request.requestId]);

  // Enter 提交：与 PermissionPrompt 的键盘语义一致（Enter = 主操作）。
  // 仅在面板展开、未提交、且所有问题都已回答（!isSubmitDisabled）时触发。当焦点
  // 在「自定义回答」输入框里时不接管 Enter——那里 Enter 有自己的语义（确认并收起
  // 输入框），接管会导致用户刚敲完自定义答案就误触发整体提交。
  useEffect(() => {
    if (typeof window === 'undefined' || collapsed || isSubmitDisabled) {
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
        // 在任何编辑控件里都不接管 Enter：面板内的自定义输入框有自己的处理，
        // 面板外的聊天输入框也不应被本面板劫持。
        if (isEditable) return;
      }
      event.preventDefault();
      onSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [collapsed, isSubmitDisabled, onSubmit]);

  return (
    <div className="iqp-wrapper" style={{ maxWidth: editorMode ? 680 : 740 }}>
      <div
        ref={containerRef}
        className="inline-question-panel"
        data-question-request-id={request.requestId}
      >
        <style>{panelStyles}</style>

        <div className="iqp-header" onClick={() => setCollapsed((c) => !c)}>
          <div className="iqp-header-left">
            <span className="iqp-pulse" />
            <span className="iqp-label">等待回答</span>
            <span className="iqp-title">{request.title}</span>
          </div>
          <div className="iqp-header-right">
            {totalQuestions > 1 && (
              <span
                className="iqp-progress"
                title={`已回答 ${answeredCount} / ${totalQuestions} 题`}
              >
                {answeredCount}/{totalQuestions}
              </span>
            )}
            <span className="iqp-tool" title={request.toolName}>
              询问用户
            </span>
            <button
              type="button"
              className="iqp-collapse-btn"
              aria-label={collapsed ? '展开' : '收起'}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                style={{
                  transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  transition: 'transform 200ms ease',
                }}
              >
                <path
                  d="M3 5.5L7 9.5L11 5.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* 折叠态下保留一条精简摘要，避免「收起后完全失去上下文」。点击同样切换展开。 */}
        {collapsed && (
          <div className="iqp-collapsed-summary" onClick={() => setCollapsed(false)}>
            {totalQuestions > 1
              ? `${totalQuestions} 个问题待回答（已答 ${answeredCount}）`
              : (request.questions[0]?.question ?? request.title)}
          </div>
        )}

        {!collapsed && (
          <>
            <div className="iqp-body">
              {errorMessage && (
                <div className="iqp-error" role="alert">
                  <span className="iqp-error-icon">!</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {request.questions.map((question, questionIndex) => (
                <QuestionBlock
                  key={`${request.requestId}:${questionIndex}`}
                  question={question}
                  questionIndex={questionIndex}
                  questionCount={totalQuestions}
                  answered={answeredFlags[questionIndex] ?? false}
                  selectedAnswers={answers[questionIndex] ?? []}
                  customInput={customInputs[questionIndex] ?? ''}
                  isSubmitting={isSubmitting}
                  onToggleOption={onToggleOption}
                  onCustomInputChange={onCustomInputChange}
                />
              ))}
            </div>

            {/* Actions live OUTSIDE the scrollable body so 确认/跳过 are always
                visible and clickable even when the question list overflows the
                panel's max-height (otherwise the submit button gets pushed below
                the fold and looks like "选了之后没有提交按钮"). */}
            <div className="iqp-actions">
              {!isSubmitDisabled && (
                <span className="iqp-kbd-hint">
                  <kbd className="iqp-kbd">Enter</kbd> 提交
                </span>
              )}
              <button
                type="button"
                className="iqp-btn iqp-btn-secondary"
                disabled={isSubmitting}
                onClick={onDismiss}
              >
                {pendingAction === 'dismissed' ? '处理中…' : '跳过'}
              </button>
              <button
                type="button"
                className="iqp-btn iqp-btn-primary"
                disabled={isSubmitDisabled}
                onClick={onSubmit}
              >
                {pendingAction === 'answered' ? '提交中…' : '确认'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function QuestionBlock({
  question,
  questionIndex,
  questionCount,
  answered,
  selectedAnswers,
  customInput,
  isSubmitting,
  onToggleOption,
  onCustomInputChange,
}: {
  question: PendingQuestionRequest['questions'][number];
  questionIndex: number;
  questionCount: number;
  answered: boolean;
  selectedAnswers: string[];
  customInput: string;
  isSubmitting: boolean;
  onToggleOption: (questionIndex: number, optionLabel: string, multiple: boolean) => void;
  onCustomInputChange: (questionIndex: number, value: string) => void;
}) {
  const multiple = question.multiple === true;
  const [showCustomInput, setShowCustomInput] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasCustom = customInput.trim().length > 0;

  const handleToggleCustom = useCallback(() => {
    setShowCustomInput((v) => !v);
    if (!showCustomInput) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [showCustomInput]);

  return (
    <div className="iqp-question-block">
      <div className="iqp-question-header">
        {questionCount > 1 && (
          <span className={`iqp-q-num ${answered ? 'iqp-q-num-done' : ''}`} aria-hidden>
            {answered ? '✓' : questionIndex + 1}
          </span>
        )}
        <span>{question.header}</span>
        {multiple && (
          <span className="iqp-multi-badge" title="该问题可选择多个选项">
            可多选
          </span>
        )}
      </div>
      <div className="iqp-question-text">{question.question}</div>

      <div className="iqp-options">
        {question.options.map((option) => {
          const selected = selectedAnswers.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              className={`iqp-option ${selected ? 'iqp-option-selected' : ''}`}
              disabled={isSubmitting}
              onClick={() => onToggleOption(questionIndex, option.label, multiple)}
            >
              <span className="iqp-option-check">
                <OptionSelectIndicator selected={selected} multiple={multiple} />
              </span>
              <span className="iqp-option-content">
                <span className="iqp-option-label">{option.label}</span>
                {option.description && (
                  <span className="iqp-option-desc">{option.description}</span>
                )}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          className={`iqp-option iqp-option-custom-trigger ${hasCustom ? 'iqp-option-selected' : ''}`}
          disabled={isSubmitting}
          onClick={handleToggleCustom}
        >
          <span className="iqp-option-check">
            {hasCustom ? (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6L5 8.5L9.5 3.5"
                  stroke="var(--accent)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 2.5V9.5M2.5 6H9.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </span>
          <span className="iqp-option-content">
            <span className="iqp-option-label">自定义回答</span>
            {!showCustomInput && !hasCustom && (
              <span className="iqp-option-desc">输入你自己的答案</span>
            )}
            {hasCustom && !showCustomInput && (
              <span className="iqp-option-desc iqp-custom-preview">{customInput}</span>
            )}
          </span>
        </button>

        {showCustomInput && (
          <div className="iqp-custom-input-row">
            <input
              ref={inputRef}
              type="text"
              className="iqp-custom-input"
              placeholder="输入自定义答案…"
              value={customInput}
              disabled={isSubmitting}
              onChange={(e) => onCustomInputChange(questionIndex, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customInput.trim()) {
                  setShowCustomInput(false);
                }
                if (e.key === 'Escape') {
                  setShowCustomInput(false);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const panelStyles = `
.iqp-wrapper {
  width: 100%;
  margin: 0 auto;
  padding: 0 10px;
  box-sizing: border-box;
}

.inline-question-panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: var(--bg-overlay);
  overflow: hidden;
  animation: iqp-slide-up 280ms cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: var(--shadow-sm);
}

@keyframes iqp-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.iqp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border-subtle);
  transition: background 120ms ease;
}
.iqp-header:hover {
  background: var(--bg-surface);
}

.iqp-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.iqp-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.iqp-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: iqp-pulse-anim 2s ease-in-out infinite;
}

@keyframes iqp-pulse-anim {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 var(--accent); }
  50% { opacity: 0.7; box-shadow: 0 0 0 4px transparent; }
}

.iqp-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-strong);
  white-space: nowrap;
}

.iqp-title {
  font-size: 12px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iqp-tool {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--fg-muted);
  background: var(--bg-surface);
  padding: 2px 6px;
  border-radius: 4px;
}

.iqp-progress {
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  padding: 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
}

.iqp-collapsed-summary {
  padding: 8px 14px 10px;
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.5;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.iqp-collapsed-summary:hover {
  color: var(--fg-default);
}

.iqp-q-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 9px;
  font-weight: 700;
  color: var(--fg-muted);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  flex-shrink: 0;
}
.iqp-q-num-done {
  color: var(--fg-on-accent);
  background: var(--accent);
  border-color: var(--accent);
}

.iqp-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  color: var(--fg-muted);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}
.iqp-collapse-btn:hover {
  background: var(--surface-3);
}

.iqp-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 14px;
  max-height: 320px;
  overflow-y: auto;
}

.iqp-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 22%, transparent);
  font-size: 12px;
  color: var(--danger);
}
.iqp-error-icon {
  font-weight: 700;
  font-size: 11px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  flex-shrink: 0;
}

.iqp-question-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.iqp-question-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.iqp-multi-badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 999px;
  padding: 1px 6px;
  line-height: 1.5;
  white-space: nowrap;
}

.iqp-question-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg-strong);
}

.iqp-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
}

.iqp-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-overlay);
  color: var(--fg-strong);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background 120ms ease;
}
.iqp-option:hover:not(:disabled) {
  background: var(--bg-surface);
  border-color: var(--border-default);
}
.iqp-option:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.iqp-option-selected {
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-overlay)) !important;
}

.iqp-option-check {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.iqp-option-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.iqp-option-label {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}

.iqp-option-desc {
  font-size: 11px;
  color: var(--fg-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.iqp-option-selected .iqp-option-desc {
  color: var(--fg-default);
}

/* 自定义回答的预览仍保持单行省略（避免长答案撑高触发按钮）。 */
.iqp-custom-preview {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--accent);
  font-style: italic;
}

.iqp-custom-input-row {
  padding: 0 2px;
}

.iqp-custom-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 7px;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--fg-strong);
  font-size: 12px;
  line-height: 1.5;
  outline: none;
  transition: border-color 120ms ease;
  font-family: inherit;
  box-sizing: border-box;
}
.iqp-custom-input:focus {
  border-color: var(--accent);
}
.iqp-custom-input::placeholder {
  color: var(--fg-muted);
}

.iqp-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-overlay);
  flex-shrink: 0;
}

.iqp-kbd-hint {
  margin-right: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--fg-muted);
  white-space: nowrap;
}

.iqp-kbd {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--fg-default);
}

.iqp-btn {
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 120ms ease, background 120ms ease;
  font-family: inherit;
}
.iqp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.iqp-btn-secondary {
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--fg-default);
}
.iqp-btn-secondary:hover:not(:disabled) {
  background: var(--surface-3);
}

.iqp-btn-primary {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--fg-on-accent);
}
.iqp-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
`;
