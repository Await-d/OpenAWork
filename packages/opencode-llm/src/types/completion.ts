import { z } from 'zod';
import {
  MessageSchema,
  ToolDefinitionSchema,
  ToolChoiceSchema,
  ResponseFormatSchema,
  type Message,
  type ToolDefinition,
  type ToolChoice,
  type ResponseFormat,
  type ToolCall,
} from './message.js';

/**
 * Token usage information
 */
export const UsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  prompt_tokens_details: z
    .object({
      cached_tokens: z.number().optional(),
      audio_tokens: z.number().optional(),
    })
    .optional(),
  completion_tokens_details: z
    .object({
      reasoning_tokens: z.number().optional(),
      audio_tokens: z.number().optional(),
      accepted_prediction_tokens: z.number().optional(),
      rejected_prediction_tokens: z.number().optional(),
    })
    .optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Finish reason types
 */
export const FinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'function_call',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/**
 * Chat completion choice
 */
export const ChatCompletionChoiceSchema = z.object({
  index: z.number(),
  message: MessageSchema,
  finish_reason: FinishReasonSchema.nullable(),
  logprobs: z.unknown().nullable().optional(),
});
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;

/**
 * Chat completion response
 */
export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: UsageSchema.optional(),
  system_fingerprint: z.string().optional(),
  service_tier: z.string().optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

/**
 * Stream options
 */
export const StreamOptionsSchema = z.object({
  include_usage: z.boolean().optional(),
});
export type StreamOptions = z.infer<typeof StreamOptionsSchema>;

/**
 * Chat completion request parameters
 */
export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().min(1).optional(),
  stream: z.boolean().optional(),
  stream_options: StreamOptionsSchema.optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  logit_bias: z.record(z.string(), z.number()).optional(),
  user: z.string().optional(),
  seed: z.number().int().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  response_format: ResponseFormatSchema.optional(),
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().int().min(0).max(20).optional(),
  parallel_tool_calls: z.boolean().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

/**
 * Generation options (subset of completion request)
 */
export const GenerationOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  seed: z.number().int().optional(),
  logprobs: z.boolean().optional(),
  top_logprobs: z.number().int().min(0).max(20).optional(),
});
export type GenerationOptions = z.infer<typeof GenerationOptionsSchema>;

/**
 * Model information
 */
export const ModelInfoSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  owned_by: z.string(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

/**
 * List models response
 */
export const ListModelsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(ModelInfoSchema),
});
export type ListModelsResponse = z.infer<typeof ListModelsResponseSchema>;

/**
 * Re-export message types for convenience
 */
export type { Message, ToolDefinition, ToolChoice, ResponseFormat, ToolCall };
