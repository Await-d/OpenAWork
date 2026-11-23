import { createContext, useContext, useState, type ReactNode } from 'react';
import './subagent-progress.css';

export interface ShellCreation {
  terminalId: string;
  startedAtMs?: number;
}

interface ShellProgress {
  knownIds: ReadonlySet<string>;
  visibleIds: ReadonlySet<string>;
  orderedIds: readonly string[];
  remaining: number;
  loadMore: () => void;
}

const ShellProgressContext = createContext<ShellProgress | null>(null);

function useLocalShellProgress(
  items: readonly ShellCreation[],
  scope: string | null,
): ShellProgress {
  const [page, setPage] = useState({ scope, limit: 5 });
  const limit = page.scope === scope ? page.limit : 5;
  if (page.scope !== scope) setPage({ scope, limit: 5 });
  const created = new Map<string, number>();
  for (const item of items) {
    if (!item.terminalId) continue;
    const time = Number.isFinite(item.startedAtMs) ? (item.startedAtMs ?? 0) : 0;
    created.set(item.terminalId, Math.min(created.get(item.terminalId) ?? time, time));
  }
  const orderedIds = [...created.keys()].sort(
    (left, right) =>
      (created.get(right) ?? 0) - (created.get(left) ?? 0) || left.localeCompare(right),
  );
  return {
    orderedIds,
    knownIds: new Set(orderedIds),
    visibleIds: new Set(orderedIds.slice(0, limit)),
    remaining: Math.max(0, orderedIds.length - limit),
    loadMore: () => setPage((previous) => ({ scope, limit: previous.limit + 5 })),
  };
}

export function ShellProgressProvider({
  shells,
  parentSessionId = null,
  children,
}: {
  shells: readonly ShellCreation[];
  parentSessionId?: string | null;
  children: ReactNode;
}) {
  const progress = useLocalShellProgress(shells, parentSessionId);
  return <ShellProgressContext value={progress}>{children}</ShellProgressContext>;
}

export function useShellProgress() {
  return useContext(ShellProgressContext);
}

export function useProgressiveShells<T>(
  items: readonly T[],
  identify: (item: T) => ShellCreation,
  parentSessionId: string | null = null,
) {
  const shared = useShellProgress();
  const local = useLocalShellProgress(items.map(identify), parentSessionId);
  const progress = shared ?? local;
  const rank = new Map(progress.orderedIds.map((id, index) => [id, index]));
  const visible = items
    .filter((item) => progress.visibleIds.has(identify(item).terminalId))
    .sort(
      (left, right) =>
        (rank.get(identify(left).terminalId) ?? 0) - (rank.get(identify(right).terminalId) ?? 0),
    );
  return { ...progress, visible };
}

export function ShellLoadMore({ progress }: { progress?: ShellProgress | null }) {
  const shared = useShellProgress();
  const value = progress ?? shared;
  if (!value || value.remaining === 0) return null;
  return (
    <button type="button" className="subagent-load-more" onClick={value.loadMore}>
      加载更多后台命令（{Math.min(5, value.remaining)} 个，剩余 {value.remaining} 个）
    </button>
  );
}

/** Only identified background terminals participate; foreground bash stays visible. */
export function shellToolTerminalId(
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
): string | null {
  if (
    !['bash', 'run_bash_in_background', 'bash_output', 'bash_kill'].includes(
      toolName.trim().toLowerCase(),
    )
  ) {
    return null;
  }
  if (typeof output === 'string') {
    try {
      return shellToolTerminalId(toolName, input, JSON.parse(output));
    } catch {
      // Plain-text results still identify their terminal through the request.
      return typeof input.terminal_id === 'string' ? input.terminal_id : null;
    }
  }
  if (
    output &&
    typeof output === 'object' &&
    'terminalId' in output &&
    typeof output.terminalId === 'string' &&
    output.terminalId.length > 0
  ) {
    return output.terminalId;
  }
  return typeof input.terminal_id === 'string' ? input.terminal_id : null;
}
