/**
 * team-layer-messages · 团队右侧面板的「角色实例消息组」数据契约
 *
 * 一个 LayerMessages 条目 = 一个角色实例（一个 session），不是一层。
 * 团队里同一层可以有多个并发实例（如执行层的「前端开发者」「后端开发者」），
 * 它们的对话上下文彼此独立，因此分发到 UI 时必须各自成组，禁止按 roleLayer 合并。
 *
 * 层级（layer）只是这个条目的分类标签；实例之间的上下关系由
 * sourceLayer / sourceDisplayName 表达 —— 它们指向该实例的上游角色实例。
 *
 * 本类型此前定义在 TeamMultiLayerPanel.tsx 内。右侧面板改为「角色窗口墙」后，
 * 旧的 tab / waterfall / timeline 视图整体下线，类型因此独立成文件，作为唯一归属。
 */

import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type { HandoffEntry, HandoffState, LayerNode } from '../../../../stores/team/team-events.js';

/**
 * 角色实例的生命周期。
 *
 * `idle` 表示「没有运行时记录」（例如只有快照、从未派发过 handoff 的实例）。
 * 三个终态 `completed / failed / cancelled` 表示该实例已经结束或关闭 ——
 * **卡片不得因此消失**，必须保留并切换到「已结束」展示态，用户仍要能展开回看它的完整对话。
 */
export type InstanceLifecycle = HandoffState | 'idle';

/** 判断是否终态。用作类型谓词，便于调用处收窄联合类型。 */
export function isTerminalLifecycle(
  value: InstanceLifecycle | null | undefined,
): value is 'completed' | 'failed' | 'cancelled' {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}

export interface LayerMessages {
  /** 该角色实例所属层级（reception / pm1 / pm2 / executor / tester / reviewer）。 */
  layer: string;
  /** 该实例的完整消息列表。 */
  messages: ChatMessage[];
  /** 该实例对应的 session id（通常只有一个）。 */
  sessionIds: string[];
  /** 是否为当前用户正在查看的主会话。 */
  isActive: boolean;
  /** 该层角色实例的显示名称（如「前端开发者」），同层多实例时各自取值。 */
  displayName?: string | null;
  /** 上游实例所属层级 —— 表达层级对话的上下关系。 */
  sourceLayer?: string | null;
  /** 上游实例显示名称。 */
  sourceDisplayName?: string | null;
  /**
   * 当前正在流式生成的消息（仅活跃实例在流式时存在）。
   * 前端通过 attach/startStream 接收 text_delta 实时累积的内容，
   * 在面板中以「正在输入」样式渲染，流式结束后被正式 messages 条目取代。
   */
  streamingMessage?: ChatMessage | null;
  /**
   * 该实例的生命周期状态。终态表示实例已结束/关闭，卡片要切到「已结束」展示态。
   *
   * 数据来源有两条，且**必须优先取 handoff 记录**：
   * `sessions.state_status` 只有 idle / running / paused，一个回合跑完就回落到 `idle`，
   * 它根本表达不了「结束」；只有 handoff 记录会持久化 completed / failed / cancelled，
   * 刷新后仍然可靠（见 hydrateTeamRuntimeStores）。
   */
  lifecycle?: InstanceLifecycle | null;
  /** 实例进入终态的时间戳（毫秒）。仅终态存在。 */
  endedAt?: number | null;
  /** 终态失败原因（failed 时存在）。 */
  failureReason?: string | null;
}

// ─── 生命周期装配（从 handoff 记录 + layer node 推导）────────────────────
//
// 抽成纯函数而不是留在 TeamConversationView 的 useMemo 里，是因为这段逻辑
// 有两个反直觉的坑（归属不能用 sessionId、必须取最近一条 handoff），
// 埋在视图层的闭包里就只能靠端到端测试碰运气。

/** 一个实例的最近一条 handoff 摘要。 */
export interface LatestHandoffSummary {
  state: HandoffState;
  endedAt: number | null;
  failureReason: string | null;
  updatedAt: number;
}

/** 一个实例的生命周期快照。 */
export interface InstanceLifecycleSnapshot {
  lifecycle: InstanceLifecycle;
  endedAt: number | null;
  failureReason: string | null;
}

/**
 * 按**目标实例**归并 handoff 记录，每个实例只保留最近一条。
 *
 * ⚠️ 归属只能用 `toSessionId`，**不能**回落成 `HandoffEntry.sessionId`。
 * 后者（无论来自 WS 事件还是快照 hydration）都是 `toSessionId ?? fromSessionId`：
 * 对一条「排队中就被取消 / 失败」的 handoff（`toSessionId` 仍为 null），它会等于
 * **fromSessionId** —— 也就是上游会话。而 reception→pm1 的 `fromRoleLayer` 恒为
 * reception，一旦照单全收，一条「接待层派给 PM1、还没被认领就被取消」的 handoff
 * 就会把**接待层根会话**标成「已取消」，主会话头上凭空长出一个终态标识条。
 * 生命周期描述的是目标实例；没有目标 session 的 handoff 不描述任何实例。
 */
export function buildLatestHandoffBySession(
  handoffs: Iterable<HandoffEntry>,
): Map<string, LatestHandoffSummary> {
  const latest = new Map<string, LatestHandoffSummary>();
  for (const handoff of handoffs) {
    const ownerSessionId = handoff.toSessionId;
    if (!ownerSessionId) {
      continue;
    }
    const existing = latest.get(ownerSessionId);
    if (existing && existing.updatedAt >= handoff.updatedAt) {
      continue;
    }
    latest.set(ownerSessionId, {
      state: handoff.state,
      endedAt: handoff.endedAt ?? null,
      failureReason: handoff.failureReason ?? null,
      updatedAt: handoff.updatedAt,
    });
  }
  return latest;
}

/**
 * 解析某个实例的生命周期。
 *
 * 为什么必须同时看两个数据源：
 *   - `sessions.state_status` 只有 idle / running / paused，一个回合跑完就回落
 *     'idle'，它根本表达不了「结束」；刷新后 layer node 只剩 'idle'，终态信息丢光。
 *   - handoff 记录持久化了 completed / failed / cancelled（含 completedAt 与
 *     failureReason），刷新后仍可靠，是判定「结束」的权威来源。
 *
 * 但一个实例可能有多条 handoff（被回收重试：running → pending → running），
 * 所以只有**最近一条**是终态时才算结束；否则回落到 layer node 的实时状态，
 * 避免把「正在重试」的实例误标成「已完成」。
 */
export function resolveInstanceLifecycle(input: {
  ownerSessionId: string;
  latestHandoffBySession: ReadonlyMap<string, LatestHandoffSummary>;
  layerNodes: ReadonlyMap<string, Pick<LayerNode, 'state'>>;
}): InstanceLifecycleSnapshot {
  const latestHandoff = input.latestHandoffBySession.get(input.ownerSessionId);
  if (latestHandoff && isTerminalLifecycle(latestHandoff.state)) {
    return {
      lifecycle: latestHandoff.state,
      endedAt: latestHandoff.endedAt,
      failureReason: latestHandoff.failureReason,
    };
  }
  return {
    lifecycle: input.layerNodes.get(input.ownerSessionId)?.state ?? 'idle',
    endedAt: null,
    failureReason: null,
  };
}
