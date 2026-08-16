export type { UpstreamProtocolKind } from './native-model.js';

export {
  runUpstreamStream,
  type RunUpstreamStreamEvent,
  type RunUpstreamStreamInput,
} from './stream-runner.js';

export { buildNativeModel, NativeModel, type NativeModelInput } from './native-model.js';
export {
  extractNativeSystemFromUnifiedMessages,
  unifiedConversationToNativeMessages,
} from './native-message-bridge.js';

export {
  runUpstreamGenerate,
  UpstreamGenerateAbortError,
  UpstreamGenerateTimeoutError,
  type RunUpstreamGenerateError,
  type RunUpstreamGenerateInput,
  type RunUpstreamGenerateResult,
} from './run-upstream-generate.js';

export {
  wrapToolForNative,
  wrapToolsForNative,
  wrapToolsForNativeDeclarationsOnly,
  wrapGatewayToolsForNativeDeclarationsOnly,
  type GatewayToolFunctionShape,
} from './tool-adapter.js';

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
