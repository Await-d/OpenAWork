import {
  appendSessionMessageV2 as appendSessionMessage,
  getSessionMessageByRequestId,
} from '../message/message-v2-adapter.js';
import type { MessageContent } from '@openAwork/shared';
import { readFileSync } from 'node:fs';
import { resolveGatewayArtifactsIndexPath } from '../infra/storage-paths.js';
import type { RunArtifact } from '@openAwork/artifacts';
import { maybeAutoTitle } from './session-title.js';
import type { ModelRouteConfig } from '../provider/model-router.js';
import { generateSessionTitleLlm, isFirstUserMessage } from './session-title-llm.js';
import { sqliteGet, sqliteTransaction } from '../infra/db.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { isGatewayInternalRequestKey } from '../handoff/store/handoff-store.js';
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
  /** 会话主对话路由，同时用于标题 / 图标生成（图标不依赖全局 fast 选型）。 */
  route?: ModelRouteConfig;
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
  // 勿因 `fileId` 短路：它全仓库无生产者也无解析器，短路会让带 artifactId 的图片被静默丢弃。
  if (item.imageUrl || !item.artifactId) {
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

  // 这批写入原本是 4–6 个独立事务：`appendSessionMessage` 对「消息」与「每个 part」
  // 各发一次事件、每次各自开事务，用户消息常带 3 个 part（正文 + 前置 system-reminder
  // + 尾块 hint），于是首 token 之前要抢 3 次 SQLite 写锁，再叠加 session event 与
  // 自动标题。
  //
  // 网关用**同步** `bun:sqlite` 且 `busy_timeout=5000`：每次 `BEGIN IMMEDIATE` 撞上
  // 其它会话的并发写，整个事件循环会被同步阻塞最长 5 秒——期间 `/status`、SSE 心跳
  // （attach 的 10s keepalive）以及所有在途 HTTP 请求全部停摆。这正是「发一条消息要
  // 等很久才出字」「偶尔提示重连」的共同来源。
  //
  // 合并成一个事务后，这批写入只抢一次写锁。`sqliteTransaction` 支持嵌套（内部调用
  // 直接执行），所以包裹 `appendSessionMessage` 不会改变其内部逐 part 投影的语义。
  // 标题生成是 fire-and-forget，刻意留在事务外以免把上游调用纳入写事务。
  sqliteTransaction(() => {
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
  });

  const sessionRow = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
    [input.sessionId, input.userId],
  );
  const isTaskCreatedSession =
    sessionRow !== undefined &&
    parseSessionMetadataJson(sessionRow.metadata_json)['createdByTool'] === 'task';

  // Fire-and-forget LLM title/icon generation on the session's own chat route.
  // 图标与会话强相关：不使用全局 fast / inline 辅助选型，避免 fast 不可用
  // （未配置、上游 403、模型下线）时会话图标静默缺失。
  //
  // 网关内部请求键默认跳过（唤醒 / 定时 / 命令 / handoff 都不是会话自己的用户回合），
  // 唯一例外是 task 子代理会话自身的运行键（`task:<parent>:child:<childSessionId>`）——
  // 子代理同样生成图标；父侧 task-* 通知键（task-job / task-reminder /
  // task-parent-decision / task-auto-resume）仍按内部键跳过。
  const isInternalRequestKey = isGatewayInternalRequestKey(input.clientRequestId);
  const isTaskChildRun =
    isTaskCreatedSession && isDelegatedChildClientRequestId(input.clientRequestId);
  if (
    input.route &&
    isFirstUserMessage(input.sessionId, input.userId) &&
    (!isInternalRequestKey || isTaskChildRun)
  ) {
    void generateSessionTitleLlm({
      route: input.route,
      userMessage: text,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  return text;
}

/**
 * 判定请求键是否为 task 子代理会话自身的运行键。
 *
 * 形状由 `buildDelegatedChildClientRequestId`（tools/call-omo-agent-output.ts）产出：
 * `task:<parentClientRequestId>:child:<childSessionId>`（超长时收敛为摘要）。
 * 父侧的 `task-*` 通知键是 `task-` 前缀而非 `task:`，不会误判。
 */
function isDelegatedChildClientRequestId(clientRequestId: string): boolean {
  return clientRequestId.startsWith('task:');
}
