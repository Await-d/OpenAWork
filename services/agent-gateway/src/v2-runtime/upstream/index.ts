/**
 * v2 upstream barrel — central export surface for the production
 * AI SDK-backed upstream stack used by `routes/stream-model-round.ts`
 * and the adjacent non-streaming helpers.
 */

export {
  buildAISdkProvider,
  type AISdkProviderConfig,
  type BuiltAISdkProvider,
  type UpstreamProtocolKind,
  type V2LanguageModel,
} from './provider.js';

export {
  buildAISdkProviderFromConfig,
  type BridgeBuildInput,
  type BridgeBuildResult,
} from './bridge.js';

export {
  runUpstreamStream,
  type RunUpstreamStreamEvent,
  type RunUpstreamStreamInput,
} from './stream-runner.js';

export {
  runUpstreamGenerate,
  type RunUpstreamGenerateInput,
  type RunUpstreamGenerateResult,
} from './run-upstream-generate.js';

export {
  wrapToolForAiSdk,
  wrapToolsForAiSdk,
  wrapToolsForAiSdkDeclarationsOnly,
  wrapGatewayToolsForAiSdkDeclarationsOnly,
  type GatewayToolFunctionShape,
} from './tool-adapter.js';

export {
  unifiedConversationToModelMessages,
  unifiedMessageToModelMessages,
} from './unified-message-bridge.js';

export {
  buildBaseProviderOptions,
  buildProviderOptions,
  buildProviderOptionsModelInfo,
  mergeProviderOptions,
  providerOptions,
  type ProviderOptionsModelInfo,
  type ReasoningEffort,
  type ThinkingConfig,
} from './provider-options.js';

export {
  applyCaching,
  buildPromptCacheModelInfo,
  type PromptCacheModelInfo,
} from './cache-breakpoints.js';
