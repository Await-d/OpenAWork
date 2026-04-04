import React from 'react';
import { logger } from '../../utils/logger.js';
import type { SettingsVersionInfo } from '../settings-types.js';
import { tauriInvoke } from './settings-page-helpers.js';

interface UseSettingsEnvironmentInput {
  gatewayUrl: string;
  setGatewayUrl: (url: string) => void;
  token: string | null;
  webAccessEnabled: boolean;
  webPort: number;
  setWebAccess: (enabled: boolean, port: number) => void;
}

interface UseSettingsEnvironmentResult {
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  checkVersionUpdate: () => Promise<void>;
  copied: boolean;
  copyAddress: () => void;
  portInput: string;
  saveGatewayUrl: () => void;
  saveWebPort: () => void;
  setPortInput: React.Dispatch<React.SetStateAction<string>>;
  setUrlInput: React.Dispatch<React.SetStateAction<string>>;
  toggleWebAccess: () => Promise<void>;
  urlInput: string;
  urlSaved: boolean;
  versionInfo: SettingsVersionInfo;
}

export function useSettingsEnvironment(
  input: UseSettingsEnvironmentInput,
): UseSettingsEnvironmentResult {
  const [urlInput, setUrlInput] = React.useState(input.gatewayUrl);
  const [urlSaved, setUrlSaved] = React.useState(false);
  const [portInput, setPortInput] = React.useState(String(input.webPort));
  const [copied, setCopied] = React.useState(false);
  const [versionInfo, setVersionInfo] = React.useState<SettingsVersionInfo>({
    currentVersion: '0.0.1',
    latestVersion: null,
    updateAvailable: false,
    checkError: null,
    checkedAt: null,
    checking: false,
  });

  const apiFetch = React.useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`${input.gatewayUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${input.token}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      }),
    [input.gatewayUrl, input.token],
  );

  const checkVersionUpdate = React.useCallback(async () => {
    if (!input.token) {
      return;
    }

    setVersionInfo((previous: SettingsVersionInfo) => ({
      ...previous,
      checking: true,
      checkError: null,
    }));

    try {
      const response = await apiFetch('/settings/version');
      const data = (await response.json()) as SettingsVersionInfo;
      setVersionInfo({
        currentVersion: data.currentVersion,
        latestVersion: data.latestVersion,
        updateAvailable: data.updateAvailable,
        checkError: data.checkError,
        checkedAt: data.checkedAt,
        checking: false,
      });
    } catch (_error) {
      setVersionInfo((previous: SettingsVersionInfo) => ({
        ...previous,
        checking: false,
        checkError: '检查失败，请稍后重试',
      }));
    }
  }, [apiFetch, input.token]);

  const saveGatewayUrl = React.useCallback(() => {
    input.setGatewayUrl(urlInput.trim().replace(/\/$/, ''));
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2000);
  }, [input, urlInput]);

  const toggleWebAccess = React.useCallback(async () => {
    const port = parseInt(portInput, 10);
    const validPort = Number.isFinite(port) && port > 0 && port < 65536 ? port : input.webPort;

    try {
      if (input.webAccessEnabled) {
        await tauriInvoke('stop_gateway');
        input.setWebAccess(false, validPort);
        return;
      }

      await tauriInvoke('start_gateway', { port: validPort });
      input.setWebAccess(true, validPort);
    } catch (error: unknown) {
      logger.error('Gateway toggle failed:', error);
    }
  }, [input, portInput]);

  const saveWebPort = React.useCallback(() => {
    const port = parseInt(portInput, 10);
    if (Number.isFinite(port) && port > 0 && port < 65536) {
      input.setWebAccess(input.webAccessEnabled, port);
    }
  }, [input, portInput]);

  const copyAddress = React.useCallback(() => {
    void navigator.clipboard.writeText(`http://localhost:${input.webPort}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [input.webPort]);

  return {
    apiFetch,
    checkVersionUpdate,
    copied,
    copyAddress,
    portInput,
    saveGatewayUrl,
    saveWebPort,
    setPortInput,
    setUrlInput,
    toggleWebAccess,
    urlInput,
    urlSaved,
    versionInfo,
  };
}
