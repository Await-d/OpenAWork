/**
 * `useSettingsWebsearch` — settings hook for the multi-provider web
 * search rollout policy (P2-WEBSEARCH workflow 260509). Mirrors the
 * shape of `useSettingsUpstreamRetry`: a fetch on entry to the
 * Connection tab + a save action that round-trips the validated
 * payload back to `/settings/websearch`.
 *
 * Local component state holds the in-flight edits; the saved snapshot
 * doubles as the dirty-state baseline so the UI can show "应用策略 /
 * 已应用".
 */

import React from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';

export type WebsearchProvider =
  | 'duckduckgo'
  | 'tavily'
  | 'exa'
  | 'serper'
  | 'searxng'
  | 'bocha'
  | 'zhipu'
  | 'google'
  | 'bing';

export type WebsearchRolloutMode = 'sequential' | 'first-success' | 'merge';

export interface WebsearchProviderEntry {
  provider: WebsearchProvider;
  apiKey?: string;
  baseUrl?: string;
  weight?: number;
}

export interface WebsearchPolicy {
  providers: WebsearchProviderEntry[];
  rolloutMode: WebsearchRolloutMode;
  timeoutMs?: number;
}

const DEFAULT_POLICY: WebsearchPolicy = {
  providers: [],
  rolloutMode: 'sequential',
};

interface UseSettingsWebsearchInput {
  gatewayUrl: string;
  token: string | null;
}

export interface UseSettingsWebsearchResult {
  loadWebsearchPolicy: () => Promise<void>;
  saveWebsearchPolicy: () => Promise<void>;
  savedPolicy: WebsearchPolicy;
  saving: boolean;
  setPolicy: React.Dispatch<React.SetStateAction<WebsearchPolicy>>;
  policy: WebsearchPolicy;
}

function clonePolicy(p: WebsearchPolicy): WebsearchPolicy {
  return {
    providers: p.providers.map((entry) => ({ ...entry })),
    rolloutMode: p.rolloutMode,
    ...(p.timeoutMs !== undefined ? { timeoutMs: p.timeoutMs } : {}),
  };
}

export function useSettingsWebsearch(input: UseSettingsWebsearchInput): UseSettingsWebsearchResult {
  const [policy, setPolicy] = React.useState<WebsearchPolicy>(DEFAULT_POLICY);
  const [savedPolicy, setSavedPolicy] = React.useState<WebsearchPolicy>(DEFAULT_POLICY);
  const [saving, setSaving] = React.useState(false);

  const loadWebsearchPolicy = React.useCallback(async () => {
    if (!input.token) return;
    try {
      const payload = (await createSettingsClient(input.gatewayUrl).getWebsearch(
        input.token,
      )) as WebsearchPolicy;
      // Trust the gateway-side schema; if it is shaped wrong we fall
      // back to the documented defaults rather than throwing in the UI.
      const next: WebsearchPolicy = {
        providers: Array.isArray(payload.providers) ? payload.providers : [],
        rolloutMode: payload.rolloutMode ?? 'sequential',
        ...(typeof payload.timeoutMs === 'number' ? { timeoutMs: payload.timeoutMs } : {}),
      };
      setPolicy(clonePolicy(next));
      setSavedPolicy(clonePolicy(next));
    } catch (err: unknown) {
      logger.error('failed to load websearch policy', err);
      setPolicy(DEFAULT_POLICY);
      setSavedPolicy(DEFAULT_POLICY);
    }
  }, [input.gatewayUrl, input.token]);

  const saveWebsearchPolicy = React.useCallback(async () => {
    if (!input.token || saving) return;
    setSaving(true);
    try {
      // Strip empty optional strings so the gateway's strict schema
      // does not reject them — `apiKey: ''` would fail `min(1)`.
      const sanitized: WebsearchPolicy = {
        providers: policy.providers.map((entry) => {
          const next: WebsearchProviderEntry = { provider: entry.provider };
          if (entry.apiKey && entry.apiKey.trim().length > 0) next.apiKey = entry.apiKey.trim();
          if (entry.baseUrl && entry.baseUrl.trim().length > 0) next.baseUrl = entry.baseUrl.trim();
          if (typeof entry.weight === 'number') next.weight = entry.weight;
          return next;
        }),
        rolloutMode: policy.rolloutMode,
        ...(typeof policy.timeoutMs === 'number' ? { timeoutMs: policy.timeoutMs } : {}),
      };
      const payload = (await createSettingsClient(input.gatewayUrl).putWebsearch(
        input.token,
        sanitized,
      )) as WebsearchPolicy;
      const next: WebsearchPolicy = {
        providers: Array.isArray(payload.providers) ? payload.providers : [],
        rolloutMode: payload.rolloutMode ?? 'sequential',
        ...(typeof payload.timeoutMs === 'number' ? { timeoutMs: payload.timeoutMs } : {}),
      };
      setPolicy(clonePolicy(next));
      setSavedPolicy(clonePolicy(next));
    } catch (err: unknown) {
      logger.error('failed to save websearch policy', err);
    } finally {
      setSaving(false);
    }
  }, [input.gatewayUrl, input.token, policy, saving]);

  return {
    loadWebsearchPolicy,
    saveWebsearchPolicy,
    savedPolicy,
    saving,
    setPolicy,
    policy,
  };
}
