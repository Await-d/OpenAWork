import type { MemoryEntry, MemoryInjectionConfig } from './types.js';
import { estimateTokenCount } from './helpers.js';
import { memoryScopeKey } from './governance.js';

function sortMemoriesForInjection(memories: MemoryEntry[]): MemoryEntry[] {
  return [...memories].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.key.localeCompare(b.key);
  });
}

/**
 * 只注入「仍然生效」的条目：生命周期为 active，且未到 validUntil。
 *
 * `lifecycle` / `validUntil` 对历史条目取缺省值（active / null），因此老数据行为不变。
 */
function filterInjectable(memories: MemoryEntry[], now: Date): MemoryEntry[] {
  return memories.filter((memory) => {
    const lifecycle = memory.lifecycle ?? 'active';
    if (lifecycle !== 'active') {
      return false;
    }
    const validUntil = memory.validUntil ?? null;
    if (!validUntil) {
      return true;
    }
    const parsed = Date.parse(validUntil);
    // 到期即停止注入；无法解析的到期时间按已到期处理（fail-closed）。
    return Number.isFinite(parsed) && parsed > now.getTime();
  });
}

/**
 * 作用域白名单过滤。
 *
 * 数组语义是**白名单**：没命中就不可见。这与「空白名单 = 不限制」的旧直觉相反，
 * 是刻意的——渠道会话必须显式列出允许的作用域，漏配只会少注入而不会越权注入。
 *
 * **缺省值同样是 fail-closed**：`null` / `undefined` 不是「不过滤」，而是退化成
 * 「只给调用方自己的 user 作用域」。这一点很关键——调用方漏传一次白名单，最多只是
 * 少注入，绝不会把 workspace / team / channel_chat 作用域的记忆注进上下文。历史实现
 * 在这里 `return memories`（不过滤），等于漏传一次就静默恢复被修掉的越权面。
 */
function filterByAllowedScopes(
  memories: MemoryEntry[],
  allowedScopes: readonly string[] | null | undefined,
  userId: string,
): MemoryEntry[] {
  const allowed = new Set(allowedScopes ?? [memoryScopeKey({ type: 'user' as const, id: userId })]);
  return memories.filter((memory) => {
    const scope = memory.scope ?? { type: 'user' as const, id: userId };
    return allowed.has(memoryScopeKey(scope));
  });
}

function filterByWorkspace(memories: MemoryEntry[], workspaceRoot: string | null): MemoryEntry[] {
  if (workspaceRoot === null) {
    return memories.filter((m) => m.workspaceRoot === null);
  }
  return memories.filter((m) => m.workspaceRoot === null || m.workspaceRoot === workspaceRoot);
}

function filterByTeamWorkspace(
  memories: MemoryEntry[],
  teamWorkspaceId: string | null,
): MemoryEntry[] {
  return memories.filter((memory) => {
    if (memory.teamWorkspaceId === null) {
      return true;
    }
    return teamWorkspaceId !== null && memory.teamWorkspaceId === teamWorkspaceId;
  });
}

function filterByRoleLayer(
  memories: MemoryEntry[],
  roleLayer: MemoryInjectionConfig['roleLayer'] | undefined,
): MemoryEntry[] {
  if (!roleLayer) {
    return memories.filter((memory) => memory.roleLayers === null);
  }
  return memories.filter(
    (memory) => memory.roleLayers === null || memory.roleLayers.includes(roleLayer),
  );
}

function formatMemoryLine(entry: MemoryEntry): string {
  return `- [${entry.type}] ${entry.key}: ${entry.value}`;
}

export function buildMemoryInjectionBlock(
  memories: MemoryEntry[],
  config: MemoryInjectionConfig,
  now: Date = new Date(),
): string | null {
  if (!config.enabled || memories.length === 0) {
    return null;
  }

  const teamWorkspaceId = config.teamWorkspaceId ?? null;
  const eligible = filterByRoleLayer(
    filterByTeamWorkspace(
      filterByWorkspace(
        filterByAllowedScopes(
          filterInjectable(
            memories.filter((m) => m.enabled && m.confidence >= config.minConfidence),
            now,
          ),
          config.allowedScopes,
          config.userId ?? '',
        ),
        config.workspaceRoot,
      ),
      teamWorkspaceId,
    ),
    config.roleLayer,
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
