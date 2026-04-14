import type { MemoryEntry, MemoryInjectionConfig } from './types.js';
import { estimateTokenCount } from './helpers.js';

function sortMemoriesForInjection(memories: MemoryEntry[]): MemoryEntry[] {
  return [...memories].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.key.localeCompare(b.key);
  });
}

function filterByWorkspace(memories: MemoryEntry[], workspaceRoot: string | null): MemoryEntry[] {
  if (workspaceRoot === null) {
    return memories;
  }
  return memories.filter((m) => m.workspaceRoot === null || m.workspaceRoot === workspaceRoot);
}

function formatMemoryLine(entry: MemoryEntry): string {
  return `- [${entry.type}] ${entry.key}: ${entry.value}`;
}

export function buildMemoryInjectionBlock(
  memories: MemoryEntry[],
  config: MemoryInjectionConfig,
): string | null {
  if (!config.enabled || memories.length === 0) {
    return null;
  }

  const eligible = filterByWorkspace(
    memories.filter((m) => m.enabled && m.confidence >= config.minConfidence),
    config.workspaceRoot,
  );

  if (eligible.length === 0) {
    return null;
  }

  const sorted = sortMemoriesForInjection(eligible);
  const lines: string[] = [];
  let currentBudget = 0;

  for (const entry of sorted) {
    const line = formatMemoryLine(entry);
    const lineTokens = estimateTokenCount(line);

    if (currentBudget + lineTokens > config.maxTokenBudget) {
      break;
    }

    lines.push(line);
    currentBudget += lineTokens;
  }

  if (lines.length === 0) {
    return null;
  }

  return `<user-memory>\n${lines.join('\n')}\n</user-memory>`;
}
