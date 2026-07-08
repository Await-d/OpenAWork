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

export type TeamRoleLayer =
  | 'user'
  | 'reception'
  | 'pm1'
  | 'pm2'
  | 'executor'
  | 'tester'
  | 'reviewer';

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
  fromSessionId?: string;
  toSessionId?: string | null;
  paused?: boolean;
  sessionId?: string;
  /** 第一次进入 running/claimed 的时间戳（毫秒）。 */
  startedAt?: number;
  /** 进入终态（completed/failed/cancelled）的时间戳（毫秒）。 */
  endedAt?: number;
  /** 失败原因（若已失败）。 */
  failureReason?: string | null;
  /** 当前重试轮次。 */
  retryCount?: number;
  /** 后端判定的可恢复失败标记。 */
  recoverableFailure?: boolean;
  /** 该 handoff 的请求载荷摘要（来自事件 payload 的意图/下一步文案，可选）。 */
  summary?: string;
  updatedAt: number;
}

export interface LayerNode {
  sessionId: string;
  roleLayer: TeamRoleLayer;
  parentSessionId: string | null;
  state: HandoffState | 'idle';
  rootSessionId?: string;
  personaKey?: string | null;
  displayName?: string | null;
  title?: string;
  /** 细粒度子状态（如 drafting_spec、dispatching、reviewing 等），来自 WS 实时推送 */
  substate?: string | null;
  /** substate 最后更新时间戳，用于单调性守卫 */
  substateUpdatedAt?: number;
}

export type TeamEventsConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'reconnecting'
  | 'stopped';

interface TeamRuntimeSnapshotHandoffRecord {
  claimedAt?: string | null;
  completedAt?: string | null;
  failureReason?: string | null;
  fromRoleLayer: string;
  fromSessionId: string;
  id: string;
  /** 后端快照返回的持久化 payload（含 rewrittenIntent/goal 等），用于提取 summary */
  payload?: unknown;
  paused?: boolean;
  recoverableFailure?: boolean;
  retryCount?: number;
  startedAt?: string | null;
  state: string;
  toRoleLayer: string;
  toSessionId: string | null;
  updatedAt: string;
}

function normalizeSnapshotPayload(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  return Object.fromEntries(Object.entries(payload));
}

interface TeamRuntimeSnapshotSessionRecord {
  id: string;
  parentSessionId: string | null;
  roleInstance?: {
    rootSessionId: string;
    roleLayer: string;
    personaKey: string | null;
    displayName: string | null;
  };
  roleLayer: string | null;
  stateStatus: string;
  title: string | null;
}

// ─── Handoff Store ──────────────────────────────────────────────────────────

interface HandoffStoreState {
  handoffs: Map<string, HandoffEntry>;
  applyEvent: (event: HandoffEvent) => void;
  clear: () => void;
  replaceAll: (entries: HandoffEntry[]) => void;
}

/**
 * 从 handoff 事件 payload 中尽力提取一段"请求载荷摘要"用于跨层对话线程展示。
 * 优先级：goal > rewrittenIntent > sourceIntent > recommendedNextStep > summary。
 *
 * 注意：PM2 创建子 handoff 时将 DispatchPackage（含 goal 字段）作为 payload 传入，
 * 因此 goal 必须排在最前，否则所有 PM2→executor/reviewer 的任务都会回退到
 * "层级名 · id短码"的无意义显示。
 */
