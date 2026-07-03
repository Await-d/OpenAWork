/**
 * LayerFlowView · 层级消息流动图（带动画）
 *
 * 解决三件事：
 *   ① 各层级对话「看得到」——把 reception → pm1 → pm2 → executor → reviewer 画成一条
 *      横向流水线，每层一个节点，节点状态/活跃度一目了然。
 *   ② 层级间「消息触发 + 详情」——节点之间的连线代表 handoff（消息传递）。点击连线看
 *      handoff 详情（from→to / 状态 / 摘要 / 时间），点击节点展开该层 session 的对话。
 *   ③ 「动画效果」——活跃层节点呼吸脉冲；正在传递的连线有流光；新事件到达时节点弹跳。
 *
 * 数据来源：useHandoffStore（层间 handoff 边）+ useLayerStore（各层 session 节点），
 * 由 team-events WS 实时填充。无新后端依赖。
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  useHandoffStore,
  useLayerStore,
  type HandoffEntry,
  type HandoffState,
  type LayerNode,
  type TeamRoleLayer,
} from '../../../../../stores/team/team-events.js';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { TeamConversationView } from '../../../conversation/TeamConversationView.js';
import { CrossLayerConversationView } from './CrossLayerConversationView.js';
import { TabContainer } from '../TabContainer.js';
import { EmptyState, SegmentedToggle } from '../../shared/content-kit/index.js';
import type { AgentTeamsSidebarTeam } from '../../data/team-runtime-types.js';
import { useTeamRuntimeReferenceViewData } from '../../data/team-runtime-reference-data.js';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isSessionInScope,
} from '../../data/team-runtime-session-scope.js';
import { resolveLayerConversationRootId } from './layered-conversation-model.js';
import { LayerFlowPipeline, type EdgeView, type LayerNodeView } from './LayerFlowPipeline.js';
import { LayerFlowDetailModeBar } from './LayerFlowDetailModeBar.js';
import { LayerFlowDetailEmptyState } from './LayerFlowDetailEmptyState.js';
import { LayerFlowTimelinePanel, type LayerFlowTimelineSection } from './LayerFlowTimelinePanel.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';

/** 流水线展示的层级顺序（不含 user / tester，聚焦核心 5 层）。 */
const FLOW_LAYERS: TeamRoleLayer[] = ['reception', 'pm1', 'pm2', 'executor', 'reviewer'];

const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ACTIVE_STATES = new Set<HandoffState>(['pending', 'claimed', 'running']);
const FLOW_LAYER_SET = new Set<TeamRoleLayer>(FLOW_LAYERS);

function normalizeFlowRoleLayer(value: string | null | undefined): TeamRoleLayer | null {
  switch (value) {
    case 'reception':
    case 'pm1':
    case 'pm2':
    case 'executor':
    case 'reviewer':
      return value;
    default:
      return null;
  }
}

function normalizeFlowNodeState(value: string | null | undefined): HandoffState | 'idle' {
  switch (value) {
    case 'pending':
    case 'claimed':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return value;
    case 'paused':
      return 'claimed';
    default:
      return 'idle';
  }
}

function resolveFlowHandoffSessionId(
  handoff: HandoffEntry,
  nodes: Map<string, LayerNode>,
): string | null {
  if (handoff.toSessionId) {
    return handoff.toSessionId;
  }

  const explicitNode = handoff.sessionId ? (nodes.get(handoff.sessionId) ?? null) : null;
  if (explicitNode?.roleLayer === handoff.toRoleLayer) {
    return handoff.sessionId ?? null;
  }

  const directChild = handoff.fromSessionId
    ? Array.from(nodes.values()).find(
        (node) =>
          node.parentSessionId === handoff.fromSessionId && node.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (directChild) {
    return directChild.sessionId;
  }

  const sessionChild = handoff.sessionId
    ? Array.from(nodes.values()).find(
        (node) =>
          node.parentSessionId === handoff.sessionId && node.roleLayer === handoff.toRoleLayer,
      )
    : null;
  if (sessionChild) {
    return sessionChild.sessionId;
  }

  const scopedLayerMatch = Array.from(nodes.values()).find(
    (node) => node.roleLayer === handoff.toRoleLayer && node.sessionId !== handoff.fromSessionId,
  );
  return scopedLayerMatch?.sessionId ?? handoff.sessionId ?? null;
}

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
};

const FLOW_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 12,
  padding: '12px 16px',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base)) 0%, color-mix(in srgb, var(--bg-base) 96%, transparent) 100%)',
  flexShrink: 0,
  boxShadow: 'var(--shadow-sm)',
};

