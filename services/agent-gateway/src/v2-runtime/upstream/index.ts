/**
 * Phase 4 upstream barrel — surfaces the AI SDK provider factory and
 * the `streamText`-driven stream runner so future phases can wire them
 * up behind `OPENAWORK_RUNTIME_UPSTREAM=v2` without reaching into the
 * private files directly.
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
  normalizedConversationToModelMessages,
  normalizedMessageToModelMessages,
} from './normalized-message-bridge.js';

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
  buildProviderOptions,
  type ReasoningEffort,
  type ThinkingConfig,
} from './provider-options.js';

export { applyAnthropicCacheBreakpoints } from './cache-breakpoints.js';

export { compareV1V2BridgeStructural, type BridgeDiffSummary } from './bridge-diff.js';