function extractHandoffSummary(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  for (const key of ['goal', 'rewrittenIntent', 'sourceIntent', 'recommendedNextStep', 'summary']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function extractAssignedMemberIdentity(
  payload: Record<string, unknown>,
): { id?: string; personaKey?: string; displayName?: string } | undefined {
  const assignedMember = payload['assignedMember'];
  if (
    typeof assignedMember !== 'object' ||
    assignedMember === null ||
    Array.isArray(assignedMember)
  ) {
    return undefined;
  }
  const record = assignedMember as Record<string, unknown>;
  const id = typeof record['id'] === 'string' && record['id'].trim() ? record['id'].trim() : null;
  const personaKey =
    typeof record['personaKey'] === 'string' && record['personaKey'].trim()
      ? record['personaKey'].trim()
      : null;
  const displayName =
    typeof record['displayName'] === 'string' && record['displayName'].trim()
      ? record['displayName'].trim()
      : null;
  if (!id && !personaKey && !displayName) {
    return undefined;
  }
  return {
    ...(id ? { id } : {}),
    ...(personaKey ? { personaKey } : {}),
    ...(displayName ? { displayName } : {}),
  };
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

      // #9 事件单调性守卫：WS 投递不保证顺序，断连补发 / 网络抖动都可能让一条
      // **较旧**的事件（timestamp 更小）在较新事件之后到达。若无脑覆盖，会把
      // handoff 从 completed 回退成 running（甚至闪回 pending），让前端进度条
      // 倒退、终态丢失。这里只接受 timestamp >= 已记录 updatedAt 的事件；旧事件
      // 直接丢弃。注意 handoff 可合法地 running→pending（retry/recovery），但
      // 那条 retry 事件带的是**更新**的时间戳，仍会被正常接受，不受影响。
      const isExistingEntry = next.has(event.taskId!);
      if (isExistingEntry && event.timestamp < existing.updatedAt) {
        return state;
      }

      const newState = (event.payload['state'] as HandoffState) ?? existing.state;
      const nextFromSessionId =
        typeof event.payload['fromSessionId'] === 'string' &&
        event.payload['fromSessionId'].length > 0
          ? event.payload['fromSessionId']
          : existing.fromSessionId;
      const nextToSessionId =
        typeof event.payload['toSessionId'] === 'string'
          ? event.payload['toSessionId']
          : event.payload['toSessionId'] === null
            ? null
            : event.sessionId && event.sessionId !== nextFromSessionId
              ? event.sessionId
              : existing.toSessionId;
      const nextPaused =
        typeof event.payload['paused'] === 'boolean' ? event.payload['paused'] : existing.paused;
      const nextFailureReason =
        typeof event.payload['reason'] === 'string'
          ? event.payload['reason']
          : existing.failureReason;
      const nextRetryCount =
        typeof event.payload['retryCount'] === 'number'
          ? event.payload['retryCount']
          : existing.retryCount;
      const nextRecoverableFailure =
        typeof event.payload['recoverableFailure'] === 'boolean'
          ? event.payload['recoverableFailure']
          : existing.recoverableFailure;

      // 派生 startedAt：第一次进入 running/claimed 时记录
      const isStartingNow =
        (newState === 'running' || newState === 'claimed') && existing.startedAt === undefined;

      // 派生 endedAt：进入终态时记录
      const isEndingNow =
        (newState === 'completed' || newState === 'failed' || newState === 'cancelled') &&
        existing.endedAt === undefined;

      // 请求载荷摘要：从事件 payload 尽力提取（首次出现即固定，不被后续覆盖）。
      const incomingSummary = extractHandoffSummary(event.payload);

      next.set(event.taskId!, {
        ...existing,
        ...(nextFromSessionId ? { fromSessionId: nextFromSessionId } : {}),
        ...(nextToSessionId !== undefined ? { toSessionId: nextToSessionId } : {}),
        ...(nextPaused !== undefined ? { paused: nextPaused } : {}),
        state: newState,
        sessionId: nextToSessionId ?? event.sessionId ?? existing.sessionId,
        updatedAt: event.timestamp,
        ...(isStartingNow ? { startedAt: event.timestamp } : {}),
        ...(isEndingNow ? { endedAt: event.timestamp } : {}),
        ...(nextFailureReason !== undefined ? { failureReason: nextFailureReason } : {}),
        ...(nextRetryCount !== undefined ? { retryCount: nextRetryCount } : {}),
        ...(nextRecoverableFailure !== undefined
          ? { recoverableFailure: nextRecoverableFailure }
          : {}),
        ...(existing.summary === undefined && incomingSummary ? { summary: incomingSummary } : {}),
      });
      return { handoffs: next };
    });
  },
  replaceAll: (entries) =>
    set(() => ({
      handoffs: new Map(entries.map((entry) => [entry.id, entry])),
    })),
  clear: () => set({ handoffs: new Map() }),
}));

// ─── Layer Store ────────────────────────────────────────────────────────────

interface LayerStoreState {
  nodes: Map<string, LayerNode>;
  addNode: (node: LayerNode) => void;
  updateNodeState: (sessionId: string, state: HandoffState | 'idle') => void;
  updateNodeSubstate: (sessionId: string, substate: string | null, timestamp: number) => void;
  clear: () => void;
  replaceAll: (nodes: LayerNode[]) => void;
}

