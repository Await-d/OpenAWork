/**
 * 260530-team-page · Wave 3 · CrossLayerConversationView（F3 跨层对话线程）
 *
 * 与 LayeredConversationView（双栏 timeline + 右侧单会话）不同，这里把一次任务链
 * 的历史层级会话 **纵向串联成一条对话线程**：
 *
 *   接待 ─▶ PM1 ─▶ PM2 ─▶ 执行 ─▶ 评审
 *     每个节点展示：from→to / 层级、状态、时间、会话摘要
 *     点击节点 → 内联展开该层 session 的完整 TeamConversationView
 *
 * 数据来源：runtime snapshot sessions + useLayerStore + useHandoffStore。
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState, CK_BORDER, CK_SURFACE } from '../../shared/content-kit/index.js';
import { RolePromptPreviewPanel } from '../../shared/RolePromptPreviewPanel.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import type { HandoffRecord } from '@openAwork/web-client';
import {
  TEAM_LAYER_LABELS,
  buildLayerConversationRows,
  canPreviewTeamLayerPrompt,
  type LayerConversationRow,
  type LayerConversationState,
} from './layered-conversation-model.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { useTeamArtifactData } from '../tasks/use-team-artifact-data.js';
import { resolveTeamArtifactContext } from '../tasks/team-artifact-context.js';
import { resolveIncomingDialoguePreview } from './layer-dialogue-preview.js';
import { LayerSummarySidebar } from './LayerSummarySidebar.js';
import { LayerProcessPanel } from './LayerProcessPanel.js';
import { LayerDetailWorkspace } from './LayerDetailWorkspace.js';
import { CrossLayerThreadListPanel } from './CrossLayerThreadListPanel.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 1,
  minHeight: 0,
};

const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
  gap: 12,
};

const DETAIL_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${CK_BORDER}`,
  background: CK_SURFACE,
  overflow: 'hidden',
};

const PANEL_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '12px 14px',
  borderBottom: `1px solid ${CK_BORDER}`,
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
  flexShrink: 0,
};

export interface CrossLayerConversationViewProps {
  /** 可选：聚焦某条 handoff（默认展开它）。 */
  focusHandoffId?: string | null;
  /** 可选：聚焦某个层级 session（默认展开它）。 */
  focusSessionId?: string | null;
  /** 当前选中团队会话；有值时线程限定在其根会话子树内。 */
  selectedTeam?: AgentTeamsSidebarTeam | null;
  /** 作为右侧详情嵌入时，不再重复套一层 TabContainer。 */
  embedded?: boolean;
}

