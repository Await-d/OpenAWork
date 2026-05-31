import React from 'react';
import { createSettingsClient, login } from '@openAwork/web-client';
import { logger } from '../../../utils/log/logger.js';
import {
  authenticateDesktopGateway,
  DESKTOP_DEFAULT_EMAIL,
  type DesktopGatewayMode,
  desktopGatewayModeForUrl,
  isLocalGatewayUrl,
  isTauriRuntime,
  localGatewayUrl,
  normalizeGatewayUrl,
  parseGatewayPort,
  readGatewayPortFromUrl,
  waitForGatewayHealth,
  writeDesktopGatewayMode,
} from '../../../utils/gateway/desktop-gateway.js';
import type { SettingsVersionInfo } from '../state/settings-types.js';
import { tauriInvoke } from './settings-page-helpers.js';

interface UseSettingsEnvironmentInput {
  gatewayUrl: string;
  setGatewayUrl: (url: string) => void;
  setAuth: (accessToken: string, email: string, refreshToken?: string, expiresIn?: string) => void;
  token: string | null;
  webAccessEnabled: boolean;
  webPort: number;
  /**
   * 「桌面端」面板「Web 端访问」section 的局域网共享开关。
   * 「连接与模型」面板的 toggleWebAccess / saveGatewayUrl / saveWebPort 在调用
   * Rust `start_gateway` 时也读这个值决定 sidecar bind 模式，保证两侧一致。
   */
  webExposeLan: boolean;
  setWebAccess: (enabled: boolean, port: number, exposeLan?: boolean) => void;
}

function hostForExposeLan(exposeLan: boolean): '127.0.0.1' | '0.0.0.0' {
  return exposeLan ? '0.0.0.0' : '127.0.0.1';
}

interface UseSettingsEnvironmentResult {
  checkVersionUpdate: () => Promise<void>;
  copied: boolean;
  copyAddress: () => void;
  desktopGatewayBusy: boolean;
  desktopGatewayError: string | null;
  desktopGatewayMode: DesktopGatewayMode;
  portInput: string;
  saveGatewayUrl: () => Promise<void>;
  saveWebPort: () => Promise<void>;
  setPortInput: React.Dispatch<React.SetStateAction<string>>;
  remoteAdminEmail: string;
  remoteAdminPassword: string;
  setRemoteAdminEmail: React.Dispatch<React.SetStateAction<string>>;
  setRemoteAdminPassword: React.Dispatch<React.SetStateAction<string>>;
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
  const [remoteAdminEmail, setRemoteAdminEmail] = React.useState(DESKTOP_DEFAULT_EMAIL);
  const [remoteAdminPassword, setRemoteAdminPassword] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [desktopGatewayBusy, setDesktopGatewayBusy] = React.useState(false);
  const [desktopGatewayError, setDesktopGatewayError] = React.useState<string | null>(null);
  const [versionInfo, setVersionInfo] = React.useState<SettingsVersionInfo>({
    currentVersion: '0.0.1',
    latestVersion: null,
    updateAvailable: false,
    checkError: null,
    checkedAt: null,
    checking: false,
  });

