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

/**
 * 设置页环境动作的统一包装：`run` 全流程留在 try 内，catch 交给 `onError`
 * （不传＝异常继续向上抛，不得静默吞掉），finally 跑清理。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（catch 里的 `error instanceof Error ? … : …` 同样触发），本 hook 4 处
 * try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runEnvironmentActionOnce(ctx: {
  onError?: (error: unknown) => void;
  onFinally?: () => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    if (!ctx.onError) {
      throw error;
    }
    ctx.onError(error);
  } finally {
    ctx.onFinally?.();
  }
}

/**
 * 尽力停止本地 sidecar：失败只记日志、不打断上层流程。
 *
 * 原代码把它写成嵌套 try/catch，而嵌套 try 同样会让所在 hook 脱靶，故抽到模块级
 * （warnMessage 由调用点给出，保持各自的日志文案不变）。
 */
async function stopGatewayIgnoringFailure(warnMessage: string): Promise<void> {
  try {
    await tauriInvoke('stop_gateway');
  } catch (error: unknown) {
    logger.warn(warnMessage, error);
  }
}

/** 读取桌面端当前更新通道；非 Tauri 运行或读取失败都回落 `preview`。 */
async function resolveDesktopUpdateChannel(): Promise<'preview' | 'stable'> {
  if (!isTauriRuntime()) {
    return 'preview';
  }
  try {
    const resolved = await tauriInvoke<string>('current_update_channel');
    return resolved === 'stable' ? 'stable' : 'preview';
  } catch {
    return 'preview';
  }
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
    const token = input.token;
    if (!token) {
      return;
    }

    setVersionInfo((previous: SettingsVersionInfo) => ({
      ...previous,
      checking: true,
      checkError: null,
    }));

    // 外层 try/catch 下沉到 `runEnvironmentActionOnce`，内层「通道探测」下沉到
    // `resolveDesktopUpdateChannel`（见各自注释）。
    await runEnvironmentActionOnce({
      onError: () => {
        setVersionInfo((previous: SettingsVersionInfo) => ({
          ...previous,
          checking: false,
          checkError: '检查失败，请稍后重试',
        }));
      },
      run: async () => {
        const channel = await resolveDesktopUpdateChannel();
        const data = (await createSettingsClient(input.gatewayUrl).getVersion(token, {
          channel,
        })) as SettingsVersionInfo;
        setVersionInfo({
          currentVersion: data.currentVersion,
          latestVersion: data.latestVersion,
          updateAvailable: data.updateAvailable,
          checkError: data.checkError,
          checkedAt: data.checkedAt,
          checking: false,
        });
      },
    });
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
    const nextUrl = normalizeGatewayUrl(urlInput);
    // 空输入视为「不修改」:空 baseUrl 会让所有 `${baseUrl}/xxx` 退化成相对路径,
    // 请求打到前端自身并被 SPA 兜底成 index.html(用量 / 开发日志 / Worker 等面板
    // 统一报 `Unexpected token '<'`)。这里把输入框回填成当前生效地址并直接返回,
    // 既不落库空值,也不误触发桌面端的网关切换流程。
    if (!nextUrl) {
      setUrlInput(input.gatewayUrl);
      return;
    }
    if (!isTauriRuntime()) {
      input.setGatewayUrl(nextUrl);
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2000);
      return;
    }

    setDesktopGatewayBusy(true);
    setDesktopGatewayError(null);
    // 外层 try/catch/finally 下沉到 `runEnvironmentActionOnce`；内层「停止失败只记日志」
    // 走模块级 `stopGatewayIgnoringFailure`（见各自注释）。
    await runEnvironmentActionOnce({
      onError: (error) => {
        setDesktopGatewayError(error instanceof Error ? error.message : '桌面网关切换失败');
        logger.error('Desktop gateway URL save failed:', error);
      },
      onFinally: () => {
        setDesktopGatewayBusy(false);
      },
      run: async () => {
        const nextMode = desktopGatewayModeForUrl(nextUrl);
        if (nextMode === 'local') {
          const fallbackPort = parseGatewayPort(portInput, input.webPort);
          const port = readGatewayPortFromUrl(nextUrl, fallbackPort);
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
          await stopGatewayIgnoringFailure(
            'Failed to stop local desktop gateway while saving remote URL',
          );
          writeDesktopGatewayMode('remote');
          input.setWebAccess(false, parseGatewayPort(portInput, input.webPort));
          await refreshRemoteDesktopAuth(nextUrl);
          input.setGatewayUrl(nextUrl);
        }
        setUrlSaved(true);
        setTimeout(() => setUrlSaved(false), 2000);
      },
    });
  }, [input, portInput, refreshLocalDesktopAuth, refreshRemoteDesktopAuth, urlInput]);

  const toggleWebAccess = React.useCallback(async () => {
    const validPort = parseGatewayPort(portInput, input.webPort);

    setDesktopGatewayBusy(true);
    setDesktopGatewayError(null);
    // try/catch/finally 下沉到模块级 `runEnvironmentActionOnce`（见其注释）。
    await runEnvironmentActionOnce({
      onError: (error) => {
        setDesktopGatewayError(error instanceof Error ? error.message : '桌面网关切换失败');
        logger.error('Gateway toggle failed:', error);
      },
      onFinally: () => {
        setDesktopGatewayBusy(false);
      },
      run: async () => {
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
      },
    });
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
    // 外层 try/catch/finally 下沉到 `runEnvironmentActionOnce`；内层「停止失败不致命」
    // 走模块级 `stopGatewayIgnoringFailure`（见各自注释）。
    await runEnvironmentActionOnce({
      onError: (error) => {
        setDesktopGatewayError(error instanceof Error ? error.message : '切换端口失败');
        logger.error('saveWebPort failed', error);
      },
      onFinally: () => {
        setDesktopGatewayBusy(false);
      },
      run: async () => {
        // 停止失败不致命——可能原进程已不在；继续尝试 start 新端口。
        await stopGatewayIgnoringFailure('stop_gateway failed while switching port');
        await tauriInvoke('start_gateway', {
          port,
          host: hostForExposeLan(input.webExposeLan),
        });
        await refreshLocalDesktopAuth(nextGatewayUrl);
        writeDesktopGatewayMode('local');
        input.setGatewayUrl(nextGatewayUrl);
        input.setWebAccess(true, port);
        setUrlInput(nextGatewayUrl);
      },
    });
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
