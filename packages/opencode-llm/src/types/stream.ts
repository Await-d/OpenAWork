import { z } from 'zod';
import { FinishReasonSchema, UsageSchema, type FinishReason, type Usage } from './completion.js';
import { ToolCallSchema, type ToolCall } from './message.js';

/**
 * Delta content for streaming
 */
export const DeltaContentSchema = z.object({
  type: z.literal('text').optional(),
  text: z.string().optional(),
});
export type DeltaContent = z.infer<typeof DeltaContentSchema>;

/**
 * Tool call delta for streaming
 */
export const ToolCallDeltaSchema = z.object({
  index: z.number(),
  id: z.string().optional(),
  type: z.literal('function').optional(),
  function: z
    .object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
});
export type ToolCallDelta = z.infer<typeof ToolCallDeltaSchema>;

/**
 * Message delta for streaming
 */
export const MessageDeltaSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']).optional(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(ToolCallDeltaSchema).optional(),
  refusal: z.string().nullable().optional(),
});
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

/**
 * Stream choice delta
 */
export const StreamChoiceDeltaSchema = z.object({
  index: z.number(),
  delta: MessageDeltaSchema,
  finish_reason: FinishReasonSchema.nullable().optional(),
  logprobs: z.unknown().nullable().optional(),
});
export type StreamChoiceDelta = z.infer<typeof StreamChoiceDeltaSchema>;

/**
 * Chat completion chunk (streaming response)
 */
export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion.chunk'),
  created: z.number(),
  model: z.string(),
  choices: z.array(StreamChoiceDeltaSchema),
  usage: UsageSchema.optional(),
  system_fingerprint: z.string().optional(),
  service_tier: z.string().optional(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;

/**
 * Stream event types
 */
export const StreamEventTypeSchema = z.enum([
  'content.start',
  'content.delta',
  'content.done',
  'tool_call.start',
  'tool_call.delta',
  'tool_call.done',
  'message.start',
  'message.delta',
  'message.done',
  'done',
  'error',
]);
export type StreamEventType = z.infer<typeof StreamEventTypeSchema>;

/**
 * Content start event
 */
export const ContentStartEventSchema = z.object({
  type: z.literal('content.start'),
  index: z.number(),
});
export type ContentStartEvent = z.infer<typeof ContentStartEventSchema>;

/**
 * Content delta event
 */
export const ContentDeltaEventSchema = z.object({
  type: z.literal('content.delta'),
  index: z.number(),
  delta: z.string(),
});
export type ContentDeltaEvent = z.infer<typeof ContentDeltaEventSchema>;

/**
 * Content done event
 */
export const ContentDoneEventSchema = z.object({
  type: z.literal('content.done'),
  index: z.number(),
  content: z.string(),
});
export type ContentDoneEvent = z.infer<typeof ContentDoneEventSchema>;

/**
 * Tool call start event
 */
export const ToolCallStartEventSchema = z.object({
  type: z.literal('tool_call.start'),
  index: z.number(),
  tool_call_id: z.string(),
  tool_name: z.string(),
});
export type ToolCallStartEvent = z.infer<typeof ToolCallStartEventSchema>;

/**
 * Tool call delta event
 */
export const ToolCallDeltaEventSchema = z.object({
  type: z.literal('tool_call.delta'),
  index: z.number(),
  tool_call_id: z.string(),
  delta: z.string(),
});
export type ToolCallDeltaEvent = z.infer<typeof ToolCallDeltaEventSchema>;

/**
 * Tool call done event
 */
export const ToolCallDoneEventSchema = z.object({
  type: z.literal('tool_call.done'),
  index: z.number(),
  tool_call: ToolCallSchema,
});
export type ToolCallDoneEvent = z.infer<typeof ToolCallDoneEventSchema>;

/**
 * Message start event
 */
export const MessageStartEventSchema = z.object({
  type: z.literal('message.start'),
  message: z.object({
    id: z.string(),
    role: z.enum(['assistant']),
    content: z.string(),
  }),
});
export type MessageStartEvent = z.infer<typeof MessageStartEventSchema>;

/**
 * Message delta event
 */
export const MessageDeltaEventSchema = z.object({
  type: z.literal('message.delta'),
  delta: MessageDeltaSchema,
});
export type MessageDeltaEvent = z.infer<typeof MessageDeltaEventSchema>;

/**
 * Message done event
 */
export const MessageDoneEventSchema = z.object({
  type: z.literal('message.done'),
  message: z.object({
    id: z.string(),
    role: z.enum(['assistant']),
    content: z.string().nullable(),
    tool_calls: z.array(ToolCallSchema).optional(),
  }),
});
export type MessageDoneEvent = z.infer<typeof MessageDoneEventSchema>;

/**
 * Done event (stream complete)
 */
export const DoneEventSchema = z.object({
  type: z.literal('done'),
  finish_reason: FinishReasonSchema,
  usage: UsageSchema.optional(),
});
export type DoneEvent = z.infer<typeof DoneEventSchema>;

/**
 * Error event
 */
export const ErrorEventSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;

/**
 * Union of all stream events
 */
export const StreamEventSchema = z.union([
  ContentStartEventSchema,
  ContentDeltaEventSchema,
  ContentDoneEventSchema,
  ToolCallStartEventSchema,
  ToolCallDeltaEventSchema,
  ToolCallDoneEventSchema,
  MessageStartEventSchema,
  MessageDeltaEventSchema,
  MessageDoneEventSchema,
  DoneEventSchema,
  ErrorEventSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

/**
 * SSE (Server-Sent Events) data format
 */
export const SSEDataSchema = z.object({
  data: z.string(),
  event: z.string().optional(),
  id: z.string().optional(),
  retry: z.number().optional(),
});
export type SSEData = z.infer<typeof SSEDataSchema>;

/**
 * Stream response wrapper
 */
export interface StreamResponse {
  readonly controller: ReadableStreamDefaultController;
  readonly stream: ReadableStream<Uint8Array>;
}

/**
 * Re-export related types
 */
export type { FinishReason, Usage, ToolCall };
