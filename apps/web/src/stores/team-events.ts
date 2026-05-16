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
      next.set(event.taskId!, {
        ...existing,
        state: newState,
        sessionId: event.sessionId ?? existing.sessionId,
        updatedAt: event.timestamp,
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

// ─── Event Dispatcher ───────────────────────────────────────────────────────

export function dispatchTeamEvent(event: HandoffEvent): void {
  const { applyEvent } = useHandoffStore.getState();
  const { addNode, updateNodeState } = useLayerStore.getState();
  const { push } = useTeamNotificationStore.getState();

  applyEvent(event);
  push(event);

  // 当 handoff started 时，把新 session 加入 layer tree
  if (event.type === 'handoff.started' && event.sessionId) {
    const toRoleLayer = (event.payload['toRoleLayer'] as TeamRoleLayer) ?? 'executor';
    addNode({
      sessionId: event.sessionId,
      roleLayer: toRoleLayer,
      parentSessionId: null, // 前端可通过 REST 补全
      state: 'running',
    });
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
