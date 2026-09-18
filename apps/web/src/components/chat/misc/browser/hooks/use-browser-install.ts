/**
 * 「安装调试浏览器」的应用内引导状态机。
 *
 * 探针报告 `browser-missing` / `browser-outdated` 时，用户点击提示条上的按钮即可触发
 * 网关安装 Playwright chromium；本 hook 负责触发、轮询进度、成功后重探可用性
 * （让实时引擎无需刷新页面即可接管），失败 / CLI 缺席时把可操作信息交回 UI。
 *
 * 边界：只在 `installable` 为 true 时暴露入口；disabled runtime 永远不出现按钮。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserInstallStatus, BrowserLiveClient } from '@openAwork/web-client';
import { HttpError } from '@openAwork/web-client';

/** 安装进行中的轮询间隔。 */
export const BROWSER_INSTALL_POLL_INTERVAL_MS = 1500;

/** CLI 缺席时用户可手动执行的命令（与网关侧常量保持一致）。 */
export const MANUAL_INSTALL_COMMAND = 'npx playwright install chromium';

/** 409：已有安装在进行中——此时改为接管轮询，而不是当成失败。 */
const INSTALL_CONFLICT_STATUS = 409;

export interface UseBrowserInstallOptions {
  /** 当前 reason 是否可通过安装解决；false 时不启动、不轮询。 */
  installable: boolean;
  /** 已按 baseUrl 构造好的实时客户端；缺省时入口不可用。 */
  client: BrowserLiveClient | null;
  /** 当前 access token；缺省时入口不可用。 */
  token: string | null;
  /** 安装成功后重探可用性（由 `use-browser-live-session` 提供）。 */
  onInstalled: () => void;
}

export interface BrowserInstallController {
  status: BrowserInstallStatus | null;
  /** POST 是否在路上（此时按钮显示忙碌态）。 */
  starting: boolean;
  /** 是否允许展示「安装调试浏览器」入口。 */
  canInstall: boolean;
  /** 触发安装（或接管已在进行的安装）。 */
  start: () => void;
}

function readError(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    const data = error.data as { error?: unknown } | undefined;
    if (data && typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

export function useBrowserInstall({
  installable,
  client,
  token,
  onInstalled,
}: UseBrowserInstallOptions): BrowserInstallController {
  const [status, setStatus] = useState<BrowserInstallStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const disposedRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const statusRef = useRef<BrowserInstallStatus | null>(null);
  /** `onInstalled` 只在本次安装内触发一次（轮询会重复读到 succeeded）。 */
  const notifiedRef = useRef(false);

  const applyStatus = useCallback((next: BrowserInstallStatus): void => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const stopPolling = useCallback((): void => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  const failLocal = useCallback(
    (message: string): void => {
      applyStatus({
        state: 'failed',
        startedAt: statusRef.current?.startedAt ?? null,
        finishedAt: Date.now(),
        tailLog: statusRef.current?.tailLog ?? [],
        error: message,
        browsersPath: statusRef.current?.browsersPath ?? null,
      });
    },
    [applyStatus],
  );

  const poll = useCallback(
    async (browserClient: BrowserLiveClient, authToken: string): Promise<void> => {
      const controller = new AbortController();
      pollAbortRef.current = controller;
      while (!disposedRef.current && !controller.signal.aborted) {
        let next: BrowserInstallStatus;
        try {
          next = await browserClient.getInstallStatus(authToken, { signal: controller.signal });
        } catch (error) {
          if (disposedRef.current || controller.signal.aborted) return;
          failLocal(readError(error, '读取安装状态失败。'));
          return;
        }
        if (disposedRef.current || controller.signal.aborted) return;
        applyStatus(next);

        if (next.state === 'succeeded') {
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onInstalled();
          }
          return;
        }
        if (next.state === 'failed' || next.state === 'unavailable') {
          return;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, BROWSER_INSTALL_POLL_INTERVAL_MS);
        });
      }
    },
    [applyStatus, failLocal, onInstalled],
  );

  const start = useCallback((): void => {
    if (!client || !token || !installable || starting) {
      return;
    }
    const browserClient = client;
    const authToken = token;
    disposedRef.current = false;
    notifiedRef.current = false;
    stopPolling();
    setStarting(true);
    void (async () => {
      try {
        await browserClient.installBrowser(authToken);
        // POST 成功（202）：进入轮询读取真实进度。
        await poll(browserClient, authToken);
      } catch (error) {
        // 409：别的会话已在进行中。接管进度而不是报错——这正是单飞要表达的语义。
        if (error instanceof HttpError && error.status === INSTALL_CONFLICT_STATUS) {
          await poll(browserClient, authToken);
          return;
        }
        if (!disposedRef.current) {
          failLocal(readError(error, `安装失败，请手动执行 ${MANUAL_INSTALL_COMMAND}。`));
        }
      } finally {
        setStarting(false);
      }
    })();
  }, [client, token, installable, starting, poll, stopPolling, failLocal]);

  useEffect(() => {
    if (installable) {
      return;
    }
    // reason 已不再是「可安装」：清掉残留状态，避免按钮/进度条误导。
    stopPolling();
    statusRef.current = null;
    setStatus(null);
  }, [installable, stopPolling]);

  useEffect(() => {
    return () => {
      disposedRef.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  const canInstall = installable && client !== null && token !== null;

  return { status, starting, canInstall, start };
}
