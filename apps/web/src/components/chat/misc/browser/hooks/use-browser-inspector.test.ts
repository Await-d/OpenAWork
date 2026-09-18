// @vitest-environment jsdom
/**
 * `useBrowserInspector` 的通道接线覆盖：上行请求（含深度收敛）与下行信封
 * （dom / a11y / node / error）到状态机的映射，以及「完整样式」两种入口。
 * 全程用假 session，不建立连接。
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserLiveEnvelope } from '@openAwork/shared';
import { useBrowserInspector } from './use-browser-inspector.js';
import type { BrowserLiveSession } from './use-browser-live-session.js';

type Listener = (envelope: BrowserLiveEnvelope) => void;

function makeSession() {
  const listeners = new Set<Listener>();
  const send = vi.fn();
  const session: BrowserLiveSession = {
    availability: null,
    phase: 'connected',
    lastError: null,
    unavailableHint: null,
    send,
    screenshot: vi.fn(async () => null),
    close: vi.fn(),
    recheckAvailability: vi.fn(),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const emit = (envelope: Partial<BrowserLiveEnvelope> & Pick<BrowserLiveEnvelope, 'ch'>): void => {
    act(() => {
      for (const listener of [...listeners]) {
        listener({ seq: 0, ts: 1, payload: undefined, ...envelope });
      }
    });
  };
  return { session, send, emit, listenerCount: () => listeners.size };
}

function renderInspector(options: { enabled?: boolean } = {}) {
  const harness = makeSession();
  const armPickForStyles = vi.fn();
  const hook = renderHook(() =>
    useBrowserInspector({
      session: harness.session,
      enabled: options.enabled ?? true,
      armPickForStyles,
    }),
  );
  return { ...harness, ...hook, armPickForStyles };
}

const DOM_ROOT = {
  nodeId: 1,
  backendNodeId: 10,
  nodeName: '#document',
  attributes: {},
  childCount: 1,
  children: [{ nodeId: 2, backendNodeId: 20, nodeName: 'HTML', attributes: {}, childCount: 0 }],
};

const NODE_PAYLOAD = {
  selector: 'button#submit',
  nodeName: 'BUTTON',
  attributes: { id: 'submit' },
  text: '提交订单',
  computedStyles: { display: 'flex' },
  fullComputedStyles: { display: 'flex' },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBrowserInspector 上行请求', () => {
  it('dom.tree 带深度下发，并把非法深度收敛到区间内', () => {
    const { result, send } = renderInspector();

    act(() => result.current.requestDom(4));
    expect(send).toHaveBeenLastCalledWith({ ch: 'control', action: 'dom.tree', depth: 4 });

    act(() => result.current.requestDom(99));
    expect(send).toHaveBeenLastCalledWith({ ch: 'control', action: 'dom.tree', depth: 12 });

    act(() => result.current.requestDom(0));
    expect(send).toHaveBeenLastCalledWith({ ch: 'control', action: 'dom.tree', depth: 1 });
    expect(result.current.domStatus).toBe('loading');
  });

  it('a11y.tree 不带参数；请求会把状态置为 loading', () => {
    const { result, send } = renderInspector();

    act(() => result.current.requestA11y());

    expect(send).toHaveBeenCalledWith({ ch: 'control', action: 'a11y.tree' });
    expect(result.current.a11yStatus).toBe('loading');
  });

  it('没有拾取坐标时先用 styles 意图武装拾取，不下发 node.styles', () => {
    const { result, send, armPickForStyles } = renderInspector();

    act(() => result.current.requestFullStyles());

    expect(armPickForStyles).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(result.current.nodeStatus).toBe('idle');
  });

  it('记住拾取坐标后按该坐标下发 node.styles', () => {
    const { result, send } = renderInspector();

    act(() => result.current.recordPickPoint({ x: 120, y: 64 }));
    act(() => result.current.requestFullStyles());

    expect(send).toHaveBeenCalledWith({ ch: 'control', action: 'node.styles', x: 120, y: 64 });
    expect(result.current.nodeStatus).toBe('loading');
  });
});

describe('useBrowserInspector 下行信封', () => {
  it('dom / a11y / node 信封落进状态并置 ready', () => {
    const { result, emit } = renderInspector();

    emit({ ch: 'dom', payload: { root: DOM_ROOT, truncated: true } });
    expect(result.current.dom?.truncated).toBe(true);
    expect(result.current.domStatus).toBe('ready');

    emit({ ch: 'a11y', payload: { root: null, nodeCount: 0 } });
    expect(result.current.a11y).toEqual({ root: null, nodeCount: 0 });
    expect(result.current.a11yStatus).toBe('ready');

    emit({ ch: 'node', payload: NODE_PAYLOAD });
    expect(result.current.node?.selector).toBe('button#submit');
    expect(result.current.nodeStatus).toBe('ready');
  });

  it('形状不符的信封被丢弃，不污染状态', () => {
    const { result, emit } = renderInspector();

    act(() => result.current.requestDom(4));
    emit({ ch: 'dom', payload: { root: { nodeId: 'x' }, truncated: false } });

    expect(result.current.dom).toBeNull();
    expect(result.current.domStatus).toBe('loading');

    emit({ ch: 'node', payload: { selector: '' } });
    expect(result.current.node).toBeNull();
  });

  it('错误信封给出可读文案，并把在途请求降级为 error', () => {
    const { result, emit } = renderInspector();

    act(() => result.current.requestA11y());
    emit({ ch: 'error', payload: { code: 'A11Y_TREE_FAILED', message: '获取页面无障碍树失败。' } });

    expect(result.current.errorMessage).toBe('A11Y_TREE_FAILED：获取页面无障碍树失败。');
    expect(result.current.a11yStatus).toBe('error');

    // 旁观的错误（没有在途请求）不改动其它请求状态。
    emit({ ch: 'error', payload: { code: 'NAV_FAILED' } });
    expect(result.current.errorMessage).toBe('NAV_FAILED');
    expect(result.current.domStatus).toBe('idle');

    // 成功回包清空错误。
    emit({ ch: 'dom', payload: { root: DOM_ROOT, truncated: false } });
    expect(result.current.errorMessage).toBeNull();
  });

  it('未启用时不订阅任何下行信封', () => {
    const { result, emit, listenerCount } = renderInspector({ enabled: false });

    expect(listenerCount()).toBe(0);
    emit({ ch: 'dom', payload: { root: DOM_ROOT, truncated: false } });
    expect(result.current.dom).toBeNull();
  });
});
