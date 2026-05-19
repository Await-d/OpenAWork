/**
 * SessionEvent — typed stream event taxonomy aligned with opencode's
 * `v2/session-event.ts` and `v2/session-entry.ts`.
 *
 * Purpose:
 * - Capture the LLM stream and tool execution lifecycle as a sequence of
 *   small, discriminated events (text.started/delta/ended, tool.input.*,
 *   tool.success/error, step.*, retried, compacted, prompt, synthetic).
 * - Power session replay (`replaySessionEntries`) and future event-sourced
 *   reads without redefining the data model.
 *
 * This is the OpenAWork-flavoured port: plain TypeScript (no Effect.Schema)
 * but with the same field names and semantics as opencode so the two stores
 * remain wire-compatible.
 *
 * Stored in the `session_entry` SQLite table; the row carries `id`, `type`,
 * `timestamp`, `client_request_id`, `seq`, plus a `data` blob containing the
 * remaining variant-specific fields (no duplication of `id`/`type`/`timestamp`).
 */

import { makeOrderedEventId } from '../ordered-id.js';

// ─── Types shared across variants ───

export type SessionEventID = string & { __brand: 'SessionEventID' };

export function makeSessionEventId(timestamp?: number): SessionEventID {
  return makeOrderedEventId(timestamp) as SessionEventID;
}

/** A range inside the original prompt text (e.g. for `@file` references). */
export interface SessionEventSource {
  start: number;
  end: number;
  text: string;
}

export interface SessionEventFileAttachment {
  uri: string;
  mime: string;
  name?: string;
  description?: string;
  source?: SessionEventSource;
}

export interface SessionEventAgentAttachment {
  name: string;
  source?: SessionEventSource;
}

export interface SessionEventRetryError {
  message: string;
  statusCode?: number;
  isRetryable: boolean;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  metadata?: Record<string, string>;
}

interface SessionEventBase {
  id: SessionEventID;
  /** Unix epoch milliseconds. */
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ─── Variants — flat literal union (close to opencode's tagged union) ───

export interface SessionEventPrompt extends SessionEventBase {
  type: 'prompt';
  text: string;
  files?: SessionEventFileAttachment[];
  agents?: SessionEventAgentAttachment[];
}

export interface SessionEventSynthetic extends SessionEventBase {
  type: 'synthetic';
  text: string;
}

export interface SessionEventStepStarted extends SessionEventBase {
  type: 'step.started';
  model: { id: string; providerID: string; variant?: string };
}

export interface SessionEventStepEnded extends SessionEventBase {
  type: 'step.ended';
  reason: string;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
}

export interface SessionEventTextStarted extends SessionEventBase {
  type: 'text.started';
}

export interface SessionEventTextDelta extends SessionEventBase {
  type: 'text.delta';
  delta: string;
}

export interface SessionEventTextEnded extends SessionEventBase {
  type: 'text.ended';
  text: string;
}

export interface SessionEventReasoningStarted extends SessionEventBase {
  type: 'reasoning.started';
}

export interface SessionEventReasoningDelta extends SessionEventBase {
  type: 'reasoning.delta';
  delta: string;
}

export interface SessionEventReasoningEnded extends SessionEventBase {
  type: 'reasoning.ended';
  text: string;
}

export interface SessionEventToolInputStarted extends SessionEventBase {
  type: 'tool.input.started';
  callID: string;
  name: string;
}

export interface SessionEventToolInputDelta extends SessionEventBase {
  type: 'tool.input.delta';
  callID: string;
  delta: string;
}

export interface SessionEventToolInputEnded extends SessionEventBase {
  type: 'tool.input.ended';
  callID: string;
  text: string;
}

export interface SessionEventToolCalled extends SessionEventBase {
  type: 'tool.called';
  callID: string;
  tool: string;
  input: Record<string, unknown>;
  provider: { executed: boolean; metadata?: Record<string, unknown> };
}

export interface SessionEventToolSuccess extends SessionEventBase {
  type: 'tool.success';
  callID: string;
  title: string;
  output?: string;
  attachments?: SessionEventFileAttachment[];
  provider: { executed: boolean; metadata?: Record<string, unknown> };
}

export interface SessionEventToolError extends SessionEventBase {
  type: 'tool.error';
  callID: string;
  error: string;
  provider: { executed: boolean; metadata?: Record<string, unknown> };
}

export interface SessionEventRetried extends SessionEventBase {
  type: 'retried';
  attempt: number;
  error: SessionEventRetryError;
}

export interface SessionEventCompacted extends SessionEventBase {
  type: 'compacted';
  auto: boolean;
  overflow?: boolean;
}

export type SessionEvent =
  | SessionEventPrompt
  | SessionEventSynthetic
  | SessionEventStepStarted
  | SessionEventStepEnded
  | SessionEventTextStarted
  | SessionEventTextDelta
  | SessionEventTextEnded
  | SessionEventReasoningStarted
  | SessionEventReasoningDelta
  | SessionEventReasoningEnded
  | SessionEventToolInputStarted
  | SessionEventToolInputDelta
  | SessionEventToolInputEnded
  | SessionEventToolCalled
  | SessionEventToolSuccess
  | SessionEventToolError
  | SessionEventRetried
  | SessionEventCompacted;

export type SessionEventType = SessionEvent['type'];

/**
 * All known event type literals — exported as a frozen array so callers can
 * validate persisted rows against the union without crawling the type system.
 */
export const SESSION_EVENT_TYPES: readonly SessionEventType[] = Object.freeze([
  'prompt',
  'synthetic',
  'step.started',
  'step.ended',
  'text.started',
  'text.delta',
  'text.ended',
  'reasoning.started',
  'reasoning.delta',
  'reasoning.ended',
  'tool.input.started',
  'tool.input.delta',
  'tool.input.ended',
  'tool.called',
  'tool.success',
  'tool.error',
  'retried',
  'compacted',
]);

export function isSessionEventType(value: string): value is SessionEventType {
  return (SESSION_EVENT_TYPES as readonly string[]).includes(value);
}
