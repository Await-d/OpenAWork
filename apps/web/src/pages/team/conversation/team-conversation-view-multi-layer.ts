/**
 * team-conversation-view-multi-layer · `<TeamConversationView/>` 的多层汇总派生
 *
 * 按「角色实例」把主会话 + 子 session 装配成 `LayerMessages[]`（右侧群聊汇总 /
 * 卡片墙的数据源），以及它的两个布尔/默认层派生。全部为纯函数，不持有状态。
 */

import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import type { HandoffEntry, LayerNode } from '../../../stores/team/team-events.js';
import {
  buildLatestHandoffBySession,
  resolveInstanceLifecycle,
  type LayerMessages,
} from './extras/team-layer-messages.js';
import { readRoleInstanceDisplayName } from './team-conversation-view-helpers.js';
import type { TeamConversationState } from './use-team-conversation-state.js';

export function buildTeamConversationMultiLayerMessages(input: {
  childSessions: TeamConversationState['childSessions'];
  handoffs: Iterable<HandoffEntry>;
  layerNodes: ReadonlyMap<string, LayerNode>;
  messages: ChatMessage[];
  roleLayer: string | null;
  sessionId: string;
  sessionMetadata: Record<string, unknown> | null;
  soloMode: boolean;
  streamBuffer: string;
  streamingSegments: ChatMessagePart[];
  visibleStreaming: boolean;
}): LayerMessages[] {
  const entries: LayerMessages[] = [];

  // 判定规则与两个坑的成因都写在 team-layer-messages.ts 的纯函数里（可单测）：
  //   - 权威来源是 handoff 记录，不是 sessions.state_status（后者表达不了「结束」）；
  //   - 归属只能用 toSessionId，不能回落 sessionId（否则排队中取消的 handoff
  //     会把上游接待层根会话误标成已取消）；
  //   - 一个实例可能有多条 handoff（回收重试），只有最近一条是终态才算结束。
  const latestHandoffBySession = buildLatestHandoffBySession(input.handoffs);

  const readLifecycle = (ownerSessionId: string) =>
    resolveInstanceLifecycle({
      ownerSessionId,
      latestHandoffBySession,
      layerNodes: input.layerNodes,
    });

  // 当前 session 自身作为一个条目
  const currentLayer = input.roleLayer?.trim() || 'reception';
  const currentNode = input.layerNodes.get(input.sessionId);
  const currentDisplayName =
    currentNode?.displayName ?? readRoleInstanceDisplayName(input.sessionMetadata);
  const currentParentNode = currentNode?.parentSessionId
    ? input.layerNodes.get(currentNode.parentSessionId)
    : undefined;
  const currentSourceDisplayName = currentParentNode?.displayName ?? null;
  const currentSourceLayer = currentParentNode?.roleLayer ?? null;

  // 当主对话处于流式状态时，构建一条流式占位消息注入汇总面板，
  // 让用户在群聊汇总中也能实时看到"正在输入"的流式回复。
  let streamingMessage: ChatMessage | null = null;
  if (input.visibleStreaming) {
    streamingMessage = {
      id: 'team-layer-streaming-assistant',
      role: 'assistant',
      content: input.streamBuffer.trim().length > 0 ? input.streamBuffer : '团队正在处理中…',
      ...(input.streamingSegments.length > 0 ? { parts: input.streamingSegments } : {}),
      ...(input.roleLayer ? { agentId: input.roleLayer } : {}),
      createdAt: Date.now(),
      status: 'streaming',
    };
  }

  entries.push({
    layer: currentLayer,
    messages: [...input.messages],
    sessionIds: [input.sessionId],
    isActive: true,
    displayName: currentDisplayName,
    sourceLayer: currentSourceLayer,
    sourceDisplayName: currentSourceDisplayName,
    streamingMessage,
  });

  // soloMode 下不包含子 session，只展示当前角色自身的消息
  if (!input.soloMode && Array.isArray(input.childSessions)) {
    for (const child of input.childSessions) {
      const childLayer = child.role_layer?.trim() || 'reception';
      const childNode = input.layerNodes.get(child.id);
      const parentNode = childNode?.parentSessionId
        ? input.layerNodes.get(childNode.parentSessionId)
        : currentNode;
      entries.push({
        layer: childLayer,
        messages: [...child.messages],
        sessionIds: [child.id],
        isActive: false,
        displayName: child.displayName ?? childNode?.displayName ?? null,
        sourceLayer: parentNode?.roleLayer ?? currentLayer,
        sourceDisplayName: parentNode?.displayName ?? currentDisplayName,
      });
    }
  }

  return entries;
}

/** 是否有任何消息（包括当前层级自身）—— 有消息就自动展开左侧群聊汇总面板。 */
export function hasTeamConversationLayerMessages(layers: LayerMessages[]): boolean {
  return layers.some((layer) => layer.messages.length > 0);
}

export function resolveTeamDefaultDetailLayer(layers: LayerMessages[]): string | null {
  return layers.find((layer) => !layer.isActive && layer.messages.length > 0)?.layer ?? null;
}
