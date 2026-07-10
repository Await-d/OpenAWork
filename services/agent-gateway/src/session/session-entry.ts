/**
 * SessionEntry — high-level aggregates derived from a sequence of
 * `SessionEvent`s, mirroring opencode's `v2/session-entry.ts`.
 *
 * Each entry collapses a turn-shaped slice of the raw event stream into
 * a single logical record:
 *   - User      — a single `prompt` event (with attachments and agents).
 *   - Synthetic — a single `synthetic` event.
 *   - Assistant — opens with `step.started`, accumulates tool/text/reasoning
 *                 events scoped to the same step, closes with `step.ended`.
 *   - Compaction — a single `compacted` event.
 *
 * The aggregation is intentionally pure and side-effect free; callers feed
 * in a chronologically-ordered iterator of `SessionEvent` and receive an
 * array of `SessionEntry` that the UI / replay tooling can consume.
 */

import type {
  SessionEvent,
  SessionEventFileAttachment,
  SessionEventAgentAttachment,
  SessionEventRetryError,
} from './session-event.js';

// ─── Tool state — derived from tool.input.* + tool.called + tool.success/error ───

export interface SessionEntryToolStatePending {
  status: 'pending';
  input: string; // raw streamed text fragments
}

export interface SessionEntryToolStateRunning {
  status: 'running';
  input: Record<string, unknown>;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionEntryToolStateCompleted {
  status: 'completed';
  input: Record<string, unknown>;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  attachments?: SessionEventFileAttachment[];
}

export interface SessionEntryToolStateError {
  status: 'error';
  input: Record<string, unknown>;
  error: string;
  metadata?: Record<string, unknown>;
}

export type SessionEntryToolState =
  | SessionEntryToolStatePending
  | SessionEntryToolStateRunning
  | SessionEntryToolStateCompleted
  | SessionEntryToolStateError;

export interface SessionEntryAssistantTool {
  type: 'tool';
  callID: string;
  name: string;
  state: SessionEntryToolState;
  time: { created: number; ran?: number; completed?: number };
}

export interface SessionEntryAssistantText {
  type: 'text';
  text: string;
}

export interface SessionEntryAssistantReasoning {
  type: 'reasoning';
  text: string;
}

export type SessionEntryAssistantContent =
  SessionEntryAssistantText | SessionEntryAssistantReasoning | SessionEntryAssistantTool;

export interface SessionEntryAssistantRetry {
  attempt: number;
  error: SessionEventRetryError;
  time: { created: number };
}

// ─── Entry variants ───

export interface SessionEntryUser {
  type: 'user';
  id: string;
  text: string;
  files?: SessionEventFileAttachment[];
  agents?: SessionEventAgentAttachment[];
  time: { created: number };
}

export interface SessionEntrySynthetic {
  type: 'synthetic';
  id: string;
  text: string;
  time: { created: number };
}

export interface SessionEntryAssistant {
  type: 'assistant';
  id: string;
  content: SessionEntryAssistantContent[];
  retries?: SessionEntryAssistantRetry[];
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  error?: string;
  time: { created: number; completed?: number };
}

export interface SessionEntryCompaction {
  type: 'compaction';
  id: string;
  auto: boolean;
  overflow?: boolean;
  time: { created: number };
}

export type SessionEntry =
  SessionEntryUser | SessionEntrySynthetic | SessionEntryAssistant | SessionEntryCompaction;

// ─── Aggregation: SessionEvent[] → SessionEntry[] ───

/**
 * Reduce a chronological sequence of `SessionEvent`s into the logical
 * `SessionEntry[]` view. The reducer is purposefully forgiving: events
 * that arrive in unexpected order (e.g. a tool.success before tool.called)
 * are still applied if a matching open entry / tool slot exists, otherwise
 * they are dropped. This mirrors opencode's tolerant `fromEvent` builders.
 */
export function aggregateSessionEntries(events: Iterable<SessionEvent>): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let openAssistant: SessionEntryAssistant | null = null;

  const closeAssistant = (timestamp?: number): void => {
    if (!openAssistant) return;
    if (timestamp !== undefined) {
      openAssistant.time.completed = timestamp;
    }
    openAssistant = null;
  };

  const findToolByCallID = (
    target: SessionEntryAssistant,
    callID: string,
  ): SessionEntryAssistantTool | undefined => {
    for (let i = target.content.length - 1; i >= 0; i--) {
      const part = target.content[i]!;
      if (part.type === 'tool' && part.callID === callID) return part;
    }
    return undefined;
  };

