/**
 * 260916-层级可视化重构 · T-05 · 追踪瀑布详情区
 *
 * 承载选中时间条的上下文工作区（继承原「跨层线程」详情形态）：
 *   - 头部：来源层 → 目标层上下文 + 承接会话标题 + 复用轮次徽章；
 *   - 主体：该层级会话的完整对话（只读）+ 该会员的 handoff 过程面板；
 *   - 侧栏：产物 / 对话预览 / 角色摘要（LayerSummarySidebar）。
 *
 * 数据组装从 CrossLayerConversationView 平移而来（其自身仍服务于「层级流动」的
 * 线程详情，保持不动）。
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { TeamRoleLayer } from '../../../../../stores/team/team-events.js';
import { EmptyState } from '../../shared/content-kit/index.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';
import { resolveTeamArtifactContext } from '../tasks/team-artifact-context.js';
import { useTeamArtifactData } from '../tasks/use-team-artifact-data.js';
import { LayerDetailWorkspace } from './LayerDetailWorkspace.js';
import { LayerProcessPanel } from './LayerProcessPanel.js';
import { LayerSummarySidebar } from './LayerSummarySidebar.js';
import { resolveIncomingDialoguePreview } from './layer-dialogue-preview.js';
import {
  TEAM_LAYER_LABELS,
  canPreviewTeamLayerPrompt,
  type LayerConversationRow,
} from './layered-conversation-model.js';

const SECTION_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const ACTION_BUTTON_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 55%, transparent)',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export interface LayerTraceDetailPaneProps {
  onPreviewPrompt: (layer: TeamRoleLayer) => void;
  onSelectSessionDrawer?: () => void;
  row: LayerConversationRow | null;
  sessionTitleById: ReadonlyMap<string, string>;
}

export function LayerTraceDetailPane({
  onPreviewPrompt,
  onSelectSessionDrawer,
  row,
  sessionTitleById,
}: LayerTraceDetailPaneProps) {
  if (!row) {
    return (
      <EmptyState
        emoji="🧭"
        title="点击上方时间条查看该层级对话"
        description="每条时间条对应一个层级会话；点开后会在这里看到它的承接上下文、产物摘要与完整对话。"
        style={SECTION_STYLE}
      />
    );
  }

  return (
    <TraceDetailBody
      key={row.sessionId}
      onPreviewPrompt={onPreviewPrompt}
      onSelectSessionDrawer={onSelectSessionDrawer}
      row={row}
      sessionTitleById={sessionTitleById}
    />
  );
}

function TraceDetailBody({
  onPreviewPrompt,
  onSelectSessionDrawer,
  row,
  sessionTitleById,
}: {
  onPreviewPrompt: (layer: TeamRoleLayer) => void;
  onSelectSessionDrawer?: () => void;
  row: LayerConversationRow;
  sessionTitleById: ReadonlyMap<string, string>;
}) {
  const { handoffs } = useSessionHandoffs(row.sessionId);
  const artifactContext = useMemo(
    () =>
      resolveTeamArtifactContext({
        focusHandoffId: null,
        handoffs,
        selectedSessionId: row.sessionId,
        selectedSessionRoleLayer: row.roleLayer,
      }),
    [handoffs, row.roleLayer, row.sessionId],
  );
  const dialoguePreview = useMemo(
    () =>
      resolveIncomingDialoguePreview({
        fallbackSummary: row.detail,
        focusHandoffId: null,
        records: handoffs,
        targetSessionId: row.sessionId,
      }),
    [handoffs, row.detail, row.sessionId],
  );
  const {
    artifactError,
    artifactLoading,
    planArtifact,
    reviewArtifact,
    specArtifact,
    tasksArtifact,
  } = useTeamArtifactData({
    pm1ArtifactSessionId: artifactContext.pm1ArtifactSessionId,
    pm2ArtifactSessionId: artifactContext.pm2ArtifactSessionId,
    preferredArtifactCreatedBeforeMs: row.timestampMs,
  });

  const actions: ReactNode = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {canPreviewTeamLayerPrompt(row.roleLayer) ? (
        <button
          type="button"
          onClick={() => onPreviewPrompt(row.roleLayer)}
          style={ACTION_BUTTON_STYLE}
          title={`查看 ${TEAM_LAYER_LABELS[row.roleLayer]} 的角色提示词`}
        >
          🧬 角色提示词
        </button>
      ) : null}
      {onSelectSessionDrawer ? (
        <button type="button" onClick={onSelectSessionDrawer} style={ACTION_BUTTON_STYLE}>
          在抽屉中打开
        </button>
      ) : null}
    </div>
  );

  return (
    <LayerDetailWorkspace
      actions={actions}
      fromRoleLayer={row.fromRoleLayer}
      fromSessionId={row.parentSessionId}
      fromSessionTitle={
        row.parentSessionId ? (sessionTitleById.get(row.parentSessionId) ?? null) : null
      }
      main={
        <TeamConversationView
          key={row.sessionId}
          sessionId={row.sessionId}
          compact
          readOnly
          soloMode
          beforeMessages={
            <LayerProcessPanel
              focusHandoffId={null}
              records={handoffs}
              roleLayer={row.roleLayer}
              sessionId={row.sessionId}
            />
          }
        />
      }
      modeBadge="历史追踪视角"
      reuseBadge={row.handoffCount > 1 ? `当前轮次 · 第 ${row.handoffCount} 轮（复用会话）` : null}
      sessionId={row.sessionId}
      sessionTitle={row.title}
      sidebar={
        <LayerSummarySidebar
          artifactError={artifactError}
          artifactLoading={artifactLoading}
          dialoguePreview={dialoguePreview}
          planArtifact={planArtifact}
          reviewArtifact={reviewArtifact}
          row={row}
          sessionLabel={row.sessionId}
          specArtifact={specArtifact}
          tasksArtifact={tasksArtifact}
        />
      }
      title={row.title}
      toRoleLayer={row.toRoleLayer}
    />
  );
}
