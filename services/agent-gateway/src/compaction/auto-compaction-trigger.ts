/**
 * Auto-Compaction Trigger
 *
 * Extracted from stream.ts to improve separation of concerns.
 * Encapsulates the logic for:
 * 1. Proactive compaction (before overflow, based on token usage trends)
 * 2. Reactive compaction (after overflow error from provider)
 * 3. Phase 2 aggressive truncation (before full summarization)
 *
 * The stream loop calls these functions at the appropriate points;
 * they return results that the loop uses to decide whether to continue,
 * retry, or stop.
 */

import {
  orchestrateAutomaticCompaction,
  type OverflowCompactionInput,
  type OverflowCompactionResult,
  type ProactiveCompactionInput,
  type ProactiveCompactionResult,
} from './automatic-compaction-orchestrator.js';

export type {
  AutoCompactionContext,
  AutomaticCompactionRequest,
  AutomaticRequestKind,
  OverflowCompactionInput,
  OverflowCompactionResult,
  ProactiveCompactionInput,
  ProactiveCompactionResult,
} from './automatic-compaction-orchestrator.js';
// ─── Proactive Compaction ────────────────────────────────────────────────────

export async function triggerProactiveCompaction(
  input: ProactiveCompactionInput,
): Promise<ProactiveCompactionResult> {
  return orchestrateAutomaticCompaction(input);
}

// ─── Overflow Compaction ─────────────────────────────────────────────────────

export async function triggerOverflowCompaction(
  input: OverflowCompactionInput,
): Promise<OverflowCompactionResult> {
  return orchestrateAutomaticCompaction(input);
}
