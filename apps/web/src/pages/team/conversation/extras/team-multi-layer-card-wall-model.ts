import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import { getRoleLayerIdentity } from '../../runtime/data/role-layer-identity.js';
import {
  isTerminalLifecycle,
  type InstanceLifecycle,
  type LayerMessages,
} from './team-layer-messages.js';
import { LAYER_DEPTH } from './team-multi-layer-card-wall-constants.js';
import type {
  CardPendingPermission,
  CardStatus,
  LayerLane,
  TerminalCardStatus,
} from './team-multi-layer-card-wall-types.js';

export function layerDepth(layer: string): number {
  return LAYER_DEPTH[layer] ?? Number.MAX_SAFE_INTEGER;
}

function parseTimestamp(value: number | string | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(instance: LayerMessages): number {
  const last = instance.messages[instance.messages.length - 1];
  return parseTimestamp(last?.createdAt);
}

/** 活跃实例置顶，其余按最近消息时间倒序 —— 让「正在说话的人」总在最前面。 */
function compareInstances(a: LayerMessages, b: LayerMessages): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return latestTimestamp(b) - latestTimestamp(a);
}

/** 卡片（= 角色实例）稳定标识，同时用作 React key 与展开态集合的键。 */
export function instanceKey(instance: LayerMessages): string {
  return instance.sessionIds[0] ?? `${instance.layer}:${instance.displayName ?? 'unknown'}`;
}

/** 按层级分组为泳道，并依层级深度从上到下排序。 */
export function buildLanes(layers: LayerMessages[]): LayerLane[] {
  const grouped = new Map<string, LayerMessages[]>();

  for (const instance of layers) {
    const key = instance.layer?.trim() || 'reception';
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(instance);
    } else {
      grouped.set(key, [instance]);
    }
  }

  return Array.from(grouped.entries())
    .map(([layer, instances]) => ({
      layer,
      identity: getRoleLayerIdentity(layer),
      instances: [...instances].sort(compareInstances),
      messageCount: instances.reduce(
        (sum, item) => sum + item.messages.length + (item.streamingMessage ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => layerDepth(a.layer) - layerDepth(b.layer) || a.layer.localeCompare(b.layer));
}

/**
 * 取实例的终态；非终态返回 null。
 * 先落到局部变量再判定，让类型谓词把联合类型收窄成终态字面量。
 *
 * 唯一的例外是「当前会话正在本地流式输出」：终态描述的是**上一轮**已经收尾，
 * 用户完全可以在一个已结束的角色实例上再发一条消息 —— 此时 handoff 还是旧的
 * 终态记录（新一轮 handoff 要等后端派发才建），但实例实际上已经活了。若还按
 * 终态渲染，卡片会一边说「已完成」一边把正在生成的回复藏起来（终态卡片不显示
 * 流式内容），用户只会以为消息发丢了。
 *
 * 这个判断只在当前会话条目上可能成立（`isActive` 仅对主会话置真，
 * 且 `streamingMessage` 只在本地真有活跃流时才由 View 层注入），
 * 所以子实例残留的过期流式占位不会误判成「活着」。
 */
export function resolveTerminalStatus(instance: LayerMessages): TerminalCardStatus | null {
  if (instance.isActive && instance.streamingMessage) {
    return null;
  }
  const lifecycle: InstanceLifecycle | null | undefined = instance.lifecycle;
  if (isTerminalLifecycle(lifecycle)) {
    return lifecycle;
  }
  return null;
}

/**
 * 该角色实例自己那条 session 上未处理的权限请求。
 *
 * 必须按 `sessionId` 过滤：权限请求是**实例级**的（子角色实例也会请求权限），
 * 网关恢复接口会把整棵子树的待处理权限一并返回，若不区分就会在每张卡片上
 * 重复渲染同一个请求 —— 点哪张卡都弹同一批按钮。
 */
export function selectPendingPermissions(
  permissions: readonly CardPendingPermission[] | undefined,
  instance: LayerMessages,
): CardPendingPermission[] {
  const ownerSessionId = instance.sessionIds[0];
  if (!permissions || permissions.length === 0 || !ownerSessionId) {
    return [];
  }
  return permissions.filter(
    (permission) => permission.status === 'pending' && permission.sessionId === ownerSessionId,
  );
}

export function resolveCardStatus(instance: LayerMessages): CardStatus {
  // 终态优先于一切：已结束 / 已关闭的实例不会再产出任何内容。即便前端还残留一条
  // streamingMessage（推送丢失会让流式占位没被正式消息取代），也绝不能显示成「正在生成」。
  const terminal = resolveTerminalStatus(instance);
  if (terminal) return terminal;
  if (instance.streamingMessage) return 'streaming';
  const last = instance.messages[instance.messages.length - 1];
  if (last?.status === 'error') return 'error';
  if (instance.messages.length === 0) return 'empty';
  if (instance.isActive) return 'active';
  return 'idle';
}

/** 终态时间标签：当天只给 HH:MM，跨天补 MM-DD —— 窄卡片里塞不下完整日期。 */
export function formatEndedAt(
  value: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value2: number): string => String(value2).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const current = new Date(now);
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  return sameDay ? time : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/** 流式内容是否已有正文 —— 没有正文时用 typing 占位，而不是渲染一个空气泡。 */
export function hasStreamContent(streaming: ChatMessage | null): boolean {
  return streaming !== null && streaming.content.trim().length > 0;
}

/**
 * 内容签名 —— 变化即视为该卡片有新内容产出，触发贴底跟随。
 * 覆盖「新增消息」与「同一条消息的流式增量」两种情况。
 */
export function buildMessageSignature(
  messages: ChatMessage[],
  streaming: ChatMessage | null,
): string {
  const last = messages[messages.length - 1];
  return [
    String(messages.length),
    last?.id ?? '',
    String(last?.content?.length ?? 0),
    String(last?.parts?.length ?? 0),
    streaming ? `stream:${streaming.content?.length ?? 0}` : '',
  ].join('|');
}
