import { ToolGlyph } from '@openAwork/shared-ui';
import type { ToolCallCardProps } from '@openAwork/shared-ui';

export type ToolVisualStatus =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'paused'
  | 'pending'
  | 'running';

export function ToolIcon({
  kind,
  toolName,
  status,
  size = 14,
}: {
  kind?: ToolCallCardProps['kind'];
  toolName: string;
  status: ToolVisualStatus;
  size?: number;
}) {
  return (
    <span className="tool-icon" data-state={status} style={{ width: size, height: size }}>
      {status === 'running' && <span className="tool-icon-ping" />}
      <ToolGlyph kind={kind} size={size} toolName={toolName} />
    </span>
  );
}
