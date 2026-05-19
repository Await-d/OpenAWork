/**
 * 260515-team-phase-b · T-11
 *
 * /team-events WS 订阅 + TeamEventDispatcher + Zustand stores。
 *
 * 架构：
 *   - `useTeamEventsConnection` hook 管理 WS 连接生命周期
 *   - 收到事件后按 type 分发到 3 个 store：
 *     - useHandoffStore：handoff 状态变化
 *     - useLayerStore：session 树 / 层级关系
 *     - useTeamNotificationStore：toast / badge 计数
 *
 * 这些 store 被 T-12~T-15 的 UI 组件消费。
 */

import { create } from 'zustand';
import { useTeamUsageStore, useTeamToolCallStore } from './team-usage.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type HandoffState = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TeamRoleLayer = 'user' | 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

export interface HandoffEvent {
  type: string;
  taskId?: string;
  sessionId?: string;
  layer?: TeamRoleLayer;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface HandoffEntry {
  id: string;
  state: HandoffState;
  fromRoleLayer: TeamRoleLayer;
  toRoleLayer: TeamRoleLayer;
  sessionId?: string;
  /** 第一次进入 running/claimed 的时间戳（毫秒）。 */
  startedAt?: number;
  /** 进入终态（completed/failed/cancelled）的时间戳（毫秒）。 */
  endedAt?: number;
  updatedAt: number;
}

export interface LayerNode {
  sessionId: string;
  roleLayer: TeamRoleLayer;
  parentSessionId: string | null;
  state: HandoffState | 'idle';
  title?: string;
}

// ─── Handoff Store ──────────────────────────────────────────────────────────

interface HandoffStoreState {
  handoffs: Map<string, HandoffEntry>;
  applyEvent: (event: HandoffEvent) => void;
  clear: () => void;
}

export const useHandoffStore = create<HandoffStoreState>((set) => ({
  handoffs: new Map(),
  applyEvent: (event) => {
    if (!event.taskId) return;
    set((state) => {
      const next = new Map(state.handoffs);
      const existing = next.get(event.taskId!) ?? {
        id: event.taskId!,
        state: 'pending' as HandoffState,
        fromRoleLayer: (event.payload['fromRoleLayer'] as TeamRoleLayer) ?? 'reception',
        toRoleLayer: (event.payload['toRoleLayer'] as TeamRoleLayer) ?? 'executor',
        updatedAt: event.timestamp,
      };
      const newState = (event.payload['state'] as HandoffState) ?? existing.state;

      // 派生 startedAt：第一次进入 running/claimed 时记录
      const isStartingNow =
        (newState === 'running' || newState === 'claimed') && existing.startedAt === undefined;

      // 派生 endedAt：进入终态时记录
      const isEndingNow =
        (newState === 'completed' || newState === 'failed' || newState === 'cancelled') &&
        existing.endedAt === undefined;

      next.set(event.taskId!, {
        ...existing,
        state: newState,
        sessionId: event.sessionId ?? existing.sessionId,
        updatedAt: event.timestamp,
        ...(isStartingNow ? { startedAt: event.timestamp } : {}),
        ...(isEndingNow ? { endedAt: event.timestamp } : {}),
      });
      return { handoffs: next };
    });
  },
  clear: () => set({ handoffs: new Map() }),
}));

// ─── Layer Store ────────────────────────────────────────────────────────────

interface LayerStoreState {
  nodes: Map<string, LayerNode>;
  addNode: (node: LayerNode) => void;
  updateNodeState: (sessionId: string, state: HandoffState | 'idle') => void;
  clear: () => void;
}

export const useLayerStore = create<LayerStoreState>((set) => ({
  nodes: new Map(),
  addNode: (node) =>
    set((state) => {
      const next = new Map(state.nodes);
      next.set(node.sessionId, node);
      return { nodes: next };
    }),
  updateNodeState: (sessionId, newState) =>
    set((state) => {
      const next = new Map(state.nodes);
      const existing = next.get(sessionId);
      if (existing) {
        next.set(sessionId, { ...existing, state: newState });
      }
      return { nodes: next };
    }),
  clear: () => set({ nodes: new Map() }),
}));

// ─── Notification Store ─────────────────────────────────────────────────────

interface TeamNotificationStoreState {
  events: HandoffEvent[];
  unreadCount: number;
  push: (event: HandoffEvent) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useTeamNotificationStore = create<TeamNotificationStoreState>((set) => ({
  events: [],
  unreadCount: 0,
  push: (event) =>
    set((state) => ({
      events: [...state.events.slice(-99), event],
      unreadCount: state.unreadCount + 1,
    })),
  markAllRead: () => set({ unreadCount: 0 }),
  clear: () => set({ events: [], unreadCount: 0 }),
}));

// ─── Clarification Store ────────────────────────────────────────────────────

/**
 * 单条 [NEEDS CLARIFICATION] 待澄清记录。
 *
 * 来源：
 *   - 后端 c 层（PM1）解析 spec.md 时遇到 [NEEDS CLARIFICATION: ...] 标记
 *   - 通过 team-events WS 推送 type='artifact.needs-clarification'
 *
 * 状态：
 *   - pending：等待用户回答
 *   - answered：用户已通过 inbound 通道回复
 *   - dismissed：用户主动忽略（不传给 c 层，但保留记录）
 */
export type ClarificationStatus = 'pending' | 'answered' | 'dismissed';

export interface ClarificationItem {
  id: string;
  sessionId: string;
  /** PM1 的 source session id（用作 inbound submit 的 target sessionId） */
  fromSessionId: string;
  question: string;
  context: string;
  createdAt: number;
  status: ClarificationStatus;
  answer?: string;
  answeredAt?: number;
}

interface ClarificationStoreState {
  items: ClarificationItem[];
  pendingCount: number;
  push: (event: HandoffEvent) => void;
  markAnswered: (id: string, answer: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useClarificationStore = create<ClarificationStoreState>((set) => ({
  items: [],
  pendingCount: 0,
  push: (event) =>
    set((state) => {
      // payload.clarifications 是数组：见 services/agent-gateway/src/handoff/artifact-chain.ts
      const raw = event.payload['clarifications'];
      if (!Array.isArray(raw)) return state;
      const fromSessionId = (event.payload['fromSessionId'] as string) ?? event.sessionId ?? '';
      const newItems: ClarificationItem[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as { id?: string; question?: string; context?: string };
        if (!item.id || !item.question) continue;
        // 去重：已有相同 id 不重复 push
        if (state.items.some((existing) => existing.id === item.id)) continue;
        newItems.push({
          id: item.id,
          sessionId: event.sessionId ?? '',
          fromSessionId,
          question: item.question,
          context: item.context ?? '',
          createdAt: event.timestamp,
          status: 'pending',
        });
      }
      if (newItems.length === 0) return state;
      const items = [...state.items, ...newItems];
      return {
        items,
        pendingCount: items.filter((i) => i.status === 'pending').length,
      };
    }),
  markAnswered: (id, answer) =>
    set((state) => {
      const items = state.items.map((item) =>
        item.id === id
          ? { ...item, status: 'answered' as ClarificationStatus, answer, answeredAt: Date.now() }
          : item,
      );
      return {
        items,
        pendingCount: items.filter((i) => i.status === 'pending').length,
      };
    }),
  dismiss: (id) =>
    set((state) => {
      const items = state.items.map((item) =>
        item.id === id ? { ...item, status: 'dismissed' as ClarificationStatus } : item,
      );
      return {
        items,
        pendingCount: items.filter((i) => i.status === 'pending').length,
      };
    }),
  clear: () => set({ items: [], pendingCount: 0 }),
}));

// ─── Event Dispatcher ───────────────────────────────────────────────────────

export function dispatchTeamEvent(event: HandoffEvent): void {
  const { applyEvent } = useHandoffStore.getState();
  const { addNode, updateNodeState } = useLayerStore.getState();
  const { push } = useTeamNotificationStore.getState();
  const { push: pushClarifications } = useClarificationStore.getState();

  applyEvent(event);
  push(event);

  // 单独分发 [NEEDS CLARIFICATION]
  if (event.type === 'artifact.needs-clarification') {
    pushClarifications(event);
  }

  // 当 handoff started 时，把新 session 加入 layer tree
  if (event.type === 'handoff.started' && event.sessionId) {
    const toRoleLayer = (event.payload['toRoleLayer'] as TeamRoleLayer) ?? 'executor';
    const fromSessionId = (event.payload['fromSessionId'] as string) ?? null;
    addNode({
      sessionId: event.sessionId,
      roleLayer: toRoleLayer,
      parentSessionId: fromSessionId,
      state: 'running',
    });
    // 确保 parent（from session）也在 tree 中（reception 节点可能还没加入）
    if (fromSessionId && !useLayerStore.getState().nodes.has(fromSessionId)) {
      const fromRoleLayer = (event.payload['fromRoleLayer'] as TeamRoleLayer) ?? 'reception';
      addNode({
        sessionId: fromSessionId,
        roleLayer: fromRoleLayer,
        parentSessionId: null,
        state: 'running',
      });
    }
  }

  if (
    (event.type === 'handoff.completed' ||
      event.type === 'handoff.failed' ||
      event.type === 'handoff.cancelled') &&
    event.sessionId
  ) {
    const state = event.type.replace('handoff.', '') as HandoffState;
    updateNodeState(event.sessionId, state);
  }

  // ─── Team tabs data: usage / tool_call / timing 事件路由 ─────────────
  // 后端 stream-team-events.ts 通过 __teamEventKind 标记区分事件类型，
  // 这里按 kind 分发到对应 zustand store。
  const teamEventKind = event.payload?.['__teamEventKind'] as string | undefined;
  if (teamEventKind === 'team_usage') {
    const { applyUsageEvent } = useTeamUsageStore.getState();
    applyUsageEvent({
      agentId: (event.payload['agentId'] as string) ?? undefined,
      sessionId: (event.payload['sessionId'] as string) ?? undefined,
      provider: (event.payload['provider'] as string) ?? undefined,
      model: (event.payload['model'] as string) ?? undefined,
      inputTokens: (event.payload['inputTokens'] as number) ?? 0,
      outputTokens: (event.payload['outputTokens'] as number) ?? 0,
      reasoningTokens: (event.payload['reasoningTokens'] as number) ?? undefined,
      cacheReadTokens: (event.payload['cacheReadTokens'] as number) ?? undefined,
      cacheWriteTokens: (event.payload['cacheWriteTokens'] as number) ?? undefined,
      costUsd: (event.payload['costUsd'] as number) ?? undefined,
      timestamp: event.timestamp,
    });
  } else if (teamEventKind === 'team_tool_call') {
    const { applyToolCallEvent } = useTeamToolCallStore.getState();
    applyToolCallEvent({
      toolName: (event.payload['toolName'] as string) ?? 'unknown',
      durationMs: (event.payload['durationMs'] as number) ?? 0,
      success: (event.payload['success'] as boolean) ?? true,
      errorType: (event.payload['errorMessage'] as string) ?? undefined,
      timestamp: event.timestamp,
    });
  }
  // team_timing 事件由 TimingView 直接从 useHandoffStore 的 handoff 时间戳派生，
  // 不需要额外 store——但如果后续需要更细粒度的 per-round timing，可以在这里加。
}

// ─── WS Connection Hook ─────────────────────────────────────────────────────

let wsInstance: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectTeamEvents(gatewayUrl: string, token: string): void {
  if (wsInstance && wsInstance.readyState <= WebSocket.OPEN) {
    return;
  }
  const wsUrl =
    gatewayUrl.replace(/^http/, 'ws') + `/team-events?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (msg) => {
    try {
      const event = JSON.parse(msg.data as string) as HandoffEvent;
      if (event.type && event.type !== 'connected' && event.type !== 'pong') {
        dispatchTeamEvent(event);
      }
    } catch (_err) {
      void _err;
      // 忽略非法 JSON
    }
  };

  ws.onclose = () => {
    wsInstance = null;
    // 自动重连（5s 后）
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectTeamEvents(gatewayUrl, token);
      }, 5000);
    }
  };

  ws.onerror = () => {
    ws.close();
  };

  wsInstance = ws;
}

export function disconnectTeamEvents(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
}
