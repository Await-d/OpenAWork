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

import { type ReactNode } from 'react';
import type { OfficeSceneState } from './office/OfficeScene.js';
import type { AgentTeamsSidebarTeam } from '../data/team-runtime-types.js';
import type { HandoffEntry, HandoffEvent } from '../../../../stores/team/team-events.js';
import { OfficeThreeCanvas } from './office/OfficeThreeCanvas.js';
import { OverviewTab } from './overview/OverviewTab.js';
import { MessagesMergedTab } from './conversation/MessagesMergedTab.js';
import { TeamArtifactSection } from './tasks/TeamArtifactSection.js';
import { ReviewMergedTab } from './tasks/ReviewMergedTab.js';
import { TeamRuntimeSettingsPanel } from './governance/team-runtime-settings-panel.js';
import { TabPlaceholder } from './TabPlaceholder.js';
import { TabContainer } from './TabContainer.js';
import { LayeredConversationView } from './conversation/LayeredConversationView.js';
import { TimingView } from './metrics/TimingView.js';
import { HealthView } from './overview/HealthView.js';
import { WorkspaceKnowledgeGraphView } from './overview/WorkspaceKnowledgeGraphView.js';
import { AuditView } from './governance/AuditView.js';
import { SharesView } from './governance/SharesView.js';
import { TemplatesTab } from './governance/TemplatesTab.js';
import { UsageView } from './metrics/UsageView.js';
import { TeamInitSummaryPanel } from './overview/TeamInitSummaryPanel.js';
import type { TeamRuntimeHandoffContextInput } from './team-runtime-navigation.js';

export type MiddleTabKey =
  | 'office'
  | 'dashboard'
  | 'graph'
  | 'health'
  | 'conversation'
  | 'layered'
  | 'messages'
  | 'artifacts'
  | 'review'
  | 'timing'
  | 'usage'
  | 'templates'
  | 'shares'
  | 'audit'
  | 'settings'
  | 'init';

export interface MiddleTabRenderArgs {
  middleTab: MiddleTabKey;
  selectedTeamId: string;
  selectedTeam: AgentTeamsSidebarTeam | null;
  focusHandoffId?: string | null;
  officeSceneState: OfficeSceneState;
  onSelectTeam: (id: string) => void;
  onOpenFullscreen: () => void;
  onOpenClarifications: () => void;
  onOpenHandoffContext: (input: TeamRuntimeHandoffContextInput) => void;
  onOpenBlockingTarget: (event: HandoffEvent) => void;
  onClearFocusedHandoff: () => void;
  onSelectLayerSession: () => void;
  onCancelHandoff: (handoffId: string) => void;
  onNewTemplate?: () => void;
  handoffs: Map<string, HandoffEntry>;
  gatewayUrl: string | null;
  accessToken: string | null;
  activeWorkspaceName: string | undefined;
  onWorkspaceChanged?: () => void;
  teamWorkspaceId: string | null;
}

export function renderMiddleTabContent(args: MiddleTabRenderArgs): ReactNode {
  const {
    middleTab,
    selectedTeamId,
    selectedTeam,
    focusHandoffId,
    officeSceneState,
    onSelectTeam,
    onOpenFullscreen,
    onOpenClarifications,
    onOpenHandoffContext,
    onOpenBlockingTarget,
    onClearFocusedHandoff,
    onSelectLayerSession,
    onCancelHandoff,
    onNewTemplate,
    handoffs,
    gatewayUrl,
    accessToken,
    onWorkspaceChanged,
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
              border: '1px solid color-mix(in srgb, var(--border-default) 60%, transparent)',
              background: 'color-mix(in srgb, var(--bg-overlay) 90%, var(--bg-base))',
              color: 'var(--fg-strong)',
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

    case 'graph':
      return (
        <WorkspaceKnowledgeGraphView
          selectedSessionId={selectedTeamId || null}
          teamWorkspaceId={teamWorkspaceId}
          onSelectSession={onSelectTeam}
        />
      );

    case 'health':
      return (
        <HealthView
          onCancelHandoff={onCancelHandoff}
          onOpenHandoffContext={onOpenHandoffContext}
        />
      );

    // ─── B. 通讯 ────────────────────────────────────────────────────
    case 'layered':
      return <LayeredConversationView onSelectSessionDrawer={onSelectLayerSession} />;

    case 'messages':
      return (
        <MessagesMergedTab
          onOpenBlockingTarget={onOpenBlockingTarget}
          onOpenClarifications={onOpenClarifications}
          selectedTeam={selectedTeam}
        />
      );

    // ─── C. 任务 / 产物 ─────────────────────────────────────────────
    // 「任务与产物」单一视图：内含会话树 + 澄清 + 任务看板 + 派发包 + 产物链。
    case 'artifacts':
      return (
        <TeamArtifactSection
          focusHandoffId={focusHandoffId}
          onClearFocus={onClearFocusedHandoff}
          selectedTeamId={selectedTeamId}
          handoffs={handoffs}
          onCancelHandoff={onCancelHandoff}
        />
      );

    case 'review':
      return (
        <ReviewMergedTab
          focusHandoffId={focusHandoffId}
          onClearFocus={onClearFocusedHandoff}
          selectedTeam={selectedTeam}
          selectedTeamId={selectedTeamId}
        />
      );

    // ─── D. 度量 ────────────────────────────────────────────────────
    case 'timing':
      return <TimingView />;

    case 'usage':
      return (
        <UsageView
          selectedSessionId={selectedTeamId || null}
          selectedSessionTitle={selectedTeam?.title ?? null}
        />
      );

    // ─── E. 配置 / 治理 ─────────────────────────────────────────────
    case 'templates':
      return <TemplatesTab onNewTemplate={onNewTemplate ?? (() => {})} />;

    case 'shares':
      return <SharesView />;

    case 'audit':
      return <AuditView />;

    case 'init':
      return (
        <TabContainer
          title="初始化"
          subtitle="团队对当前会话项目的前置认知：结构 / 记忆 / 架构理解 / 各层工具绑定"
        >
          <TeamInitSummaryPanel sessionId={selectedTeamId || null} variant="full" />
        </TabContainer>
      );

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
            onWorkspaceChanged={onWorkspaceChanged}
            teamWorkspaceId={teamWorkspaceId}
          />
        </TabContainer>
      );

    case 'conversation':
      // 「对话」tab 由 TeamPageV2 直接处理（messagesOverride 走 TeamConversationView 分支）。
      // 这里返回 null 仅用于 TS 穷尽检查，正常路径不会进入。
      return null;

    default: {
      const _exhaustive: never = middleTab;
      return _exhaustive;
    }
  }
}
