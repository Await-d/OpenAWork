export type ToolCardStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface TaskToolMeta {
  agentType?: string;
  command?: string;
  description?: string;
  prompt?: string;
  requestedTaskId?: string;
  /**
   * 输入侧显式指定的子会话 id（`session_id` / `sessionID`）。
   *
   * resume 场景下工具结果可能尚未返回，卡片预览只能靠它定位子会话；
   * `outputSessionId` 仍是运行结果里的权威来源，两者缺失顺序：output > requested。
   */
  requestedSessionId?: string;
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
