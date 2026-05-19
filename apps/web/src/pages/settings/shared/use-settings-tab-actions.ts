import { useCallback } from 'react';
import type React from 'react';
import {
  createDesktopAutomationClient,
  createGitHubClient,
  createSettingsClient,
} from '@openAwork/web-client';
import type { SettingsDiagnosticRecord } from '../state/settings-types.js';

interface SettingsTabActionsParams {
  gatewayUrl: string;
  token: string | null;
  setDiagnostics: React.Dispatch<React.SetStateAction<SettingsDiagnosticRecord[]>>;
  setDiagnosticsAvailableDates: React.Dispatch<React.SetStateAction<string[]>>;
  setGithubTriggers: React.Dispatch<
    React.SetStateAction<Array<{ events: string[]; repo: string }>>
  >;
}

export function useSettingsTabActions({
  gatewayUrl,
  token,
  setDiagnostics,
  setDiagnosticsAvailableDates,
  setGithubTriggers,
}: SettingsTabActionsParams) {
  const handleSaveGitHubTrigger = useCallback(
    async (config: { events: string[]; repoFullNameOwnerSlashRepo: string }) => {
      if (!token) {
        throw new Error('未登录');
      }
      await createGitHubClient(gatewayUrl).createTrigger(token, config);
      setGithubTriggers((prev) => [
        ...prev,
        { repo: config.repoFullNameOwnerSlashRepo, events: config.events },
      ]);
    },
    [gatewayUrl, setGithubTriggers, token],
  );

  const handleDesktopAutomationStart = useCallback(
    async (url?: string) => {
      if (!token) return;
      await createDesktopAutomationClient(gatewayUrl).start(token, url);
    },
    [gatewayUrl, token],
  );

  const handleDesktopAutomationGoto = useCallback(
    async (url: string) => {
      if (!token) return;
      await createDesktopAutomationClient(gatewayUrl).goto(token, url);
    },
    [gatewayUrl, token],
  );

  const handleDesktopAutomationClick = useCallback(
    async (selector: string) => {
      if (!token) return;
      await createDesktopAutomationClient(gatewayUrl).click(token, selector);
    },
    [gatewayUrl, token],
  );

  const handleDesktopAutomationType = useCallback(
    async (selector: string, text: string) => {
      if (!token) return;
      await createDesktopAutomationClient(gatewayUrl).type(token, selector, text);
    },
    [gatewayUrl, token],
  );

  const handleDesktopAutomationScreenshot = useCallback(async () => {
    if (!token) return '';
    const payload = await createDesktopAutomationClient(gatewayUrl).screenshot(token);
    return payload.screenshotBase64;
  }, [gatewayUrl, token]);

  const handleClearDiagnostics = useCallback(async () => {
    if (!token) return;
    try {
      await createSettingsClient(gatewayUrl).clearDiagnostics(token);
      setDiagnostics([]);
      setDiagnosticsAvailableDates([]);
    } catch (_err) {
      return;
    }
  }, [gatewayUrl, setDiagnostics, setDiagnosticsAvailableDates, token]);

  // (Settings hook intentionally exposes only the action callbacks; the
  // earlier `apiFetch` shim has been replaced with web-client method calls.)

  return {
    handleClearDiagnostics,
    handleDesktopAutomationClick,
    handleDesktopAutomationGoto,
    handleDesktopAutomationScreenshot,
    handleDesktopAutomationStart,
    handleDesktopAutomationType,
    handleSaveGitHubTrigger,
  };
}
