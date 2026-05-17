/**
 * 260516-team-page-v2 · T-13 · MiddleTabRouter
 *
 * 把 TeamPageV2 中间区的 tab 内容路由独立出来，避免 TeamPageV2 主文件
 * 在 tab 数量增长时变得难以维护。
 *
 * 实现策略：
 *   - 已有完整组件的 tab：直接复用（office、dashboard、conversation 等）
 *   - 占位 tab：使用 TabPlaceholder，标注数据源、计划项与状态
 *
 * 后续每个占位 tab 完工时，只需在此文件替换对应分支即可，无需改动
 * TeamPageV2 主体。
 */

import { useMemo, type ReactNode } from 'react';
import type { OfficeSceneState } from './office/OfficeScene.js';
import type { AgentTeamsSidebarTeam } from '../data/team-runtime-types.js';
import type { HandoffEntry } from '../../../../stores/team-events.js';
import { OfficeThreeCanvas } from './office/OfficeThreeCanvas.js';
import { OverviewTab } from './overview/OverviewTab.js';
import { MessagesMergedTab } from './conversation/MessagesMergedTab.js';
import { TeamsTab } from './governance/TeamsTab.js';
import { TeamArtifactSection } from './tasks/TeamArtifactSection.js';
import { ReviewMergedTab } from './tasks/ReviewMergedTab.js';
import { SessionTreeView } from './tasks/SessionTreeView.js';
import { TeamRuntimeSettingsPanel } from './governance/team-runtime-settings-panel.js';
import { TabPlaceholder } from './TabPlaceholder.js';
import { TabContainer } from './TabContainer.js';
import { LayeredConversationView } from './conversation/LayeredConversationView.js';
import { TimingView } from './metrics/TimingView.js';
import { HealthView } from './overview/HealthView.js';
import { TopologyView } from './overview/TopologyView.js';
import { AuditView } from './governance/AuditView.js';
import { SharesView } from './governance/SharesView.js';
import { TemplatesTab } from './governance/TemplatesTab.js';
import { DispatchTab } from './tasks/DispatchTab.js';
import { ClarificationsPanel } from './tasks/ClarificationsPanel.js';
import { FailureFlowIndicator } from '../shell/FailureFlowIndicator.js';
import { useReviewDisposition } from '../hooks/use-review-disposition.js';
import { useSessionHandoffs } from '../hooks/use-session-handoffs.js';
import { UsageView } from './metrics/UsageView.js';
import { ToolCallsView } from './metrics/ToolCallsView.js';

export type MiddleTabKey =
  | 'office'
  | 'dashboard'
  | 'topology'
  | 'health'
  | 'conversation'
  | 'layered'
  | 'messages'
  | 'tasks'
  | 'dispatch'
  | 'artifacts'
  | 'review'
  | 'timing'
  | 'usage'
  | 'tools'
  | 'members'
  | 'templates'
  | 'shares'
  | 'audit'
  | 'settings';

export interface MiddleTabRenderArgs {
  middleTab: MiddleTabKey;
  selectedTeamId: string;
  selectedTeam: AgentTeamsSidebarTeam | null;
  officeSceneState: OfficeSceneState;
  onSelectTeam: (id: string) => void;
  onOpenFullscreen: () => void;
  onSelectLayerSession: () => void;
  onCancelHandoff: (handoffId: string) => void;
  onNewTemplate?: () => void;
  handoffs: Map<string, HandoffEntry>;
  gatewayUrl: string | null;
  accessToken: string | null;
  activeWorkspaceName: string | undefined;
  teamWorkspaceId: string | null;
}