export function CrossLayerConversationView({
  focusHandoffId,
  focusSessionId,
  selectedTeam = null,
  embedded = false,
}: CrossLayerConversationViewProps) {
  const isNarrowLayout = useNarrowConversationLayout();
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const { sessions } = useTeamRuntimeReferenceViewData();
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [promptPreviewLayer, setPromptPreviewLayer] = useState<TeamRoleLayer | null>(null);
  const expandedSessionHandoffs = useSessionHandoffs(expandedSessionId);

  const thread = useMemo(
    () =>
      buildLayerConversationRows({
        handoffs: handoffs.values(),
        nodes: nodes.values(),
        selectedSessionId: selectedTeam?.isSharedSession ? null : selectedTeam?.id,
        sessions,
      }),
    [handoffs, nodes, selectedTeam?.id, selectedTeam?.isSharedSession, sessions],
  );

  const handleToggle = useCallback((sessionId: string) => {
    setExpandedSessionId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  const expandedArtifactContext = useMemo(
    () =>
      resolveTeamArtifactContext({
        focusHandoffId,
        handoffs: expandedSessionHandoffs.handoffs,
        selectedSessionId: expandedSessionId,
        selectedSessionRoleLayer: expandedSessionId
          ? (thread.find((row) => row.sessionId === expandedSessionId)?.roleLayer ?? null)
          : null,
      }),
    [expandedSessionHandoffs.handoffs, expandedSessionId, focusHandoffId, thread],
  );
  const expandedFocusRow = useMemo(
    () =>
      expandedSessionId
        ? (thread.find((row) => row.sessionId === expandedSessionId) ?? null)
        : null,
    [expandedSessionId, thread],
  );
  const sessionTitleById = useMemo(
    () => new Map(thread.map((row) => [row.sessionId, row.title])),
    [thread],
  );
  const expandedDialoguePreview = useMemo(
    () =>
      resolveIncomingDialoguePreview({
        fallbackSummary: expandedFocusRow?.detail ?? null,
        focusHandoffId,
        records: expandedSessionHandoffs.handoffs,
        targetSessionId: expandedSessionId,
      }),
    [expandedFocusRow?.detail, expandedSessionHandoffs.handoffs, expandedSessionId, focusHandoffId],
  );
  const {
    artifactError,
    artifactLoading,
    planArtifact,
    reviewArtifact,
    specArtifact,
    tasksArtifact,
  } = useTeamArtifactData({
    pm1ArtifactSessionId: expandedArtifactContext.pm1ArtifactSessionId,
    pm2ArtifactSessionId: expandedArtifactContext.pm2ArtifactSessionId,
    preferredArtifactCreatedBeforeMs: expandedFocusRow?.timestampMs ?? null,
  });

  useEffect(() => {
    if (thread.length === 0) {
      setExpandedSessionId(null);
      return;
    }

    if (focusSessionId && thread.some((row) => row.sessionId === focusSessionId)) {
      setExpandedSessionId(focusSessionId);
      return;
    }

    if (focusHandoffId) {
      const focusRow = thread.find((row) => row.id === `handoff-${focusHandoffId}`);
      if (focusRow) {
        setExpandedSessionId(focusRow.sessionId);
        return;
      }
    }

    setExpandedSessionId((previous) => {
      if (previous && thread.some((row) => row.sessionId === previous)) {
        return previous;
      }
      return thread.find((row) => row.parentSessionId !== null)?.sessionId ?? thread[0]!.sessionId;
    });
  }, [focusHandoffId, focusSessionId, thread]);

  const EMBEDDED_BODY_STYLE: CSSProperties = {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const body = embedded ? (
    <div style={EMBEDDED_BODY_STYLE}>
      {expandedFocusRow ? (
        <TeamConversationView
          key={expandedFocusRow.sessionId}
          sessionId={expandedFocusRow.sessionId}
          compact
          topBar={null}
          readOnly
          soloMode
        />
      ) : (
        <EmptyState
          emoji="🧵"
          title="选择左侧线程节点查看详情"
          description="右侧会展示该层的上下文和正文。"
          style={{ flex: 1 }}
        />
      )}
    </div>
  ) : (
    <div style={CONTAINER_STYLE}>
      <div
        style={
          isNarrowLayout
            ? {
                ...SPLIT_STYLE,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }
            : SPLIT_STYLE
        }
      >
        <CrossLayerThreadListPanel
          expandedSessionId={expandedSessionId}
          focusHandoffId={focusHandoffId}
          rows={thread}
          onPreviewPrompt={setPromptPreviewLayer}
          onToggle={handleToggle}
        />
        <div
          style={
            isNarrowLayout
              ? {
                  ...DETAIL_PANEL_STYLE,
                  minHeight: 360,
                }
              : DETAIL_PANEL_STYLE
          }
        >
          {expandedFocusRow ? (
            <>
              <LayerDetailWorkspace
                fromRoleLayer={expandedFocusRow.fromRoleLayer}
                fromSessionId={expandedFocusRow.parentSessionId}
                fromSessionTitle={
                  expandedFocusRow.parentSessionId
                    ? (sessionTitleById.get(expandedFocusRow.parentSessionId) ?? null)
                    : null
                }
                modeBadge="跨层线程视角"
                reuseBadge={
                  expandedFocusRow.handoffCount > 1
                    ? `当前轮次 · 第 ${expandedFocusRow.handoffCount} 轮（复用会话）`
                    : null
                }
                main={
                  <TeamConversationView
                    key={expandedFocusRow.sessionId}
                    sessionId={expandedFocusRow.sessionId}
                    compact
                    soloMode
                    beforeMessages={
                      <LayerProcessPanel
                        focusHandoffId={focusHandoffId}
                        records={expandedSessionHandoffs.handoffs}
                        roleLayer={expandedFocusRow.roleLayer}
                        sessionId={expandedFocusRow.sessionId}
                      />
                    }
                  />
                }
                sessionId={expandedFocusRow.sessionId}
                sessionTitle={expandedFocusRow.title}
                sidebar={
                  <LayerSummarySidebar
                    artifactError={artifactError}
                    artifactLoading={artifactLoading}
                    dialoguePreview={expandedDialoguePreview}
                    planArtifact={planArtifact}
                    reviewArtifact={reviewArtifact}
                    row={expandedFocusRow}
                    sessionLabel={expandedFocusRow.sessionId}
                    specArtifact={specArtifact}
                    summaryTitle={undefined}
                    tasksArtifact={tasksArtifact}
                  />
                }
                title={expandedFocusRow.title}
                toRoleLayer={expandedFocusRow.toRoleLayer}
              />
            </>
          ) : (
            <EmptyState
              emoji="🧵"
              title="选择左侧线程节点查看详情"
              description="右侧会固定展示该层的上下文、产物和正文，左侧节点高度不会再受右侧内容影响。"
              style={{ flex: 1 }}
            />
          )}
        </div>
      </div>
      <RolePromptPreviewPanel
        layer={promptPreviewLayer}
        onClose={() => setPromptPreviewLayer(null)}
      />
    </div>
  );

  if (thread.length === 0) {
    if (embedded) {
      return (
        <EmptyState
          emoji="🧵"
          title="暂无跨层对话"
          description="团队启动后，接待、规划、管控、执行、测试、评审等历史会话会在这里串成线程。"
          style={{ flex: 1 }}
        />
      );
    }

    return (
      <TabContainer
        title="跨层对话线程"
        subtitle="把当前会话树的历史层级串成一条线程，逐层展开普通对话内容。"
      >
        <EmptyState
          emoji="🧵"
          title="暂无跨层对话"
          description="团队启动后，接待、规划、管控、执行、测试、评审等历史会话会在这里串成线程。"
        />
      </TabContainer>
    );
  }

  if (embedded) {
    return body;
  }

  return (
    <TabContainer
      title="跨层对话线程"
      subtitle="把当前会话树的历史层级串成一条线程，逐层展开普通对话内容。"
    >
      {body}
    </TabContainer>
  );
}
