import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCommandsClient } from '@openAwork/web-client';
import type { CommandDescriptor, CommandSurface } from '@openAwork/shared';
import { useAuthStore } from '../../stores/auth/auth.js';
import { logger } from '../../utils/log/logger.js';

const COMMAND_REGISTRY_RETRY_BASE_MS = 2_000;
const COMMAND_REGISTRY_RETRY_MAX_MS = 15_000;

function computeCommandRegistryRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(COMMAND_REGISTRY_RETRY_BASE_MS * 2 ** safeAttempt, COMMAND_REGISTRY_RETRY_MAX_MS);
}

/**
 * 命令注册表拉取的统一包装：try → catch 交给 `onError`（**无 finally**，与原语义一致）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try 内的值块（`??`、三元、链式调用），本 hook
 * 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runCommandRegistryLoadOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

export function useCommandRegistry(surface: CommandSurface): CommandDescriptor[] {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const client = useMemo(() => createCommandsClient(gatewayUrl), [gatewayUrl]);
  const requestScopeKey = useMemo(() => `${gatewayUrl}::${surface}`, [gatewayUrl, surface]);
  const [commands, setCommands] = useState<CommandDescriptor[]>([]);
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
    if (!token) {
      clearRetry();
      retryAttemptRef.current = 0;
      retainedScopeKeyRef.current = null;
      setCommands([]);
      return;
    }

    let cancelled = false;

    retryAttemptRef.current = 0;
    clearRetry();
    if (retainedScopeKeyRef.current !== requestScopeKey) {
      retainedScopeKeyRef.current = requestScopeKey;
      setCommands([]);
    }

    const loadCommands = async (): Promise<void> => {
      // try/catch 下沉到模块级 `runCommandRegistryLoadOnce`（见其注释）。
      await runCommandRegistryLoadOnce({
        onError: (error) => {
          if (cancelled) {
            return;
          }
          clearRetry();
          retryAttemptRef.current = 0;
          logger.error('failed to load command registry', error);
          setCommands([]);
        },
        run: async () => {
          const result = await client.listResult(token);
          if (cancelled) {
            return;
          }

          if (result.ok) {
            clearRetry();
            retryAttemptRef.current = 0;
            retainedScopeKeyRef.current = requestScopeKey;
            setCommands(
              result.commands.filter((item: CommandDescriptor) => item.contexts.includes(surface)),
            );
            return;
          }

          if (result.retryable) {
            const attempt = retryAttemptRef.current + 1;
            const delayMs = computeCommandRegistryRetryDelay(retryAttemptRef.current);
            retryAttemptRef.current = attempt;
            logger.warn('failed to load command registry, will retry', {
              attempt,
              delayMs,
              error: new Error(result.errorMessage ?? '读取命令列表失败'),
              gatewayUrl,
              surface,
              status: result.status,
            });
            clearRetry();
            retryTimerRef.current = globalThis.setTimeout(() => {
              retryTimerRef.current = null;
              if (!cancelled) {
                void loadCommands();
              }
            }, delayMs);
            return;
          }

          clearRetry();
          retryAttemptRef.current = 0;
          logger.error(
            'failed to load command registry',
            new Error(result.errorMessage ?? '读取命令列表失败'),
          );
          setCommands([]);
        },
      });
    };

    void loadCommands();

    return () => {
      cancelled = true;
      clearRetry();
    };
  }, [clearRetry, client, gatewayUrl, requestScopeKey, surface, token]);

  return commands;
}
