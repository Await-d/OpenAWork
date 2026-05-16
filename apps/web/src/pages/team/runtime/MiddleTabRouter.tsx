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
import type { OfficeSceneState } from './OfficeScene.js';
import type { AgentTeamsSidebarTeam } from './team-runtime-types.js';
import type { HandoffEntry } from '../../../stores/team-events.js';
import { OfficeThreeCanvas } from './OfficeThreeCanvas.js';
import { OverviewTab } from './OverviewTab.js';
import { MessagesTab } from './MessagesTab.js';
import { TeamsTab } from './TeamsTab.js';
import { TeamArtifactSection } from './TeamArtifactSection.js';
import { ReviewReportView } from './ReviewReportView.js';
import { SessionTreeView } from './SessionTreeView.js';
import { TeamRuntimeSettingsPanel } from './team-runtime-settings-panel.js';
import { TabPlaceholder } from './TabPlaceholder.js';
import { LayeredConversationView } from './LayeredConversationView.js';
import { TimingView } from './TimingView.js';

export type MiddleTabKey =
  | 'office'
  | 'dashboard'
  | 'topology'
  | 'health'
  | 'conversation'
  | 'layered'
  | 'messages'
  | 'mentions'
  | 'tasks'
  | 'dispatch'
  | 'session-tree'
  | 'artifacts'
  | 'review'
  | 'review-queue'
  | 'timing'
  | 'usage'
  | 'tools'
  | 'members'
  | 'templates'
  | 'shares'
  | 'audit';

export interface MiddleTabRenderArgs {
  middleTab: MiddleTabKey;
  selectedTeamId: string;
  selectedTeam: AgentTeamsSidebarTeam | null;
  officeSceneState: OfficeSceneState;
  onSelectTeam: (id: string) => void;
  onOpenFullscreen: () => void;
  onSelectLayerSession: () => void;
  onCancelHandoff: (handoffId: string) => void;
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
      return (
        <TabPlaceholder
          emoji="🕸️"
          title="拓扑视图"
          subtitle="将 5 层运行时（reception → pm1 → pm2 → executor → reviewer）渲染为节点图，节点上挂当前 handoff 与子会话。"
          status="planned"
          dataSource="useLayerStore.nodes + useHandoffStore.handoffs"
          bullets={[
            '复用 OfficeCompactBar 中已实现的层流转可视化',
            '边的颜色按 handoff.state 变化（pending/running/completed/failed）',
            '点击节点跳到对应 session（复用 SessionTreeView 的 onSelect）',
          ]}
        />
      );

    case 'health':
      return (
        <TabPlaceholder
          emoji="🩺"
          title="健康度 / 异常驾驶舱"
          subtitle="聚焦异常项：失败 handoff、卡住的 pending、超时 PM、僵尸 executor。"
          status="planned"
          dataSource="useHandoffStore.handoffs（按 state + updatedAt 派生）"
          bullets={[
            '失败 handoff 列表（按时间倒序）',
            '超过阈值的 pending（>2min 视为卡住）',
            '一键取消／重试入口（复用 onCancelHandoff）',
          ]}
        />
      );

    // ─── B. 通讯 ────────────────────────────────────────────────────
    case 'layered':
      return <LayeredConversationView onSelectSessionDrawer={onSelectLayerSession} />;

    case 'messages':
      return <MessagesTab selectedTeam={selectedTeam} />;

    case 'mentions':
      return (
        <TabPlaceholder
          emoji="🔔"
          title="待回复 / @ 我的"
          subtitle="过滤出阻塞型确认与 @ 当前用户的消息，提供快速回复。"
          status="planned"
          dataSource="useTeamNotificationStore.events（kind === 'blocking'）"
          bullets={[
            '阻塞确认（waiting_confirmation）置顶',
            '直接在卡片上回复，复用 ConversationArea 里的 PushMessageCard',
            '已读 / 未读切换',
          ]}
        />
      );

    // ─── C. 任务 / 产物 ─────────────────────────────────────────────
    case 'tasks':
      return <SessionTreeView onSelectSession={onSelectLayerSession} />;

    case 'dispatch':
      return (
        <TabPlaceholder
          emoji="📦"
          title="派发包"
          subtitle="展示 PM2 拆分给 executor 的 dispatch package 列表，可视化每个包的进度。"
          status="data-pending"
          dataSource="DispatchPackageView（已存在）+ team-events 推送的 dispatch 事件"
          bullets={[
            '按 sessionId 聚合 dispatch 包',
            '每个包内显示子任务、负责人、当前状态',
            '失败包提供「重派 / 跳过」入口',
          ]}
        />
      );

