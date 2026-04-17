import type {
  SessionMessageRatingRecord,
  SessionRecoveryReadModel,
  Session,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from '@openAwork/web-client';
import type { ChatMessage, ReasoningEffort } from './support.js';
import type { DialogueMode } from '../dialogue-mode.js';
import type { SessionStateStatus, SessionTodoItem } from './session-runtime.js';
import { parseSessionModeMetadata } from './support.js';
import {
  getRecoveryPendingInteractions,
  getRecoveryTranscriptMessages,
} from './recovery-read-model.js';
import { flattenSessionTodoLanes } from './session-runtime.js';
import { createSessionsClient } from '@openAwork/web-client';
import { buildChatRightPanelStateFromRunEvents } from '../chat-stream-state.js';
import type {
  ChatRenderEntry,
  ChatRenderGroup,
} from '../../components/chat/chat-message-group-list.js';

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
}

export type SessionsClientWithActiveStop = ReturnType<typeof createSessionsClient> & {
  stopActiveStream: (token: string, sessionId: string) => Promise<boolean>;
};

export const SESSION_SWITCH_DEFER_THRESHOLD = 32;
export const REMOTE_STREAM_RECOVERY_POLL_MS = 1000;
export const CHAT_SCROLL_BOTTOM_PADDING = '0.95rem';
export const CHAT_SCROLL_BOTTOM_SPACER_HEIGHT = 'clamp(180px, 34vh, 320px)';
export const CHAT_LATEST_FOCUS_THRESHOLD_PX = 32;
export const CHAT_LATEST_EDGE_VISIBILITY_THRESHOLD_PX = 40;
export const CHAT_LATEST_REGION_FALLBACK_PX = 420;
export const CHAT_PROGRAMMATIC_SCROLL_LOCK_SMOOTH_MS = 420;

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
    webSearchEnabled: metadata.webSearchEnabled === true,
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

export function groupChatRenderEntries(entries: ChatRenderEntry[]): ChatRenderGroup[] {
  const groups: ChatRenderGroup[] = [];
  for (const entry of entries) {
    const lastGroup = groups[groups.length - 1];
    const lastEntry = lastGroup?.entries[lastGroup.entries.length - 1];
    if (lastEntry && lastEntry.message.role === entry.message.role) {
      lastGroup.entries.push(entry);
      continue;
    }
    groups.push({ entries: [entry], key: entry.message.id, role: entry.message.role });
  }
  return groups;
}

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
