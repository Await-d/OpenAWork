import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  HandoffRecord,
  PendingPermissionRequest,
  SessionFileChangesSummary,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
} from '@openAwork/web-client';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  resolveMatchedSharedSessionDetail,
  resolveMatchedSharedSummary,
} from '../../data/team-runtime-shared-context.js';
import {
  findLatestAssistantMessage,
  formatSnapshotScopeKind,
  formatWorkspaceLabel,
  getSharedSessionStateLabel,
} from '../../data/team-runtime-model.js';
import {
  useClarificationStore,
  useLayerStore,
  type HandoffEntry,
} from '../../../../../stores/team/team-events.js';
import { useReviewDisposition } from '../../hooks/use-review-disposition.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { FailureFlowIndicator } from '../../shell/controls/FailureFlowIndicator.js';
import { TabContainer, TabSection } from '../TabContainer.js';
import { EmptyState } from '../../shared/content-kit/EmptyState.js';
import { ArtifactChainWizard } from './ArtifactChainWizard.js';
import { ClarificationsPanel } from './ClarificationsPanel.js';
import { parseConstitutionCheck, readConstitutionWarnings } from './constitution-check.js';
import { DispatchPackageView } from './DispatchPackageView.js';
import { ReviewReportView } from './ReviewReportView.js';
import { SessionTreeView } from './SessionTreeView.js';
import { RunningHandoffCancelList } from './RunningHandoffCancelList.js';
import { useTeamArtifactData } from './use-team-artifact-data.js';
import { ArtifactPreview } from './ArtifactPreview.js';
import {
  extractReviewReport,
  parseDispatchPackage,
  resolveTeamArtifactContext,
} from './team-artifact-context.js';

const CONTEXT_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
};

const CONTEXT_META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const CONTEXT_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--bg-overlay) 84%, var(--bg-base))',
  color: 'var(--fg-default)',
  fontSize: 10,
  fontWeight: 700,
};

const ACTION_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  color: 'var(--fg-default)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
};

const PRIMARY_ACTION_BTN_STYLE: CSSProperties = {
  ...ACTION_BTN_STYLE,
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  color: 'var(--accent)',
};

const ERROR_BANNER_STYLE: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--danger) 32%, transparent)',
  background: 'color-mix(in srgb, var(--danger) 8%, var(--bg-overlay))',
  color: 'var(--danger)',
  fontSize: 12,
};

const SHARED_SUMMARY_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
};

const SHARED_SUMMARY_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 48%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
};

const SHARED_EMPTY_NOTE_STYLE: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px dashed color-mix(in srgb, var(--border-default) 54%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 12,
  lineHeight: 1.6,
};

const SHARED_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const SHARED_LIST_ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gap: 5,
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 72%, var(--bg-base))',
};

const SHARED_SOURCE_BADGES_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const SHARED_SOURCE_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg-default)',
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

type WizardStep = 'spec_draft' | 'clarifying' | 'plan_ready' | 'tasks_ready';

interface TeamArtifactSectionProps {
  focusHandoffId?: string | null;
  onClearFocus?: () => void;
  selectedTeamId: string;
  /** 全量 handoff（用于运行中任务取消列表）。 */
  handoffs?: Map<string, HandoffEntry>;
  onCancelHandoff?: (handoffId: string) => void;
}

function buildWizardStep(input: {
  hasPlan: boolean;
  hasSpec: boolean;
  hasTasks: boolean;
  pendingClarificationCount: number;
}): WizardStep {
  if (input.hasTasks) {
    return 'tasks_ready';
  }
  if (input.hasPlan) {
    return 'plan_ready';
  }
  if (input.hasSpec && input.pendingClarificationCount > 0) {
    return 'clarifying';
  }
  return 'spec_draft';
}

function mergeHandoffRecords(groups: HandoffRecord[][]): HandoffRecord[] {
  const records = new Map<string, HandoffRecord>();
  for (const group of groups) {
    for (const record of group) {
      records.set(record.id, record);
    }
  }
  return Array.from(records.values());
}

