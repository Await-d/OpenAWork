import React, { useState } from 'react';
import '../message/chat-message.css';
import './ChatPageSections.css';
import type { AlwaysScopeLevel, GenerativeUIMessage } from '@openAwork/shared-ui';
import type { InputImageContent } from '@openAwork/shared';
import { GenerativeUIRenderer, isSubagentToolName } from '@openAwork/shared-ui';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { mergeReasoningDisplayBlocks } from '@openAwork/shared';
import { renderMediaContent } from '../media/media-renderer.js';
import {
  type AssistantTracePayload,
  type ChatMessage,
  type ChatReasoningPart,
  type ChatToolPart,
  createCompactionCardContent,
  extractNestedCompactionCardContent,
  extractInputImages,
  parseAssistantEventContent,
  parseAssistantTraceContent,
  parseCopiedToolCardContent,
  readAssistantTracePayload,
} from '../../conversation-runtime/messages/support.js';
import {
  resolveTaskToolRuntimeSnapshot,
  type TaskToolRuntimeLookup,
} from '../../../pages/chat-page/conversation/render/task-tool-runtime.js';
import {
  AssistantErrorContent,
  looksLikeAssistantErrorContent,
} from '../assistant/assistant-error-content.js';
import { AssistantEventRow } from '../assistant/assistant-event-row.js';
import { shouldStreamLocalReasoningBlock } from '../assistant/assistant-reasoning-block.helpers.js';
import { AssistantReasoningBlock } from '../assistant/assistant-reasoning-block.js';
import { CollapsibleAssistantContent } from '../message/collapsible-assistant-content.js';
import { FoldDisabledContext } from '../markdown/fold-policy.js';
import { ImageLightbox, type ImageLightboxItem } from '../image/image-lightbox.js';
import { ModifiedFilesSummaryCard } from '../misc/modified-files-summary-card.js';
import StreamingMarkdownContent from '../markdown/streaming-markdown-content.js';
import { TaskToolInline } from '../tool-call/display/task-tool-inline.js';
import {
  GroupedToolCallPill,
  groupConsecutiveTools,
  ToolCallDisplay,
} from '../tool-call/display/tool-call-inline.js';
import { tryFormatJson, looksLikeJson } from '../../../utils/format-json.js';
import {
  tryParseIncidentJson,
  IncidentReadableCard,
} from '../../../pages/team/conversation/extras/incident-readable-card.js';
import { groupMessageParts } from './parts-grouping-helper.js';
export { MessageRow } from './message-row.js';
export { WelcomeScreen } from './welcome-screen.js';

export const sharedUiThemeVars = {
  '--color-bg': 'var(--bg-base)',
  '--color-surface': 'var(--bg-overlay)',
  '--color-surface-2': 'var(--bg-overlay)',
  '--color-surface-glass': 'var(--bg-overlay)',
  '--color-border': 'var(--border-default)',
  '--color-border-subtle': 'var(--border-subtle)',
  '--color-text': 'var(--fg-strong)',
  '--color-muted': 'var(--fg-muted)',
  '--color-accent': 'var(--accent)',
  '--color-accent-hover': 'var(--accent-hover)',
  '--color-success': 'var(--success)',
  '--color-warning': 'var(--warning)',
  '--color-danger': 'var(--danger)',
  '--color-info': 'var(--info)',
} as React.CSSProperties;

export { ModelPicker, ModelSettingsPopover } from '../model-picker/model-picker-panels.js';

const MarkdownMessageContent = React.lazy(() => import('../markdown/markdown-message-content.js'));

export function renderChatMessageContent(m: ChatMessage) {
  if (m.role !== 'assistant') return m.content;
  return renderAssistantMessageContentValue(m.content, { messageId: m.id });
}

export function renderStreamingChatMessageContent(content: string) {
  return renderAssistantMessageContentValue(content, { streaming: true });
}

export interface ChatToolRenderOptions {
  messageId?: string;
  onOpenChildSession?: (sessionId: string) => void;
  presentationMode?: 'chat' | 'team';
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
        scopeLevels?: AlwaysScopeLevel[];
        selectedScopeCategory?: AlwaysScopeLevel['category'];
        selectedScopePattern?: string;
        onSelectScopeLevel?: (level: AlwaysScopeLevel) => void;
      }
    | undefined;
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}

/**
 * 用户消息附件图集。
 *
 * 无障碍：可预览附件的文件名标签是一个真实控件，由原生 `<button type="button">`
 * 承担，与缩略图按钮同级（同一 tile 内并列，不互相嵌套），键盘 Enter / Space 交给
 * 浏览器原生按钮语义，不再使用无角色、不可聚焦的 `<span onClick>`。没有可预览图源时
 * 文件名退化为纯文本标签（`--static`），不产生任何交互语义。
 */
