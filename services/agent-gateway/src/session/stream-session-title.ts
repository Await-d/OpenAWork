import {
  appendSessionMessageV2 as appendSessionMessage,
  getSessionMessageByRequestId,
} from '../message/message-v2-adapter.js';
import type { MessageContent } from '@openAwork/shared';
import { readFileSync } from 'node:fs';
import { resolveGatewayArtifactsIndexPath } from '../storage-paths.js';
import type { RunArtifact } from '@openAwork/artifacts';
import { maybeAutoTitle } from './session-title.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import { generateSessionTitleLlm, isFirstUserMessage } from './session-title-llm.js';
import { sqliteGet } from '../db.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { isTaskParentAutoResumeClientRequestId } from '../task/task-parent-auto-resume.js';
import { appendSessionEvent } from './session-entry-store.js';
import { makeSessionEventId } from './session-event.js';
import {
  buildSyntheticRequestContextBlock,
  type SyntheticRequestContext,
} from '../routes/stream-system-prompts.js';

export interface PersistStreamUserMessageInput {
  clientRequestId: string;
  content?: MessageContent[];
  displayMessage?: string;
  message: string;
  sessionId: string;
  userId: string;
  /** Route for the main chat stream. Used as fallback for title generation. */
  route?: ModelRouteConfig;
  /** Dedicated route for LLM title generation (typically the fast model). Falls back to route. */
  titleRoute?: ModelRouteConfig;
  /**
   * Per-request dynamic context (capability list, keyword-detector reminder,
   * companion prompt, ...) that mirrors oh-my-opencode's
   * `experimental.chat.messages.transform` injection. Persisted as a
   * `synthetic: true` text part *before* the user's text part so the prompt-
   * cache prefix stays byte-stable across turns instead of being mutated in
   * memory only when a message is the latest user turn.
   */
  syntheticContext?: SyntheticRequestContext;
}

const gatewayArtifactsIndexPath = resolveGatewayArtifactsIndexPath();

function loadIndexedSessionArtifact(
  sessionId: string,
  artifactId: string,
): RunArtifact | undefined {
  try {
    const raw = readFileSync(gatewayArtifactsIndexPath, 'utf-8');
    const artifacts = JSON.parse(raw) as RunArtifact[];
    return artifacts.find(
      (artifact) => artifact.id === artifactId && artifact.sessionId === sessionId,
    );
  } catch {
    return undefined;
  }
}

function resolveInputImageContent(
  sessionId: string,
  item: Extract<MessageContent, { type: 'input_image' }>,
): Extract<MessageContent, { type: 'input_image' }> {
  if (item.imageUrl || item.fileId || !item.artifactId) {
    return item;
  }

  const artifact = loadIndexedSessionArtifact(sessionId, item.artifactId);
  if (!artifact?.path || !artifact.mimeType?.startsWith('image/')) {
    return item;
  }

  try {
    const contentBase64 = readFileSync(artifact.path, 'base64');
    return {
      ...item,
      fileName: item.fileName ?? artifact.name,
      imageUrl: `data:${artifact.mimeType};base64,${contentBase64}`,
      mimeType: item.mimeType ?? artifact.mimeType,
    };
  } catch {
    return item;
  }
}

function resolvePersistedUserContent(
  sessionId: string,
  content: MessageContent[] | undefined,
  text: string,
  syntheticContext: SyntheticRequestContext | undefined,
) {
  const baseContent: MessageContent[] =
    !content || content.length === 0
      ? [{ type: 'text', text }]
      : content.map((item) =>
          item.type === 'input_image' ? resolveInputImageContent(sessionId, item) : item,
        );

  // Persist per-turn synthetic content as `synthetic: true` text parts
  // surrounding the user's own content:
  //
  //   - leading  block (`<system-reminder>...</system-reminder>`):
  //       injectedPrompt + capabilityContext + companionPrompt
  //   - trailing block (`[hint]`):
  //       thinkingLanguageHint
  //
  // Both directions mirror opencode's `insertReminders` →
  // `sessions.updatePart()` flow so the per-turn dynamic blocks become part
  // of the message body and stay byte-stable across subsequent turns,
  // instead of being mutated only on whichever message currently happens to
  // be the latest user turn (which broke prompt-cache prefixes — see
  // `injectSyntheticRequestContextUnified` history).
  const leadingPart: MessageContent | null = (() => {
    if (!syntheticContext) return null;
    const block = buildSyntheticRequestContextBlock(syntheticContext);
    if (!block) return null;
    return {
      type: 'text',
      text: `<system-reminder>\n${block}\n</system-reminder>`,
      synthetic: true,
    };
  })();
  // Trailing thinking-language hint: kept *after* the user's text so the
  // final rendered string matches the legacy `${userText}\n\n[${hint}]`
  // shape (the leading `\n` here combines with `buildUserInput`'s `\n`
  // join separator to produce the expected `\n\n` gap).
  const trailingPart: MessageContent | null =
    syntheticContext?.thinkingLanguageHint &&
    syntheticContext.thinkingLanguageHint.trim().length > 0
      ? {
          type: 'text',
          text: `\n[${syntheticContext.thinkingLanguageHint}]`,
          synthetic: true,
        }
      : null;

  return [
    ...(leadingPart ? [leadingPart] : []),
    ...baseContent,
    ...(trailingPart ? [trailingPart] : []),
  ];
}

export function persistStreamUserMessage(input: PersistStreamUserMessageInput): string {
  const text = input.displayMessage ?? input.message;
  const existingMessage = getSessionMessageByRequestId({
    clientRequestId: input.clientRequestId,
    role: 'user',
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (existingMessage) {
    return text;
  }

  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'user',
    content: resolvePersistedUserContent(
      input.sessionId,
      input.content,
      text,
      input.syntheticContext,
    ),
    clientRequestId: input.clientRequestId,
  });
  appendSessionEvent({
    clientRequestId: input.clientRequestId,
    sessionId: input.sessionId,
    userId: input.userId,
    event: {
      id: makeSessionEventId(),
      timestamp: Date.now(),
      type: 'prompt',
      text,
    },
  });
  maybeAutoTitle({ sessionId: input.sessionId, userId: input.userId, text });

  const sessionRow = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  const isTaskCreatedSession =
    sessionRow && parseSessionMetadataJson(sessionRow.metadata_json)['createdByTool'] === 'task';

  // Fire-and-forget LLM title generation to upgrade the heuristic title
  const titleRoute = input.titleRoute ?? input.route;
  if (
    titleRoute &&
    !isTaskCreatedSession &&
    !isTaskParentAutoResumeClientRequestId(input.clientRequestId) &&
    isFirstUserMessage(input.sessionId, input.userId)
  ) {
    void generateSessionTitleLlm({
      route: titleRoute,
      userMessage: text,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  return text;
}
