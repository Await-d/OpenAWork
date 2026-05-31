import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  type HandoffRecord,
} from '@openAwork/web-client';
import {
  useClarificationStore,
  useLayerStore,
  type HandoffEntry,
} from '../../../../../stores/team/team-events.js';
import { useReviewDisposition } from '../../hooks/use-review-disposition.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { FailureFlowIndicator } from '../../shell/controls/FailureFlowIndicator.js';
import { TabContainer, TabSection } from '../TabContainer.js';
import { TabPlaceholder } from '../TabPlaceholder.js';
import { ArtifactChainWizard } from './ArtifactChainWizard.js';
import { ClarificationsPanel } from './ClarificationsPanel.js';
import { DispatchPackageView } from './DispatchPackageView.js';
import { ReviewReportView } from './ReviewReportView.js';
import { SessionTreeView } from './SessionTreeView.js';
import { RunningHandoffCancelList } from './RunningHandoffCancelList.js';
import { useTeamArtifactData } from './use-team-artifact-data.js';
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

export function TeamArtifactSection({
  focusHandoffId = null,
  onClearFocus,
  selectedTeamId,
  handoffs,
  onCancelHandoff,
}: TeamArtifactSectionProps) {
  const nodes = useLayerStore((state) => state.nodes);
  const clarificationItems = useClarificationStore((state) => state.items);
  const selectedSessionRoleLayer = selectedTeamId
    ? nodes.get(selectedTeamId)?.roleLayer ?? null
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

  const pm2DetailSessionId =
    initialContext.pm2ArtifactSessionId && initialContext.pm2ArtifactSessionId !== selectedTeamId
      ? initialContext.pm2ArtifactSessionId
      : null;
  const pm2SessionHandoffs = useSessionHandoffs(pm2DetailSessionId);

  const combinedHandoffs = useMemo(
    () => mergeHandoffRecords([selectedSessionHandoffs.handoffs, pm2SessionHandoffs.handoffs]),
    [pm2SessionHandoffs.handoffs, selectedSessionHandoffs.handoffs],
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

  const [wizardStep, setWizardStep] = useState<WizardStep>('spec_draft');
  const {
    artifactError,
    artifactLoading,
    planArtifact,
    refreshArtifacts,
    reviewArtifact,
    specArtifact,
    tasksArtifact,
  } = useTeamArtifactData({
    pm1ArtifactSessionId: artifactContext.pm1ArtifactSessionId,
    pm2ArtifactSessionId: artifactContext.pm2ArtifactSessionId,
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

  const runtimeLoading = selectedSessionHandoffs.loading || pm2SessionHandoffs.loading;
  const runtimeError = selectedSessionHandoffs.error ?? pm2SessionHandoffs.error;
  const disposition = useReviewDisposition(selectedTeamId || null, focusHandoffId);

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

  const reviewReportFromHandoffs = useMemo(
    () => extractReviewReport(combinedHandoffs, focusHandoffId),
    [combinedHandoffs, focusHandoffId],
  );
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
      <TabContainer title="任务与产物" subtitle="按当前会话和 handoff 上下文查看任务、派发与 PM1 / PM2 的产物。">
        <TabPlaceholder
          emoji="🧱"
          title="未选择会话"
          subtitle="左侧选中一个团队会话后，这里会自动拼接 spec / plan / tasks / review 和 dispatch 上下文。"
          status="data-pending"
          dataSource="GET /team/artifacts + GET /team/sessions/:sessionId/handoffs"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="任务与产物"
      subtitle="会话树 / 待澄清 / 任务派发 / 产物链一体化：优先绑定当前会话与聚焦 handoff。"
      actions={
        <button
          type="button"
          onClick={() => {
            selectedSessionHandoffs.refresh();
            pm2SessionHandoffs.refresh();
            refreshArtifacts();
          }}
          style={ACTION_BTN_STYLE}
        >
          {runtimeLoading || artifactLoading ? '加载中…' : '刷新'}
        </button>
      }
    >
      {focusHandoffId && artifactContext.focusHandoff ? (
        <section style={CONTEXT_CARD_STYLE}>
          <strong style={{ color: 'var(--accent)', fontSize: 13 }}>
            已定位到 Handoff #{focusHandoffId.slice(0, 8)}
          </strong>
          <span style={{ color: 'var(--fg-strong)', fontSize: 12, fontWeight: 700 }}>
            {artifactContext.focusHandoff.fromRoleLayer} → {artifactContext.focusHandoff.toRoleLayer} ·{' '}
            {artifactContext.focusHandoff.state}
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
          {onClearFocus ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={onClearFocus} style={ACTION_BTN_STYLE}>
                清除定位
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {runtimeError ? <div style={ERROR_BANNER_STYLE}>handoff 上下文加载失败：{runtimeError}</div> : null}
      {artifactError ? <div style={ERROR_BANNER_STYLE}>{artifactError}</div> : null}

      {disposition.action ? (
        <FailureFlowIndicator
          action={disposition.action}
          reason={disposition.reason}
          escalationRound={disposition.escalationRound}
          pm2HandoffId={disposition.pm2HandoffId}
          onActionComplete={(result) => {
            selectedSessionHandoffs.applyPreview(result.handoffs);
            pm2SessionHandoffs.applyPreview(result.handoffs);
            selectedSessionHandoffs.refresh();
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
          <ClarificationsPanel filterSessionId={selectedTeamId} />
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
              constitutionWarnings={[]}
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
        <TabPlaceholder
          emoji="🪵"
          title="当前上下文尚未生成可读产物"
          subtitle="这通常表示 handoff 还在早期阶段，或当前聚焦手柄尚未进入 PM1 / PM2 的产物生成节点。"
          status="data-pending"
          dataSource="team.artifacts + session handoffs"
          extra={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            </div>
          }
        />
      )}
    </TabContainer>
  );
}