function UserAttachedImagesGallery({ images }: { images: ReturnType<typeof extractInputImages> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const viewableImages = images.flatMap((image, imageIndex) =>
    image.imageUrl ? [{ image, imageIndex }] : [],
  );
  const lightboxItems: ImageLightboxItem[] = viewableImages.flatMap(({ image, imageIndex }) => {
    if (!image.imageUrl) return [];
    const label = image.fileName ?? `图片 ${imageIndex + 1}`;
    return [
      {
        src: image.imageUrl,
        alt: label,
        caption: label,
        ...(image.fileName ? { fileName: image.fileName } : {}),
      },
    ];
  });
  // openIndex 是 images 下标；图集索引用可预览图片的位置，两者互转。
  const openPosition = viewableImages.findIndex((entry) => entry.imageIndex === openIndex);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {images.map((image, index) => {
        const label = image.fileName ?? `图片 ${index + 1}`;
        const src = image.imageUrl;
        const isHovered = hoverIndex === index;
        const clickable = Boolean(src);

        return (
          <div
            key={`${src ?? image.artifactId ?? image.fileId ?? 'image'}-${index}`}
            style={{ display: 'grid', gap: 6, width: 180 }}
          >
            {src ? (
              <button
                type="button"
                onClick={() => setOpenIndex(index)}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex((value) => (value === index ? null : value))}
                title="点击放大查看"
                style={{
                  position: 'relative',
                  padding: 0,
                  width: '100%',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  background: 'var(--bg-overlay)',
                  cursor: 'zoom-in',
                  overflow: 'hidden',
                  lineHeight: 0,
                }}
              >
                <img
                  src={src}
                  alt={label}
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: 180,
                    objectFit: 'cover',
                  }}
                />
                {/* Hover overlay */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                      'linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.18) 100%)',
                    opacity: isHovered ? 1 : 0,
                    transition: 'opacity 150ms ease',
                    pointerEvents: 'none',
                  }}
                >
                  <span className="chat-attachment-thumbnail__zoom-badge">⤢</span>
                </div>
              </button>
            ) : (
              <div
                style={{
                  minHeight: 120,
                  borderRadius: 12,
                  border: '1px dashed var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--fg-muted)',
                  fontSize: 11,
                  background: 'var(--bg-overlay)',
                }}
              >
                图片已附加
              </div>
            )}
            {clickable ? (
              <button
                type="button"
                className="chat-attachment-file-name"
                aria-label={`放大查看 ${label}`}
                title={label}
                onClick={() => setOpenIndex(index)}
              >
                {label}
              </button>
            ) : (
              <span
                className="chat-attachment-file-name chat-attachment-file-name--static"
                title={label}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}

      {openIndex !== null && openPosition >= 0 && (
        <ImageLightbox
          open
          items={lightboxItems}
          index={openPosition}
          onIndexChange={(next) => setOpenIndex(viewableImages[next]?.imageIndex ?? null)}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

export function renderChatMessageContentWithOptions(
  m: ChatMessage,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  if (m.role !== 'assistant') {
    const inputImages = m.rawContent ? extractInputImages(m.rawContent) : [];
    const mediaNodes = m.rawContent
      ? renderMediaContent(m.rawContent as unknown as import('@openAwork/shared').MessageContent[])
      : [];

    if (inputImages.length === 0 && mediaNodes.length === 0) {
      return m.content;
    }

    return (
      <div style={{ display: 'grid', gap: 10 }}>
        {m.content ? <span>{m.content}</span> : null}
        {inputImages.length > 0 && <UserAttachedImagesGallery images={inputImages} />}
        {mediaNodes.length > 0 && <div style={{ display: 'grid', gap: 10 }}>{mediaNodes}</div>}
      </div>
    );
  }
  return renderAssistantMessageContentValue(m, { ...options, messageId: m.id });
}

export function renderStreamingChatMessageContentWithOptions(
  contentOrMessage: ChatMessage | string,
  options?: Omit<ChatToolRenderOptions, 'streaming'>,
) {
  return renderAssistantMessageContentValue(contentOrMessage, {
    ...options,
    streaming: true,
  });
}

function renderToolCallContent(input: {
  approvalActions?: {
    errorMessage?: string;
    helperMessage?: string;
    items: Array<{
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      id: string;
      label: string;
      onClick: () => void;
      primary?: boolean;
    }>;
    pendingLabel?: string;
    scopeLevels?: AlwaysScopeLevel[];
    selectedScopeCategory?: AlwaysScopeLevel['category'];
    selectedScopePattern?: string;
    onSelectScopeLevel?: (level: AlwaysScopeLevel) => void;
  };
  /** tool result 的图片附件（`computer_use` 最终截图），其余工具为空。 */
  attachments?: readonly InputImageContent[];
  durationMs?: number;
  isError?: boolean;
  kind?: 'agent' | 'mcp' | 'skill' | 'tool';
  onOpenChildSession?: (sessionId: string) => void;
  output?: unknown;
  pendingPermissionRequestId?: string;
  reactKey?: React.Key;
  resumedAfterApproval?: boolean;
  selectedChildSessionId?: string | null;
  status?: 'running' | 'paused' | 'completed' | 'failed';
  taskRuntimeLookup?: TaskToolRuntimeLookup;
  toolCallId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}) {
  if (isSubagentToolName(input.toolName)) {
    return (
      <TaskToolInline
        key={input.reactKey}
        {...input}
        input={input.toolInput}
        onOpenChildSession={input.onOpenChildSession}
        runtimeSnapshot={resolveTaskToolRuntimeSnapshot(
          input.toolInput,
          input.output,
          input.taskRuntimeLookup,
        )}
        selectedChildSessionId={input.selectedChildSessionId}
      />
    );
  }

  return (
    <ToolCallDisplay
      approvalActions={input.approvalActions}
      attachments={input.attachments}
      key={input.reactKey}
      input={input.toolInput}
      isError={input.isError}
      kind={input.kind}
      output={input.output}
      resumedAfterApproval={input.resumedAfterApproval}
      status={input.status}
      durationMs={input.durationMs}
      toolCallId={input.toolCallId}
      toolName={input.toolName}
    />
  );
}

function renderAssistantMessageContentValue(
  contentOrMessage: ChatMessage | string,
  options?: ChatToolRenderOptions,
) {
  // 统一拦截：将 assistant_event + kind:'compaction' 消息转为格式化的 compaction 卡片
  // 此拦截在 parts/content 路径分流之前，确保所有压缩事件都使用 UICompaction 渲染
  const earlyContent =
    typeof contentOrMessage === 'string' ? contentOrMessage : contentOrMessage.content;
  if (earlyContent && looksLikeStructuredJsonContent(earlyContent)) {
    try {
      const earlyParsed = JSON.parse(earlyContent) as {
        type?: string;
        payload?: Record<string, unknown>;
      };
      if (earlyParsed?.type === 'assistant_event' && earlyParsed.payload?.kind === 'compaction') {
        const card = createCompactionCardContent({
          title: (earlyParsed.payload['title'] as string)?.trim() || 'compact',
          summary: (earlyParsed.payload['message'] as string) || '',
          trigger: 'automatic',
          phase:
            earlyParsed.payload['status'] === 'running'
              ? 'started'
              : earlyParsed.payload['status'] === 'error'
                ? 'failed'
                : 'completed',
        });
        return <GenerativeUIRenderer message={JSON.parse(card) as GenerativeUIMessage} />;
      }
    } catch {
      // Fall through to normal rendering
    }
  }

  // Parts-first path: when the message carries structured parts that
  // include any reasoning / tool / event segment, render them in their
  // original order. This is the only way to faithfully show the wire
  // arrival sequence (e.g. tool → text → tool, reasoning interleaved with
  // tool output). Plain text-only parts fall through to the trace path so
  // copied-tool-card / generative-UI / companion-block detection still work.
  if (
    typeof contentOrMessage !== 'string' &&
    Array.isArray(contentOrMessage.parts) &&
    contentOrMessage.parts.length > 0 &&
    contentOrMessage.parts.some(
      (part) => part.type === 'reasoning' || part.type === 'tool' || part.type === 'event',
    )
  ) {
    return <AssistantPartsContent message={contentOrMessage} options={options} />;
  }
  const content =
    typeof contentOrMessage === 'string' ? contentOrMessage : contentOrMessage.content;
  const copiedToolCard = parseCopiedToolCardContent(content);
  if (copiedToolCard) {
    return renderToolCallContent({
      kind: copiedToolCard.kind,
      toolName: copiedToolCard.toolName,
      toolInput: copiedToolCard.input,
      output: copiedToolCard.output,
      isError: copiedToolCard.isError,
      onOpenChildSession: options?.onOpenChildSession,
      pendingPermissionRequestId: copiedToolCard.pendingPermissionRequestId,
      approvalActions:
        copiedToolCard.pendingPermissionRequestId && options?.resolveInlinePermissionActions
          ? options.resolveInlinePermissionActions(copiedToolCard.pendingPermissionRequestId)
          : undefined,
      durationMs: copiedToolCard.durationMs,
      resumedAfterApproval: copiedToolCard.resumedAfterApproval,
      selectedChildSessionId: options?.selectedChildSessionId,
      status: copiedToolCard.status,
      taskRuntimeLookup: options?.taskRuntimeLookup,
    });
  }

  if (!looksLikeStructuredJsonContent(content)) {
    const companionBlocks = extractCompanionBlocks(content);
    if (companionBlocks) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {companionBlocks.mainContent && (
            <AssistantRichContent
              content={companionBlocks.mainContent}
              streaming={options?.streaming}
              messageId={options?.messageId}
            />
          )}
          {companionBlocks.companionContent && (
            <CompanionInlineBlock content={companionBlocks.companionContent} />
          )}
        </div>
      );
    }
    return (
      <AssistantRichContent
        content={content}
        streaming={options?.streaming}
        messageId={options?.messageId}
      />
    );
  }

  try {
    const parsed = JSON.parse(content) as GenerativeUIMessage & {
      payload?: Record<string, unknown>;
      type?: string;
    };
    if (parsed?.type === 'tool_call') {
      const payload = parsed.payload ?? {};
      return renderToolCallContent({
        kind:
          payload['kind'] === 'agent' ||
          payload['kind'] === 'mcp' ||
          payload['kind'] === 'skill' ||
          payload['kind'] === 'tool'
            ? payload['kind']
            : undefined,
        toolCallId: typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : undefined,
        toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool',
        toolInput:
          payload['input'] &&
          typeof payload['input'] === 'object' &&
          !Array.isArray(payload['input'])
            ? (payload['input'] as Record<string, unknown>)
            : {},
        output: payload['output'],
        isError: payload['isError'] === true,
        pendingPermissionRequestId:
          typeof payload['pendingPermissionRequestId'] === 'string'
            ? payload['pendingPermissionRequestId']
            : undefined,
        approvalActions:
          typeof payload['pendingPermissionRequestId'] === 'string' &&
          options?.resolveInlinePermissionActions
            ? options.resolveInlinePermissionActions(payload['pendingPermissionRequestId'])
            : undefined,
        durationMs:
          typeof payload['durationMs'] === 'number' && Number.isFinite(payload['durationMs'])
            ? payload['durationMs']
            : undefined,
        resumedAfterApproval: payload['resumedAfterApproval'] === true,
        taskRuntimeLookup: options?.taskRuntimeLookup,
        status:
          payload['status'] === 'running' ||
          payload['status'] === 'paused' ||
          payload['status'] === 'completed' ||
          payload['status'] === 'failed'
            ? payload['status']
            : undefined,
      });
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.type === 'form' ||
        parsed.type === 'table' ||
        parsed.type === 'chart' ||
        parsed.type === 'approval' ||
        parsed.type === 'code_diff' ||
        parsed.type === 'status' ||
        parsed.type === 'compaction' ||
        parsed.type === 'tool_call')
    ) {
      return <GenerativeUIRenderer message={parsed} />;
    }
  } catch {
    // Fall through to assistant-trace / assistant-event parsing.
  }

  const nestedCompactionCard = extractNestedCompactionCardContent(content);
  if (nestedCompactionCard) {
    try {
      return (
        <GenerativeUIRenderer message={JSON.parse(nestedCompactionCard) as GenerativeUIMessage} />
      );
    } catch {
      // Fall through to assistant-trace rendering if the nested payload is malformed.
    }
  }

  const assistantTrace =
    typeof contentOrMessage === 'string'
      ? parseAssistantTraceContent(content)
      : readAssistantTracePayload(contentOrMessage);
  if (assistantTrace) {
    const reasoningBlocksEndedFlags =
      typeof contentOrMessage === 'string' ? undefined : contentOrMessage.reasoningBlocksEndedFlags;
    const reasoningBlocksDurationsMs =
      typeof contentOrMessage === 'string'
        ? undefined
        : contentOrMessage.reasoningBlocksDurationsMs;
    return (
      <AssistantTraceContent
        messageId={options?.messageId}
        payload={assistantTrace}
        presentationMode={options?.presentationMode}
        reasoningBlocksEndedFlags={reasoningBlocksEndedFlags}
        reasoningBlocksDurationsMs={reasoningBlocksDurationsMs}
        resolveInlinePermissionActions={options?.resolveInlinePermissionActions}
        streaming={options?.streaming}
        onOpenChildSession={options?.onOpenChildSession}
        selectedChildSessionId={options?.selectedChildSessionId}
        taskRuntimeLookup={options?.taskRuntimeLookup}
      />
    );
  }

  const assistantEvent = parseAssistantEventContent(content);
  if (assistantEvent) {
    return <AssistantEventRow payload={assistantEvent} />;
  }

  return (
    <AssistantRichContent
      content={content}
      streaming={options?.streaming}
      messageId={options?.messageId}
    />
  );
}

function AssistantPartsContent({
  message,
  options,
}: {
  message: ChatMessage;
  options?: ChatToolRenderOptions;
}) {
  const parts = message.parts ?? [];
  const streaming = options?.streaming === true;
  const showReasoningBlock = useDisplayPreferencesStore((s) => s.showReasoningBlock);
  const reasoningExpandedByDefault = useDisplayPreferencesStore(
    (s) => s.reasoningExpandedByDefault,
  );
  const reasoningParts = parts.filter(
    (part): part is ChatReasoningPart => part.type === 'reasoning',
  );
  const totalReasoning = reasoningParts.length;
  const reasoningEndedFlags = message.reasoningBlocksEndedFlags;
  const reasoningDurations = message.reasoningBlocksDurationsMs;
  const reasoningFlagsMatchParts = reasoningEndedFlags?.length === totalReasoning;
  const reasoningDurationsMatchParts = reasoningDurations?.length === totalReasoning;
  // 展示层投影：把一条消息内的多个思考块合并为单个展示块，只在首个思考块位置渲染。
  // 这里只派生新数组，不修改 message.parts / reasoningBlocksEndedFlags / reasoningBlocksDurationsMs。
  const mergedReasoning = mergeReasoningDisplayBlocks(
    reasoningParts.map((part, index) => {
      // Default to "ended" when no streaming flag list is supplied
      // (i.e. message is finalized / loaded from history). While
      // streaming, prefer the per-block flag, then fall back to
      // segment-level endedAt set by `markStreamingReasoningSegmentEnded`.
      const ended = reasoningFlagsMatchParts
        ? reasoningEndedFlags[index] === true
        : !streaming || part.endedAt !== undefined;
      const rawDuration = reasoningDurationsMatchParts ? reasoningDurations?.[index] : undefined;
      const persistedDuration =
        typeof part.startedAt === 'number' &&
        typeof part.endedAt === 'number' &&
        part.endedAt >= part.startedAt
          ? part.endedAt - part.startedAt
          : undefined;
      const durationMs =
        typeof rawDuration === 'number' && rawDuration >= 0 ? rawDuration : persistedDuration;
      return { id: part.id, text: part.text, ended, durationMs };
    }),
  );
  const hasActiveToolCall = parts.some(
    (part): part is ChatToolPart =>
      part.type === 'tool' && (part.status === 'running' || part.status === 'paused'),
  );
  const hasAssistantText = parts.some(
    (part) => part.type === 'text' && part.text.trim().length > 0,
  );

  // 将 parts 转换为支持分组的渲染序列，连续的 tool parts 会被合并
  const groupedParts = React.useMemo(() => groupMessageParts(parts), [parts]);

  // 一条消息可能被拆成多个文本段（text → tool → text）。光标只交给**最后一个
  // 非空文本段**：工具卡不绘制光标，而推理块仅在没有正文时才绘制（见
  // `shouldStreamLocalReasoningBlock` 的 `hasAssistantText` 分支），因此这样
  // 恰好只有一个光标，且存在正文时不会退化为零。若给每个文本段都画，就会同时
  // 出现多个闪烁光标。
  const activeTextPartIndex = React.useMemo(() => {
    for (let index = groupedParts.length - 1; index >= 0; index -= 1) {
      const item = groupedParts[index];
      if (item?.type === 'text' && item.part.text.trim().length > 0) {
        return index;
      }
    }
    return -1;
  }, [groupedParts]);

  // 管理简化思考过程的展开/收起状态
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(new Set());

  const toggleReasoning = (id: string) => {
    setExpandedReasoningIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
      {groupedParts.map((item, idx) => {
        if (item.type === 'reasoning') {
          const part = item.part;
          // 展示层合并：同一条消息的所有思考块只在首个思考块位置渲染。
          if (!mergedReasoning || part.id !== mergedReasoning.id) {
            return null;
          }
          if (!showReasoningBlock) {
            if (options?.presentationMode === 'team') {
              return null;
            }
            return (
              <HiddenReasoningNotice
                key={mergedReasoning.id}
                index={0}
                streaming={streaming}
                total={1}
                content={mergedReasoning.text}
                onToggle={() => toggleReasoning(mergedReasoning.id)}
                expanded={expandedReasoningIds.has(mergedReasoning.id)}
              />
            );
          }
          return (
            <AssistantReasoningBlock
              key={mergedReasoning.id}
              content={mergedReasoning.text}
              defaultExpanded={reasoningExpandedByDefault}
              durationMs={mergedReasoning.durationMs}
              ended={mergedReasoning.ended}
              index={0}
              messageStreaming={streaming}
              renderBody={renderReasoningRichBody}
              streaming={shouldStreamLocalReasoningBlock({
                ended: mergedReasoning.ended,
                hasActiveToolCall,
                hasAssistantText,
                index: 0,
                streaming,
                total: 1,
              })}
              total={1}
            />
          );
        }
        if (item.type === 'text') {
          const part = item.part;
          if (part.text.length === 0) return null;
          return (
            <AssistantRichContentBody
              key={part.id}
              content={part.text}
              streaming={streaming}
              streamingCaret={streaming && idx === activeTextPartIndex}
              messageId={message.id}
            />
          );
        }
        if (item.type === 'tool-group') {
          // 分组的工具调用，渲染为可展开的 pill
          return (
            <GroupedToolCallPill
              key={`group-${idx}-${item.groupKey}`}
              groupKey={item.groupKey}
              toolName={item.toolName}
              calls={item.calls.map((tp) => ({
                toolCallId: tp.toolCallId,
                toolName: tp.toolName,
                input: tp.input,
                output: tp.output,
                isError: tp.isError,
                kind: tp.kind,
                status: tp.status,
                durationMs: tp.durationMs,
                pendingPermissionRequestId: tp.pendingPermissionRequestId,
                resumedAfterApproval: tp.resumedAfterApproval,
              }))}
            />
          );
        }
        if (item.type === 'tool-single') {
          const part = item.part;
          return renderToolCallContent({
            reactKey: part.id,
            attachments: part.attachments,
            kind: part.kind,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            toolInput: part.input,
            output: part.output,
            isError: part.isError,
            onOpenChildSession: options?.onOpenChildSession,
            pendingPermissionRequestId: part.pendingPermissionRequestId,
            approvalActions:
              part.pendingPermissionRequestId && options?.resolveInlinePermissionActions
                ? options.resolveInlinePermissionActions(part.pendingPermissionRequestId)
                : undefined,
            durationMs: part.durationMs,
            resumedAfterApproval: part.resumedAfterApproval,
            selectedChildSessionId: options?.selectedChildSessionId,
            status: part.status,
            taskRuntimeLookup: options?.taskRuntimeLookup,
          });
        }
        if (item.type === 'event') {
          const part = item.part;
          // 压缩事件使用专门的 UICompaction 卡片渲染，而非通用事件行
          if (part.payload.kind === 'compaction') {
            const compactionCard = createCompactionCardContent({
              title: part.payload.title?.trim() || 'compact',
              summary: part.payload.message || '',
              trigger: 'automatic',
              phase:
                part.payload.status === 'running'
                  ? 'started'
                  : part.payload.status === 'error'
                    ? 'failed'
                    : 'completed',
            });
            try {
              return (
                <GenerativeUIRenderer
                  key={part.id}
                  message={JSON.parse(compactionCard) as GenerativeUIMessage}
                />
              );
            } catch {
              // Fall through to AssistantEventRow if parsing fails
            }
          }
          return <AssistantEventRow key={part.id} payload={part.payload} />;
        }
        return null;
      })}
      {message.modifiedFilesSummary && (
        <ModifiedFilesSummaryCard summary={message.modifiedFilesSummary} />
      )}
    </div>
  );
}

function AssistantTraceContent({
  messageId,
  onOpenChildSession,
  payload,
  presentationMode = 'chat',
  reasoningBlocksEndedFlags,
  reasoningBlocksDurationsMs,
  resolveInlinePermissionActions,
  selectedChildSessionId,
  streaming = false,
  taskRuntimeLookup,
}: {
  messageId?: string;
  onOpenChildSession?: (sessionId: string) => void;
  payload: AssistantTracePayload;
  presentationMode?: 'chat' | 'team';
  reasoningBlocksEndedFlags?: boolean[];
  reasoningBlocksDurationsMs?: number[];
  resolveInlinePermissionActions?: ChatToolRenderOptions['resolveInlinePermissionActions'];
  selectedChildSessionId?: string | null;
  streaming?: boolean;
  taskRuntimeLookup?: TaskToolRuntimeLookup;
}) {
  const hasActiveToolCall = payload.toolCalls.some(
    (toolCall) => toolCall.status === 'running' || toolCall.status === 'paused',
  );
  const hasAssistantText = payload.text.trim().length > 0;
  const showReasoningBlockStreaming = useDisplayPreferencesStore((s) => s.showReasoningBlock);
  const reasoningExpandedByDefaultStreaming = useDisplayPreferencesStore(
    (s) => s.reasoningExpandedByDefault,
  );

  // 管理简化思考过程的展开/收起状态
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(new Set());

  const toggleReasoning = (id: string) => {
    setExpandedReasoningIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const reasoningBlocks = payload.reasoningBlocks ?? [];
  // 展示层投影：把 payload 中的多个思考块合并为单个展示块，只派生新数组，不修改 payload。
  const mergedReasoning = mergeReasoningDisplayBlocks(
    reasoningBlocks.map((reasoning, index) => {
      // Default: when no explicit ended-flag list is supplied (i.e. the
      // message is finalized / loaded from history), treat every reasoning
      // block as ended. While streaming, use the per-block flag from the
      // upstream `thinking_end` event.
      const ended = reasoningBlocksEndedFlags
        ? reasoningBlocksEndedFlags[index] === true
        : !streaming;
      const rawDuration = reasoningBlocksDurationsMs?.[index];
      const persistedTiming = payload.reasoningBlocksTimings?.[index];
      const persistedDuration =
        persistedTiming &&
        typeof persistedTiming.startedAt === 'number' &&
        typeof persistedTiming.endedAt === 'number' &&
        persistedTiming.endedAt >= persistedTiming.startedAt
          ? persistedTiming.endedAt - persistedTiming.startedAt
          : undefined;
      const durationMs =
        typeof rawDuration === 'number' && rawDuration >= 0
          ? rawDuration
          : typeof persistedDuration === 'number'
            ? persistedDuration
            : undefined;
      return {
        id: `reasoning-${index}`,
        text: reasoning,
        startedAt: persistedTiming?.startedAt,
        endedAt: persistedTiming?.endedAt,
        ended,
        durationMs,
      };
    }),
  );

  return (
    <div className="assistant-rich-content" style={{ minWidth: 0, gap: 4 }}>
      {mergedReasoning !== null &&
        (showReasoningBlockStreaming ? (
          <AssistantReasoningBlock
            key={mergedReasoning.id}
            content={mergedReasoning.text}
            defaultExpanded={reasoningExpandedByDefaultStreaming}
            durationMs={mergedReasoning.durationMs}
            ended={mergedReasoning.ended}
            index={0}
            messageStreaming={streaming}
            renderBody={renderReasoningRichBody}
            streaming={shouldStreamLocalReasoningBlock({
              ended: mergedReasoning.ended,
              hasActiveToolCall,
              hasAssistantText,
              index: 0,
              streaming,
              total: 1,
            })}
            total={1}
          />
        ) : presentationMode === 'team' ? null : (
          <HiddenReasoningNotice
            key={mergedReasoning.id}
            index={0}
            streaming={streaming}
            total={1}
            content={mergedReasoning.text}
            onToggle={() => toggleReasoning(mergedReasoning.id)}
            expanded={expandedReasoningIds.has(mergedReasoning.id)}
          />
        ))}
      {payload.text.length > 0 && (
        <AssistantRichContentBody
          content={payload.text}
          streaming={streaming}
          messageId={messageId}
        />
      )}
      {/* Collapse runs of ≥2 consecutive read/grep/glob calls into a
          single grouped pill so a session that reads 8 files in a row
          doesn't blow out the message column. The helper preserves
          the original index so the React key stays stable across
          re-renders even when group boundaries shift. */}
      {groupConsecutiveTools(payload.toolCalls).map((entry) => {
        if (entry.kind === 'group') {
          return (
            <GroupedToolCallPill
              key={`group-${entry.startIndex}-${entry.groupKey}`}
              groupKey={entry.groupKey}
              toolName={entry.toolName}
              calls={entry.calls}
            />
          );
        }
        const toolCall = entry.call;
        return renderToolCallContent({
          reactKey: `${toolCall.toolName}-${entry.index}`,
          kind: toolCall.kind,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          output: toolCall.output,
          isError: toolCall.isError,
          onOpenChildSession,
          pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
          approvalActions:
            toolCall.pendingPermissionRequestId && resolveInlinePermissionActions
              ? resolveInlinePermissionActions(toolCall.pendingPermissionRequestId)
              : undefined,
          durationMs: toolCall.durationMs,
          resumedAfterApproval: toolCall.resumedAfterApproval,
          selectedChildSessionId,
          status: toolCall.status,
          taskRuntimeLookup,
        });
      })}
      {payload.modifiedFilesSummary && (
        <ModifiedFilesSummaryCard summary={payload.modifiedFilesSummary} />
      )}
    </div>
  );
}

function HiddenReasoningNotice({
  index,
  streaming,
  total,
  content,
  onToggle,
  expanded,
}: {
  index: number;
  streaming: boolean;
  total: number;
  content: string;
  onToggle: () => void;
  expanded: boolean;
}) {
  const label = total > 1 ? `思考过程 ${index + 1}` : '思考过程';

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        style={{
          all: 'unset',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: '100%',
          padding: '6px 10px',
          borderRadius: 8,
          color: 'var(--fg-muted)',
          fontSize: 11,
          lineHeight: 1.5,
          cursor: 'pointer',
          transition: 'background 140ms ease, color 140ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-overlay)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--fg-default)' }}>{label}</span>
        <span>{streaming ? '生成中' : '已完成'}</span>
        <span style={{ marginLeft: 4, fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && content && (
        <div
          className="assistant-reasoning-block"
          data-streaming="false"
          style={{ marginTop: 8, marginBottom: 0 }}
        >
          <div className="assistant-reasoning-body">
            {/* 思考占位展开后的正文同样自带折叠语义（▶/▼），不再叠加消息级「展开全部」，
                内部的围栏块也不再自折叠 */}
            <FoldDisabledContext value={true}>
              <AssistantRichContentBody content={content} foldMode="disabled" streaming={false} />
            </FoldDisabledContext>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantRichContent({
  content,
  streaming = false,
  messageId,
}: {
  content: string;
  streaming?: boolean;
  messageId?: string;
}) {
  return (
    <div className="assistant-rich-content">
      <AssistantRichContentBody content={content} streaming={streaming} messageId={messageId} />
    </div>
  );
}

// Stable module-level reference for AssistantReasoningBlock.renderBody.
// Must be defined AFTER AssistantRichContentBody to avoid TDZ when read.
// React components reference it at render time (post module-eval), so safe.
// eslint-disable-next-line @typescript-eslint/no-use-before-define
const renderReasoningRichBody = (reasoningContent: string, isStreaming: boolean) => (
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  // foldMode="disabled"：思考块自带 展开/收起，内部不再叠加消息级「展开全部」折叠。
  // FoldDisabledContext：思考块内部的围栏块（代码 / Markdown 预览 / ```thinking）
  // 同样不再自折叠——"展开思考"就等于看到全部思考内容，避免二级「展开全部 N 行」。
  <FoldDisabledContext value={true}>
    <AssistantRichContentBody
      content={reasoningContent}
      foldMode="disabled"
      streaming={isStreaming}
    />
  </FoldDisabledContext>
);

function AssistantRichContentBody({
  content,
  foldMode = 'auto',
  streaming = false,
  streamingCaret = streaming,
  messageId,
}: {
  content: string;
  /**
   * 消息级折叠策略（`CollapsibleAssistantContent`，长正文裁到 ~60vh + 「展开全部 · N 字符」）。
   * - `auto`：默认，按长度阈值决定是否折叠。
   * - `disabled`：该正文自带折叠控件（思考块 / 思考占位），不再叠加消息级折叠——
   *   否则用户点开思考后还要再点一次「展开全部」，同一内容出现两层折叠提示，
   *   且第二层仍把内容裁到 60vh，"展开"名不副实。
   */
  foldMode?: 'auto' | 'disabled';
  streaming?: boolean;
  /**
   * 是否在该 body 上绘制流式光标（`data-streaming`），默认为 `streaming`。
   * 一条消息可能拆成多个文本段（如 text → tool → text），调用方应只把最后一个
   * 非空文本段置为 true；若每个文本段都置 true，会同时出现多个闪烁光标。
   */
  streamingCaret?: boolean;
  messageId?: string;
}) {
  if (streaming && content.trim().length === 0) {
    return <AssistantPendingBubble />;
  }

  if (looksLikeAssistantErrorContent(content)) {
    return <AssistantErrorContent content={content} />;
  }

  // JSON 内容：先尝试解析为 incident 卡片，否则格式化为代码块
  if (!streaming && looksLikeJson(content)) {
    // 0. assistant_event + kind:'compaction' → 格式化的 compaction 卡片
    try {
      const parsed = JSON.parse(content) as { type?: string; payload?: Record<string, unknown> };
      if (parsed?.type === 'assistant_event' && parsed.payload?.kind === 'compaction') {
        const card = createCompactionCardContent({
          title: (parsed.payload['title'] as string)?.trim() || 'compact',
          summary: (parsed.payload['message'] as string) || '',
          trigger: 'automatic',
          phase:
            parsed.payload['status'] === 'running'
              ? 'started'
              : parsed.payload['status'] === 'error'
                ? 'failed'
                : 'completed',
        });
        return <GenerativeUIRenderer message={JSON.parse(card) as GenerativeUIMessage} />;
      }
    } catch {
      // Fall through
    }

    // 1. 尝试解析为 incident JSON → 人类可读卡片
    const incident = tryParseIncidentJson(content);
    if (incident) {
      return (
        <div className="assistant-rich-content-body">
          <IncidentReadableCard data={incident} />
        </div>
      );
    }
    // 2. 其他 JSON → 格式化代码块
    const formatted = tryFormatJson(content);
    if (formatted !== content) {
      return (
        <div className="assistant-rich-content-body">
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'var(--bg-base)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              fontSize: 11.5,
              lineHeight: 1.6,
              color: 'var(--fg-default)',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {formatted}
          </pre>
        </div>
      );
    }
  }

  if (streaming) {
    return (
      <div
        className="assistant-rich-content-body"
        data-streaming={streamingCaret ? 'true' : undefined}
      >
        <React.Suspense fallback={<div className="chat-markdown-streaming">{content}</div>}>
          <StreamingMarkdownContent content={content} />
        </React.Suspense>
      </div>
    );
  }

  const markdownBody = (
    <React.Suspense fallback={<div className="chat-markdown-streaming">{content}</div>}>
      <MarkdownMessageContent content={content} />
    </React.Suspense>
  );

  return (
    <div className="assistant-rich-content-body">
      {foldMode === 'disabled' ? (
        markdownBody
      ) : (
        <CollapsibleAssistantContent content={content} messageId={messageId}>
          {markdownBody}
        </CollapsibleAssistantContent>
      )}
    </div>
  );
}

function AssistantPendingBubble() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div
      data-testid="chat-streaming-placeholder"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 26,
        color: 'var(--fg-default)',
        animation: prefersReducedMotion ? undefined : 'fade-in 180ms ease-out',
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.01em',
          color: 'var(--fg-strong)',
        }}
      >
        正在对话
      </span>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent)',
              opacity: 0.45,
              animation: prefersReducedMotion ? undefined : 'pulse 1.1s ease-in-out infinite',
              animationDelay: `${index * 140}ms`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

function looksLikeStructuredJsonContent(content: string): boolean {
  const normalized = content.trim();
  if (!normalized.startsWith('{')) {
    return false;
  }

  return normalized.includes('"type"') || normalized.endsWith('}');
}

export type ResolveInlinePermissionActionsFn = (requestId: string) =>
  | {
      errorMessage?: string;
      helperMessage?: string;
      items: Array<{
        danger?: boolean;
        disabled?: boolean;
        hint?: string;
        id: string;
        label: string;
        onClick: () => void;
        primary?: boolean;
      }>;
      pendingLabel?: string;
      scopeLevels?: AlwaysScopeLevel[];
      selectedScopeCategory?: AlwaysScopeLevel['category'];
      selectedScopePattern?: string;
      onSelectScopeLevel?: (level: AlwaysScopeLevel) => void;
    }
  | undefined;

function isScopeLevelSelected(
  level: AlwaysScopeLevel,
  actions: NonNullable<ReturnType<ResolveInlinePermissionActionsFn>>,
): boolean {
  return (
    actions.selectedScopeCategory === level.category ||
    actions.selectedScopePattern === level.pattern
  );
}

function renderCompactScopeSelector(
  actions: NonNullable<ReturnType<ResolveInlinePermissionActionsFn>>,
  buttonStyle: React.CSSProperties,
): React.ReactNode {
  if (!actions.scopeLevels || actions.scopeLevels.length === 0 || !actions.onSelectScopeLevel) {
    return null;
  }

  return actions.scopeLevels.map((level) => {
    const isSelected = isScopeLevelSelected(level, actions);
    return (
      <button
        key={level.category}
        type="button"
        onClick={() => actions.onSelectScopeLevel?.(level)}
        title={`${level.description} ${level.pattern}`}
        aria-pressed={isSelected}
        style={{
          ...buttonStyle,
          border: isSelected
            ? '1px solid var(--accent)'
            : '1px solid color-mix(in srgb, var(--accent) 24%, var(--border-default))',
          background: isSelected
            ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
            : 'var(--bg-overlay)',
          color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
        }}
      >
        {level.label}
      </button>
    );
  });
}

export interface InlinePermissionQuickBarProps {
  permissions: Array<{
    requestId: string;
    toolName: string;
    reason: string;
    scope: string;
    riskLevel: string;
    previewAction?: string;
  }>;
  resolveActions: ResolveInlinePermissionActionsFn;
  /**
   * 紧凑模式：去掉为「对话气泡左侧头像列」预留的 40px 缩进。
   * 卡片墙等窄容器（<280px）里必须开 —— 否则可用宽度被白白吃掉六分之一。
   */
  dense?: boolean;
}

export function InlinePermissionQuickBar({
  permissions,
  resolveActions,
  dense = false,
}: InlinePermissionQuickBarProps) {
  if (permissions.length === 0) return null;

  return (
    <div
      data-testid="inline-permission-quick-bar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        paddingLeft: dense ? 0 : 40,
      }}
    >
      {permissions.map((permission) => {
        const actions = resolveActions(permission.requestId);
        return (
          <div
            key={permission.requestId}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              fontSize: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'var(--warning)',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{permission.toolName}</span>
              <span
                style={{
                  color: 'var(--fg-default)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {permission.reason}
              </span>
              {actions &&
                renderCompactScopeSelector(actions, {
                  appearance: 'none',
                  height: 20,
                  padding: '0 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  cursor: 'pointer',
                  flexShrink: 0,
                })}
              {actions &&
                actions.items.length > 0 &&
                actions.items.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    disabled={action.disabled}
                    onClick={action.onClick}
                    title={action.hint}
                    style={{
                      appearance: 'none',
                      height: 20,
                      padding: '0 7px',
                      borderRadius: 999,
                      border: 'none',
                      background: action.primary
                        ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                        : action.danger
                          ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
                          : 'color-mix(in srgb, var(--accent) 10%, transparent)',
                      color: action.danger ? 'var(--danger)' : 'var(--accent)',
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      cursor: action.disabled ? 'not-allowed' : 'pointer',
                      opacity: action.disabled ? 0.55 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              {actions?.errorMessage && (
                <span style={{ color: 'var(--danger)' }}>{actions.errorMessage}</span>
              )}
            </div>
            {permission.previewAction && (
              <div
                style={{
                  marginLeft: 11,
                  maxWidth: '100%',
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={permission.previewAction}
              >
                {permission.previewAction}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const COMPANION_FENCE_PATTERN = /```companion\n([\s\S]*?)```/;

function extractCompanionBlocks(
  content: string,
): { mainContent: string; companionContent: string } | null {
  const match = COMPANION_FENCE_PATTERN.exec(content);
  if (!match) {
    return null;
  }

  const companionContent = match[1]?.trim() ?? '';
  const mainContent = content.replace(match[0], '').trim();

  if (!companionContent) {
    return null;
  }

  return { mainContent, companionContent };
}

function CompanionInlineBlock({ content }: { content: string }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid color-mix(in oklch, var(--accent) 20%, transparent)',
        background: 'color-mix(in oklch, var(--accent) 6%, var(--bg-overlay))',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'color-mix(in oklch, var(--accent) 82%, var(--fg-on-accent) 18%)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: -1 }}>◈</span>
      <span>{content}</span>
    </div>
  );
}