export function renderMiddleTabContent(args: MiddleTabRenderArgs): ReactNode {
  const {
    middleTab,
    selectedTeamId,
    selectedTeam,
    officeSceneState,
    onSelectTeam,
    onOpenFullscreen,
    onSelectLayerSession,
    onCancelHandoff,
    onNewTemplate,
    handoffs,
    gatewayUrl,
    accessToken,
    teamWorkspaceId,
  } = args;

  switch (middleTab) {
    case 'office':
      return (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <OfficeThreeCanvas
            selectedAgentId={selectedTeamId}
            onSelectAgent={onSelectTeam}
            state={officeSceneState}
          />
          <button
            type="button"
            onClick={onOpenFullscreen}
            aria-label="全屏 3D 办公场景"
            title="全屏（ESC 关闭）"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              padding: '6px 10px',
              borderRadius: 8,
              border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
              background: 'color-mix(in srgb, var(--surface) 90%, var(--bg))',
              color: 'var(--text)',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              backdropFilter: 'blur(6px)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span aria-hidden>⛶</span>
            <span>全屏</span>
          </button>
        </div>
      );

    // ─── A. 概览 ────────────────────────────────────────────────────
    case 'dashboard':
      return <OverviewTab selectedTeam={selectedTeam} />;

    case 'topology':
      return <TopologyView />;

    case 'health':
      return <HealthView onCancelHandoff={onCancelHandoff} />;

    // ─── B. 通讯 ────────────────────────────────────────────────────
    case 'layered':
      return <LayeredConversationView onSelectSessionDrawer={onSelectLayerSession} />;

    case 'messages':
      return <MessagesMergedTab selectedTeam={selectedTeam} />;

    // ─── C. 任务 / 产物 ─────────────────────────────────────────────
    case 'tasks':
      return (
        <TabContainer title="任务流" subtitle="层级会话树 + 当前可取消的 handoff，按状态实时联动。">
          <TaskFailureBanner selectedTeamId={selectedTeamId} />
          <ClarificationsPanel filterSessionId={selectedTeamId || null} />
          <SessionTreeView onSelectSession={onSelectLayerSession} />
          <HandoffCancelInline handoffs={handoffs} onCancel={onCancelHandoff} />
        </TabContainer>
      );

    case 'dispatch':
      return <DispatchTab selectedTeamId={selectedTeamId} onCancelHandoff={onCancelHandoff} />;

    case 'artifacts':
      return <TeamArtifactSection />;

    case 'review':
      return <ReviewMergedTab selectedTeam={selectedTeam} selectedTeamId={selectedTeamId} />;

    // ─── D. 度量 ────────────────────────────────────────────────────
    case 'timing':
      return <TimingView />;

    case 'usage':
      return <UsageView />;

    case 'tools':
      return <ToolCallsView />;

    // ─── E. 配置 / 治理 ─────────────────────────────────────────────
    case 'members':
      return <TeamsTab />;

    case 'templates':
      return <TemplatesTab onNewTemplate={onNewTemplate ?? (() => {})} />;

    case 'shares':
      return <SharesView />;

    case 'audit':
      return <AuditView />;

    case 'settings':
      if (!gatewayUrl) {
        return (
          <TabContainer title="设置" subtitle="团队宪法 / 用户记忆 / 角色 SOUL">
            <TabPlaceholder
              emoji="🔌"
              title="未连接到网关"
              subtitle="设置面板需要先连接到 Agent Gateway。"
              status="data-pending"
              dataSource="useAuthStore.gatewayUrl"
            />
          </TabContainer>
        );
      }
      return (
        <TabContainer title="设置" subtitle="团队宪法 / 用户记忆 / 角色 SOUL">
          <TeamRuntimeSettingsPanel
            gatewayUrl={gatewayUrl}
            accessToken={accessToken}
            teamWorkspaceId={teamWorkspaceId}
          />
        </TabContainer>
      );

    case 'conversation':
      // 「对话」tab 由 TeamPageV2 直接处理（messagesOverride 走 TeamSessionView 分支）。
      // 这里返回 null 仅用于 TS 穷尽检查，正常路径不会进入。
      return null;

    default: {
      const _exhaustive: never = middleTab;
      return _exhaustive;
    }
  }
}

/**
 * 「任务流」tab 顶部的失败分流横幅。
 *
 * 把 useReviewDisposition + FailureFlowIndicator 组合成一个独立组件，
 * 让 renderMiddleTabContent 不需要在 switch case 中调用 hook。
 */
function TaskFailureBanner({ selectedTeamId }: { selectedTeamId: string }) {
  const sessionId = selectedTeamId || null;
  const disposition = useReviewDisposition(sessionId);
  const { handoffs } = useSessionHandoffs(sessionId);
  const pm2Source = useMemo(() => {
    const pm2Records = handoffs
      .filter((record) => record.fromRoleLayer === 'pm2')
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return pm2Records[0]?.fromSessionId ?? null;
  }, [handoffs]);

  if (!disposition.action) return null;
  return (
    <FailureFlowIndicator
      action={disposition.action}
      reason={disposition.reason}
      escalationRound={disposition.escalationRound}
      pm2HandoffId={disposition.pm2HandoffId}
      pm2SourceSessionId={pm2Source}
    />
  );
}

/**
 * 嵌入版的「运行中 handoff 取消列表」。原本只在右侧面板里有一份；
 * 在 session-tree tab 中也复用，避免用户在两处来回切换。
 */
function HandoffCancelInline({
  handoffs,
  onCancel,
}: {
  handoffs: Map<string, HandoffEntry>;
  onCancel: (handoffId: string) => void;
}) {
  const cancellable = useMemo(() => {
    const result: HandoffEntry[] = [];
    for (const entry of handoffs.values()) {
      if (entry.state === 'running' || entry.state === 'pending' || entry.state === 'claimed') {
        result.push(entry);
      }
    }
    return result;
  }, [handoffs]);

  if (cancellable.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        运行中任务
      </span>
      {cancellable.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
            background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: entry.state === 'running' ? 'var(--success, #22c55e)' : '#f59e0b',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-2)',
            }}
          >
            {entry.fromRoleLayer} → {entry.toRoleLayer}
          </span>
          <button
            type="button"
            onClick={() => onCancel(entry.id)}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid color-mix(in srgb, var(--danger, #d4574e) 40%, transparent)',
              background: 'color-mix(in srgb, var(--danger, #d4574e) 8%, transparent)',
              color: 'var(--danger, #d4574e)',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
            aria-label={`取消任务 ${entry.id}`}
          >
            取消
          </button>
        </div>
      ))}
    </div>
  );
}
