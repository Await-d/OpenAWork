import {
  appendSessionMessageV2 as appendSessionMessage,
  getSessionMessageByRequestId,
} from './message-v2-adapter.js';
import type { MessageContent } from '@openAwork/shared';
import { readFileSync } from 'node:fs';
import { resolveGatewayArtifactsIndexPath } from './storage-paths.js';
import type { RunArtifact } from '@openAwork/artifacts';
import { maybeAutoTitle } from './session-title.js';
import type { ModelRouteConfig } from './model-router.js';
import { generateSessionTitleLlm, isFirstUserMessage } from './session-title-llm.js';
import { sqliteGet } from './db.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { isTaskParentAutoResumeClientRequestId } from './task-parent-auto-resume.js';
import { appendSessionEvent } from './session-entry-store.js';
import { makeSessionEventId } from './session-event.js';

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
) {
  if (!content || content.length === 0) {
    return [{ type: 'text', text }] satisfies MessageContent[];
  }

  return content.map((item) =>
    item.type === 'input_image' ? resolveInputImageContent(sessionId, item) : item,
  );
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
    content: resolvePersistedUserContent(input.sessionId, input.content, text),
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
