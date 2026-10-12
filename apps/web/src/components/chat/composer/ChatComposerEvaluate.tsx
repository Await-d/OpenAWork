/**
 * ChatComposerEvaluate — 提示词评估结果面板。
 *
 * 展示 prompt-evaluation 的产出：总体/维度评分、改进建议、
 * stopSignals 止损信号，以及补丁计划（用 applyPatchPlan 本地运算出
 * 应用后文本，支持一键回填输入框）。
 */

import { useMemo } from 'react';
import type { PromptEvaluationResponse } from '@openAwork/web-client';
import { applyPatchPlan } from '../../../utils/prompt-patch.js';

export interface ChatComposerEvaluateProps {
  /** 被评估的原始文本（候选或当前输入）。 */
  sourceText: string;
  evaluateResult: PromptEvaluationResponse | null;
  evaluateLoading: boolean;
  evaluateError: string | null;
  /** 触发评估（无结果且可评估时渲染为入口按钮）。 */
  onEvaluate?: () => void;
  onRetry?: () => void;
  onApplyPatch: (appliedText: string) => void;
}

const OP_LABELS: Record<string, string> = {
  insert: '插入',
  replace: '替换',
  delete: '删除',
};

function StopSignalBadges({ result }: { result: PromptEvaluationResponse }) {
  const signals = result.stopSignals;
  if (!signals) {
    return null;
  }
  const chips: string[] = [];
  if (signals.stopRecommendation === 'stop') {
    chips.push('建议停止迭代');
  } else if (signals.stopRecommendation === 'continue') {
    chips.push('建议继续优化');
  } else if (signals.stopRecommendation === 'review') {
    chips.push('建议人工复核');
  }
  if (signals.targetVsBaseline === 'improved') chips.push('相对基线有改进');
  if (signals.targetVsBaseline === 'regressed') chips.push('相对基线回退');
  if (signals.overfitRisk === 'high') chips.push('过拟合风险高');
  else if (signals.overfitRisk === 'medium') chips.push('过拟合风险中');
  if (chips.length === 0) {
    return null;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {chips.map((chip, idx) => (
        <span
          key={idx}
          style={{
            fontSize: 9,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            color: 'color-mix(in oklch, var(--accent) 72%, var(--fg-on-accent) 28%)',
            whiteSpace: 'nowrap',
          }}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

export function ChatComposerEvaluate({
  sourceText,
  evaluateResult,
  evaluateLoading,
  evaluateError,
  onEvaluate,
  onRetry,
  onApplyPatch,
}: ChatComposerEvaluateProps) {
  const patchPreview = useMemo(() => {
    if (!evaluateResult) {
      return null;
    }
    return applyPatchPlan(sourceText, evaluateResult.patchPlan);
  }, [evaluateResult, sourceText]);

  if (evaluateLoading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          fontSize: 11,
          color: 'var(--fg-muted)',
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            border: '2px solid var(--border-default)',
            borderTopColor: 'var(--accent)',
            borderRadius: 999,
            animation: 'composerSpin 800ms linear infinite',
            flexShrink: 0,
          }}
        />
        正在评估提示词…
      </div>
    );
  }

  if (evaluateError) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
          color: 'color-mix(in srgb, var(--danger) 82%, var(--fg-on-accent) 18%)',
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        <span>{evaluateError}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            重试
          </button>
        )}
      </div>
    );
  }

  if (!evaluateResult) {
    if (!onEvaluate || evaluateLoading) {
      return null;
    }
    return (
      <button
        type="button"
        onClick={onEvaluate}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--fg-default)',
          fontSize: 11,
          fontWeight: 600,
          padding: '6px 10px',
          cursor: 'pointer',
          transition: 'background 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 6%, transparent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        评估此提示词
      </button>
    );
  }

  const { score, improvements, summary } = evaluateResult;
  const canApplyPatch = patchPreview !== null && patchPreview.appliedCount > 0;

  return (
    <div style={{ display: 'grid', gap: 8, padding: '8px 10px', fontSize: 11 }}>
      {/* 总评 + 分数 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color:
                score.overall >= 70
                  ? 'var(--success)'
                  : score.overall >= 50
                    ? 'var(--accent)'
                    : 'var(--danger)',
            }}
          >
            {Math.round(score.overall)}
          </span>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>/ 100</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>提示词评估</span>
      </div>

      {summary && <div style={{ color: 'var(--fg-default)', lineHeight: 1.6 }}>{summary}</div>}

      <StopSignalBadges result={evaluateResult} />

      {/* 维度得分 */}
      {score.dimensions.length > 0 && (
        <div style={{ display: 'grid', gap: 4, marginTop: 2 }}>
          {score.dimensions.map((dim) => (
            <div key={dim.key} style={{ display: 'grid', gap: 2 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                }}
              >
                <span>{dim.label}</span>
                <span>{Math.round(dim.score)}</span>
              </div>
              <div
                style={{
                  height: 3,
                  borderRadius: 999,
                  background: 'var(--border-subtle)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, dim.score))}%`,
                    borderRadius: 999,
                    background:
                      dim.score >= 70
                        ? 'var(--success)'
                        : dim.score >= 50
                          ? 'var(--accent)'
                          : 'var(--danger)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 改进建议 */}
      {improvements.length > 0 && (
        <div style={{ display: 'grid', gap: 3 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-strong)' }}>改进建议</span>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 2 }}>
            {improvements.map((imp, idx) => (
              <li key={idx} style={{ color: 'var(--fg-default)', lineHeight: 1.5 }}>
                {imp}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 补丁计划 */}
      {evaluateResult.patchPlan.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-strong)' }}>
            精准修复（{evaluateResult.patchPlan.length} 项）
          </span>
          <div style={{ display: 'grid', gap: 4 }}>
            {evaluateResult.patchPlan.map((op, idx) => (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gap: 2,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'color-mix(in oklch, var(--bg-base) 40%, transparent)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    fontSize: 9,
                    color: 'var(--fg-muted)',
                  }}
                >
                  <span
                    style={{
                      padding: '0 4px',
                      borderRadius: 4,
                      background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                      color: 'var(--accent)',
                      fontWeight: 700,
                    }}
                  >
                    {OP_LABELS[op.op] ?? op.op}
                  </span>
                  <span
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {op.instruction}
                  </span>
                </div>
                {op.oldText.length > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>原文：</span>
                    <span
                      style={{
                        textDecoration: op.op === 'delete' ? 'line-through' : 'none',
                        color: op.op === 'delete' ? 'var(--danger)' : 'var(--fg-default)',
                      }}
                    >
                      {op.oldText}
                    </span>
                  </div>
                )}
                {op.newText.length > 0 && (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>替换：</span>
                    <span style={{ color: 'var(--success)' }}>{op.newText}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {patchPreview && patchPreview.skipped.length > 0 && (
            <span style={{ fontSize: 9, color: 'var(--fg-subtle)' }}>
              {patchPreview.skipped.length} 项未能定位原文锚点，已跳过。
            </span>
          )}
        </div>
      )}

      {/* 一键应用补丁 */}
      {canApplyPatch && patchPreview && (
        <button
          type="button"
          onClick={() => onApplyPatch(patchPreview.text)}
          style={{
            border: '1px solid color-mix(in oklch, var(--accent) 45%, var(--border-subtle))',
            borderRadius: 8,
            background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 10px',
            cursor: 'pointer',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background =
              'color-mix(in oklch, var(--accent) 18%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              'color-mix(in oklch, var(--accent) 12%, transparent)';
          }}
        >
          应用修复到输入框
        </button>
      )}
    </div>
  );
}
