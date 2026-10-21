import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCapabilitiesClient } from '@openAwork/web-client';
import type { CapabilityDescriptor } from '@openAwork/shared';
import type {
  ComposerAgentTool,
  ComposerCapabilityItem,
  InstalledComposerSkill,
} from '../../components/conversation-runtime/messages/support.js';
import { logger } from '../../utils/log/logger.js';

export interface ComposerWorkspaceCatalog {
  agents: ComposerCapabilityItem[];
  agentTools: ComposerAgentTool[];
  installedSkills: InstalledComposerSkill[];
  mcpServers: ComposerCapabilityItem[];
}

const EMPTY_CATALOG: ComposerWorkspaceCatalog = {
  agents: [],
  agentTools: [],
  installedSkills: [],
  mcpServers: [],
};

const COMPOSER_WORKSPACE_CATALOG_RETRY_BASE_MS = 2_000;
const COMPOSER_WORKSPACE_CATALOG_RETRY_MAX_MS = 15_000;

function computeComposerWorkspaceCatalogRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(
    COMPOSER_WORKSPACE_CATALOG_RETRY_BASE_MS * 2 ** safeAttempt,
    COMPOSER_WORKSPACE_CATALOG_RETRY_MAX_MS,
  );
}

function buildComposerWorkspaceCatalog(
  capabilities: readonly CapabilityDescriptor[],
): ComposerWorkspaceCatalog {
  const installedSkills = capabilities
    .filter((capability) => capability.kind === 'skill')
    .map<InstalledComposerSkill>((capability) => ({
      id: capability.id,
      label: capability.label,
      description: capability.description,
      source: capability.source,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));

  const agentTools = capabilities
    .filter(
      (capability) =>
        capability.kind === 'tool' &&
        capability.callable === true &&
        !capability.label.startsWith('lsp_'),
    )
    .map<ComposerAgentTool>((capability) => ({
      name: capability.label,
      description: capability.description,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));

  const agents = capabilities
    .filter((capability) => capability.kind === 'agent')
    .map<ComposerCapabilityItem>((capability) => ({
      id: capability.id,
      kind: 'agent',
      label: capability.label,
      description: capability.description,
      callable: capability.callable,
      canonicalRole: capability.canonicalRole,
      aliases: capability.aliases,
      source: capability.source,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'en-US'));

  const mcpServers = capabilities
    .filter((capability) => capability.kind === 'mcp')
    .map<ComposerCapabilityItem>((capability) => ({
      id: capability.id,
      kind: 'mcp',
      label: capability.label,
      description: capability.description,
      callable: capability.callable,
      canonicalRole: capability.canonicalRole,
      aliases: capability.aliases,
      source: capability.source,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'en-US'));

  return { installedSkills, agentTools, agents, mcpServers };
}

/**
 * 组合器工作区能力目录拉取的统一包装：try → catch 交给 `onError`（**无 finally**）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try 内的值块（`??`、三元、链式调用），本 hook
 * 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runComposerCatalogLoadOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

export function useComposerWorkspaceCatalog(input: {
  enabled: boolean;
  gatewayUrl: string;
  sessionId: string | null;
  token: string | null;
}): ComposerWorkspaceCatalog {
  const { enabled, gatewayUrl, sessionId, token } = input;
  const client = useMemo(() => createCapabilitiesClient(gatewayUrl), [gatewayUrl]);
  const requestScopeKey = useMemo(
    () => `${gatewayUrl}::${sessionId ?? ''}`,
    [gatewayUrl, sessionId],
  );
  const [catalog, setCatalog] = useState<ComposerWorkspaceCatalog>(EMPTY_CATALOG);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const retainedScopeKeyRef = useRef<string | null>(null);
  const clearRetry = useCallback(() => {
    if (retryTimerRef.current === null) {
      return;
    }
    globalThis.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !token) {
      clearRetry();
      retryAttemptRef.current = 0;
      retainedScopeKeyRef.current = null;
      setCatalog(EMPTY_CATALOG);
      return;
    }

    let cancelled = false;
    retryAttemptRef.current = 0;
    clearRetry();
    if (retainedScopeKeyRef.current !== requestScopeKey) {
      retainedScopeKeyRef.current = requestScopeKey;
      setCatalog(EMPTY_CATALOG);
    }

    const loadCatalog = async (): Promise<void> => {
      // try/catch 下沉到模块级 `runComposerCatalogLoadOnce`（见其注释）。
      await runComposerCatalogLoadOnce({
        onError: (error) => {
          if (cancelled) {
            return;
          }
          clearRetry();
          retryAttemptRef.current = 0;
          logger.error('failed to load composer workspace catalog', error);
          setCatalog(EMPTY_CATALOG);
        },
        run: async () => {
          const result = await client.listResult(token, sessionId);
          if (cancelled) {
            return;
          }

          if (result.ok) {
            clearRetry();
            retryAttemptRef.current = 0;
            retainedScopeKeyRef.current = requestScopeKey;
            setCatalog(buildComposerWorkspaceCatalog(result.capabilities));
            return;
          }

          const error = new Error(result.errorMessage ?? '加载能力列表失败');
          if (result.retryable) {
            const attempt = retryAttemptRef.current + 1;
            const delayMs = computeComposerWorkspaceCatalogRetryDelay(retryAttemptRef.current);
            retryAttemptRef.current = attempt;
            logger.warn('failed to load composer workspace catalog, will retry', {
              attempt,
              delayMs,
              error,
              gatewayUrl,
              sessionId,
            });
            clearRetry();
            retryTimerRef.current = globalThis.setTimeout(() => {
              retryTimerRef.current = null;
              if (!cancelled) {
                void loadCatalog();
              }
            }, delayMs);
            return;
          }

          clearRetry();
          retryAttemptRef.current = 0;
          logger.error('failed to load composer workspace catalog', error);
          setCatalog(EMPTY_CATALOG);
        },
      });
    };

    void loadCatalog();

    return () => {
      cancelled = true;
      clearRetry();
    };
  }, [clearRetry, client, enabled, requestScopeKey, sessionId, token]);

  return catalog;
}
