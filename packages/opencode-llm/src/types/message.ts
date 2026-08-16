import { z } from 'zod';

/**
 * OpenAI-compatible message role types
 */
export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/**
 * Text content part
 */
export const TextContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});
export type TextContentPart = z.infer<typeof TextContentPartSchema>;

/**
 * Image URL content part
 */
export const ImageUrlContentPartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});
export type ImageUrlContentPart = z.infer<typeof ImageUrlContentPartSchema>;

/**
 * Tool call function
 */
export const FunctionCallSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});
export type FunctionCall = z.infer<typeof FunctionCallSchema>;

/**
 * Tool call
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: FunctionCallSchema,
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Content part union
 */
export const ContentPartSchema = z.union([TextContentPartSchema, ImageUrlContentPartSchema]);
export type ContentPart = z.infer<typeof ContentPartSchema>;

/**
 * Message content (string or array of content parts)
 */
export const MessageContentSchema = z.union([z.string(), z.array(ContentPartSchema)]);
export type MessageContent = z.infer<typeof MessageContentSchema>;

/**
 * System message
 */
export const SystemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
});
export type SystemMessage = z.infer<typeof SystemMessageSchema>;

/**
 * User message
 */
export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: MessageContentSchema,
  name: z.string().optional(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

/**
 * Assistant message
 */
export const AssistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
  refusal: z.string().nullable().optional(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

/**
 * Tool message
 */
export const ToolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string(),
});
export type ToolMessage = z.infer<typeof ToolMessageSchema>;

/**
 * Message union (all message types)
 */
export const MessageSchema = z.union([
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);
export type Message = z.infer<typeof MessageSchema>;

/**
 * Tool definition function parameters
 */
export const FunctionParametersSchema = z.record(z.string(), z.unknown());
export type FunctionParameters = z.infer<typeof FunctionParametersSchema>;

/**
 * Tool function definition
 */
export const FunctionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: FunctionParametersSchema.optional(),
  strict: z.boolean().optional(),
});
export type FunctionDefinition = z.infer<typeof FunctionDefinitionSchema>;

/**
 * Tool definition
 */
export const ToolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: FunctionDefinitionSchema,
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * Tool choice - auto, none, required, or specific function
 */
export const ToolChoiceAutoSchema = z.literal('auto');
export const ToolChoiceNoneSchema = z.literal('none');
export const ToolChoiceRequiredSchema = z.literal('required');
export const ToolChoiceNamedSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
  }),
});

export const ToolChoiceSchema = z.union([
  ToolChoiceAutoSchema,
  ToolChoiceNoneSchema,
  ToolChoiceRequiredSchema,
  ToolChoiceNamedSchema,
]);
export type ToolChoice = z.infer<typeof ToolChoiceSchema>;

/**
 * Response format types
 */
export const ResponseFormatTextSchema = z.object({
  type: z.literal('text'),
});

export const ResponseFormatJsonObjectSchema = z.object({
  type: z.literal('json_object'),
});

export const ResponseFormatJsonSchemaSchema = z.object({
  type: z.literal('json_schema'),
  json_schema: z.object({
    name: z.string(),
    description: z.string().optional(),
    schema: z.record(z.string(), z.unknown()),
    strict: z.boolean().optional(),
  }),
});

export const ResponseFormatSchema = z.union([
  ResponseFormatTextSchema,
  ResponseFormatJsonObjectSchema,
  ResponseFormatJsonSchemaSchema,
]);
export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;
