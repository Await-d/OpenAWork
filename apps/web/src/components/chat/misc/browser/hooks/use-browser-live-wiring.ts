/**
 * `BuiltInBrowser` 的实时引擎接线：把 `/browser-live` 的下行事件喂进既有控制台状态。
 *
 * 通道对两种引擎都启用：Web 端由它承载画面与采集；Tauri 原生窗口的画面仍是系统
 * webview（`CdpLiveEngine` 不挂载），但控制台 / 网络同样由网关侧 CDP 采集——没有
 * 这条通道，桌面端永远只能看到空控制台。
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
  /** 控制台日志入口（宿主负责按 tab 隔离）。 */
  appendLog: (entry: ConsoleEntry) => void;
  /** 网络阶段补丁入口（宿主按 networkId 归并到对应 tab）。 */
  upsertNetwork: (exchange: NetworkExchange) => void;
  /**
   * 当前可接受的最小页面代次（`null` / 缺省 = 不过滤）。
   *
   * 控制台 / 网络同样是「属于某个页面」的事件：快速切标签时旧页面最后几条日志会晚到，
   * 只按「当前激活标签」归属就会记到新标签上。传 ref 而不是值，保证判定始终用最新
   * 门槛、且不会因为门槛变化重建订阅。
   */
  minGenerationRef?: { current: number | null };
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
  appendLog,
  upsertNetwork,
  minGenerationRef,
}: UseBrowserLiveWiringOptions): BrowserLiveWiring {
  const session = useBrowserLiveSession();
  const { subscribe } = session;
  const token = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  /** 控制台行 id 计数器：与 iframe 注入脚本的 id 形状一样，只在宿主内唯一即可。 */
  const sequenceRef = useRef(0);

  // 惰性客户端：只有真正点「安装」时才需要，避免仅渲染提示条也构造连接器。
  //
  // 这里刻意**不用 ref 缓存**：在 useMemo 工厂体内读写 `lazyClientRef.current` 属于
  // 渲染期访问 ref，会被 React Compiler 判定为 "Cannot access refs during render"
  // 并放弃优化本 hook（实测 5 个函数脱靶）。而 ref 缓存本身就是冗余的——
  // `createBrowserLiveClient(baseUrl)` 是纯工厂（返回的方法把 token 作为参数传入、
  // 不持有连接），`useMemo` 按 gatewayUrl 记忆化已提供同等的实例稳定性。
  // 拆成两步是为了让 client 的引用在 token 变化时保持稳定，与原 ref 写法语义一致。
  const liveClient = useMemo(() => createBrowserLiveClient(gatewayUrl), [gatewayUrl]);
  const installClient = token ? liveClient : null;

  const availability = session.availability;
  const install = useBrowserInstall({
    installable: availability?.installable === true,
    client: installClient,
    token,
    onInstalled: session.recheckAvailability,
  });

  useEffect(() => {
    /**
     * 该事件是否属于已过期的页面。
     *
     * 只有「事件带代次 **且** 已知门槛」时才判定——老网关两种字段都没有，退回原来的
     * 「记到当前激活标签」行为，不会因为缺少元信息就把日志全丢掉。
     */
    const isStale = (generation: unknown): boolean => {
      const minimum = minGenerationRef?.current ?? null;
      if (typeof generation !== 'number' || minimum === null) return false;
      return generation < minimum;
    };

    return subscribe((envelope) => {
      switch (envelope.ch) {
        case 'console': {
          const payload = envelope.payload as BrowserLiveConsolePayload;
          if (isStale(payload.generation)) return;
          const sequence = sequenceRef.current;
          sequenceRef.current += 1;
          appendLog(consolePayloadToEntry(payload, sequence, Date.now()));
          return;
        }
        case 'network': {
          const payload = envelope.payload as BrowserLiveNetworkPayload;
          if (isStale(payload.generation)) return;
          upsertNetwork(networkPayloadToExchange(payload));
          return;
        }
        case 'error': {
          // 页面异常（page_error）与协议错误都走这里：控制台面板是它们的唯一出口。
          const payload = envelope.payload as BrowserLiveErrorPayload | undefined;
          if (isStale(payload?.generation)) return;
          const sequence = sequenceRef.current;
          sequenceRef.current += 1;
          appendLog(errorPayloadToEntry(payload, sequence, Date.now()));
          return;
        }
        default:
          return;
      }
    });
  }, [subscribe, appendLog, upsertNetwork, minGenerationRef]);

  return {
    session,
    availability: session.availability,
    unavailableHint: session.unavailableHint,
    install,
  };
}
