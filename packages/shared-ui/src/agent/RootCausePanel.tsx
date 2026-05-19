import { color } from '../tokens.js';
import type { CSSProperties } from 'react';

export interface RootCauseInfo {
  category:
    | 'logic_error'
    | 'missing_dependency'
    | 'env_issue'
    | 'input_format'
    | 'model_capability';
  whyRetryFailed: string;
  fixSuggestion: string;
  requiresHuman: boolean;
  autoFixApplied?: string;
  affectedNodes?: string[];
}

export interface RootCausePanelProps {
  nodeLabel: string;
  attempts: number;
  error: string;
  analysis?: RootCauseInfo;
  onRetry?: () => void;
  onSkip?: () => void;
  style?: CSSProperties;
}

const CATEGORY_LABEL: Record<RootCauseInfo['category'], string> = {
  logic_error: '逻辑错误',
  missing_dependency: '缺少依赖',
  env_issue: '环境问题',
  input_format: '输入格式错误',
  model_capability: '模型能力限制',
};

const CATEGORY_COLOR: Record<RootCauseInfo['category'], string> = {
  logic_error: color.danger,
  missing_dependency: color.warning,
  env_issue: color.contrast,
  input_format: 'var(--aux, #8b9cf5)',
  model_capability: 'var(--aux, #8b9cf5)',
};

export function RootCausePanel({
  nodeLabel,
  attempts,
  error,
  analysis,
  onRetry,
  onSkip,
  style,
}: RootCausePanelProps) {
  return (
    <div
      style={{
        border: '1px solid rgba(248,113,113,0.4)',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        background: 'rgba(248,113,113,0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: '75%',
        alignSelf: 'flex-start',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: color.complementHover }}>✗ 失败：{nodeLabel}</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted, #7b8a9e)' }}>
          {attempts} 次尝试
        </span>
      </div>

      <div
        style={{ fontSize: 12, color: color.complementHover, fontFamily: 'monospace', wordBreak: 'break-all' }}
      >
        {error}
      </div>

      {analysis && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: '1px solid rgba(248,113,113,0.2)',
            paddingTop: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: `${CATEGORY_COLOR[analysis.category]}22`,
                color: CATEGORY_COLOR[analysis.category],
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {CATEGORY_LABEL[analysis.category]}
            </span>
            {analysis.requiresHuman && (
              <span style={{ fontSize: 10, color: color.contrast }}>⚠ 需要人工审查</span>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--fg-muted, #7b8a9e)' }}>
            {analysis.whyRetryFailed}
          </div>

          <div style={{ fontSize: 12, color: 'var(--fg-strong, #f1f4f8)', fontStyle: 'italic' }}>
            建议：{analysis.fixSuggestion}
          </div>

          {analysis.autoFixApplied && (
            <div style={{ fontSize: 11, color: color.success }}>
              已自动修复：{analysis.autoFixApplied}
            </div>
          )}
        </div>
      )}

      {(onRetry ?? onSkip) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                fontSize: 12,
                padding: '0.3rem 0.75rem',
                background: 'var(--accent, #5cd4c0)',
                color: color.fgOnAccent,
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          )}
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              style={{
                fontSize: 12,
                padding: '0.3rem 0.75rem',
                background: 'transparent',
                color: 'var(--fg-muted, #7b8a9e)',
                border: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              跳过
            </button>
          )}
        </div>
      )}
    </div>
  );
}
