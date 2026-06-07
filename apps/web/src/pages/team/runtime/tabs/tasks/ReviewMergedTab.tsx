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
 *   - 找到 to_role_layer === 'pm2' 且 state === 'completed' 的最新一条
 *   - 解析其 payload / result_json 获取 reviewReport / overallVerdict / sub-checks
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { getEffectiveReviewDisposition, type HandoffRecord } from '@openAwork/web-client';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import { useLayerStore } from '../../../../../stores/team/team-events.js';
import { ReviewReportView } from './ReviewReportView.js';
import { ReviewTab } from './ReviewTab.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { useReviewDisposition } from '../../hooks/use-review-disposition.js';
import { FailureFlowIndicator } from '../../shell/controls/FailureFlowIndicator.js';
import { extractReviewReport, resolveTeamArtifactContext } from './team-artifact-context.js';
import { useTeamArtifactData } from './use-team-artifact-data.js';

type ReviewSegment = 'report' | 'queue';

const SEGMENT_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 32%, transparent)',
  flexShrink: 0,
  background: 'var(--bg-base)',
};

const SEGMENT_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 12px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 40%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
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
  color: 'var(--fg-strong)',
};

export interface ReviewMergedTabProps {
  focusHandoffId?: string | null;
  onClearFocus?: () => void;
  selectedTeam: AgentTeamsSidebarTeam | null;
  /** 当前选中的 team session id；为空时显示空态。 */
  selectedTeamId: string;
}

const FOCUS_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
};

const FOCUS_ACTIONS_ROW_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const FOCUS_CLEAR_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  justifySelf: 'start',
};

const FOCUS_PRIMARY_BTN_STYLE: CSSProperties = {
  ...FOCUS_CLEAR_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--accent)',
};

function mergeHandoffRecords(groups: HandoffRecord[][]): HandoffRecord[] {
  const records = new Map<string, HandoffRecord>();
  for (const group of groups) {
    for (const record of group) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values());
}

