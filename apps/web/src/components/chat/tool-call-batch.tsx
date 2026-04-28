import type { BatchTerminalView } from '@openAwork/shared-ui';
import { BatchTerminalCard } from '@openAwork/shared-ui';

function parseBatchOutput(output: unknown): BatchTerminalView | null {
  let record: Record<string, unknown> | null = null;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    record = output as Record<string, unknown>;
  } else if (typeof output === 'string') {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  if (!record) return null;

  const results = record['results'];
  if (!Array.isArray(results) || results.length === 0) return null;

  const subTools = results.map((entry, index) => {
    const rec = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const tool = typeof rec?.['tool'] === 'string' ? rec['tool'] : 'unknown';
    const isError = rec?.['isError'] === true;
    const entryOutput = rec?.['output'];
    return {
      index,
      tool,
      status: (isError ? 'error' : 'completed') as import('@openAwork/shared').BatchSubToolStatus,
      output: entryOutput,
      isError,
    };
  });
  return {
    subTools,
    completedCount: subTools.length,
    totalCount: subTools.length,
  };
}

export function resolveBatchTerminalView(
  input: Record<string, unknown>,
  output: unknown,
): BatchTerminalView | null {
  // 1) Streaming transient: _batchProgress injected during live stream.
  const rawBatchProgress = input['_batchProgress'];
  if (
    rawBatchProgress &&
    typeof rawBatchProgress === 'object' &&
    'subTools' in rawBatchProgress
  ) {
    return rawBatchProgress as BatchTerminalView;
  }

  // 2) Persisted state: reconstruct from output.results after refresh/session-switch.
  const parsed = parseBatchOutput(output);
  if (parsed) return parsed;

  return null;
}

export function BatchToolCallCard({
  input,
  output,
}: {
  input: Record<string, unknown>;
  output?: unknown;
}) {
  const batchView = resolveBatchTerminalView(input, output);
  if (!batchView) return null;
  return <BatchTerminalCard view={batchView} />;
}
