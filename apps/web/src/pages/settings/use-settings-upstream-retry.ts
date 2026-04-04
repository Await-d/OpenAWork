import React from 'react';
import { logger } from '../../utils/logger.js';
import type { UpstreamRetrySettingsRef } from '../settings-types.js';
import { readErrorMessage } from './settings-page-helpers.js';

interface UseSettingsUpstreamRetryInput {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
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

export function useSettingsUpstreamRetry(
  input: UseSettingsUpstreamRetryInput,
): UseSettingsUpstreamRetryResult {
  const [upstreamRetryMaxRetries, setUpstreamRetryMaxRetries] = React.useState(3);
  const [savedUpstreamRetryMaxRetries, setSavedUpstreamRetryMaxRetries] = React.useState(3);
  const [savingUpstreamRetrySettings, setSavingUpstreamRetrySettings] = React.useState(false);

  const loadUpstreamRetrySettings = React.useCallback(async () => {
    if (!input.token) {
      return;
    }

    try {
      const response = await input.apiFetch('/settings/upstream-retry', { method: 'GET' });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '加载上游重试策略失败'));
      }

      const payload = (await response.json()) as UpstreamRetrySettingsRef;
      setUpstreamRetryMaxRetries(payload.maxRetries);
      setSavedUpstreamRetryMaxRetries(payload.maxRetries);
    } catch (error: unknown) {
      logger.error('failed to load upstream retry settings', error);
      setUpstreamRetryMaxRetries(3);
      setSavedUpstreamRetryMaxRetries(3);
    }
  }, [input.apiFetch, input.token]);

  const saveUpstreamRetrySettings = React.useCallback(async () => {
    if (!input.token || savingUpstreamRetrySettings) {
      return;
    }

    setSavingUpstreamRetrySettings(true);
    try {
      const response = await input.apiFetch('/settings/upstream-retry', {
        method: 'PUT',
        body: JSON.stringify({ maxRetries: upstreamRetryMaxRetries }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '保存上游重试设置失败'));
      }

      const payload = (await response.json()) as UpstreamRetrySettingsRef;
      setUpstreamRetryMaxRetries(payload.maxRetries);
      setSavedUpstreamRetryMaxRetries(payload.maxRetries);
    } catch (error: unknown) {
      logger.error('failed to save upstream retry settings', error);
    } finally {
      setSavingUpstreamRetrySettings(false);
    }
  }, [input.apiFetch, input.token, savingUpstreamRetrySettings, upstreamRetryMaxRetries]);

  return {
    loadUpstreamRetrySettings,
    saveUpstreamRetrySettings,
    savedUpstreamRetryMaxRetries,
    savingUpstreamRetrySettings,
    setUpstreamRetryMaxRetries,
    upstreamRetryMaxRetries,
  };
}
