import { useState, useCallback, useRef, useEffect } from 'react';
import type { PendingQuestionRequest } from '@openAwork/web-client';

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
  const hasAnyAnswer = request.questions.some(
    (_, index) =>
      (answers[index]?.length ?? 0) > 0 || (customInputs[index]?.trim().length ?? 0) > 0,
  );
  const isSubmitDisabled = isSubmitting || !hasAnyAnswer;
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [request.requestId]);

  return (
    <div className="iqp-wrapper" style={{ maxWidth: editorMode ? 680 : 740 }}>
      <div ref={containerRef} className="inline-question-panel">
        <style>{panelStyles}</style>

        <div className="iqp-header" onClick={() => setCollapsed((c) => !c)}>
          <div className="iqp-header-left">
            <span className="iqp-pulse" />
            <span className="iqp-label">等待回答</span>
            <span className="iqp-title">{request.title}</span>
          </div>
          <div className="iqp-header-right">
            <span className="iqp-tool">{request.toolName}</span>
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

        {!collapsed && (
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
                selectedAnswers={answers[questionIndex] ?? []}
                customInput={customInputs[questionIndex] ?? ''}
                isSubmitting={isSubmitting}
                onToggleOption={onToggleOption}
                onCustomInputChange={onCustomInputChange}
              />
            ))}

            <div className="iqp-actions">
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
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionBlock({
  question,
  questionIndex,
  selectedAnswers,
  customInput,
  isSubmitting,
  onToggleOption,
  onCustomInputChange,
}: {
  question: PendingQuestionRequest['questions'][number];
  questionIndex: number;
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
      <div className="iqp-question-header">{question.header}</div>
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
                {selected ? (
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
                  <span className="iqp-option-check-empty" />
                )}
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
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
  animation: iqp-slide-up 280ms cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.06);
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
  background: var(--surface-2);
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
  color: var(--text);
  white-space: nowrap;
}

.iqp-title {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iqp-tool {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--text-3);
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 4px;
}

.iqp-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  color: var(--text-3);
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
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  font-size: 12px;
  color: var(--danger, #ef4444);
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
  background: rgba(239, 68, 68, 0.15);
  flex-shrink: 0;
}

.iqp-question-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.iqp-question-header {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.iqp-question-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
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
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background 120ms ease;
}
.iqp-option:hover:not(:disabled) {
  background: var(--surface-2);
  border-color: var(--border);
}
.iqp-option:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.iqp-option-selected {
  border-color: var(--accent) !important;
  background: color-mix(in srgb, var(--accent) 8%, var(--surface)) !important;
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
.iqp-option-check-empty {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1.5px solid var(--border);
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
  color: var(--text-3);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.iqp-custom-preview {
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
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
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
  color: var(--text-3);
}

.iqp-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
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
  background: var(--surface-2);
  color: var(--text-2);
}
.iqp-btn-secondary:hover:not(:disabled) {
  background: var(--surface-3);
}

.iqp-btn-primary {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-text, #fff);
}
.iqp-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}
`;
