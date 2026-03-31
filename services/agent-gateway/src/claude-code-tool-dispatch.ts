import {
  buildUnsupportedToolResult,
  normalizeInputForCanonical,
  UnsupportedToolError,
} from './claude-code-input-adapters.js';
import type {
  ClaudeCodeCompatLevel,
  NormalizedInput,
  RawInput,
  UnsupportedToolResult,
} from './claude-code-input-adapters.js';

export type { ClaudeCodeCompatLevel, NormalizedInput, RawInput, UnsupportedToolResult };

export type DispatchOutcome =
  | { kind: 'resolved'; normalized: NormalizedInput }
  | { kind: 'unsupported'; result: UnsupportedToolResult };

export function dispatchClaudeCodeTool(presentedName: string, rawInput: RawInput): DispatchOutcome {
  try {
    const normalized = normalizeInputForCanonical(presentedName, rawInput);
    return { kind: 'resolved', normalized };
  } catch (error) {
    if (error instanceof UnsupportedToolError) {
      return {
        kind: 'unsupported',
        result: buildUnsupportedToolResult(presentedName, error.hint),
      };
    }
    throw error;
  }
}
