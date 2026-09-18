/**
 * `BuiltInBrowser` 的实时引擎接线：把 `/browser-live` 的下行事件喂进既有控制台状态。
 *
 * 是否让 live 视图接管内容区不在这里判断——那是能力矩阵（`computeEngineCapability`
 * 的 `liveView`）的职责，宿主统一从那里取值，避免同一条件散落多处。
 *
 * 单独成 hook 的原因：`BuiltInBrowser` 已接近 700 行的维护红线，而实时接线涉及
 * 可用性、订阅与逐事件映射；抽出来后宿主只需要透传几个 prop。
 */

import { useEffect, useMemo, useRef } from 'react';
import { createBrowserLiveClient } from '@openAwork/web-client';
import type { BrowserLiveClient, BrowserLiveStatus } from '@openAwork/web-client';
import type {
  BrowserLiveConsolePayload,
  BrowserLiveErrorPayload,
  BrowserLiveNetworkPayload,
} from '@openAwork/shared';

import type { ConsoleEntry, NetworkExchange } from '../browser-console-types.js';
import {
  consolePayloadToEntry,
  errorPayloadToEntry,
  networkPayloadToExchange,
} from '../live-console-bridge.js';
import { useBrowserLiveSession } from './use-browser-live-session.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';
import { useBrowserInstall } from './use-browser-install.js';
import type { BrowserInstallController } from './use-browser-install.js';
import { useAuthStore } from '../../../../../stores/auth/auth.js';

export interface UseBrowserLiveWiringOptions {
  /** 非 Tauri（网页端）才启用实时通道；Tauri 保留原生 webview 分支。 */
  enabled: boolean;
  /** 控制台日志入口（宿主负责按 tab 隔离）。 */
  appendLog: (entry: ConsoleEntry) => void;
  /** 网络阶段补丁入口（宿主按 networkId 归并到对应 tab）。 */
  upsertNetwork: (exchange: NetworkExchange) => void;
}

export interface BrowserLiveWiring {
  session: BrowserLiveSession;
  availability: BrowserLiveStatus | null;
  /** 网关声明不可用时的中文可操作提示；宿主负责渲染（可用时为 null）。 */
  unavailableHint: string | null;
  /** 应用内安装调试浏览器的状态机（含入口可用性）。 */
  install: BrowserInstallController;
}

export function useBrowserLiveWiring({
  enabled,
  appendLog,
  upsertNetwork,
}: UseBrowserLiveWiringOptions): BrowserLiveWiring {
  const session = useBrowserLiveSession({ enabled });
  const { subscribe } = session;
  const token = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  /** 控制台行 id 计数器：与 iframe 注入脚本的 id 形状一样，只在宿主内唯一即可。 */
  const sequenceRef = useRef(0);

  // 惰性客户端：只有真正点「安装」时才需要，避免仅渲染提示条也构造连接器。
  const lazyClientRef = useRef<{ baseUrl: string; client: BrowserLiveClient } | null>(null);
  const installClient = useMemo((): BrowserLiveClient | null => {
    if (!enabled || !token) return null;
    if (lazyClientRef.current?.baseUrl !== gatewayUrl) {
      lazyClientRef.current = { baseUrl: gatewayUrl, client: createBrowserLiveClient(gatewayUrl) };
    }
    return lazyClientRef.current.client;
  }, [enabled, token, gatewayUrl]);

  const availability = session.availability;
  const install = useBrowserInstall({
    installable: availability?.installable === true,
    client: installClient,
    token,
    onInstalled: session.recheckAvailability,
  });

  useEffect(() => {
    if (!enabled) return;

    return subscribe((envelope) => {
      switch (envelope.ch) {
        case 'console': {
          const sequence = sequenceRef.current;
          sequenceRef.current += 1;
          appendLog(
            consolePayloadToEntry(
              envelope.payload as BrowserLiveConsolePayload,
              sequence,
              Date.now(),
            ),
          );
          return;
        }
        case 'network': {
          upsertNetwork(networkPayloadToExchange(envelope.payload as BrowserLiveNetworkPayload));
          return;
        }
        case 'error': {
          // 页面异常（page_error）与协议错误都走这里：控制台面板是它们的唯一出口。
          const payload = envelope.payload as BrowserLiveErrorPayload | undefined;
          const sequence = sequenceRef.current;
          sequenceRef.current += 1;
          appendLog(errorPayloadToEntry(payload, sequence, Date.now()));
          return;
        }
        default:
          return;
      }
    });
  }, [enabled, subscribe, appendLog, upsertNetwork]);

  return {
    session,
    availability: session.availability,
    unavailableHint: session.unavailableHint,
    install,
  };
}
