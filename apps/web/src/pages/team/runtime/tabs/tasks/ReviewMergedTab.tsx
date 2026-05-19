/**
 * 260517-team-page-v2 · 评审合并视图
 *
 * 把原本两个独立子 tab（评审报告 + 评审待办）合并到一个子 tab 内，
 * 用 segmented control 切换：
 *   - 报告：从当前 session 的 PM2 完成 handoff 的 result_json 中
 *     提取 review_report.md 与 verdict（双重 review 结果）
 *   - 待办：评审卡片队列（自取数据，包含批注 / 通过 / 退回操作）
 *
 * 合并理由：两者都属于「评审」语义，用户会在两个视图之间频繁切换；
 * 之前各占一个子 tab 槽位，导致「任务」主 tab 子 tab 数量虚高。
 *
 * Phase D 接入说明：
 *   - PM2 完成双重 review 后会把 review_report.md 写回 handoff_records.result_json
 *   - 前端通过 GET /team/sessions/:sessionId/handoffs 拉取所有 handoff
 *   - 找到 from_role_layer === 'pm2' 且 state === 'completed' 的最新一条
 *   - 解析其 payload / result_json 获取 reviewReport / overallVerdict / sub-checks
 */

import { useMemo, useState, type CSSProperties } from 'react';
import type { HandoffRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { ReviewReportView } from './ReviewReportView.js';
import { ReviewTab } from './ReviewTab.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { useReviewDisposition } from '../../hooks/use-review-disposition.js';
import { FailureFlowIndicator } from '../../shell/controls/FailureFlowIndicator.js';

type ReviewSegment = 'report' | 'queue';

interface ReviewReportPayload {
  review_report?: {
    markdown?: string;
    overallVerdict?: 'pass' | 'implementation-failure' | 'planning-failure';
    specReviewPassed?: boolean;
    qualityReviewPassed?: boolean;
  };
}

const SEGMENT_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 32%, transparent)',
  flexShrink: 0,
  background: 'var(--bg)',
};

const SEGMENT_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  border: '1px solid color-mix(in srgb, var(--border) 40%, transparent)',
  background: 'transparent',
  color: 'var(--text-3)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const SEGMENT_BTN_ACTIVE_STYLE: CSSProperties = {
  ...SEGMENT_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 50%, transparent)',
  color: 'var(--text)',
};

export interface ReviewMergedTabProps {
  selectedTeam: AgentTeamsSidebarTeam | null;
  /** 当前选中的 team session id；为空时显示空态。 */
  selectedTeamId: string;
}

function isPayloadObject(value: unknown): value is ReviewReportPayload {
  return typeof value === 'object' && value !== null;
}

function extractLatestReviewReport(records: HandoffRecord[]): {
  markdown: string | null;
  overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
  specReviewPassed: boolean | null;
  qualityReviewPassed: boolean | null;
} {
  const candidates = records
    .filter((record) => record.fromRoleLayer === 'pm2' && record.state === 'completed')
    .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));

  for (const record of candidates) {
    if (!isPayloadObject(record.payload)) continue;
    const reviewReport = record.payload.review_report;
    if (!reviewReport) continue;
    return {
      markdown: reviewReport.markdown ?? null,
      overallVerdict: reviewReport.overallVerdict ?? null,
      specReviewPassed: reviewReport.specReviewPassed ?? null,
      qualityReviewPassed: reviewReport.qualityReviewPassed ?? null,
    };
  }
  return {
    markdown: null,
    overallVerdict: null,
    specReviewPassed: null,
    qualityReviewPassed: null,
  };
}

export function ReviewMergedTab({ selectedTeam, selectedTeamId }: ReviewMergedTabProps) {
  const [segment, setSegment] = useState<ReviewSegment>('report');
  const { handoffs, loading, error } = useSessionHandoffs(selectedTeamId || null);
  const disposition = useReviewDisposition(selectedTeamId || null);

  const review = useMemo(() => extractLatestReviewReport(handoffs), [handoffs]);

  // 派生：尝试从 handoffs 中找出 PM2 的来源 session id 用作 inbound target
  const pm2SourceSessionId = useMemo(() => {
    const pm2Records = handoffs
      .filter((record) => record.fromRoleLayer === 'pm2')
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return pm2Records[0]?.fromSessionId ?? null;
  }, [handoffs]);

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={SEGMENT_BAR_STYLE} role="tablist" aria-label="评审视图切换">
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'report'}
          onClick={() => setSegment('report')}
          style={segment === 'report' ? SEGMENT_BTN_ACTIVE_STYLE : SEGMENT_BTN_STYLE}
        >
          <span aria-hidden>✅</span>
          <span>评审报告</span>
          {review.markdown ? (
            <span
              aria-hidden
              style={{
                marginLeft: 4,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background:
                  review.overallVerdict === 'pass'
                    ? 'var(--success, var(--success, var(--success, #3dd49a)))'
                    : review.overallVerdict === 'implementation-failure'
                      ? 'var(--danger, #d4574e)'
                      : 'var(--warning, var(--warning, #f0b429))',
              }}
            />
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'queue'}
          onClick={() => setSegment('queue')}
          style={segment === 'queue' ? SEGMENT_BTN_ACTIVE_STYLE : SEGMENT_BTN_STYLE}
        >
          <span aria-hidden>🗂️</span>
          <span>评审待办</span>
        </button>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {disposition.action ? (
          <FailureFlowIndicator
            action={disposition.action}
            reason={disposition.reason}
            escalationRound={disposition.escalationRound}
            pm2HandoffId={disposition.pm2HandoffId}
            pm2SourceSessionId={pm2SourceSessionId}
          />
        ) : null}
        {segment === 'report' ? (
          <ReportSegment
            loading={loading && !review.markdown}
            error={error}
            reportMarkdown={review.markdown}
            overallVerdict={review.overallVerdict}
            specReviewPassed={review.specReviewPassed}
            qualityReviewPassed={review.qualityReviewPassed}
            hasSession={Boolean(selectedTeamId)}
          />
        ) : (
          <ReviewTab selectedTeam={selectedTeam} />
        )}
      </div>
    </div>
  );
}

function ReportSegment({
  loading,
  error,
  reportMarkdown,
  overallVerdict,
  specReviewPassed,
  qualityReviewPassed,
  hasSession,
}: {
  loading: boolean;
  error: string | null;
  reportMarkdown: string | null;
  overallVerdict: 'pass' | 'implementation-failure' | 'planning-failure' | null;
  specReviewPassed: boolean | null;
  qualityReviewPassed: boolean | null;
  hasSession: boolean;
}) {
  if (!hasSession) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
        左侧选中一个团队会话后，PM2 完成双重 review 时会把报告写在这里。
      </div>
    );
  }
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-3)' }}>正在加载评审报告…</div>;
  }
  if (error) {
    return (
      <div style={{ fontSize: 12, color: 'var(--danger, #d4574e)' }}>评审报告拉取失败：{error}</div>
    );
  }
  return (
    <ReviewReportView
      reportMarkdown={reportMarkdown}
      overallVerdict={overallVerdict}
      specReviewPassed={specReviewPassed}
      qualityReviewPassed={qualityReviewPassed}
    />
  );
}
