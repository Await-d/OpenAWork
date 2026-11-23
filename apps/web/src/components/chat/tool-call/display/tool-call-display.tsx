import type { InputImageContent } from '@openAwork/shared';
import { shellToolTerminalId, useShellProgress } from '../../shell-progress.js';
import { isSubagentToolName } from '@openAwork/shared-ui';
import type { ToolCallCardProps } from '@openAwork/shared-ui';
import { BatchToolCallCard } from '../cards/batch-tool-call-card.js';
import { BlockToolCall } from './block-tool-call.js';
import { ComputerUseToolCard } from '../cards/computer-use-tool-card.js';
import { DesktopToolCard } from '../cards/desktop-tool-card.js';
import { isDesktopTool } from '../shared/desktop-tool-view.js';
import { GenerateImageToolCard } from '../cards/generate-image-tool-card.js';
import { ConvertMediaToolCard } from '../cards/convert-media-tool-card.js';
import { GenerateAudioToolCard } from '../cards/generate-audio-tool-card.js';
import { ExtractVideoFrameToolCard } from '../cards/extract-video-frame-tool-card.js';
import { InlineToolCall } from './inline-tool-call.js';
import { isInlineTool } from '../shared/inline-tool-set.js';
import { isToolInputPending } from '../shared/pending-tool-input.js';
import { shouldSuppressQuestionToolCall } from '../shared/question-tool-suppression.js';
import { ToolCallPendingCard } from './tool-call-pending-card.js';

/* ── Router: pick inline vs block ── */

export interface ToolCallDisplayProps {
  approvalActions?: ToolCallCardProps['approvalActions'];
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status?: ToolCallCardProps['status'];
  isError?: boolean;
  durationMs?: number;
  resumedAfterApproval?: boolean;
  kind?: ToolCallCardProps['kind'];
  toolCallId?: string;
  pendingPermissionRequestId?: string;
  /**
   * 嵌在 batch 子行展开区里渲染：外层行已经提供标题 / 状态 / 摘要，
   * 嵌套卡只渲染内容本体（block 卡隐藏 header，inline 卡隐藏整行）。
   */
  embedded?: boolean;
  /**
   * tool result 的图片附件通道（`StreamToolResultChunk.attachments`）。
   *
   * 目前只有 `computer_use` 消费它（最终截图不在 output 里）；其余卡片忽略。
   */
  attachments?: readonly InputImageContent[];
  fileDiffs?: unknown;
  /** 当前消息所属会话 id（可选，仅供文件变更卡按需加载完整快照）。 */
  sessionId?: string | undefined;
}

export function ToolCallDisplay(props: ToolCallDisplayProps) {
  const normalized = props.toolName.trim().toLowerCase();
  const shellProgress = useShellProgress();
  // 提问工具在「等待回答」期间的唯一入口是 composer 上方的专属面板
  // （`InlineQuestionPanel`），消息流里再画一条工具条目会让同一件事出现两份，
  // 且必然产生「先工具调用、后跳成提问面板」的时序跳变。裁决与「结算后必须恢复
  // 可见」的理由见 `question-tool-suppression.ts`。必须放在下面
  // `isToolInputPending` 之前：骨架卡同样属于「流内工具条目」。
  if (
    shouldSuppressQuestionToolCall({
      toolName: props.toolName,
      isError: props.isError,
      output: props.output,
      status: props.status,
    })
  ) {
    return null;
  }
  // 流式入参还没收全（`tool_call_delta` 只到了半截 JSON）：此刻渲染真实卡片只会
  // 把原始格式铺给用户，等尾部的 `}` 到了又跳成正常内容。统一换成骨架占位，
  // 参数收全 / `tool_result` 到达后自动回落下面的真实卡片路由。
  if (
    isToolInputPending({
      input: props.input,
      isError: props.isError,
      output: props.output,
      status: props.status,
    })
  ) {
    return <ToolCallPendingCard embedded={props.embedded === true} toolName={props.toolName} />;
  }
  const terminalId = shellToolTerminalId(props.toolName, props.input, props.output);
  if (
    terminalId &&
    !props.pendingPermissionRequestId &&
    !props.approvalActions &&
    shellProgress?.knownIds.has(terminalId) &&
    !shellProgress.visibleIds.has(terminalId)
  ) {
    return null;
  }

  if (isSubagentToolName(normalized)) {
    return null; // Task tools handled separately by TaskToolInline
  }

  if (normalized === 'batch') {
    return (
      <BatchToolCallCard
        approvalActions={props.approvalActions}
        kind={props.kind}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        sessionId={props.sessionId}
        renderToolCallDisplay={(p) => <ToolCallDisplay {...p} />}
      />
    );
  }

  if (props.toolName.trim().toLowerCase() === 'generate_image') {
    return (
      <GenerateImageToolCard
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (props.toolName.trim().toLowerCase() === 'convert_media') {
    return (
      <ConvertMediaToolCard
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (props.toolName.trim().toLowerCase() === 'generate_audio') {
    return (
      <GenerateAudioToolCard
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (props.toolName.trim().toLowerCase() === 'extract_video_frame') {
    return (
      <ExtractVideoFrameToolCard
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  // computer_use 必须早于 isInlineTool 兜底：它不在 inline 名单里，但仍放在
  // 兜底之前，避免后续有人把它误加进 INLINE_TOOLS 后静默退化成一行的 pill。
  if (normalized === 'computer_use') {
    return (
      <ComputerUseToolCard
        approvalActions={props.approvalActions}
        attachments={props.attachments}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
        kind={props.kind}
        pendingPermissionRequestId={props.pendingPermissionRequestId}
      />
    );
  }

  // 桌面 / 浏览器自动化：动作语义在入参里，通用输出只能给出 `{ok:true}` 的字段表，
  // 因此单独成卡（动作 + 目标 + 截图 + 读取类动作的真实返回）。
  if (isDesktopTool(normalized)) {
    return (
      <DesktopToolCard
        approvalActions={props.approvalActions}
        pendingPermissionRequestId={props.pendingPermissionRequestId}
        kind={props.kind}
        toolName={props.toolName}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        durationMs={props.durationMs}
      />
    );
  }

  if (isInlineTool(props.toolName)) {
    return (
      <InlineToolCall
        approvalActions={props.approvalActions}
        pendingPermissionRequestId={props.pendingPermissionRequestId}
        kind={props.kind}
        toolName={props.toolName}
        input={props.input}
        output={props.output}
        status={props.status}
        isError={props.isError}
        embedded={props.embedded === true}
        sessionId={props.sessionId}
      />
    );
  }

  return (
    <BlockToolCall
      fileDiffs={props.fileDiffs}
      approvalActions={props.approvalActions}
      pendingPermissionRequestId={props.pendingPermissionRequestId}
      kind={props.kind}
      toolName={props.toolName}
      input={props.input}
      output={props.output}
      status={props.status}
      isError={props.isError}
      durationMs={props.durationMs}
      embedded={props.embedded === true}
      sessionId={props.sessionId}
    />
  );
}