export const useLayerStore = create<LayerStoreState>((set) => ({
  nodes: new Map(),
  addNode: (node) =>
    set((state) => {
      const next = new Map(state.nodes);
      const existing = next.get(node.sessionId);
      next.set(node.sessionId, existing ? { ...existing, ...node } : node);
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
  updateNodeSubstate: (sessionId, substate, timestamp) =>
    set((state) => {
      const next = new Map(state.nodes);
      const existing = next.get(sessionId);
      if (existing) {
        // 单调性守卫：忽略比当前更旧的 substate 更新
        if (existing.substateUpdatedAt && timestamp < existing.substateUpdatedAt) {
          return state;
        }
        next.set(sessionId, {
          ...existing,
          substate,
          substateUpdatedAt: timestamp,
        });
      }
      return { nodes: next };
    }),
  replaceAll: (nodes) =>
    set(() => ({
      nodes: new Map(nodes.map((node) => [node.sessionId, node])),
    })),
  clear: () => set({ nodes: new Map() }),
}));

// ─── Notification Store ─────────────────────────────────────────────────────

interface TeamNotificationStoreState {
  events: HandoffEvent[];
  mergeRuntime: (events: HandoffEvent[]) => void;
  markEventRead: (eventKey: string) => void;
  markEventUnread: (eventKey: string) => void;
  readEventKeys: Set<string>;
  unreadCount: number;
  push: (event: HandoffEvent) => void;
  markAllRead: () => void;
  clear: () => void;
}

export function getTeamNotificationEventKey(event: HandoffEvent): string {
  const payloadMessageId =
    typeof event.payload['messageId'] === 'string' ? event.payload['messageId'] : '';
  return [
    event.type,
    payloadMessageId,
    event.taskId ?? '',
    event.sessionId ?? '',
    String(event.timestamp),
    typeof event.payload['summary'] === 'string' ? event.payload['summary'] : '',
  ].join('|');
}

function appendNotificationEvents(
  state: Pick<TeamNotificationStoreState, 'events' | 'readEventKeys' | 'unreadCount'>,
  incoming: HandoffEvent[],
): Pick<TeamNotificationStoreState, 'events' | 'readEventKeys' | 'unreadCount'> {
  const seen = new Set(state.events.map(getTeamNotificationEventKey));
  const additions = incoming.filter((event) => {
    const key = getTeamNotificationEventKey(event);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  if (additions.length === 0) {
    return state;
  }
  const unreadDelta = additions.filter(
    (event) => !state.readEventKeys.has(getTeamNotificationEventKey(event)),
  ).length;
  const merged = [...state.events, ...additions]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-100);
  // Bound `readEventKeys` to the keys still present after the 100-event slice.
  // Otherwise, on a long-lived team page, keys for events that scrolled out of
  // the window accumulate forever (the Set never shrinks) — an unbounded
  // frontend memory leak in the same family as the backend dedupe-map sweeps.
  // Recomputing `unreadCount` from the surviving buffer (events whose key is
  // not in the pruned read set) matches `markEventRead`'s own definition and
  // also fixes the latent count drift when an unread event is evicted.
  const survivingKeys = new Set(merged.map(getTeamNotificationEventKey));
  // Prune read-keys whose event scrolled out of the buffer. Gate on membership,
  // not relative size: stale keys can exist even when `readEventKeys` is smaller
  // than the surviving-event count (e.g. 60 read keys vs 100 fresh unread events),
  // so a size-based guard would silently skip the prune and leak.
  let prunedReadEventKeys = state.readEventKeys;
  if (state.readEventKeys.size > 0) {
    let changed = false;
    const next = new Set<string>();
    for (const key of state.readEventKeys) {
      if (survivingKeys.has(key)) {
        next.add(key);
      } else {
        changed = true;
      }
    }
    if (changed) {
      prunedReadEventKeys = next;
    }
  }
  const unreadCount = merged.reduce(
    (count, event) => count + (prunedReadEventKeys.has(getTeamNotificationEventKey(event)) ? 0 : 1),
    0,
  );
  return {
    events: merged,
    readEventKeys: prunedReadEventKeys,
    unreadCount,
  };
}

export const useTeamNotificationStore = create<TeamNotificationStoreState>((set) => ({
  events: [],
  mergeRuntime: (events) =>
    set((state) => {
      if (events.length === 0) {
        return state;
      }
      const next = appendNotificationEvents(state, events);
      return {
        events: next.events,
        readEventKeys: next.readEventKeys,
        unreadCount: next.unreadCount,
      };
    }),
  markEventRead: (eventKey) =>
    set((state) => {
      if (state.readEventKeys.has(eventKey)) {
        return state;
      }
      const readEventKeys = new Set(state.readEventKeys);
      readEventKeys.add(eventKey);
      const unreadCount = state.events.reduce(
        (count, event) => count + (readEventKeys.has(getTeamNotificationEventKey(event)) ? 0 : 1),
        0,
      );
      return {
        readEventKeys,
        unreadCount,
      };
    }),
  markEventUnread: (eventKey) =>
    set((state) => {
      if (!state.readEventKeys.has(eventKey)) {
        return state;
      }
      const readEventKeys = new Set(state.readEventKeys);
      readEventKeys.delete(eventKey);
      const unreadCount = state.events.reduce(
        (count, event) => count + (readEventKeys.has(getTeamNotificationEventKey(event)) ? 0 : 1),
        0,
      );
      return {
        readEventKeys,
        unreadCount,
      };
    }),
  readEventKeys: new Set<string>(),
  unreadCount: 0,
  push: (event) =>
    set((state) => {
      const next = appendNotificationEvents(state, [event]);
      return {
        events: next.events,
        readEventKeys: next.readEventKeys,
        unreadCount: next.unreadCount,
      };
    }),
  markAllRead: () =>
    set((state) => ({
      readEventKeys: new Set(state.events.map(getTeamNotificationEventKey)),
      unreadCount: 0,
    })),
  clear: () => set({ events: [], readEventKeys: new Set<string>(), unreadCount: 0 }),
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
  replaceFromRuntime: (items: ClarificationItem[]) => void;
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
  replaceFromRuntime: (items) =>
    set((state) => {
      const runtimeById = new Map(items.map((item) => [item.id, item]));
      const merged = [...items];
      for (const existing of state.items) {
        const runtimeItem = runtimeById.get(existing.id);
        if (!runtimeItem) {
          if (existing.status === 'answered' || existing.status === 'dismissed') {
            merged.push(existing);
          }
          continue;
        }
        if (
          (existing.status === 'answered' || existing.status === 'dismissed') &&
          runtimeItem.status === 'pending'
        ) {
          const index = merged.findIndex((item) => item.id === existing.id);
          if (index >= 0) {
            merged[index] = existing;
          }
        }
      }
      return {
        items: merged,
        pendingCount: merged.filter((item) => item.status === 'pending').length,
      };
    }),
  clear: () => set({ items: [], pendingCount: 0 }),
}));

// ─── Connection Store ──────────────────────────────────────────────────────

interface TeamEventsConnectionStoreState {
  lastCloseCode: number | null;
  lastError: string | null;
  lastOpenAt: number | null;
  lastProtocolErrorCode: string | null;
  lastRecoveredAt: number | null;
  nextRetryAt: number | null;
  reconnectAttempt: number;
  setSnapshot: (input: Partial<Omit<TeamEventsConnectionStoreState, 'setSnapshot'>>) => void;
  state: TeamEventsConnectionState;
}

export const useTeamEventsConnectionStore = create<TeamEventsConnectionStoreState>((set) => ({
  lastCloseCode: null,
  lastError: null,
  lastOpenAt: null,
  lastProtocolErrorCode: null,
  lastRecoveredAt: null,
  nextRetryAt: null,
  reconnectAttempt: 0,
  setSnapshot: (input) =>
    set((state) => ({
      ...state,
      ...input,
    })),
  state: 'idle',
}));

// ─── Event Dispatcher ───────────────────────────────────────────────────────

export function dispatchTeamEvent(event: HandoffEvent): void {
  const { applyEvent } = useHandoffStore.getState();
  const { addNode, updateNodeState, updateNodeSubstate } = useLayerStore.getState();
  const { push } = useTeamNotificationStore.getState();
  const { push: pushClarifications } = useClarificationStore.getState();

  // 后端 stream-team-events.ts 通过 __teamEventKind 标记区分事件类型。
  const teamEventKind = event.payload?.['__teamEventKind'] as string | undefined;

  // 指标遥测事件（team_usage / team_tool_call / team_timing）复用了
  // `type: 'session.substate.changed'` 作为信封类型，但它们是纯度量数据，
  // 只应路由到 usage / tool-call store。绝不能进 handoff / notification store：
  //   - 进 notification → "待回复"列表被大量"阶段更新"噪声刷屏（即截图里看到的
  //     重复 session.substate.changed 行），且每条都触发会话 reload 风暴。
  //   - 进 handoff store → applyEvent 因无 taskId 直接 return，本就无副作用，
  //     但显式短路更清晰。
  const isTelemetryEvent =
    teamEventKind === 'team_usage' ||
    teamEventKind === 'team_tool_call' ||
    teamEventKind === 'team_timing';

  if (!isTelemetryEvent) {
    // handoff.* 与 scheduler.task-* 都承载 handoff 状态/paused 位变化，
    // 必须进入 handoff store。否则 pause/resume 只能等下一轮 snapshot 才可见，
    // 页面会表现为"不实时"。
    if (
      event.type.startsWith('handoff.') ||
      event.type === 'scheduler.task-paused' ||
      event.type === 'scheduler.task-resumed'
    ) {
      applyEvent(event);
    }
    push(event);
  }

  // 单独分发 [NEEDS CLARIFICATION]
  if (event.type === 'artifact.needs-clarification') {
    pushClarifications(event);
  }

  // 当 handoff started 时，把新 session 加入 layer tree
  if (event.type === 'handoff.started' && event.sessionId) {
    const toRoleLayer = (event.payload['toRoleLayer'] as TeamRoleLayer) ?? 'executor';
    const fromSessionId = (event.payload['fromSessionId'] as string) ?? null;
    const assignedMember = extractAssignedMemberIdentity(event.payload);
    addNode({
      sessionId: event.sessionId,
      roleLayer: toRoleLayer,
      parentSessionId: fromSessionId,
      state: 'running',
      ...(assignedMember?.personaKey ? { personaKey: assignedMember.personaKey } : {}),
      ...(assignedMember?.displayName || assignedMember?.id
        ? { displayName: assignedMember.displayName ?? assignedMember.id }
        : {}),
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

  if (
    (event.type === 'scheduler.task-paused' || event.type === 'scheduler.task-resumed') &&
    event.sessionId
  ) {
    const nextState =
      event.type === 'scheduler.task-paused'
        ? 'claimed'
        : normalizeLayerNodeState((event.payload['state'] as string | undefined) ?? 'running');
    updateNodeState(event.sessionId, nextState);
  }

  // ─── substate 实时更新 ──────────────────────────────────────────────
  // 后端每次 setSubstate 都会推送 session.substate.changed 事件。
  // 直接更新 layer store 中的 substate 字段，无需等待 HTTP reload，
  // 让进度条（TeamSubstateProgressBar）能实时更新。
  if (event.type === 'session.substate.changed' && !isTelemetryEvent && event.sessionId) {
    const substate = (event.payload['substate'] as string | null | undefined) ?? null;
    const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
    updateNodeSubstate(event.sessionId, substate, ts);
  }

  // ─── handoff.created：提前将新 session 加入 layer tree ──────────────
  // 不等 handoff.started，在 created 阶段就添加节点（状态为 pending），
  // 让 useMultiSessionAttach 尽早建立 SSE 连接，减少流式事件丢失窗口。
  if (event.type === 'handoff.created' && event.sessionId) {
    const toRoleLayer = (event.payload['toRoleLayer'] as TeamRoleLayer) ?? 'executor';
    const fromSessionId = (event.payload['fromSessionId'] as string) ?? null;
    // 只在节点不存在时添加（避免覆盖已 started 的节点状态）
    if (!useLayerStore.getState().nodes.has(event.sessionId)) {
      addNode({
        sessionId: event.sessionId,
        roleLayer: toRoleLayer,
        parentSessionId: fromSessionId,
        state: 'pending',
      });
    }
  }

  // ─── handoff.reclaimed：将状态回退到 pending ────────────────────────
  // 崩溃恢复时 handoff 被回收重试，前端节点状态应回退，
  // 让用户看到进度条回退而非停留在旧的 running 状态。
  if (event.type === 'handoff.reclaimed' && event.sessionId) {
    updateNodeState(event.sessionId, 'pending');
    // 清除 substate，让进度条重置
    updateNodeSubstate(event.sessionId, null, Date.now());
  }

  // ─── Team tabs data: usage / tool_call / timing 事件路由 ─────────────
  // 按 kind 分发到对应 zustand store（telemetry 事件已在上方从 notification /
  // handoff store 中排除，这里只做度量聚合）。
  if (teamEventKind === 'team_usage') {
    const { applyUsageEvent } = useTeamUsageStore.getState();
    const usageSessionId = (event.payload['sessionId'] as string) ?? event.sessionId ?? undefined;
    // layer 归属：优先用事件显式 layer，否则由 session→roleLayer 映射推导。
    const explicitLayer = (event.payload['layer'] as string) ?? event.layer ?? undefined;
    const derivedLayer =
      explicitLayer ??
      (usageSessionId ? useLayerStore.getState().nodes.get(usageSessionId)?.roleLayer : undefined);
    applyUsageEvent({
      agentId: (event.payload['agentId'] as string) ?? undefined,
      sessionId: usageSessionId,
      ...(derivedLayer ? { layer: derivedLayer } : {}),
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
    const toolSessionId = (event.payload['sessionId'] as string) ?? event.sessionId ?? undefined;
    const explicitLayer = (event.payload['layer'] as string) ?? event.layer ?? undefined;
    const derivedLayer =
      explicitLayer ??
      (toolSessionId ? useLayerStore.getState().nodes.get(toolSessionId)?.roleLayer : undefined);
    applyToolCallEvent({
      agentId: (event.payload['agentId'] as string) ?? undefined,
      ...(derivedLayer ? { layer: derivedLayer } : {}),
      sessionId: toolSessionId,
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

function parseTimestampMs(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTeamRoleLayer(value: string | null | undefined): TeamRoleLayer {
  switch (value) {
    case 'user':
    case 'reception':
    case 'pm1':
    case 'pm2':
    case 'executor':
    case 'tester':
    case 'reviewer':
      return value;
    default:
      return 'reception';
  }
}

function normalizeLayerNodeState(value: string | null | undefined): HandoffState | 'idle' {
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

export function hydrateTeamRuntimeStores(input: {
  handoffs: TeamRuntimeSnapshotHandoffRecord[];
  sessions: TeamRuntimeSnapshotSessionRecord[];
}): void {
  useHandoffStore.getState().replaceAll(
    input.handoffs.map((record) => {
      const updatedAt = parseTimestampMs(record.updatedAt) ?? Date.now();
      // 从快照 payload 提取 summary，使刷新后任务清单仍能显示有意义的标题
      const snapshotPayload = normalizeSnapshotPayload(record.payload);
      const summaryFromSnapshot = snapshotPayload
        ? extractHandoffSummary(snapshotPayload)
        : undefined;
      return {
        ...(parseTimestampMs(record.completedAt)
          ? { endedAt: parseTimestampMs(record.completedAt) }
          : normalizeLayerNodeState(record.state) !== 'running' &&
              normalizeLayerNodeState(record.state) !== 'claimed' &&
              normalizeLayerNodeState(record.state) !== 'pending'
            ? { endedAt: updatedAt }
            : {}),
        fromSessionId: record.fromSessionId,
        id: record.id,
        fromRoleLayer: normalizeTeamRoleLayer(record.fromRoleLayer),
        ...(typeof record.paused === 'boolean' ? { paused: record.paused } : {}),
        sessionId: record.toSessionId ?? record.fromSessionId,
        startedAt: parseTimestampMs(record.startedAt) ?? parseTimestampMs(record.claimedAt),
        state: normalizeLayerNodeState(record.state) as HandoffState,
        toSessionId: record.toSessionId,
        toRoleLayer: normalizeTeamRoleLayer(record.toRoleLayer),
        ...(record.failureReason !== undefined ? { failureReason: record.failureReason } : {}),
        ...(typeof record.retryCount === 'number' ? { retryCount: record.retryCount } : {}),
        ...(typeof record.recoverableFailure === 'boolean'
          ? { recoverableFailure: record.recoverableFailure }
          : {}),
        ...(summaryFromSnapshot ? { summary: summaryFromSnapshot } : {}),
        updatedAt,
      };
    }),
  );

  useLayerStore.getState().replaceAll(
    input.sessions.map((session) => ({
      parentSessionId: session.parentSessionId,
      roleLayer: normalizeTeamRoleLayer(session.roleLayer),
      sessionId: session.id,
      state: normalizeLayerNodeState(session.stateStatus),
      ...(session.roleInstance?.rootSessionId
        ? { rootSessionId: session.roleInstance.rootSessionId }
        : {}),
      ...(session.roleInstance?.personaKey ? { personaKey: session.roleInstance.personaKey } : {}),
      ...(session.roleInstance?.displayName
        ? { displayName: session.roleInstance.displayName }
        : {}),
      ...(session.title ? { title: session.title } : {}),
    })),
  );
}

export function hydrateClarificationStore(
  items: Array<{
    answer?: string;
    answeredAt?: number;
    context: string;
    createdAt: number;
    fromSessionId: string;
    id: string;
    question: string;
    sessionId: string;
    status: ClarificationStatus;
  }>,
): void {
  useClarificationStore.getState().replaceFromRuntime(
    items.map((item) => ({
      ...item,
      ...(item.answer ? { answer: item.answer } : {}),
      ...(typeof item.answeredAt === 'number' ? { answeredAt: item.answeredAt } : {}),
    })),
  );
}

export function hydrateNotificationStore(
  events: Array<{
    layer?: string;
    payload: Record<string, unknown>;
    sessionId?: string;
    taskId?: string;
    timestamp: number;
    type: string;
  }>,
): void {
  useTeamNotificationStore.getState().mergeRuntime(
    events.map((event) => ({
      payload: event.payload,
      timestamp: event.timestamp,
      type: event.type,
      ...(event.layer ? { layer: normalizeTeamRoleLayer(event.layer) } : {}),
      ...(event.sessionId ? { sessionId: event.sessionId } : {}),
      ...(event.taskId ? { taskId: event.taskId } : {}),
    })),
  );
}

// ─── WS Connection Hook ─────────────────────────────────────────────────────

let wsInstance: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnect = false;
let lastProtocolErrorCode: string | null = null;
// §0.150 client-side liveness watchdog state. The gateway pings at the
// PROTOCOL level (browsers auto-answer those and never surface them to JS)
// and idle-closes after 45s, but a half-open socket (server crash / network
// partition with no TCP FIN) leaves the browser socket OPEN indefinitely:
// `onmessage`/`onclose` never fire, reconnect never triggers, and the team
// UI silently freezes on stale state while still showing "connected". This
// app-level probe sends `{type:'ping'}` (which the gateway answers with
// `pong`) and tears the socket down once the server has gone silent past a
// tolerance window, handing recovery to the normal onclose backoff path.
let livenessTimer: ReturnType<typeof setInterval> | null = null;
let lastServerActivityAt = 0;

const TEAM_EVENTS_RECONNECT_BASE_MS = 2_000;
const TEAM_EVENTS_RECONNECT_MAX_MS = 30_000;

/** Client-side application ping cadence (keeps the half-open detector primed
 * and also refreshes the gateway's own 45s idle timer). */
const TEAM_EVENTS_CLIENT_PING_INTERVAL_MS = 15_000;
/** Tolerance window: if NOTHING (team event, the initial `connected`, or a
 * `pong`) arrives from the server within this span, the socket is presumed
 * half-open and torn down. Must exceed 2 ping intervals so a single dropped
 * pong doesn't cause a spurious reconnect, yet stay well under the OS TCP
 * timeout (minutes) that the browser would otherwise wait on. */
const TEAM_EVENTS_CLIENT_LIVENESS_TIMEOUT_MS = 40_000;

/**
 * Pure decision for one liveness-probe tick. `ping` keeps the connection
 * primed; `reconnect` means the server has gone silent past the tolerance
 * window, so the caller must tear the socket down and let onclose reconnect.
 */
export function resolveTeamEventsLivenessAction(input: {
  msSinceLastServerActivity: number;
  livenessTimeoutMs?: number;
}): 'ping' | 'reconnect' {
  const timeout = input.livenessTimeoutMs ?? TEAM_EVENTS_CLIENT_LIVENESS_TIMEOUT_MS;
  return input.msSinceLastServerActivity > timeout ? 'reconnect' : 'ping';
}

function stopTeamEventsLivenessProbe(): void {
  if (livenessTimer) {
    clearInterval(livenessTimer);
    livenessTimer = null;
  }
}

function startTeamEventsLivenessProbe(ws: WebSocket): void {
  stopTeamEventsLivenessProbe();
  livenessTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const action = resolveTeamEventsLivenessAction({
      msSinceLastServerActivity: Date.now() - lastServerActivityAt,
    });
    if (action === 'reconnect') {
      // Server silent past tolerance → presume half-open. Closing triggers
      // the onclose handler, which runs the normal backoff-reconnect path.
      stopTeamEventsLivenessProbe();
      try {
        ws.close();
      } catch {
        /* already closing/closed */
      }
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch {
      // send threw (socket died between the readyState check and here) →
      // tear down so onclose can reconnect.
      stopTeamEventsLivenessProbe();
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }, TEAM_EVENTS_CLIENT_PING_INTERVAL_MS);
}

export function computeTeamEventsReconnectDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(TEAM_EVENTS_RECONNECT_BASE_MS * 2 ** safeAttempt, TEAM_EVENTS_RECONNECT_MAX_MS);
}

export function resolveTeamEventsCloseStrategy(input: {
  closeCode: number;
  lastErrorCode?: string | null;
  manualDisconnect: boolean;
  online: boolean;
}): {
  lastError: string | null;
  shouldReconnect: boolean;
  state: TeamEventsConnectionState;
} {
  if (input.manualDisconnect) {
    return {
      lastError: null,
      shouldReconnect: false,
      state: 'stopped',
    };
  }

  if (input.lastErrorCode === 'UNAUTHORIZED' || input.closeCode === 1008) {
    return {
      lastError: 'team-events 认证失效，请重新登录后再连接。',
      shouldReconnect: false,
      state: 'stopped',
    };
  }

  if (!input.online) {
    return {
      lastError: '当前网络离线，等待网络恢复。',
      shouldReconnect: true,
      state: 'offline',
    };
  }

  return {
    lastError: input.closeCode === 1001 ? 'team-events 空闲超时，准备自动重连。' : null,
    shouldReconnect: true,
    state: 'reconnecting',
  };
}

export function connectTeamEvents(gatewayUrl: string, token: string): void {
  if (wsInstance && wsInstance.readyState <= WebSocket.OPEN) {
    return;
  }
  manualDisconnect = false;
  const setConnection = useTeamEventsConnectionStore.getState().setSnapshot;
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isOffline) {
    setConnection({
      lastError: '当前网络离线，等待恢复后重连。',
      nextRetryAt: null,
      state: 'offline',
    });
    return;
  }
  const currentAttempt = useTeamEventsConnectionStore.getState().reconnectAttempt;
  setConnection({
    lastError: null,
    nextRetryAt: null,
    state: currentAttempt > 0 ? 'reconnecting' : 'connecting',
  });
  const wsUrl =
    gatewayUrl.replace(/^http/, 'ws') + `/team-events?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    lastProtocolErrorCode = null;
    const openedAt = Date.now();
    lastServerActivityAt = openedAt;
    startTeamEventsLivenessProbe(ws);
    useTeamEventsConnectionStore.getState().setSnapshot({
      lastCloseCode: null,
      lastError: null,
      lastOpenAt: openedAt,
      lastProtocolErrorCode: null,
      lastRecoveredAt: currentAttempt > 0 ? openedAt : null,
      nextRetryAt: null,
      reconnectAttempt: 0,
      state: 'connected',
    });
  };

  ws.onmessage = (msg) => {
    // Any frame (team event, the initial `connected`, or a `pong` answer to
    // our liveness ping) proves the server is alive — refresh the watchdog.
    lastServerActivityAt = Date.now();
    try {
      const event = JSON.parse(msg.data as string) as HandoffEvent;
      if ((event as { type?: string; code?: string; message?: string }).type === 'error') {
        lastProtocolErrorCode = (event as { code?: string }).code ?? null;
        useTeamEventsConnectionStore.getState().setSnapshot({
          lastProtocolErrorCode: lastProtocolErrorCode,
          lastError:
            (event as { message?: string }).message ??
            (event as { code?: string }).code ??
            'team-events error',
        });
        return;
      }
      if (event.type && event.type !== 'connected' && event.type !== 'pong') {
        dispatchTeamEvent(event);
      }
    } catch (_err) {
      void _err;
      // 忽略非法 JSON
    }
  };

  ws.onclose = (event) => {
    wsInstance = null;
    stopTeamEventsLivenessProbe();
    const strategy = resolveTeamEventsCloseStrategy({
      closeCode: event.code,
      lastErrorCode: lastProtocolErrorCode,
      manualDisconnect,
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    });
    lastProtocolErrorCode = null;
    if (!strategy.shouldReconnect) {
      useTeamEventsConnectionStore.getState().setSnapshot({
        lastCloseCode: event.code,
        lastError: strategy.lastError,
        lastProtocolErrorCode: lastProtocolErrorCode,
        lastRecoveredAt: null,
        nextRetryAt: null,
        reconnectAttempt: 0,
        state: strategy.state,
      });
      return;
    }
    const attempt = useTeamEventsConnectionStore.getState().reconnectAttempt + 1;
    const delay = computeTeamEventsReconnectDelay(attempt - 1);
    const nextRetryAt = Date.now() + delay;
    useTeamEventsConnectionStore.getState().setSnapshot({
      lastCloseCode: event.code,
      ...(strategy.lastError ? { lastError: strategy.lastError } : {}),
      lastProtocolErrorCode: lastProtocolErrorCode,
      lastRecoveredAt: null,
      nextRetryAt,
      reconnectAttempt: attempt,
      state: strategy.state,
    });
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectTeamEvents(gatewayUrl, token);
      }, delay);
    }
  };

  ws.onerror = () => {
    useTeamEventsConnectionStore.getState().setSnapshot({
      lastError: 'team-events 连接异常，准备重连。',
    });
    ws.close();
  };

  const handleOnline = () => {
    if (manualDisconnect) return;
    if (!wsInstance || wsInstance.readyState > WebSocket.OPEN) {
      connectTeamEvents(gatewayUrl, token);
    }
  };
  const handleOffline = () => {
    useTeamEventsConnectionStore.getState().setSnapshot({
      lastError: '当前网络离线，等待网络恢复。',
      lastRecoveredAt: null,
      state: 'offline',
    });
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    ws.addEventListener('close', () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
  }

  wsInstance = ws;
}

export function disconnectTeamEvents(): void {
  manualDisconnect = true;
  lastProtocolErrorCode = null;
  stopTeamEventsLivenessProbe();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsInstance) {
    wsInstance.close();
    wsInstance = null;
  }
  useTeamEventsConnectionStore.getState().setSnapshot({
    lastCloseCode: null,
    lastProtocolErrorCode: null,
    lastRecoveredAt: null,
    nextRetryAt: null,
    reconnectAttempt: 0,
    state: 'stopped',
  });
}