  for (const event of events) {
    switch (event.type) {
      case 'prompt': {
        closeAssistant();
        entries.push({
          type: 'user',
          id: event.id,
          text: event.text,
          ...(event.files ? { files: event.files } : {}),
          ...(event.agents ? { agents: event.agents } : {}),
          time: { created: event.timestamp },
        });
        break;
      }
      case 'synthetic': {
        closeAssistant();
        entries.push({
          type: 'synthetic',
          id: event.id,
          text: event.text,
          time: { created: event.timestamp },
        });
        break;
      }
      case 'compacted': {
        closeAssistant();
        entries.push({
          type: 'compaction',
          id: event.id,
          auto: event.auto,
          ...(event.overflow !== undefined ? { overflow: event.overflow } : {}),
          time: { created: event.timestamp },
        });
        break;
      }
      case 'step.started': {
        closeAssistant();
        const next: SessionEntryAssistant = {
          type: 'assistant',
          id: event.id,
          content: [],
          time: { created: event.timestamp },
        };
        entries.push(next);
        openAssistant = next;
        break;
      }
      case 'step.ended': {
        if (openAssistant) {
          openAssistant.cost = event.cost;
          openAssistant.tokens = event.tokens;
          openAssistant.time.completed = event.timestamp;
          openAssistant = null;
        }
        break;
      }
      case 'text.started': {
        if (!openAssistant) break;
        openAssistant.content.push({ type: 'text', text: '' });
        break;
      }
      case 'text.delta': {
        if (!openAssistant) break;
        const last = openAssistant.content[openAssistant.content.length - 1];
        if (last && last.type === 'text') {
          last.text += event.delta;
        } else {
          openAssistant.content.push({ type: 'text', text: event.delta });
        }
        break;
      }
      case 'text.ended': {
        if (!openAssistant) break;
        const last = openAssistant.content[openAssistant.content.length - 1];
        if (last && last.type === 'text') {
          last.text = event.text;
        } else {
          openAssistant.content.push({ type: 'text', text: event.text });
        }
        break;
      }
      case 'reasoning.started': {
        if (!openAssistant) break;
        openAssistant.content.push({ type: 'reasoning', text: '' });
        break;
      }
      case 'reasoning.delta': {
        if (!openAssistant) break;
        const last = openAssistant.content[openAssistant.content.length - 1];
        if (last && last.type === 'reasoning') {
          last.text += event.delta;
        } else {
          openAssistant.content.push({ type: 'reasoning', text: event.delta });
        }
        break;
      }
      case 'reasoning.ended': {
        if (!openAssistant) break;
        const last = openAssistant.content[openAssistant.content.length - 1];
        if (last && last.type === 'reasoning') {
          last.text = event.text;
        } else {
          openAssistant.content.push({ type: 'reasoning', text: event.text });
        }
        break;
      }
      case 'tool.input.started': {
        if (!openAssistant) break;
        openAssistant.content.push({
          type: 'tool',
          callID: event.callID,
          name: event.name,
          state: { status: 'pending', input: '' },
          time: { created: event.timestamp },
        });
        break;
      }
      case 'tool.input.delta': {
        if (!openAssistant) break;
        const tool = findToolByCallID(openAssistant, event.callID);
        if (tool && tool.state.status === 'pending') {
          tool.state.input += event.delta;
        }
        break;
      }
      case 'tool.input.ended': {
        if (!openAssistant) break;
        const tool = findToolByCallID(openAssistant, event.callID);
        if (tool && tool.state.status === 'pending') {
          tool.state.input = event.text;
        }
        break;
      }
      case 'tool.called': {
        if (!openAssistant) break;
        const tool = findToolByCallID(openAssistant, event.callID);
        if (tool) {
          tool.state = {
            status: 'running',
            input: event.input,
          };
          tool.time.ran = event.timestamp;
        } else {
          openAssistant.content.push({
            type: 'tool',
            callID: event.callID,
            name: event.tool,
            state: { status: 'running', input: event.input },
            time: { created: event.timestamp, ran: event.timestamp },
          });
        }
        break;
      }
      case 'tool.success': {
        if (!openAssistant) break;
        const tool = findToolByCallID(openAssistant, event.callID);
        if (!tool) break;
        const previousInput =
          tool.state.status === 'running' ||
          tool.state.status === 'completed' ||
          tool.state.status === 'error'
            ? tool.state.input
            : {};
        tool.state = {
          status: 'completed',
          input: previousInput,
          output: event.output ?? '',
          title: event.title,
          metadata: {},
          ...(event.attachments && event.attachments.length > 0
            ? { attachments: event.attachments }
            : {}),
        };
        tool.time.completed = event.timestamp;
        break;
      }
      case 'tool.error': {
        if (!openAssistant) break;
        const tool = findToolByCallID(openAssistant, event.callID);
        if (!tool) break;
        const previousInput =
          tool.state.status === 'running' ||
          tool.state.status === 'completed' ||
          tool.state.status === 'error'
            ? tool.state.input
            : {};
        tool.state = {
          status: 'error',
          input: previousInput,
          error: event.error,
        };
        tool.time.completed = event.timestamp;
        break;
      }
      case 'retried': {
        if (!openAssistant) break;
        const retries = openAssistant.retries ?? [];
        retries.push({
          attempt: event.attempt,
          error: event.error,
          time: { created: event.timestamp },
        });
        openAssistant.retries = retries;
        break;
      }
    }
  }

  return entries;
}
