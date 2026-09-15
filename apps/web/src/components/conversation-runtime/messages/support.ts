// Compat re-export barrel (Phase 1): the implementation now lives in the
// sibling `message-equivalence`, `snapshot-reconciliation`,
// `streaming-message-merge`, and `normalize-chat-messages` modules.
// Removed in Phase 2 once consumers import those modules directly.

export type {
  AssistantTracePart,
  AssistantTracePayload,
  AssistantTraceToolCall,
} from '@openAwork/shared';
// Re-exported module surfaces (Phase 1 extraction).
export type {
  AssistantEventKind,
  AssistantEventPayload,
  AssistantEventStatus,
  ChatEventPart,
  ChatInputImageItem,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatTextPart,
  ChatToolPart,
  ChatUsageDetails,
  ReasoningEffort,
} from './message-model.js';
export { estimateTokenCount, hasActivePendingPermissionRequest } from './message-coercion.js';
export { extractInputImages } from './message-content.js';
export {
  createAssistantEventCardContent,
  createCompactionCardContent,
  createStatusCardContent,
  parseAssistantEventContent,
} from './card-codec.js';
export {
  contentFromParts,
  createAssistantTraceContent,
  parseAssistantTraceContent,
  partsFromAssistantTrace,
  partsFromOrderedAssistantContent,
  readAssistantTracePayload,
  readAssistantTracePayloadFromParts,
  reconcilePartsById,
} from './trace-codec.js';
export { formatDurationLabel, formatShortTime, formatStopReasonLabel } from './message-format.js';
export { parseSessionModeMetadata } from './session-mode-metadata.js';
export {
  buildMentionItemsFromSearch,
  detectComposerTrigger,
  flattenWorkspaceFiles,
  getMentionDirectoryHint,
  MENTION_SEARCH_LIMIT,
  matchClientSlashCommand,
  matchServerSlashCommand,
  sanitizeComposerPlainText,
} from './composer.js';
export type {
  ComposerAgentTool,
  ComposerCapabilityItem,
  ComposerMenuState,
  InstalledComposerSkill,
  MentionItem,
  MentionSearchResult,
  SlashCommandItem,
  WorkspaceFileMentionItem,
  WorkspaceTreeNode,
} from './composer.js';
export { parseCopiedToolCardContent, parseToolCallInputText } from './copied-tool-card.js';
export {
  deduplicateCompactionMessages,
  estimateContextMessageTokens,
  extractNestedCompactionCardContent,
  filterChatMessagesForContext,
  isCompactionMessage,
  readCompactionTranscriptState,
} from './compaction.js';
export type {
  CompactionTranscriptPhase,
  CompactionTranscriptSource,
  CompactionTranscriptState,
} from './compaction.js';
export { createAssistantEventContent, createCommandCardContent } from './event-card-builder.js';
export {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  clearResolvedPendingPermissionFromMessage,
  dismissPermissionEventMessage,
  upsertPermissionEventMessage,
} from './permission-merge.js';
export { normalizeChatMessages } from './normalize-chat-messages.js';
export {
  reconcileSnapshotChatMessages,
  toSharedMessageSnapshot,
} from './snapshot-reconciliation.js';
export { replaceOrAppendStreamedAssistantMessage } from './streaming-message-merge.js';
