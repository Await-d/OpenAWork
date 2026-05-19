import type {
  SessionMessageRatingRecord,
  SessionRecoveryReadModel,
  Session,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from '@openAwork/web-client';
import type {
  ChatMessage,
  ReasoningEffort,
} from '../../../../components/conversation-runtime/messages/support.js';
import type { DialogueMode } from '../../mode/dialogue-mode.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../../components/conversation-runtime/session/session-runtime.js';
import { parseSessionModeMetadata } from '../../../../components/conversation-runtime/messages/support.js';
import {
  getRecoveryPendingInteractions,
  getRecoveryTranscriptMessages,
} from '../../../../components/conversation-runtime/session/recovery-read-model.js';
import { flattenSessionTodoLanes } from '../../../../components/conversation-runtime/session/session-runtime.js';
import { createSessionsClient } from '@openAwork/web-client';
import { buildChatRightPanelStateFromRunEvents } from '../../state/chat-stream-state.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../../../components/chat/message/chat-message-group-list.js';

export interface PreparedSessionRecoveryState {
  messageRatings: Record<string, SessionMessageRatingRecord>;
  metadata: ReturnType<typeof parseSessionModeMetadata>;
  normalizedMessages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestions: PendingQuestionRequest[];
  session: Session;
  sessionStateStatus: SessionStateStatus | null;
  sessionTodos: SessionTodoItem[];
}

export interface LiveToolCallState {
  createdAt: number;
  completedAt?: number;
  inputText: string;
  isError?: boolean;
  output?: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  status: 'streaming' | 'paused' | 'completed' | 'error';
  toolCallId: string;
  toolName: string;
  batchProgress?: {
    subTools: import('@openAwork/shared').BatchSubToolProgress[];
    completedCount: number;
    totalCount: number;
  };
}

export type SessionsClientWithActiveStop = ReturnType<typeof createSessionsClient> & {
  stopActiveStream: (token: string, sessionId: string) => Promise<boolean>;
};

export const SESSION_SWITCH_DEFER_THRESHOLD = 32;
export const REMOTE_STREAM_RECOVERY_POLL_MS = 1000;

// 滚动相关常量 SSOT 已抽到 ./scroll-constants.ts。
// 此处仅 re-export 保持向后兼容，避免一次性改动所有外部引用。
// 后续 §6.2 协议层迁移时，外部直接从 scroll-constants 引入。
export {
  CHAT_SCROLL_BOTTOM_PADDING,
  CHAT_SCROLL_BOTTOM_SPACER_HEIGHT,
  CHAT_LATEST_FOCUS_THRESHOLD_PX,
  CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX,
  CHAT_LATEST_REGION_FALLBACK_PX,
  CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS,
} from '../../../../components/conversation-runtime/scroll/scroll-constants.js';

export function normalizeModelLookupKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function buildQueuedComposerScopeKey(email: string, sessionId: string): string {
  const normalizedEmail = email.trim().toLowerCase() || 'anonymous';
  return `${normalizedEmail}:${sessionId}`;
}

export function createSessionMetadataSnapshot(metadata: {
  agentId?: string;
  dialogueMode?: DialogueMode;
  modelId?: string;
  providerId?: string;
  reasoningEffort?: ReasoningEffort;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
  workingDirectory?: string | null;
  yoloMode?: boolean;
}): string {
  const snapshot: Record<string, unknown> = {
    dialogueMode: metadata.dialogueMode ?? 'clarify',
    yoloMode: metadata.yoloMode === true,
    webSearchEnabled: metadata.webSearchEnabled !== false,
    thinkingEnabled: metadata.thinkingEnabled === true,
    reasoningEffort: metadata.reasoningEffort ?? 'medium',
  };
  const providerId = metadata.providerId?.trim();
  if (providerId) snapshot['providerId'] = providerId;
  const modelId = metadata.modelId?.trim();
  if (modelId) snapshot['modelId'] = modelId;
  const workingDirectory = metadata.workingDirectory?.trim();
  if (workingDirectory) snapshot['workingDirectory'] = workingDirectory;
  const agentId = metadata.agentId?.trim();
  if (agentId) snapshot['agentId'] = agentId;
  return JSON.stringify(snapshot);
}

export function prepareSessionRecoveryState(
  recovery: SessionRecoveryReadModel,
): PreparedSessionRecoveryState {
  const session = recovery.session;
  const sessionWithRuntime = session as Session & { state_status?: SessionStateStatus };
  const pendingInteractions = getRecoveryPendingInteractions(recovery);
  return {
    messageRatings: Object.fromEntries(
      recovery.ratings.map((rating) => [rating.messageId, rating]),
    ),
    metadata: parseSessionModeMetadata(session.metadata_json),
    normalizedMessages: getRecoveryTranscriptMessages(recovery),
    pendingPermissions: pendingInteractions.pendingPermissions,
    pendingQuestions: pendingInteractions.pendingQuestions,
    session,
    sessionStateStatus: sessionWithRuntime.state_status ?? null,
    sessionTodos: flattenSessionTodoLanes(recovery.todoLanes),
  };
}

export function deriveLatestUserGoal(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content.trim().length > 0) return message.content;
  }
  return '';
}

export function buildRightPanelStateFromSessionSnapshot(session: Session, messages: ChatMessage[]) {
  return buildChatRightPanelStateFromRunEvents({
    events: Array.isArray(session.runEvents) ? session.runEvents : [],
    goal: deriveLatestUserGoal(messages),
  });
}

export function resolveModelPriceEntry(
  prices: ModelPriceEntry[],
  candidates: Array<string | undefined>,
): ModelPriceEntry | undefined {
  const normalizedCandidates = candidates.map(normalizeModelLookupKey).filter((c) => c.length > 0);
  if (normalizedCandidates.length === 0) return undefined;
  return prices.find((entry) => {
    const normalizedModelName = normalizeModelLookupKey(entry.modelName);
    return normalizedCandidates.some(
      (c) =>
        c === normalizedModelName ||
        c.includes(normalizedModelName) ||
        normalizedModelName.includes(c),
    );
  });
}

export interface ModelPriceEntry {
  modelName: string;
  inputPer1m: number;
  outputPer1m: number;
  cachedPer1m?: number;
}

// 协议工具 SSOT 已抽到 conversation-runtime/messages/。
// 此处仅 re-export 保持向后兼容，方便 chat 装配里的旧 import 不必逐个改。
// 新代码请直接从 conversation-runtime/messages/group-render-entries.js 引入。
export { groupChatRenderEntries } from '../../../../components/conversation-runtime/messages/group-render-entries.js';

export function decorateAssistantGroupActions(
  group: ChatRenderGroup,
  handleCopyMessageGroup: (messages: ChatMessage[]) => void,
): ChatRenderGroup {
  const firstEntry = group.entries[0];
  if (!firstEntry || group.role !== 'assistant' || group.entries.length <= 1) return group;
  return {
    ...group,
    actions: (firstEntry.actions ?? []).map((action) =>
      action.id === 'copy'
        ? {
            ...action,
            onClick: () => handleCopyMessageGroup(group.entries.map((e) => e.message)),
            title: '复制这次回答的完整内容',
          }
        : action,
    ),
  };
}

export function isImmediatelyRenderableStructuredContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.startsWith('{') || !normalized.includes('"type"')) return false;
  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}
