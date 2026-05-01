import type { ToolCallCardProps } from '@openAwork/shared-ui';
import { BatchToolCallCard } from './batch-tool-call-card.js';
import { BlockToolCall } from './block-tool-call.js';
import { GenerateImageToolCard } from './generate-image-tool-card.js';
import { InlineToolCall } from './inline-tool-call.js';
import { isInlineTool } from './shared/inline-tool-set.js';

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
}

export function ToolCallDisplay(props: ToolCallDisplayProps) {
  const normalized = props.toolName.trim().toLowerCase();

  if (
    normalized === 'task' ||
    normalized === 'agent' ||
    normalized === 'call_omo_agent' ||
    normalized === 'delegate_task'
  ) {
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

  if (isInlineTool(props.toolName)) {
    return (
      <InlineToolCall
        approvalActions={props.approvalActions}
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
