export type ToolCardStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface TaskToolMeta {
  agentType?: string;
  command?: string;
  description?: string;
  prompt?: string;
  requestedTaskId?: string;
  outputTaskId?: string;
  outputSessionId?: string;
  outputStatus?: string;
  outputErrorMessage?: string;
  outputMessage?: string;
  outputResult?: string;
  readonly: boolean;
  extraOutput?: unknown;
  hasAdditionalInputFields: boolean;
}

export interface TaskSummaryData {
  footer?: string;
  preview?: string;
  subtitle?: string;
  title: string;
}

export interface StatusMeta {
  color: string;
  dot: string;
  label: string;
}

export type ToolKind = 'agent' | 'mcp' | 'skill' | 'tool';
export type PillTone = 'danger' | 'info' | 'muted' | 'success' | 'warning';
