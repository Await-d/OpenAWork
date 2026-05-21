/**
 * 260516-team-phase-d · T-10
 *
 * review_report 展示：底部抽屉 d 层 Tab 中渲染 review 结果。
 */

import { type CSSProperties } from 'react';
import { ArtifactPreview } from './ArtifactPreview.js';

const VERDICT_STYLES: Record<string, CSSProperties> = {
  pass: {
    color: 'var(--success)',
    border: '1px solid color-mix(in srgb, var(--success) 40%, transparent)',
    background: 'color-mix(in srgb, var(--success) 8%, var(--bg-overlay)',
  },
  'implementation-failure': {
    color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
    background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay)',
  },
  'planning-failure': {
    color: 'var(--warning)',
    border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)',
    background: 'color-mix(in srgb, var(--warning) 8%, var(--bg-overlay)',
  },
};

export interface ReviewReportViewProps {
  reportMarkdown: string | null;
  overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
  specReviewPassed: boolean | null;
  qualityReviewPassed: boolean | null;
}

export function ReviewReportView({
  reportMarkdown,
  overallVerdict,
  specReviewPassed,
  qualityReviewPassed,
}: ReviewReportViewProps) {
  if (!reportMarkdown) {
    return (
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: 12 }}>
        等待 PM2 完成双重 review…所有 executor/reviewer 任务完成后会自动触发。
      </div>
    );
  }

  const verdictStyle = overallVerdict ? (VERDICT_STYLES[overallVerdict] ?? {}) : {};
  const verdictLabel =
    overallVerdict === 'pass'
      ? '✅ 通过'
      : overallVerdict === 'implementation-failure'
        ? '❌ 实现型失败'
        : '❌ 规划型失败';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 8,
          ...verdictStyle,
        }}
      >
        <strong style={{ fontSize: 13 }}>{verdictLabel}</strong>
        <span style={{ fontSize: 11 }}>
          Spec: {specReviewPassed ? '✅' : '❌'} · Quality: {qualityReviewPassed ? '✅' : '❌'}
        </span>
      </div>

      <ArtifactPreview title="Review Report" content={reportMarkdown} phase="review" />
    </div>
  );
}