function formatShortTimestamp(value: string | undefined): string {
  if (!value) {
    return '未记录';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPermissionRiskLabel(riskLevel: PendingPermissionRequest['riskLevel']): string {
  if (riskLevel === 'high') {
    return '高风险';
  }
  if (riskLevel === 'medium') {
    return '中风险';
  }
  return '低风险';
}

function SharedSessionArtifactView({
  selectedTeamId,
  sharedSession,
  sharedSessionLoading,
  sharedSummary,
}: {
  selectedTeamId: string;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  sharedSummary: SharedSessionSummaryRecord | null;
}) {
  const effectiveSummary = sharedSession?.share ?? sharedSummary;
  const latestAssistantOutput = findLatestAssistantMessage(sharedSession);
  const fileChangesSummary = sharedSession?.session.fileChangesSummary;
  const pendingPermissions = sharedSession?.pendingPermissions ?? [];
  const pendingQuestions = sharedSession?.pendingQuestions ?? [];
  const sessionTitle =
    effectiveSummary?.title?.trim() || effectiveSummary?.sessionId || selectedTeamId;

  return (
    <TabContainer
      title="任务与产物"
      subtitle="共享会话没有本地 PM1 / PM2 handoff 树，这里直接展示共享输出、协作待处理项和变更快照。"
      scroll={false}
    >
      <div data-testid="shared-artifact-view" style={{ display: 'grid', gap: 12 }}>
        <TabSection title="共享上下文" hint="当前选中的是共享会话。">
          <div style={SHARED_SUMMARY_GRID_STYLE}>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>共享会话</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>{sessionTitle}</strong>
            </div>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>状态</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {effectiveSummary
                  ? getSharedSessionStateLabel(effectiveSummary.stateStatus)
                  : '待同步'}
              </strong>
            </div>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>共享者</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {effectiveSummary?.sharedByEmail ?? '待同步'}
              </strong>
            </div>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>权限</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {effectiveSummary?.permission === 'operate'
                  ? '可操作'
                  : effectiveSummary?.permission === 'comment'
                    ? '评论'
                    : effectiveSummary?.permission === 'view'
                      ? '只读'
                      : '待同步'}
              </strong>
            </div>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>工作区</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                {formatWorkspaceLabel(effectiveSummary?.workspacePath)}
              </strong>
            </div>
            <div style={SHARED_SUMMARY_CARD_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>协作态</span>
              <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                评论 {sharedSession?.comments.length ?? 0} · 在线{' '}
                {sharedSession?.presence.length ?? 0}
              </strong>
            </div>
          </div>
        </TabSection>

        <TabSection
          title="最新助手输出"
          hint={
            sharedSession
              ? `消息 ${sharedSession.session.messages?.length ?? 0} 条`
              : '等待共享详情同步'
          }
        >
          {sharedSessionLoading ? (
            <div style={SHARED_EMPTY_NOTE_STYLE}>正在同步共享会话详情…</div>
          ) : latestAssistantOutput ? (
            <div data-testid="shared-artifact-output">
              <ArtifactPreview
                title="共享输出摘要"
                content={latestAssistantOutput}
                phase="shared"
              />
            </div>
          ) : (
            <div style={SHARED_EMPTY_NOTE_STYLE}>
              {sharedSession
                ? '当前共享会话还没有可展示的助手文本输出。'
                : '共享摘要已加载，但详细消息尚未同步到本地。'}
            </div>
          )}
        </TabSection>

        <TabSection title="协作待处理项" hint="这些请求会同步出现在评审和共享治理视图。">
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}
          >
            <section style={SHARED_LIST_STYLE}>
              <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                待审批权限 {pendingPermissions.length}
              </strong>
              {pendingPermissions.length > 0 ? (
                pendingPermissions.map((request) => (
                  <div key={request.requestId} style={SHARED_LIST_ITEM_STYLE}>
                    <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                      {request.previewAction ?? request.toolName}
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                      {request.scope} · {formatPermissionRiskLabel(request.riskLevel)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}>
                      {request.reason}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                      创建于 {formatShortTimestamp(request.createdAt)}
                    </span>
                  </div>
                ))
              ) : (
                <div style={SHARED_EMPTY_NOTE_STYLE}>当前没有待处理的权限申请。</div>
              )}
            </section>

            <section style={SHARED_LIST_STYLE}>
              <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                待回答问题 {pendingQuestions.length}
              </strong>
              {pendingQuestions.length > 0 ? (
                pendingQuestions.map((request) => (
                  <div key={request.requestId} style={SHARED_LIST_ITEM_STYLE}>
                    <strong style={{ fontSize: 12, color: 'var(--fg-strong)' }}>
                      {request.title}
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--fg-default)' }}>
                      {request.toolName} · {request.questions.length} 个问题
                    </span>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {request.questions.map((question, index) => (
                        <span
                          key={`${request.requestId}-${index}`}
                          style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.6 }}
                        >
                          {question.header}：{question.question}
                        </span>
                      ))}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                      创建于 {formatShortTimestamp(request.createdAt)}
                    </span>
                  </div>
                ))
              ) : (
                <div style={SHARED_EMPTY_NOTE_STYLE}>当前没有待回答的问题请求。</div>
              )}
            </section>
          </div>
        </TabSection>

        <TabSection title="变更快照" hint="基于共享会话同步过来的文件变更摘要。">
          {fileChangesSummary ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={SHARED_SUMMARY_GRID_STYLE}>
                {buildSharedChangeMetricCards(fileChangesSummary).map((item) => (
                  <div key={item.label} style={SHARED_SUMMARY_CARD_STYLE}>
                    <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{item.label}</span>
                    <strong style={{ fontSize: 14, color: 'var(--fg-strong)' }}>
                      {item.value}
                    </strong>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
                      {item.hint}
                    </span>
                  </div>
                ))}
              </div>
              {fileChangesSummary.sourceKinds.length > 0 ? (
                <div style={SHARED_SOURCE_BADGES_STYLE}>
                  {fileChangesSummary.sourceKinds.map((sourceKind) => (
                    <span key={sourceKind} style={SHARED_SOURCE_BADGE_STYLE}>
                      {sourceKind}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={SHARED_EMPTY_NOTE_STYLE}>当前共享会话还没有同步到文件变更快照。</div>
          )}
        </TabSection>
      </div>
    </TabContainer>
  );
}

function buildSharedChangeMetricCards(fileChangesSummary: SessionFileChangesSummary) {
  return [
    {
      label: '变更文件',
      value: fileChangesSummary.totalFileDiffs,
      hint: '本次共享运行累计同步的文件 diff 数量',
    },
    {
      label: '快照数',
      value: fileChangesSummary.snapshotCount,
      hint: '当前共享运行已经保存的快照数量',
    },
    {
      label: '最近快照',
      value: formatShortTimestamp(fileChangesSummary.latestSnapshotAt),
      hint: formatSnapshotScopeKind(fileChangesSummary.latestSnapshotScopeKind),
    },
  ];
}

export function TeamArtifactSection({
  focusHandoffId = null,
  onClearFocus,
  selectedTeamId,
  handoffs,
  onCancelHandoff,
}: TeamArtifactSectionProps) {
  const nodes = useLayerStore((state) => state.nodes);
  const clarificationItems = useClarificationStore((state) => state.items);
  const {
    activeSharedSession,
    runRuntimeAlertRemediation,
    selectedSharedSession,
    sharedSessionLoading,
    sharedSessions,
    workspaceGroups = [],
  } = useTeamRuntimeReferenceViewData();
  const selectedTeamRecord = useMemo(
    () =>
      workspaceGroups
        .flatMap((group) => group.sessions)
        .find((session) => session.id === selectedTeamId) ?? null,
    [selectedTeamId, workspaceGroups],
  );
  const isSharedSessionSelected = useMemo(
    () =>
      selectedTeamRecord?.isSharedSession === true ||
      sharedSessions.some((session) => session.sessionId === selectedTeamId),
    [selectedTeamRecord, selectedTeamId, sharedSessions],
  );
  const selectedSharedSummary = useMemo(
    () =>
      resolveMatchedSharedSummary({
        selectedTeamId,
        activeSharedSession,
        selectedSharedSession,
        sharedSessions,
      }),
    [activeSharedSession, selectedSharedSession, selectedTeamId, sharedSessions],
  );
  const matchedSharedSession = useMemo(
    () =>
      resolveMatchedSharedSessionDetail({
        selectedTeamId,
        activeSharedSession,
        selectedSharedSession,
      }),
    [activeSharedSession, selectedSharedSession, selectedTeamId],
  );
  const selectedSessionRoleLayer = selectedTeamId
    ? isSharedSessionSelected
      ? null
      : (nodes.get(selectedTeamId)?.roleLayer ?? null)
    : null;
  const selectedSessionHandoffs = useSessionHandoffs(
    isSharedSessionSelected ? null : selectedTeamId || null,
  );

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

  const [wizardStep, setWizardStep] = useState<WizardStep>('spec_draft');
  const reviewReportFromHandoffs = useMemo(
    () => extractReviewReport(combinedHandoffs, focusHandoffId),
    [combinedHandoffs, focusHandoffId],
  );
  const {
    artifactError,
    artifactLoading,
    planArtifact,
    refreshArtifacts,
    reviewArtifact,
    specArtifact,
    tasksArtifact,
  } = useTeamArtifactData({
    pm1ArtifactSessionId: isSharedSessionSelected ? null : artifactContext.pm1ArtifactSessionId,
    pm2ArtifactSessionId: isSharedSessionSelected ? null : artifactContext.pm2ArtifactSessionId,
    preferredReviewArtifactId: reviewReportFromHandoffs.reviewArtifactId,
  });

  useEffect(() => {
    const nextStep = buildWizardStep({
      hasPlan: Boolean(planArtifact?.content),
      hasSpec: Boolean(specArtifact?.content),
      hasTasks: Boolean(tasksArtifact?.content),
      pendingClarificationCount: clarificationItems.filter(
        (item) =>
          item.status === 'pending' && item.sessionId === artifactContext.pm1ArtifactSessionId,
      ).length,
    });
    setWizardStep(nextStep);
  }, [
    artifactContext.pm1ArtifactSessionId,
    clarificationItems,
    planArtifact?.content,
    specArtifact?.content,
    tasksArtifact?.content,
  ]);

  const runtimeLoading =
    selectedSessionHandoffs.loading || pm1SessionHandoffs.loading || pm2SessionHandoffs.loading;
  const runtimeError =
    selectedSessionHandoffs.error ?? pm1SessionHandoffs.error ?? pm2SessionHandoffs.error;
  const disposition = useReviewDisposition(
    isSharedSessionSelected ? null : reviewSessionId,
    focusHandoffId,
  );
  const [retryBusyHandoffId, setRetryBusyHandoffId] = useState<string | null>(null);

  const pendingClarifications = useMemo(
    () =>
      clarificationItems
        .filter(
          (item) =>
            item.status === 'pending' && item.sessionId === artifactContext.pm1ArtifactSessionId,
        )
        .map((item) => ({
          id: item.id,
          question: item.question,
        })),
    [artifactContext.pm1ArtifactSessionId, clarificationItems],
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
  const constitutionWarnings = useMemo(() => {
    const pm1ResultWarnings = combinedHandoffs
      .filter((record) => record.toRoleLayer === 'pm1')
      .sort((left, right) =>
        (right.completedAt ?? right.updatedAt).localeCompare(left.completedAt ?? left.updatedAt),
      )
      .flatMap((record) => readConstitutionWarnings(record.resultJson))
      .filter((warning) => warning.status !== 'pass');

    if (pm1ResultWarnings.length > 0) {
      return pm1ResultWarnings;
    }

    return planArtifact?.content
      ? parseConstitutionCheck(planArtifact.content).filter((warning) => warning.status !== 'pass')
      : [];
  }, [combinedHandoffs, planArtifact?.content]);

  const dispatchPackages = useMemo(() => {
    if (!artifactContext.pm2ArtifactSessionId) {
      return [];
    }
    return combinedHandoffs
      .filter(
        (record) =>
          record.fromSessionId === artifactContext.pm2ArtifactSessionId &&
          (record.toRoleLayer === 'executor' ||
            record.toRoleLayer === 'tester' ||
            record.toRoleLayer === 'reviewer'),
      )
      .sort((left, right) => {
        if (left.id === focusHandoffId) {
          return -1;
        }
        if (right.id === focusHandoffId) {
          return 1;
        }
        return (right.completedAt ?? right.updatedAt).localeCompare(
          left.completedAt ?? left.updatedAt,
        );
      })
      .map((record) => {
        const dispatch = parseDispatchPackage(record);
        if (!dispatch) {
          return null;
        }
        return {
          handoff: record,
          dispatch,
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          handoff: HandoffRecord;
          dispatch: NonNullable<ReturnType<typeof parseDispatchPackage>>;
        } => entry !== null,
      );
  }, [artifactContext.pm2ArtifactSessionId, combinedHandoffs, focusHandoffId]);

  const reviewReport = useMemo(
    () =>
      reviewReportFromHandoffs.markdown
        ? reviewReportFromHandoffs
        : {
            markdown: reviewArtifact?.content ?? null,
            overallVerdict: reviewReportFromHandoffs.overallVerdict,
            specReviewPassed: reviewReportFromHandoffs.specReviewPassed,
            qualityReviewPassed: reviewReportFromHandoffs.qualityReviewPassed,
          },
    [reviewArtifact?.content, reviewReportFromHandoffs],
  );

  const hasAnyContent =
    Boolean(specArtifact?.content) ||
    Boolean(planArtifact?.content) ||
    Boolean(tasksArtifact?.content) ||
    dispatchPackages.length > 0 ||
    Boolean(reviewReport.markdown) ||
    pendingClarifications.length > 0 ||
    nodes.size > 0;

  if (!selectedTeamId) {
    return (
      <TabContainer
        title="任务与产物"
        subtitle="按当前会话和 handoff 上下文查看任务、派发与 PM1 / PM2 的产物。"
        scroll={false}
      >
        <EmptyState
          emoji="🧱"
          title="先选择一个团队会话"
          description="左侧选中会话后，这里会自动拼接 spec / plan / tasks / review 和 dispatch 上下文。"
          action={
            <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
              选中会话后可继续查看待澄清、派发包和评审报告。
            </span>
          }
        />
      </TabContainer>
    );
  }

  if (isSharedSessionSelected) {
    return (
      <SharedSessionArtifactView
        selectedTeamId={selectedTeamId}
        sharedSession={matchedSharedSession}
        sharedSessionLoading={sharedSessionLoading}
        sharedSummary={selectedSharedSummary}
      />
    );
  }

  return (
    <TabContainer
      title="任务与产物"
      subtitle="会话树 / 待澄清 / 任务派发 / 产物链一体化：优先绑定当前会话与聚焦 handoff。"
      scroll={false}
      actions={
        <button
          type="button"
          onClick={() => {
            selectedSessionHandoffs.refresh();
            pm1SessionHandoffs.refresh();
            pm2SessionHandoffs.refresh();
            refreshArtifacts();
          }}
          style={ACTION_BTN_STYLE}
        >
          {runtimeLoading || artifactLoading ? '加载中…' : '刷新'}
        </button>
      }
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {focusHandoffId && artifactContext.focusHandoff ? (
          <section style={CONTEXT_CARD_STYLE}>
            <strong style={{ color: 'var(--accent)', fontSize: 13 }}>
              已定位到 Handoff #{focusHandoffId.slice(0, 8)}
            </strong>
            <span style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 700 }}>
              {artifactContext.focusHandoff.fromRoleLayer} →{' '}
              {artifactContext.focusHandoff.toRoleLayer} · {artifactContext.focusHandoff.state}
            </span>
            <div style={CONTEXT_META_ROW_STYLE}>
              {artifactContext.pm1ArtifactSessionId ? (
                <span style={CONTEXT_BADGE_STYLE}>
                  PM1 会话 #{artifactContext.pm1ArtifactSessionId.slice(0, 8)}
                </span>
              ) : null}
              {artifactContext.pm2ArtifactSessionId ? (
                <span style={CONTEXT_BADGE_STYLE}>
                  PM2 会话 #{artifactContext.pm2ArtifactSessionId.slice(0, 8)}
                </span>
              ) : null}
              {artifactContext.pm2Handoff ? (
                <span style={CONTEXT_BADGE_STYLE}>
                  PM2 Handoff #{artifactContext.pm2Handoff.id.slice(0, 8)}
                </span>
              ) : null}
            </div>
            {artifactContext.focusHandoff.failureReason ? (
              <span style={{ color: 'var(--fg-muted)', fontSize: 11, lineHeight: 1.5 }}>
                {artifactContext.focusHandoff.failureReason}
              </span>
            ) : null}
            {onClearFocus || artifactContext.focusHandoff.recoverableFailure ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {onClearFocus ? (
                  <button type="button" onClick={onClearFocus} style={ACTION_BTN_STYLE}>
                    清除定位
                  </button>
                ) : null}
                {artifactContext.focusHandoff.recoverableFailure ? (
                  <button
                    type="button"
                    onClick={() => {
                      void retryFocusedHandoff(artifactContext.focusHandoff!.id);
                    }}
                    style={PRIMARY_ACTION_BTN_STYLE}
                    disabled={retryBusyHandoffId === artifactContext.focusHandoff.id}
                    aria-label={`重试失败 handoff ${artifactContext.focusHandoff.id}`}
                  >
                    {retryBusyHandoffId === artifactContext.focusHandoff.id
                      ? '重试中…'
                      : '重试失败 handoff'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {runtimeError ? (
          <div style={ERROR_BANNER_STYLE}>handoff 上下文加载失败：{runtimeError}</div>
        ) : null}
        {artifactError ? <div style={ERROR_BANNER_STYLE}>{artifactError}</div> : null}

        {disposition.action ? (
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

        {nodes.size > 0 ? (
          <TabSection title="会话树" hint="帮助确认当前产物链所处的层级上下文。">
            <SessionTreeView />
          </TabSection>
        ) : null}

        {selectedTeamId ? (
          <TabSection title="待澄清" hint="PM1 解析 spec 时产生的澄清问题。">
            <ClarificationsPanel
              filterSessionId={artifactContext.pm1ArtifactSessionId ?? selectedTeamId}
            />
          </TabSection>
        ) : null}

        {handoffs && onCancelHandoff ? (
          <RunningHandoffCancelList
            focusHandoffId={focusHandoffId}
            handoffs={handoffs}
            onCancel={onCancelHandoff}
            {...(onClearFocus ? { onClearFocus } : {})}
          />
        ) : null}

        {hasAnyContent ? (
          <>
            <TabSection
              title="PM1 规划链"
              hint={
                artifactContext.pm1ArtifactSessionId
                  ? `会话 #${artifactContext.pm1ArtifactSessionId.slice(0, 8)}`
                  : '等待 PM1 会话建立'
              }
            >
              <ArtifactChainWizard
                specContent={specArtifact?.content ?? null}
                planContent={planArtifact?.content ?? null}
                tasksContent={tasksArtifact?.content ?? null}
                clarifications={pendingClarifications}
                constitutionWarnings={constitutionWarnings}
                currentStep={wizardStep}
                onStepChange={setWizardStep}
              />
            </TabSection>

            <TabSection
              title="PM2 派发包"
              hint={
                artifactContext.pm2ArtifactSessionId
                  ? `会话 #${artifactContext.pm2ArtifactSessionId.slice(0, 8)}`
                  : '等待 PM2 接手'
              }
            >
              <DispatchPackageView
                packages={dispatchPackages.map(({ dispatch, handoff }) => ({
                  goal: dispatch.goal ?? `任务 ${handoff.id.slice(0, 8)}`,
                  role: dispatch.role ?? handoff.toRoleLayer,
                  toolsets: dispatch.toolsets ?? [],
                  taskMarkers: {
                    taskId: dispatch.taskMarkers?.taskId ?? handoff.id.slice(0, 8),
                    parallel: dispatch.taskMarkers?.parallel ?? false,
                    story: dispatch.taskMarkers?.story,
                    priority: dispatch.taskMarkers?.priority ?? 'medium',
                  },
                  dependsOn: dispatch.dependsOn ?? [],
                }))}
              />
            </TabSection>

            <TabSection
              title="评审报告"
              hint={
                artifactContext.pm2ArtifactSessionId
                  ? `会话 #${artifactContext.pm2ArtifactSessionId.slice(0, 8)}`
                  : '等待 PM2 评审完成'
              }
            >
              <ReviewReportView
                reportMarkdown={reviewReport.markdown}
                overallVerdict={reviewReport.overallVerdict}
                specReviewPassed={reviewReport.specReviewPassed}
                qualityReviewPassed={reviewReport.qualityReviewPassed}
              />
            </TabSection>
          </>
        ) : (
          <EmptyState
            emoji="🪵"
            title="当前还没有可读产物"
            description="这通常表示 handoff 仍在早期阶段，或当前聚焦节点还没进入 PM1 / PM2 的产物生成区。"
            action={
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    selectedSessionHandoffs.refresh();
                    pm2SessionHandoffs.refresh();
                    refreshArtifacts();
                  }}
                  style={PRIMARY_ACTION_BTN_STYLE}
                >
                  重新拉取上下文
                </button>
                <button
                  type="button"
                  onClick={() => {
                    selectedSessionHandoffs.refresh();
                    pm1SessionHandoffs.refresh();
                    pm2SessionHandoffs.refresh();
                  }}
                  style={ACTION_BTN_STYLE}
                >
                  刷新 handoff 链
                </button>
              </div>
            }
          />
        )}
      </div>
    </TabContainer>
  );
}
