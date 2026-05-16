import React from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import { logger } from '../../utils/logger.js';
import type { UpstreamRetrySettingsRef } from '../settings-types.js';

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
      const payload = (await createSettingsClient(input.gatewayUrl).getUpstreamRetry(
        input.token,
      )) as UpstreamRetrySettingsRef;
      setUpstreamRetryMaxRetries(payload.maxRetries);
      setSavedUpstreamRetryMaxRetries(payload.maxRetries);
    } catch (error: unknown) {
      logger.error('failed to load upstream retry settings', error);
      setUpstreamRetryMaxRetries(3);
      setSavedUpstreamRetryMaxRetries(3);
    }
  }, [input.gatewayUrl, input.token]);

  const saveUpstreamRetrySettings = React.useCallback(async () => {
    if (!input.token || savingUpstreamRetrySettings) {
      return;
    }

    setSavingUpstreamRetrySettings(true);
    try {
      const payload = (await createSettingsClient(input.gatewayUrl).putUpstreamRetry(input.token, {
        maxRetries: upstreamRetryMaxRetries,
      })) as UpstreamRetrySettingsRef;
      setUpstreamRetryMaxRetries(payload.maxRetries);
      setSavedUpstreamRetryMaxRetries(payload.maxRetries);
    } catch (error: unknown) {
      logger.error('failed to save upstream retry settings', error);
    } finally {
      setSavingUpstreamRetrySettings(false);
    }
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