const SPLIT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(200px, 0.3fr) minmax(0, 1fr)',
  gridTemplateRows: 'minmax(0, 1fr)',
  gap: 12,
  overflow: 'hidden',
};

const TIMELINE_PANEL_STYLE: CSSProperties = {
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

const DETAIL_TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 78%, var(--bg-base))',
  flexShrink: 0,
  minHeight: 44,
};

const DETAIL_PANE_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'var(--radius-lg, 12px)',
  border: '1px solid color-mix(in srgb, var(--border-default) 36%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 60%, var(--bg-base))',
};

const DETAIL_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const CONVERSATION_WRAPPER_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
};

const FLOW_TIMELINE_SECTION_ORDER: TeamRoleLayer[] = [
  'pm1',
  'pm2',
  'executor',
  'reviewer',
  'reception',
];

export interface LayerFlowViewProps {
  selectedTeam?: AgentTeamsSidebarTeam | null;
}

export function LayerFlowView({ selectedTeam = null }: LayerFlowViewProps) {
  const isNarrowLayout = useNarrowConversationLayout();
  const handoffs = useHandoffStore((s) => s.handoffs);
  const nodes = useLayerStore((s) => s.nodes);
  const { sessions } = useTeamRuntimeReferenceViewData();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedHandoffId, setSelectedHandoffId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<'session' | 'thread'>('session');
  const [flowDensityMode, setFlowDensityMode] = useState<'active' | 'all'>('active');
  const [detailSelectedTeam, setDetailSelectedTeam] = useState<AgentTeamsSidebarTeam | null>(null);
  const selectedScope = selectedTeam;
  const selectedDetailTeam = detailSelectedTeam ?? selectedTeam;

  const snapshotNodes = useMemo<LayerNode[]>(() => {
    const result: LayerNode[] = [];
    for (const session of sessions) {
      const roleLayer = normalizeFlowRoleLayer(
        session.roleLayer ?? session.roleInstance?.roleLayer,
      );
      if (!roleLayer || !FLOW_LAYER_SET.has(roleLayer)) {
        continue;
      }
      result.push({
        parentSessionId: session.parentSessionId,
        roleLayer,
        sessionId: session.id,
        state: normalizeFlowNodeState(session.paused ? 'paused' : session.stateStatus),
        ...(session.roleInstance?.rootSessionId
          ? { rootSessionId: session.roleInstance.rootSessionId }
          : {}),
        ...(session.roleInstance?.personaKey
          ? { personaKey: session.roleInstance.personaKey }
          : {}),
        ...(session.roleInstance?.displayName
          ? { displayName: session.roleInstance.displayName }
          : {}),
        ...(session.title ? { title: session.title } : {}),
      });
    }
    return result;
  }, [sessions]);

  const mergedNodes = useMemo(() => {
    const next = new Map<string, LayerNode>();
    for (const node of snapshotNodes) {
      next.set(node.sessionId, node);
    }
    for (const node of nodes.values()) {
      next.set(node.sessionId, {
        ...next.get(node.sessionId),
        ...node,
      });
    }
    return next;
  }, [nodes, snapshotNodes]);

  const scopedSessionIds = useMemo(() => {
    if (!selectedScope || selectedScope.isSharedSession) {
      return null;
    }
    const nodeList = Array.from(mergedNodes.values());
    const rootSessionId = resolveLayerConversationRootId({
      nodes: nodeList,
      selectedSessionId: selectedScope.id,
      sessions,
    });
    return rootSessionId
      ? collectSessionScope(rootSessionId, [...sessions, ...nodeList])
      : new Set<string>();
  }, [mergedNodes, selectedScope, sessions]);

  const scopedHandoffs = useMemo(() => {
    if (!scopedSessionIds) {
      return handoffs;
    }
    return new Map(
      Array.from(handoffs.entries()).filter(([, handoff]) =>
        isHandoffInSessionScope(handoff, scopedSessionIds),
      ),
    );
  }, [handoffs, scopedSessionIds]);

  const scopedNodes = useMemo(() => {
    if (!scopedSessionIds) {
      return mergedNodes;
    }
    return new Map(
      Array.from(mergedNodes.entries()).filter(([sessionId]) =>
        isSessionInScope(sessionId, scopedSessionIds),
      ),
    );
  }, [mergedNodes, scopedSessionIds]);

  const effectiveSelectedTeam = selectedDetailTeam;

  useEffect(() => {
    setSelectedSessionId(null);
    setSelectedHandoffId(null);
    setDetailSelectedTeam(null);
    setDetailMode('thread');
  }, [selectedTeam?.id, selectedTeam?.isSharedSession]);

  // 派生每层节点视图：聚合该层作为 to 的 handoff，以及 layer store 里的 session。
  const layerViews = useMemo<LayerNodeView[]>(() => {
    const entries = Array.from(scopedHandoffs.values());
    const views = FLOW_LAYERS.map((layer) => {
      const inbound = entries.filter((h) => h.toRoleLayer === layer);
      inbound.sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = inbound[0] ?? null;
      // 优先用 handoff 目标层 session；历史事件中的 sessionId 可能是上游/主会话。
      let sessionId = latest ? resolveFlowHandoffSessionId(latest, scopedNodes) : null;
      if (!sessionId) {
        for (const node of scopedNodes.values()) {
          if (node.roleLayer === layer) {
            sessionId = node.sessionId;
            break;
          }
        }
      }
      const matchedNode = sessionId ? (scopedNodes.get(sessionId) ?? null) : null;
      const state: HandoffState | 'idle' = latest?.state ?? matchedNode?.state ?? 'idle';

      // 收集该层所有角色实例（从 layer store nodes 中筛选同层）
      const layerNodes = Array.from(scopedNodes.values()).filter(
        (node) => node.roleLayer === layer,
      );
      // 也从 handoff 中补充没有对应 node 的 session
      const handoffSessionIds = new Set(
        inbound
          .map((h) => resolveFlowHandoffSessionId(h, scopedNodes))
          .filter((sid): sid is string => sid !== null),
      );
      const existingSessionIds = new Set(layerNodes.map((n) => n.sessionId));
      for (const sid of handoffSessionIds) {
        if (!existingSessionIds.has(sid)) {
          layerNodes.push({
            sessionId: sid,
            roleLayer: layer,
            parentSessionId: null,
            state: latest?.state ?? 'idle',
            personaKey: null,
            displayName: null,
          });
        }
      }

      const roleInstances = layerNodes.map((node) => ({
        sessionId: node.sessionId,
        displayName: node.displayName ?? null,
        personaKey: node.personaKey ?? null,
        state: node.state,
      }));

      return {
        layer,
        sessionId,
        state,
        active: latest ? ACTIVE_STATES.has(latest.state) : false,
        inboundCount: inbound.length,
        roleInstances,
      };
    });
    if (flowDensityMode === 'all') {
      return views;
    }
    return views.filter(
      (view) =>
        view.active ||
        view.inboundCount > 0 ||
        view.sessionId !== null ||
        view.sessionId === selectedSessionId,
    );
  }, [flowDensityMode, scopedHandoffs, scopedNodes, selectedSessionId]);

  // 派生相邻层之间的边。
  const edges = useMemo<EdgeView[]>(() => {
    const entries = Array.from(scopedHandoffs.values());
    const result: EdgeView[] = [];
    for (let i = 0; i < FLOW_LAYERS.length - 1; i++) {
      const from = FLOW_LAYERS[i]!;
      const to = FLOW_LAYERS[i + 1]!;
      const matching = entries
        .filter((h) => h.fromRoleLayer === from && h.toRoleLayer === to)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const latest = matching[0] ?? null;
      result.push({
        fromIndex: i,
        toIndex: i + 1,
        latest,
        active: latest ? ACTIVE_STATES.has(latest.state) : false,
        state: latest?.state ?? 'idle',
      });
    }
    return result;
  }, [scopedHandoffs]);

  // 时间线（全部 handoff，时间倒序），点击查看详情 + 打开会话。
  const timeline = useMemo<HandoffEntry[]>(() => {
    const list = Array.from(scopedHandoffs.values());
    list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [scopedHandoffs]);

  const selectedHandoff = selectedHandoffId
    ? (scopedHandoffs.get(selectedHandoffId) ?? null)
    : null;

  const timelineSections = useMemo<LayerFlowTimelineSection[]>(
    () =>
      FLOW_TIMELINE_SECTION_ORDER.map((layer) => {
        const layerEntries = timeline.filter((entry) => entry.toRoleLayer === layer);
        // 按 toSessionId 聚合为会话分组
        const groupMap = new Map<string, HandoffEntry[]>();
        for (const entry of layerEntries) {
          const key = entry.toSessionId ?? entry.sessionId ?? entry.id;
          const existing = groupMap.get(key);
          if (existing) {
            existing.push(entry);
          } else {
            groupMap.set(key, [entry]);
          }
        }
        const groups = Array.from(groupMap.entries())
          .map(([sessionId, entries]) => {
            const sortedEntries = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
            return {
              sessionId,
              entries: sortedEntries,
              toRoleLayer: sortedEntries[0]!.toRoleLayer,
              fromRoleLayer: sortedEntries[0]!.fromRoleLayer,
              state: sortedEntries[0]!.state,
              summary: sortedEntries[0]!.summary,
              updatedAt: sortedEntries[0]!.updatedAt,
            };
          })
          .sort((a, b) => b.updatedAt - a.updatedAt);

        return { groups, layer };
      }).filter((section) => section.groups.length > 0),
    [timeline],
  );
  const sessionTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const session of sessions) {
      if (session.title?.trim()) {
        map.set(session.id, session.title);
      }
    }
    for (const node of scopedNodes.values()) {
      if (node.title?.trim()) {
        map.set(node.sessionId, node.title);
      }
      if (node.displayName?.trim() && !map.has(node.sessionId)) {
        map.set(node.sessionId, node.displayName);
      }
    }
    return map;
  }, [scopedNodes, sessions]);

  const handleSelectLayer = (view: LayerNodeView) => {
    if (!view.sessionId) return;
    // 默认进入 session 模式，直接展示该角色实例的独立对话
    setDetailMode('session');
    setDetailSelectedTeam({
      id: view.sessionId,
      status:
        view.state === 'failed'
          ? 'failed'
          : view.state === 'running' || view.state === 'claimed' || view.state === 'pending'
            ? 'running'
            : view.state === 'cancelled'
              ? 'paused'
              : 'completed',
      subtitle: `${getRoleLayerIdentity(view.layer).label} 层`,
      title: `${getRoleLayerIdentity(view.layer).label} 会话`,
    });
    setSelectedSessionId((prev) => (prev === view.sessionId ? null : view.sessionId));
    setSelectedHandoffId(null);
  };

  const handleSelectHandoff = (entry: HandoffEntry) => {
    setSelectedHandoffId(entry.id);
    // 如果 handoff 已绑定目标 session，直接进 session 模式看该角色对话
    const handoffSessionId = resolveFlowHandoffSessionId(entry, scopedNodes);
    setDetailMode(handoffSessionId ? 'session' : 'thread');
    const threadSessionId =
      resolveFlowHandoffSessionId(entry, scopedNodes) ?? entry.fromSessionId ?? null;
    setDetailSelectedTeam(
      threadSessionId
        ? {
            id: threadSessionId,
            status:
              entry.state === 'failed'
                ? 'failed'
                : entry.state === 'running' ||
                    entry.state === 'claimed' ||
                    entry.state === 'pending'
                  ? 'running'
                  : entry.state === 'cancelled'
                    ? 'paused'
                    : 'completed',
            subtitle: `${getRoleLayerIdentity(entry.fromRoleLayer).label} → ${getRoleLayerIdentity(entry.toRoleLayer).label}`,
            title: entry.summary ?? '跨层线程',
          }
        : null,
    );
    if (threadSessionId) setSelectedSessionId(threadSessionId);
  };

  if (scopedHandoffs.size === 0 && scopedNodes.size === 0) {
    return (
      <TabContainer
        title="层级流动"
        subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。"
      >
        <EmptyState
          emoji="🪜"
          title="还没有跨层流动"
          description="当前会话还停留在接待层直接对话。一旦你提出需要规划/执行的任务，团队会展开 接待 → 规划 → 管控 → 执行 → 评审 的层级协作，过程会在这里实时画成流水线。"
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="层级流动"
      subtitle="把消息在 接待 → 规划 → 管控 → 执行 → 评审 各层之间的传递实时画成流水线。点左侧记录切换，右侧面板只显示对话。"
      scroll={false}
    >
      <div style={CONTAINER_STYLE}>
        {/* 流水线：节点 + 动画连线 */}
        <div style={FLOW_ROW_STYLE} role="group" aria-label="层级流水线">
          <LayerFlowPipeline
            edges={edges}
            layerViews={layerViews}
            selectedSessionId={selectedSessionId}
            onSelectHandoff={handleSelectHandoff}
            onSelectLayer={handleSelectLayer}
          />
          <SegmentedToggle<'active' | 'all'>
            ariaLabel="层级流动密度模式"
            size="sm"
            value={flowDensityMode}
            onChange={setFlowDensityMode}
            options={[
              { value: 'active', label: '活跃', icon: '⚡' },
              { value: 'all', label: '全部', icon: '🗂️' },
            ]}
          />
        </div>

        {/* 左右分栏：左 timeline + 右对话 */}
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
          <div
            style={
              isNarrowLayout
                ? {
                    ...TIMELINE_PANEL_STYLE,
                    maxHeight: 280,
                  }
                : TIMELINE_PANEL_STYLE
            }
          >
            <LayerFlowTimelinePanel
              sections={timelineSections}
              selectedHandoffId={selectedHandoffId}
              onSelectHandoff={handleSelectHandoff}
              nodes={scopedNodes}
            />
          </div>

          <div style={DETAIL_PANE_STYLE}>
            {selectedSessionId || selectedHandoff ? (
              <div style={DETAIL_BODY_STYLE}>
                <div style={DETAIL_TOOLBAR_STYLE}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}
                  >
                    <strong
                      style={{
                        fontSize: 13,
                        color: 'var(--fg-strong)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {selectedHandoff?.summary ?? detailSelectedTeam?.title ?? '层级详情'}
                    </strong>
                    {selectedHandoff ? (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 11,
                          color: 'var(--fg-muted)',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm, 6px)',
                            background: 'color-mix(in srgb, var(--bg-hover) 60%, transparent)',
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          <span>{getRoleLayerIdentity(selectedHandoff.fromRoleLayer).short}</span>
                          <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                            →
                          </span>
                          <span>{getRoleLayerIdentity(selectedHandoff.toRoleLayer).short}</span>
                        </span>
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '1px 7px',
                            borderRadius: 'var(--radius-pill, 9999px)',
                            background: `color-mix(in srgb, ${STATE_COLOR[selectedHandoff.state]} 14%, transparent)`,
                            border: `1px solid color-mix(in srgb, ${STATE_COLOR[selectedHandoff.state]} 28%, transparent)`,
                            color: STATE_COLOR[selectedHandoff.state],
                          }}
                        >
                          {STATE_LABELS[selectedHandoff.state] ?? selectedHandoff.state}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(selectedHandoff.updatedAt).toLocaleTimeString('zh-CN')}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <LayerFlowDetailModeBar detailMode={detailMode} onChange={setDetailMode} />
                </div>

                {detailMode === 'thread' ? (
                  <div style={CONVERSATION_WRAPPER_STYLE}>
                    <CrossLayerConversationView
                      embedded
                      focusHandoffId={selectedHandoff?.id ?? null}
                      focusSessionId={selectedSessionId}
                      selectedTeam={effectiveSelectedTeam}
                    />
                  </div>
                ) : selectedSessionId ? (
                  <div style={CONVERSATION_WRAPPER_STYLE}>
                    {/* 同层多角色实例选择器：当当前层级有多个角色实例时，
                        显示切换栏让用户选择查看哪个角色的对话 */}
                    {(() => {
                      const selectedView = layerViews.find(
                        (v) => v.sessionId === selectedSessionId,
                      );
                      if (selectedView && selectedView.roleInstances.length > 1) {
                        return (
                          <div
                            style={{
                              display: 'flex',
                              gap: 4,
                              padding: '6px 10px',
                              borderBottom:
                                '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
                              overflowX: 'auto',
                              flexShrink: 0,
                            }}
                          >
                            {selectedView.roleInstances.map((ri) => {
                              const isActive = ri.sessionId === selectedSessionId;
                              return (
                                <button
                                  key={ri.sessionId}
                                  type="button"
                                  onClick={() => setSelectedSessionId(ri.sessionId)}
                                  className="team-sub-tab"
                                  data-active={isActive}
                                  style={{
                                    padding: '3px 10px',
                                    borderRadius: 'var(--radius-sm, 6px)',
                                    border: isActive
                                      ? '1px solid color-mix(in srgb, var(--accent) 45%, transparent)'
                                      : '1px solid color-mix(in srgb, var(--border-default) 30%, transparent)',
                                    background: isActive
                                      ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
                                      : 'transparent',
                                    color: isActive ? 'var(--fg-strong)' : 'var(--fg-muted)',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={ri.displayName ?? ri.personaKey ?? ri.sessionId}
                                >
                                  {ri.displayName ?? ri.personaKey ?? ri.sessionId.slice(-8)}
                                </button>
                              );
                            })}
                          </div>
                        );
                      }
                      return null;
                    })()}
                    <TeamConversationView
                      key={selectedSessionId}
                      sessionId={selectedSessionId}
                      compact
                      topBar={null}
                      readOnly
                      soloMode
                    />
                  </div>
                ) : (
                  <EmptyState
                    emoji="💬"
                    title="当前交接尚未绑定层级会话"
                    description="可切到跨层线程查看本次交接前后的完整上下文。"
                    style={{ flex: 1 }}
                  />
                )}
              </div>
            ) : (
              <LayerFlowDetailEmptyState />
            )}
          </div>
        </div>
      </div>
    </TabContainer>
  );
}
