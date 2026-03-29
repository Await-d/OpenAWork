import type {
  AgentVizAdapter,
  AgentVizChannel,
  AgentVizEvent,
  AgentVizEventType,
} from './types.js';

export interface AgentVizBridge {
  addAdapter(adapter: AgentVizAdapter): void;
  removeAdapter(channel: AgentVizChannel): void;
  emit(event: AgentVizEvent): void;
  agentStarted(agentId: string, agentName: string, sessionId: string): void;
  agentThinking(agentId: string, sessionId: string, content: string): void;
  agentToolCall(agentId: string, sessionId: string, toolName: string): void;
  agentToolDone(agentId: string, sessionId: string, toolName: string, durationMs: number): void;
  agentDone(agentId: string, sessionId: string): void;
  agentError(agentId: string, sessionId: string, error: string): void;
}

export class AgentVizBridgeImpl implements AgentVizBridge {
  private readonly adapters = new Map<AgentVizChannel, AgentVizAdapter>();
  private readonly agentNames = new Map<string, string>();

  addAdapter(adapter: AgentVizAdapter): void {
    const existing = this.adapters.get(adapter.channel);
    if (existing?.close) {
      existing.close();
    }
    this.adapters.set(adapter.channel, adapter);
  }

  removeAdapter(channel: AgentVizChannel): void {
    const existing = this.adapters.get(channel);
    if (existing?.close) {
      existing.close();
    }
    this.adapters.delete(channel);
  }

  emit(event: AgentVizEvent): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.emit(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `[AgentVizBridge] adapter ${adapter.channel} emit failed: ${message}\n`,
        );
      }
    }
  }

  agentStarted(agentId: string, agentName: string, sessionId: string): void {
    this.agentNames.set(agentId, agentName);
    this.emit(this.createEvent('agent_started', agentId, sessionId, undefined, agentName));
  }

  agentThinking(agentId: string, sessionId: string, content: string): void {
    this.emit(this.createEvent('agent_thinking', agentId, sessionId, { content }));
  }

  agentToolCall(agentId: string, sessionId: string, toolName: string): void {
    this.emit(this.createEvent('agent_tool_call', agentId, sessionId, { toolName }));
  }

  agentToolDone(agentId: string, sessionId: string, toolName: string, durationMs: number): void {
    this.emit(this.createEvent('agent_tool_done', agentId, sessionId, { toolName, durationMs }));
  }

  agentDone(agentId: string, sessionId: string): void {
    this.emit(this.createEvent('agent_done', agentId, sessionId));
    this.agentNames.delete(agentId);
  }

  agentError(agentId: string, sessionId: string, error: string): void {
    this.emit(this.createEvent('agent_error', agentId, sessionId, { error }));
    this.agentNames.delete(agentId);
  }

  private createEvent(
    type: AgentVizEventType,
    agentId: string,
    sessionId: string,
    data?: AgentVizEvent['data'],
    agentName?: string,
  ): AgentVizEvent {
    const resolvedName = agentName ?? this.agentNames.get(agentId);
    return {
      type,
      agentId,
      agentName: resolvedName,
      sessionId,
      timestamp: Date.now(),
      data,
    };
  }
}

export class ConsoleAgentVizAdapter implements AgentVizAdapter {
  readonly channel: AgentVizChannel = 'console';

  emit(event: AgentVizEvent): void {
    const time = new Date(event.timestamp).toISOString().slice(11, 19);
    const name = event.agentName ?? event.agentId;
    const detail =
      event.data?.toolName ?? event.data?.content?.slice(0, 80) ?? event.data?.error ?? '';
    console.log(`[${time}] [${name}] ${event.type}${detail ? `: ${detail}` : ''}`);
  }
}

export class WebSocketAgentVizAdapter implements AgentVizAdapter {
  readonly channel: AgentVizChannel = 'websocket';

  constructor(private readonly send: (data: string) => void) {}

  emit(event: AgentVizEvent): void {
    this.send(JSON.stringify(event));
  }
}