  const desktopGatewayMode = React.useMemo<DesktopGatewayMode>(() => {
    if (input.webAccessEnabled || isLocalGatewayUrl(input.gatewayUrl)) {
      return 'local';
    }

    return 'remote';
  }, [input.gatewayUrl, input.webAccessEnabled]);

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
      const data = (await createSettingsClient(input.gatewayUrl).getVersion(
        input.token,
      )) as SettingsVersionInfo;
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
  }, [input.gatewayUrl, input.token]);

  const refreshLocalDesktopAuth = React.useCallback(
    async (gatewayUrl: string) => {
      if (!(await waitForGatewayHealth(gatewayUrl))) {
        throw new Error('网关健康检查失败，请确认地址可访问。');
      }

      const tokenPair = await authenticateDesktopGateway(gatewayUrl);
      input.setAuth(
        tokenPair.accessToken,
        DESKTOP_DEFAULT_EMAIL,
        tokenPair.refreshToken,
        tokenPair.expiresIn,
      );
    },
    [input],
  );

  const refreshRemoteDesktopAuth = React.useCallback(
    async (gatewayUrl: string) => {
      if (!remoteAdminEmail || !remoteAdminPassword) {
        throw new Error('请填写远程网关管理员邮箱和密码。');
      }
      if (!(await waitForGatewayHealth(gatewayUrl))) {
        throw new Error('网关健康检查失败，请确认地址可访问。');
      }

      const tokenPair = await login(gatewayUrl, remoteAdminEmail, remoteAdminPassword);
      input.setAuth(
        tokenPair.accessToken,
        remoteAdminEmail,
        tokenPair.refreshToken,
        tokenPair.expiresIn,
      );
    },
    [input, remoteAdminEmail, remoteAdminPassword],
  );

  const saveGatewayUrl = React.useCallback(async () => {
    const gatewayUrl = normalizeGatewayUrl(urlInput);
    if (!isTauriRuntime()) {
      input.setGatewayUrl(gatewayUrl);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
      return;
    }

    setDesktopGatewayBusy(true);
    setDesktopGatewayError(null);
    try {
      const nextMode = desktopGatewayModeForUrl(gatewayUrl);
      if (nextMode === 'local') {
        const fallbackPort = parseGatewayPort(portInput, input.webPort);
        const port = readGatewayPortFromUrl(gatewayUrl, fallbackPort);
        const nextGatewayUrl = localGatewayUrl(port);
        await tauriInvoke('start_gateway', {
          port,
          host: hostForExposeLan(input.webExposeLan),
        });
        await refreshLocalDesktopAuth(nextGatewayUrl);
        writeDesktopGatewayMode('local');
        input.setGatewayUrl(nextGatewayUrl);
        input.setWebAccess(true, port);
        setUrlInput(nextGatewayUrl);
      } else {
        try {
          await tauriInvoke('stop_gateway');
        } catch (error: unknown) {
          logger.warn('Failed to stop local desktop gateway while saving remote URL', error);
        }
        writeDesktopGatewayMode('remote');
        input.setWebAccess(false, parseGatewayPort(portInput, input.webPort));
        await refreshRemoteDesktopAuth(gatewayUrl);
        input.setGatewayUrl(gatewayUrl);
      }
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
    } catch (error: unknown) {
      setDesktopGatewayError(error instanceof Error ? error.message : '桌面网关切换失败');
      logger.error('Desktop gateway URL save failed:', error);
    } finally {
      setDesktopGatewayBusy(false);
    }
  }, [input, portInput, refreshLocalDesktopAuth, refreshRemoteDesktopAuth, urlInput]);

  const toggleWebAccess = React.useCallback(async () => {
    const validPort = parseGatewayPort(portInput, input.webPort);

    setDesktopGatewayBusy(true);
    setDesktopGatewayError(null);
    try {
      if (input.webAccessEnabled) {
        const nextGatewayUrl = normalizeGatewayUrl(urlInput);
        if (!nextGatewayUrl || isLocalGatewayUrl(nextGatewayUrl)) {
          throw new Error('请先在上方填写远程网关地址，再切换到远程网关。');
        }

        await tauriInvoke('stop_gateway');
        writeDesktopGatewayMode('remote');
        await refreshRemoteDesktopAuth(nextGatewayUrl);
        input.setGatewayUrl(nextGatewayUrl);
        input.setWebAccess(false, validPort);
        return;
      }

      await tauriInvoke('start_gateway', {
        port: validPort,
        host: hostForExposeLan(input.webExposeLan),
      });
      const gatewayUrl = localGatewayUrl(validPort);
      await refreshLocalDesktopAuth(gatewayUrl);
      writeDesktopGatewayMode('local');
      input.setGatewayUrl(gatewayUrl);
      input.setWebAccess(true, validPort);
      setUrlInput(gatewayUrl);
    } catch (error: unknown) {
      setDesktopGatewayError(error instanceof Error ? error.message : '桌面网关切换失败');
      logger.error('Gateway toggle failed:', error);
    } finally {
      setDesktopGatewayBusy(false);
    }
  }, [input, portInput, refreshLocalDesktopAuth, refreshRemoteDesktopAuth, urlInput]);

  const saveWebPort = React.useCallback(async () => {
    const port = parseGatewayPort(portInput, input.webPort);

    // 非 Tauri 环境 / 远程模式：仅更新 store，不涉及 sidecar。
    if (!isTauriRuntime() || !isLocalGatewayUrl(input.gatewayUrl)) {
      input.setWebAccess(input.webAccessEnabled, port);
      return;
    }

    // 本地模式但未启用：sidecar 本就没在跑，仅更新 store 与 URL。
    if (!input.webAccessEnabled) {
      const nextGatewayUrl = localGatewayUrl(port);
      input.setWebAccess(false, port);
      input.setGatewayUrl(nextGatewayUrl);
      setUrlInput(nextGatewayUrl);
      writeDesktopGatewayMode('local');
      return;
    }

    // 已启用本地网关：端口没变则空操作；变了才 stop + start + 重新认证。
    if (port === input.webPort) {
      return;
    }

    const nextGatewayUrl = localGatewayUrl(port);
    setDesktopGatewayBusy(true);
    setDesktopGatewayError(null);
    try {
      try {
        await tauriInvoke('stop_gateway');
      } catch (error: unknown) {
        // 停止失败不致命——可能原进程已不在；继续尝试 start 新端口。
        logger.warn('stop_gateway failed while switching port', error);
      }
      await tauriInvoke('start_gateway', {
        port,
        host: hostForExposeLan(input.webExposeLan),
      });
      await refreshLocalDesktopAuth(nextGatewayUrl);
      writeDesktopGatewayMode('local');
      input.setGatewayUrl(nextGatewayUrl);
      input.setWebAccess(true, port);
      setUrlInput(nextGatewayUrl);
    } catch (error: unknown) {
      setDesktopGatewayError(error instanceof Error ? error.message : '切换端口失败');
      logger.error('saveWebPort failed', error);
    } finally {
      setDesktopGatewayBusy(false);
    }
  }, [input, portInput, refreshLocalDesktopAuth]);

  const copyAddress = React.useCallback(() => {
    void navigator.clipboard.writeText(`http://localhost:${input.webPort}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [input.webPort]);

  return {
    checkVersionUpdate,
    copied,
    copyAddress,
    desktopGatewayBusy,
    desktopGatewayError,
    desktopGatewayMode,
    portInput,
    remoteAdminEmail,
    remoteAdminPassword,
    saveGatewayUrl,
    saveWebPort,
    setRemoteAdminEmail,
    setRemoteAdminPassword,
    setPortInput,
    setUrlInput,
    toggleWebAccess,
    urlInput,
    urlSaved,
    versionInfo,
  };
}
