export type AgentVizEventType =
  | 'agent_started'
  | 'agent_thinking'
  | 'agent_tool_call'
  | 'agent_tool_done'
  | 'agent_message'
  | 'agent_done'
  | 'agent_error';

export interface AgentVizEvent {
  type: AgentVizEventType;
  agentId: string;
  agentName?: string;
  sessionId: string;
  timestamp: number;
  data?: {
    toolName?: string;
    content?: string;
    error?: string;
    durationMs?: number;
  };
}

export type AgentVizChannel = 'console' | 'websocket' | 'custom';

export interface AgentVizAdapter {
  channel: AgentVizChannel;
  emit(event: AgentVizEvent): void;
  close?(): void;
}
