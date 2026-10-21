import React from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';
import type { UpstreamRetrySettingsRef } from '../state/settings-types.js';

interface UseSettingsUpstreamRetryInput {
  gatewayUrl: string;
  token: string | null;
}

interface UseSettingsUpstreamRetryResult {
  loadUpstreamRetrySettings: () => Promise<void>;
  saveUpstreamRetrySettings: () => Promise<void>;
  savedUpstreamRetryMaxRetries: number;
  savingUpstreamRetrySettings: boolean;
  setUpstreamRetryMaxRetries: React.Dispatch<React.SetStateAction<number>>;
  upstreamRetryMaxRetries: number;
}

/**
 * 上游重试设置的加载 / 保存统一包装：`onStart` → try → catch 交给 `onError`
 * → `onFinally` 收尾。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，也不支持 try 内
 * 的值块。语义逐字照搬。
 */
async function runUpstreamRetryActionOnce(ctx: {
  onStart?: () => void;
  onError: (error: unknown) => void;
  onFinally?: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.onStart?.();
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  } finally {
    ctx.onFinally?.();
  }
}

export function useSettingsUpstreamRetry(
  input: UseSettingsUpstreamRetryInput,
): UseSettingsUpstreamRetryResult {
  const [upstreamRetryMaxRetries, setUpstreamRetryMaxRetries] = React.useState(3);
  const [savedUpstreamRetryMaxRetries, setSavedUpstreamRetryMaxRetries] = React.useState(3);
  const [savingUpstreamRetrySettings, setSavingUpstreamRetrySettings] = React.useState(false);

  const loadUpstreamRetrySettings = React.useCallback(async () => {
    // 取局部常量：嵌套的 run 回调里 TS 会重置对 `input.token` 的非空收窄。
    const token = input.token;
    if (!token) {
      return;
    }

    // try/catch 下沉到模块级 `runUpstreamRetryActionOnce`（见其注释）。
    await runUpstreamRetryActionOnce({
      onError: (error) => {
        logger.error('failed to load upstream retry settings', error);
        setUpstreamRetryMaxRetries(3);
        setSavedUpstreamRetryMaxRetries(3);
      },
      run: async () => {
        const payload = (await createSettingsClient(input.gatewayUrl).getUpstreamRetry(
          token,
        )) as UpstreamRetrySettingsRef;
        setUpstreamRetryMaxRetries(payload.maxRetries);
        setSavedUpstreamRetryMaxRetries(payload.maxRetries);
      },
    });
  }, [input.gatewayUrl, input.token]);

  const saveUpstreamRetrySettings = React.useCallback(async () => {
    // 同 load：嵌套的 run 回调里 TS 会重置对 `input.token` 的非空收窄。
    const token = input.token;
    if (!token || savingUpstreamRetrySettings) {
      return;
    }

    // 置 saving 与 try/catch/finally 一起下沉到模块级 `runUpstreamRetryActionOnce`。
    await runUpstreamRetryActionOnce({
      onStart: () => {
        setSavingUpstreamRetrySettings(true);
      },
      onError: (error) => {
        logger.error('failed to save upstream retry settings', error);
      },
      onFinally: () => {
        setSavingUpstreamRetrySettings(false);
      },
      run: async () => {
        const payload = (await createSettingsClient(input.gatewayUrl).putUpstreamRetry(token, {
          maxRetries: upstreamRetryMaxRetries,
        })) as UpstreamRetrySettingsRef;
        setUpstreamRetryMaxRetries(payload.maxRetries);
        setSavedUpstreamRetryMaxRetries(payload.maxRetries);
      },
    });
  }, [input.gatewayUrl, input.token, savingUpstreamRetrySettings, upstreamRetryMaxRetries]);

  return {
    loadUpstreamRetrySettings,
    saveUpstreamRetrySettings,
    savedUpstreamRetryMaxRetries,
    savingUpstreamRetrySettings,
    setUpstreamRetryMaxRetries,
    upstreamRetryMaxRetries,
  };
}
