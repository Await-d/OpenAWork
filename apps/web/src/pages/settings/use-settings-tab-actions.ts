import { useCallback } from 'react';
import type React from 'react';
import type { SettingsDiagnosticRecord } from '../settings-types.js';

interface SettingsTabActionsParams {
  apiFetch: (input: string, init?: RequestInit) => Promise<Response>;
  gatewayUrl: string;
  token: string | null;
  setDiagnostics: React.Dispatch<React.SetStateAction<SettingsDiagnosticRecord[]>>;
  setDiagnosticsAvailableDates: React.Dispatch<React.SetStateAction<string[]>>;
  setGithubTriggers: React.Dispatch<
    React.SetStateAction<Array<{ events: string[]; repo: string }>>
  >;
}

export function useSettingsTabActions({
  apiFetch,
  gatewayUrl,
  token,
  setDiagnostics,
  setDiagnosticsAvailableDates,
  setGithubTriggers,
}: SettingsTabActionsParams) {
  const handleSaveGitHubTrigger = useCallback(
    async (config: { events: string[]; repoFullNameOwnerSlashRepo: string }) => {
      const response = await apiFetch('/github/triggers', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      if (!response.ok) {
        const err = (await response.json()) as { message?: string };
        throw new Error(err.message ?? '注册失败');
      }
      setGithubTriggers((prev) => [
        ...prev,
        { repo: config.repoFullNameOwnerSlashRepo, events: config.events },
      ]);
    },
    [apiFetch, setGithubTriggers],
  );

  const handleDesktopAutomationStart = useCallback(
    async (url?: string) => {
      await apiFetch('/desktop-automation/start', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },
    [apiFetch],
  );

  const handleDesktopAutomationGoto = useCallback(
    async (url: string) => {
      await apiFetch('/desktop-automation/goto', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
    },
    [apiFetch],
  );

  const handleDesktopAutomationClick = useCallback(
    async (selector: string) => {
      await apiFetch('/desktop-automation/click', {
        method: 'POST',
        body: JSON.stringify({ selector }),
      });
    },
    [apiFetch],
  );

  const handleDesktopAutomationType = useCallback(
    async (selector: string, text: string) => {
      await apiFetch('/desktop-automation/type', {
        method: 'POST',
        body: JSON.stringify({ selector, text }),
      });
    },
    [apiFetch],
  );

  const handleDesktopAutomationScreenshot = useCallback(async () => {
    const response = await apiFetch('/desktop-automation/screenshot', {
      method: 'POST',
    });
    const payload = (await response.json()) as { screenshotBase64: string };
    return payload.screenshotBase64;
  }, [apiFetch]);

  const handleClearDiagnostics = useCallback(async () => {
    try {
      const resp = await fetch(`${gatewayUrl}/settings/diagnostics`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (resp.ok) {
        setDiagnostics([]);
        setDiagnosticsAvailableDates([]);
      }
    } catch (_err) {
      return;
    }
  }, [gatewayUrl, setDiagnostics, setDiagnosticsAvailableDates, token]);

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
