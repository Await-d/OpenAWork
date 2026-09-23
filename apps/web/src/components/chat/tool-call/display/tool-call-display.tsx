import type { InputImageContent } from '@openAwork/shared';
import { isSubagentToolName } from '@openAwork/shared-ui';
import type { ToolCallCardProps } from '@openAwork/shared-ui';
import { BatchToolCallCard } from '../cards/batch-tool-call-card.js';
import { BlockToolCall } from './block-tool-call.js';
import { ComputerUseToolCard } from '../cards/computer-use-tool-card.js';
import { GenerateImageToolCard } from '../cards/generate-image-tool-card.js';
import { ConvertMediaToolCard } from '../cards/convert-media-tool-card.js';
import { GenerateAudioToolCard } from '../cards/generate-audio-tool-card.js';
import { ExtractVideoFrameToolCard } from '../cards/extract-video-frame-tool-card.js';
import { InlineToolCall } from './inline-tool-call.js';
import { isInlineTool } from '../shared/inline-tool-set.js';

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
   * tool result 的图片附件通道（`StreamToolResultChunk.attachments`）。
   *
   * 目前只有 `computer_use` 消费它（最终截图不在 output 里）；其余卡片忽略。
   */
  attachments?: readonly InputImageContent[];
}

export function ToolCallDisplay(props: ToolCallDisplayProps) {
  const normalized = props.toolName.trim().toLowerCase();

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
      />
    );
  }

  return (
    <BlockToolCall
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