export function ReviewMergedTab({
  focusHandoffId = null,
  onClearFocus,
  selectedTeam,
  selectedTeamId,
}: ReviewMergedTabProps) {
  const [segment, setSegment] = useState<ReviewSegment>('report');
  const [retryBusyHandoffId, setRetryBusyHandoffId] = useState<string | null>(null);
  const nodes = useLayerStore((state) => state.nodes);
  const { runRuntimeAlertRemediation } = useTeamRuntimeReferenceViewData();
  const selectedSessionRoleLayer = selectedTeamId
    ? (nodes.get(selectedTeamId)?.roleLayer ?? null)
    : null;
  const selectedSessionHandoffs = useSessionHandoffs(selectedTeamId || null);

  const initialContext = useMemo(
    () =>
      resolveTeamArtifactContext({
        focusHandoffId,
        handoffs: selectedSessionHandoffs.handoffs,
        selectedSessionId: selectedTeamId || null,
        selectedSessionRoleLayer,
      }),
    [focusHandoffId, selectedSessionHandoffs.handoffs, selectedSessionRoleLayer, selectedTeamId],
  );

  const pm1DetailSessionId =
    initialContext.pm1ArtifactSessionId && initialContext.pm1ArtifactSessionId !== selectedTeamId
      ? initialContext.pm1ArtifactSessionId
      : null;
  const pm1SessionHandoffs = useSessionHandoffs(pm1DetailSessionId);

  const upstreamCombinedHandoffs = useMemo(
    () => mergeHandoffRecords([selectedSessionHandoffs.handoffs, pm1SessionHandoffs.handoffs]),
    [pm1SessionHandoffs.handoffs, selectedSessionHandoffs.handoffs],
  );

  const intermediateContext = useMemo(
    () =>
      resolveTeamArtifactContext({
        focusHandoffId,
        handoffs: upstreamCombinedHandoffs,
        selectedSessionId: selectedTeamId || null,
        selectedSessionRoleLayer,
      }),
    [focusHandoffId, selectedSessionRoleLayer, selectedTeamId, upstreamCombinedHandoffs],
  );

  const pm2DetailSessionId =
    intermediateContext.pm2ArtifactSessionId &&
    intermediateContext.pm2ArtifactSessionId !== selectedTeamId &&
    intermediateContext.pm2ArtifactSessionId !== pm1DetailSessionId
      ? intermediateContext.pm2ArtifactSessionId
      : null;
  const pm2SessionHandoffs = useSessionHandoffs(pm2DetailSessionId);

  const combinedHandoffs = useMemo(
    () =>
      mergeHandoffRecords([
        selectedSessionHandoffs.handoffs,
        pm1SessionHandoffs.handoffs,
        pm2SessionHandoffs.handoffs,
      ]),
    [pm1SessionHandoffs.handoffs, pm2SessionHandoffs.handoffs, selectedSessionHandoffs.handoffs],
  );

  const artifactContext = useMemo(
    () =>
      resolveTeamArtifactContext({
        focusHandoffId,
        handoffs: combinedHandoffs,
        selectedSessionId: selectedTeamId || null,
        selectedSessionRoleLayer,
      }),
    [combinedHandoffs, focusHandoffId, selectedSessionRoleLayer, selectedTeamId],
  );

  const reviewSessionId = artifactContext.pm2ArtifactSessionId ?? selectedTeamId;
  const review = useMemo(
    () => extractReviewReport(combinedHandoffs, focusHandoffId),
    [combinedHandoffs, focusHandoffId],
  );
  const { artifactError, artifactLoading, refreshArtifacts, reviewArtifact } = useTeamArtifactData({
    pm1ArtifactSessionId: null,
    pm2ArtifactSessionId: artifactContext.pm2ArtifactSessionId,
    preferredReviewArtifactId: review.reviewArtifactId,
  });
  const disposition = useReviewDisposition(reviewSessionId, focusHandoffId);
  const reviewMarkdown = review.markdown ?? reviewArtifact?.content ?? null;
  const loading =
    selectedSessionHandoffs.loading ||
    pm1SessionHandoffs.loading ||
    pm2SessionHandoffs.loading ||
    (artifactContext.pm2ArtifactSessionId ? artifactLoading : false);
  const error =
    reviewMarkdown == null
      ? (selectedSessionHandoffs.error ??
        pm1SessionHandoffs.error ??
        pm2SessionHandoffs.error ??
        artifactError)
      : null;
  const focusedHandoff = useMemo(
    () =>
      focusHandoffId
        ? (combinedHandoffs.find((record) => record.id === focusHandoffId) ?? null)
        : null,
    [combinedHandoffs, focusHandoffId],
  );
  const focusedDisposition = useMemo(
    () => (focusedHandoff ? getEffectiveReviewDisposition(focusedHandoff) : null),
    [focusedHandoff],
  );
  const focusedDispositionOwnedByCurrent = Boolean(
    focusedHandoff &&
    focusedDisposition &&
    disposition.pm2HandoffId &&
    focusedHandoff.id === disposition.pm2HandoffId,
  );
  const retryFocusedHandoff = async (handoffId: string) => {
    setRetryBusyHandoffId(handoffId);
    try {
      await runRuntimeAlertRemediation('handoff-failure', {
        handoffId,
        ...(reviewSessionId ? { sessionId: reviewSessionId } : {}),
      });
    } finally {
      setRetryBusyHandoffId(null);
    }
  };

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
                    ? 'var(--success)'
                    : review.overallVerdict === 'implementation-failure'
                      ? 'var(--danger)'
                      : 'var(--warning)',
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
        {focusedHandoff ? (
          <div style={FOCUS_CARD_STYLE}>
            <strong style={{ color: 'var(--accent)', fontSize: 13 }}>
              已定位到 Handoff #{focusedHandoff.id.slice(0, 8)}
            </strong>
            <span style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 700 }}>
              {focusedHandoff.fromRoleLayer} → {focusedHandoff.toRoleLayer} · {focusedHandoff.state}
            </span>
            {focusedDisposition?.reason ? (
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                {focusedDisposition.reason}
              </span>
            ) : focusedHandoff.failureReason ? (
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                {focusedHandoff.failureReason}
              </span>
            ) : null}
            <div style={FOCUS_ACTIONS_ROW_STYLE}>
              <button
                type="button"
                onClick={() => setSegment('report')}
                style={segment === 'report' ? FOCUS_PRIMARY_BTN_STYLE : FOCUS_CLEAR_BTN_STYLE}
              >
                查看报告
              </button>
              <button
                type="button"
                onClick={() => setSegment('queue')}
                style={segment === 'queue' ? FOCUS_PRIMARY_BTN_STYLE : FOCUS_CLEAR_BTN_STYLE}
              >
                查看待办
              </button>
              {onClearFocus ? (
                <button type="button" onClick={onClearFocus} style={FOCUS_CLEAR_BTN_STYLE}>
                  清除定位
                </button>
              ) : null}
              {focusedHandoff?.recoverableFailure ? (
                <button
                  type="button"
                  onClick={() => {
                    void retryFocusedHandoff(focusedHandoff.id);
                  }}
                  style={FOCUS_PRIMARY_BTN_STYLE}
                  disabled={retryBusyHandoffId === focusedHandoff.id}
                  aria-label={`重试失败 handoff ${focusedHandoff.id}`}
                >
                  {retryBusyHandoffId === focusedHandoff.id ? '重试中…' : '重试失败 handoff'}
                </button>
              ) : null}
            </div>
            {focusedDispositionOwnedByCurrent ? (
              <FailureFlowIndicator
                action={disposition.action}
                reason={disposition.reason}
                escalationRound={disposition.escalationRound}
                pm2HandoffId={disposition.pm2HandoffId}
                onActionComplete={(result) => {
                  selectedSessionHandoffs.applyPreview(result.handoffs);
                  pm1SessionHandoffs.applyPreview(result.handoffs);
                  pm2SessionHandoffs.applyPreview(result.handoffs);
                  selectedSessionHandoffs.refresh();
                  pm1SessionHandoffs.refresh();
                  pm2SessionHandoffs.refresh();
                  refreshArtifacts();
                }}
              />
            ) : null}
          </div>
        ) : null}
        {disposition.action && !focusedDispositionOwnedByCurrent ? (
          <FailureFlowIndicator
            action={disposition.action}
            reason={disposition.reason}
            escalationRound={disposition.escalationRound}
            pm2HandoffId={disposition.pm2HandoffId}
            onActionComplete={(result) => {
              selectedSessionHandoffs.applyPreview(result.handoffs);
              pm1SessionHandoffs.applyPreview(result.handoffs);
              pm2SessionHandoffs.applyPreview(result.handoffs);
              selectedSessionHandoffs.refresh();
              pm1SessionHandoffs.refresh();
              pm2SessionHandoffs.refresh();
              refreshArtifacts();
            }}
          />
        ) : null}
        {segment === 'report' ? (
          <ReportSegment
            loading={loading && !reviewMarkdown}
            error={error}
            reportMarkdown={reviewMarkdown}
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
      <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        左侧选中一个团队会话后，PM2 完成双重 review 时会把报告写在这里。
      </div>
    );
  }
  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在加载评审报告…</div>;
  }
  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--danger)' }}>评审报告拉取失败：{error}</div>;
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
