import { Schema } from "effect";
import { ProviderMetadata } from "../external-schema-types.js";
export { ProviderMetadata };
/** Stable string identifier for a protocol implementation. */
export const ProtocolID = Schema.String;
/** Stable string identifier for the runnable route. */
export const RouteID = Schema.String;
export const ModelID = Schema.String.pipe(Schema.brand("LLM.ModelID"));
export const ProviderID = Schema.String.pipe(Schema.brand("LLM.ProviderID"));
export const ResponseID = Schema.String;
export const ContentBlockID = Schema.String;
export const ToolCallID = Schema.String;
export const ReasoningEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
export const ReasoningEffort = Schema.Literals(ReasoningEfforts);
export const TextVerbosity = Schema.Literals(["low", "medium", "high"]);
export const MessageRole = Schema.Literals(["system", "user", "assistant", "tool"]);
export const FinishReason = Schema.Literals(["stop", "length", "tool-calls", "content-filter", "error", "unknown"]);
export const JsonSchema = Schema.Record(Schema.String, Schema.Unknown);
//# sourceMappingURL=ids.js.map