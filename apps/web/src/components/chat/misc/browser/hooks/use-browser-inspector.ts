/**
 * 元素检查器的实时通道接线（`/browser-live`）。
 *
 * 与 `useBrowserLiveWiring` 共用同一个 `BrowserLiveSession`（由 `BuiltInBrowser`
 * 持有并透传）：订阅是扇出的，检查器与控制台互不影响，绝不新开第二条连接。
 *
 * 职责边界：本 hook 只做「下行信封 → 状态」与「上行请求」，不做任何渲染判断；
 * 视图逻辑全部在 `BrowserInspectorPanel`（因此验收 harness 可以直接挂合成信封，
 * 绕过这个 hook）。
 *
 * 拾取坐标只能从 `useCdpLivePick` 的点击中获得（`node` 信封不带坐标），所以
 * 「获取完整样式」要么用已记录的坐标直接下发 `node.styles`，要么先以 styles 意图
 * 武装拾取、等下一次点击回来再下发——两者都复用既有拾取机制，不另造一套。
 */

import { useEffect, useRef, useState } from 'react';
import type {
  BrowserLiveA11yPayload,
  BrowserLiveDomPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';

import {
  clampInspectorDepth,
  toA11yPayload,
  toDomPayload,
  toNodePayload,
} from '../browser-inspector-model.js';
import type { BrowserInspectorLoadStatus } from '../browser-inspector-model.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

/** 设备坐标（拾取 / `node.styles` 都以它为输入）。 */
export interface BrowserInspectorPickPoint {
  x: number;
  y: number;
}

export interface UseBrowserInspectorOptions {
  session: BrowserLiveSession;
  /** 是否启用；false 时完全不订阅（Tauri 原生窗口 / iframe 回退）。 */
  enabled: boolean;
  /** 没有拾取坐标时，「获取完整样式」先用 styles 意图武装元素拾取。 */
  armPickForStyles: () => void;
}

export interface BrowserInspectorController {
  dom: BrowserLiveDomPayload | null;
  a11y: BrowserLiveA11yPayload | null;
  node: BrowserLiveNodePayload | null;
  domStatus: BrowserInspectorLoadStatus;
  a11yStatus: BrowserInspectorLoadStatus;
  nodeStatus: BrowserInspectorLoadStatus;
  /** 最近一次协议错误（`ch:'error'`）；下一次成功回包时清空。 */
  errorMessage: string | null;
  requestDom: (depth: number) => void;
  requestA11y: () => void;
  requestFullStyles: () => void;
  /** 拾取请求发出（`useCdpLivePick` 的 onPickSent）：记录坐标供完整样式复用。 */
  recordPickPoint: (point: BrowserInspectorPickPoint) => void;
}

export function useBrowserInspector({
  session,
  enabled,
  armPickForStyles,
}: UseBrowserInspectorOptions): BrowserInspectorController {
  const { send, subscribe } = session;

  const [dom, setDom] = useState<BrowserLiveDomPayload | null>(null);
  const [a11y, setA11y] = useState<BrowserLiveA11yPayload | null>(null);
  const [node, setNode] = useState<BrowserLiveNodePayload | null>(null);
  const [domStatus, setDomStatus] = useState<BrowserInspectorLoadStatus>('idle');
  const [a11yStatus, setA11yStatus] = useState<BrowserInspectorLoadStatus>('idle');
  const [nodeStatus, setNodeStatus] = useState<BrowserInspectorLoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pickPointRef = useRef<BrowserInspectorPickPoint | null>(null);

  useEffect(() => {
    if (!enabled) return;

    return subscribe((envelope) => {
      switch (envelope.ch) {
        case 'dom': {
          const payload = toDomPayload(envelope.payload);
          if (payload === null) return;
          setDom(payload);
          setDomStatus('ready');
          setErrorMessage(null);
          return;
        }
        case 'a11y': {
          const payload = toA11yPayload(envelope.payload);
          if (payload === null) return;
          setA11y(payload);
          setA11yStatus('ready');
          setErrorMessage(null);
          return;
        }
        case 'node': {
          const payload = toNodePayload(envelope.payload);
          if (payload === null) return;
          setNode(payload);
          setNodeStatus('ready');
          setErrorMessage(null);
          return;
        }
        case 'error': {
          const payload = envelope.payload as { code?: unknown; message?: unknown };
          const code = typeof payload?.code === 'string' ? payload.code : 'BROWSER_LIVE_ERROR';
          const message = typeof payload?.message === 'string' ? payload.message : '';
          setErrorMessage(message.length > 0 ? `${code}：${message}` : code);
          // 只有确实在途的请求才降级为 error；旁观事件（如导航失败）不动请求状态。
          setDomStatus((current) => (current === 'loading' ? 'error' : current));
          setA11yStatus((current) => (current === 'loading' ? 'error' : current));
          setNodeStatus((current) => (current === 'loading' ? 'error' : current));
          return;
        }
        default:
          return;
      }
    });
  }, [enabled, subscribe]);

  const requestDom = (depth: number): void => {
    setDomStatus('loading');
    setErrorMessage(null);
    send({ ch: 'control', action: 'dom.tree', depth: clampInspectorDepth(depth) });
  };

  const requestA11y = (): void => {
    setA11yStatus('loading');
    setErrorMessage(null);
    send({ ch: 'control', action: 'a11y.tree' });
  };

  const requestFullStyles = (): void => {
    const point = pickPointRef.current;
    if (point === null) {
      // 没有坐标就无法下发 node.styles：先用 styles 意图武装拾取，
      // 下一次点击由引擎直接发 node.styles（不写 composer）。
      armPickForStyles();
      return;
    }
    setNodeStatus('loading');
    setErrorMessage(null);
    send({ ch: 'control', action: 'node.styles', x: point.x, y: point.y });
  };

  const recordPickPoint = (point: BrowserInspectorPickPoint): void => {
    pickPointRef.current = point;
  };

  return {
    dom,
    a11y,
    node,
    domStatus,
    a11yStatus,
    nodeStatus,
    errorMessage,
    requestDom,
    requestA11y,
    requestFullStyles,
    recordPickPoint,
  };
}