    case 'session-tree':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
          <SessionTreeView onSelectSession={onSelectLayerSession} />
          <HandoffCancelInline handoffs={handoffs} onCancel={onCancelHandoff} />
        </div>
      );

    case 'artifacts':
      return <TeamArtifactSection />;

    case 'review':
      return (
        <ReviewReportView
          reportMarkdown={null}
          overallVerdict={null}
          specReviewPassed={null}
          qualityReviewPassed={null}
        />
      );

    case 'review-queue':
      return (
        <TabPlaceholder
          emoji="🗂️"
          title="评审待办"
          subtitle="区别于「评审」tab 看的是已完成报告，本 tab 关注待评审项的处理队列。"
          status="planned"
          dataSource="useTeamRuntimeReferenceViewData().reviewCards（status === 'pending'）"
          bullets={[
            '按优先级 / 类型分组',
            '每条提供 通过 / 拒绝 / 转人工 操作',
            '已通过／已拒绝可折叠隐藏',
          ]}
        />
      );

    // ─── D. 度量 ────────────────────────────────────────────────────
    case 'timing':
      return (
        <TabPlaceholder
          emoji="⏱️"
          title="耗时分析 / 时间线"
          subtitle="按 layer / handoff 聚合 P50/P95，绘制甘特图，定位团队瓶颈。"
          status="data-pending"
          dataSource="useHandoffStore.handoffs（需后端补 startedAt / endedAt）"
          bullets={[
            '甘特图：按层级排列，宽度 = 持续时间',
            '直方图：每层耗时分布 + P50/P95',
            '失败 vs 成功的耗时对比',
          ]}
        />
      );

    case 'usage':
      return (
        <TabPlaceholder
          emoji="🔋"
          title="用量 & 费用"
          subtitle="按 provider / agent / 会话聚合 token、缓存命中、推理成本。"
          status="data-pending"
          dataSource="agent-gateway streamUsageEvent（inputTokens/outputTokens/cacheReadTokens）"
          bullets={[
            'web 端需新建 useTeamUsageStore，订阅 usage 事件',
            '按时间窗口聚合（小时 / 天）',
            '高消耗 agent / session 排行榜',
          ]}
        />
      );

    case 'tools':
      return (
        <TabPlaceholder
          emoji="🛠️"
          title="工具调用统计"
          subtitle="每个工具的调用次数 / 失败率 / 平均耗时，定位低效工具。"
          status="data-pending"
          dataSource="chat tool-call durationMs（需聚合到 team 维度）"
          bullets={[
            '工具维度排行榜：调用量、失败率、p95',
            '按 agent 拆分热力图',
            '失败明细：错误类型、错误样本',
          ]}
        />
      );

    // ─── E. 配置 / 治理 ─────────────────────────────────────────────
    case 'members':
      return <TeamsTab />;

    case 'templates':
      return (
        <TabPlaceholder
          emoji="📐"
          title="工作流模板"
          subtitle="复用 TemplatesTab + WorkflowTemplateEditor，集中管理团队 workflow 模板。"
          status="in-progress"
          dataSource="useTeamWorkflowTemplates"
          bullets={[
            '直接挂载 TemplatesTab 即可（已实现）',
            '保留 onNewTemplate 入口',
            '与「成员」tab 的角色绑定面板做联动',
          ]}
        />
      );

    case 'shares':
      return (
        <TabPlaceholder
          emoji="🤝"
          title="共享 / 协作"
          subtitle="管理已共享的会话、共享给我的会话、权限申请。"
          status="planned"
          dataSource="TeamSessionSharesPanel + TeamSharedSessionsPanel（已存在）"
          bullets={[
            '我共享出去的（含权限、撤销）',
            '别人共享给我的（含查看 / 评论 / 操作权限）',
            '权限申请待办',
          ]}
        />
      );

    case 'audit':
      return (
        <TabPlaceholder
          emoji="📜"
          title="审计日志"
          subtitle="共享创建、权限变更、评论、问题答复等审计事件。"
          status="planned"
          dataSource="TeamAuditPanel + auditLogs from useResolvedTeamRuntimeReferenceData"
          bullets={['按 entityType 过滤', '按 actor 过滤', '导出 CSV']}
          extra={
            gatewayUrl && accessToken && teamWorkspaceId ? (
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                上下文已就绪：
                <code style={{ marginLeft: 6 }}>workspace={teamWorkspaceId}</code>
              </div>
            ) : null
          }
        />
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
