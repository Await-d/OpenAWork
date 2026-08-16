/**
 * OpenAI-compatible type definitions for OpenCode LLM
 *
 * This module provides comprehensive type definitions that are fully compatible
 * with the OpenAI API, using Zod for runtime validation.
 */

// Message types
export {
  MessageRoleSchema,
  TextContentPartSchema,
  ImageUrlContentPartSchema,
  FunctionCallSchema,
  ToolCallSchema,
  ContentPartSchema,
  MessageContentSchema,
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
  MessageSchema,
  FunctionParametersSchema,
  FunctionDefinitionSchema,
  ToolDefinitionSchema,
  ToolChoiceAutoSchema,
  ToolChoiceNoneSchema,
  ToolChoiceRequiredSchema,
  ToolChoiceNamedSchema,
  ToolChoiceSchema,
  ResponseFormatTextSchema,
  ResponseFormatJsonObjectSchema,
  ResponseFormatJsonSchemaSchema,
  ResponseFormatSchema,
} from './message.js';

export type {
  MessageRole,
  TextContentPart,
  ImageUrlContentPart,
  FunctionCall,
  ToolCall,
  ContentPart,
  MessageContent,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  Message,
  FunctionParameters,
  FunctionDefinition,
  ToolDefinition,
  ToolChoice,
  ResponseFormat,
} from './message.js';

// Completion types
export {
  UsageSchema,
  FinishReasonSchema,
  ChatCompletionChoiceSchema,
  ChatCompletionResponseSchema,
  StreamOptionsSchema,
  ChatCompletionRequestSchema,
  GenerationOptionsSchema,
  ModelInfoSchema,
  ListModelsResponseSchema,
} from './completion.js';

export type {
  Usage,
  FinishReason,
  ChatCompletionChoice,
  ChatCompletionResponse,
  StreamOptions,
  ChatCompletionRequest,
  GenerationOptions,
  ModelInfo,
  ListModelsResponse,
} from './completion.js';

// Stream types
export {
  DeltaContentSchema,
  ToolCallDeltaSchema,
  MessageDeltaSchema,
  StreamChoiceDeltaSchema,
  ChatCompletionChunkSchema,
  StreamEventTypeSchema,
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
  StreamEventSchema,
  SSEDataSchema,
} from './stream.js';

export type {
  DeltaContent,
  ToolCallDelta,
  MessageDelta,
  StreamChoiceDelta,
  ChatCompletionChunk,
  StreamEventType,
  ContentStartEvent,
  ContentDeltaEvent,
  ContentDoneEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallDoneEvent,
  MessageStartEvent,
  MessageDeltaEvent,
  MessageDoneEvent,
  DoneEvent,
  ErrorEvent,
  StreamEvent,
  SSEData,
  StreamResponse,
} from './stream.js';

// Error types
export {
  ErrorTypeSchema,
  ErrorCodeSchema,
  ErrorDetailSchema,
  APIErrorResponseSchema,
  RateLimitInfoSchema,
  ExtendedErrorSchema,
  OpenAIError,
  InvalidRequestError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  ContextLengthError,
  ContentPolicyError,
  APIError,
  TimeoutError,
  NetworkError,
  parseErrorResponse,
  createErrorFromResponse,
} from './error.js';

export type {
  ErrorType,
  ErrorCode,
  ErrorDetail,
  APIErrorResponse,
  RateLimitInfo,
  ExtendedError,
} from './error.js';

// Provider types
export {
  ProviderTypeSchema,
  AuthConfigSchema,
  HttpConfigSchema,
  ModelLimitsSchema,
  ModelConfigSchema,
  ProviderConfigSchema,
  OpenAIConfigSchema,
  AzureConfigSchema,
  AnthropicConfigSchema,
  GoogleConfigSchema,
  DeepSeekConfigSchema,
  CustomProviderConfigSchema,
  ProviderRegistryEntrySchema,
  ProviderRegistrySchema,
  ProviderCapabilitiesSchema,
  ProviderStatusSchema,
  createProviderConfig,
  validateProviderConfig,
} from './provider.js';

export type {
  ProviderType,
  AuthConfig,
  HttpConfig,
  ModelLimits,
  ModelConfig,
  ProviderConfig,
  OpenAIConfig,
  AzureConfig,
  AnthropicConfig,
  GoogleConfig,
  DeepSeekConfig,
  CustomProviderConfig,
  ProviderRegistryEntry,
  ProviderRegistry,
  ProviderCapabilities,
  ProviderStatus,
  ProviderInitOptions,
  IProvider,
} from './provider.js';
