// @vitest-environment jsdom
/**
 * `useTerminalLayout` —— 布局持久化 hook 的语义测试。
 *
 * 重点是 workflow「⚠️ 最危险的交互」的三条防线（红→绿主用例）：
 *   1. 切会话瞬间（`liveIdsTrusted=false` 且 `liveTerminalIds=null`）**不得归一、不得清空**；
 *   2. 归一化只在渲染路径发生，**落盘只走用户主动操作**；
 *   3. `sessionKey` 跟随 `lastChatPath`，不同会话的布局互不干扰。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { terminalPanelSessionKeyFor, useUIStateStore } from '../../../../stores/ui/uiState.js';
import { useTerminalLayout } from './use-terminal-layout.js';
import { countPanes, layoutTerminalIds } from './queries.js';
import { makePane, makeSplit } from './test-fixtures.js';
import type { TerminalLayout } from './types.js';

const SESSION_A = '/chat/session-a';
const SESSION_B = '/chat/session-b';

interface HookProps {
  liveTerminalIds: ReadonlySet<string> | null;
  liveIdsTrusted: boolean;
}

/** 两分屏、每屏一个终端（p1→t1 / p2→t2）。 */
function twoPaneLayout(): TerminalLayout {
  return makeSplit('split-p2', 'row', [makePane('p1', ['t1']), makePane('p2', ['t2'])]);
}

const REAL_SETTER = useUIStateStore.getState().setTerminalLayoutForSession;

interface SetterCall {
  sessionKey: string;
  layout: TerminalLayout | null;
}

/** 记录落盘调用但仍走真实 setter —— 用来断言「渲染路径一次都没落盘」。 */
function installSetterSpy(): SetterCall[] {
  const calls: SetterCall[] = [];
  useUIStateStore.setState({
    setTerminalLayoutForSession: (sessionKey, layout) => {
      calls.push({ sessionKey, layout });
      REAL_SETTER(sessionKey, layout);
    },
  });
  return calls;
}

function seedSession(sessionKey: string, layout: TerminalLayout): void {
  useUIStateStore.getState().setLastChatPath(sessionKey);
  useUIStateStore.getState().setTerminalLayoutForSession(sessionKey, layout);
}

/** 读取落盘布局；缺桶直接抛错，避免 `noUncheckedIndexedAccess` 下的 undefined 穿透。 */
function readPersisted(sessionKey: string): TerminalLayout {
  const layout = useUIStateStore.getState().terminalLayoutBySession[sessionKey];
  if (layout === undefined) {
    throw new Error(`会话 ${sessionKey} 没有落盘布局`);
  }
  return layout;
}

function renderLayout(initialProps: HookProps) {
  return renderHook((props: HookProps) => useTerminalLayout(props), { initialProps });
}

function resetStore(): void {
  useUIStateStore.setState({
    lastChatPath: null,
    terminalLayoutBySession: {},
    terminalPanelOpened: false,
    terminalPanelOpenedBySession: {},
  });
}

beforeEach(resetStore);

afterEach(() => {
  cleanup();
  useUIStateStore.setState({ setTerminalLayoutForSession: REAL_SETTER });
  vi.restoreAllMocks();
  resetStore();
});

describe('无持久化布局', () => {
  it('layout 为 null，sessionKey 落到 __default__ 桶', () => {
    const { result } = renderLayout({ liveTerminalIds: null, liveIdsTrusted: false });

    expect(result.current.layout).toBeNull();
    expect(result.current.sessionKey).toBe(terminalPanelSessionKeyFor(null));
  });
});

describe('⚠️ 最危险的交互：切会话瞬间不得清空布局', () => {
  it('liveIdsTrusted=false 且 liveTerminalIds=null → 原样返回，store 不被改写', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result, rerender } = renderLayout({ liveTerminalIds: null, liveIdsTrusted: false });

    expect(result.current.sessionKey).toBe(SESSION_A);
    expect(result.current.layout).toBe(stored);
    expect(useUIStateStore.getState().terminalLayoutBySession[SESSION_A]).toBe(stored);

    // 上游随后就绪：集合包含这两个终端 → 布局保持，不被归一改写
    rerender({ liveTerminalIds: new Set(['t1', 't2']), liveIdsTrusted: true });
    expect(result.current.layout).toBe(stored);
    expect(useUIStateStore.getState().terminalLayoutBySession[SESSION_A]).toBe(stored);
  });

  it('liveIdsTrusted=true 但集合为 null（未同步）→ 同样原样返回', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result } = renderLayout({ liveTerminalIds: null, liveIdsTrusted: true });

    expect(result.current.layout).toBe(stored);
    expect(useUIStateStore.getState().terminalLayoutBySession[SESSION_A]).toBe(stored);
  });
});

describe('真实归一', () => {
  it('可信集合只含部分终端 → 渲染归一摘除死终端，但 store 未落盘', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1']),
      liveIdsTrusted: true,
    });

    expect(result.current.layout).toEqual(makePane('p1', ['t1']));
    // 归一只是渲染态：未经过用户操作，store 必须保持原样
    expect(useUIStateStore.getState().terminalLayoutBySession[SESSION_A]).toBe(stored);
  });
});

describe('持久化只在用户操作', () => {
  it('单纯渲染（含归一变化）不会触发 setTerminalLayoutForSession', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);
    const calls = installSetterSpy();

    const { rerender } = renderLayout({ liveTerminalIds: null, liveIdsTrusted: false });
    rerender({ liveTerminalIds: new Set(['t1']), liveIdsTrusted: true });

    expect(calls).toHaveLength(0);
  });

  it('splitPane 落盘，且不摘掉上游尚未同步的种子终端', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1', 't2']),
      liveIdsTrusted: true,
    });

    act(() => {
      result.current.splitPane('p1', 'column', 'p3', 't3');
    });

    const persisted = readPersisted(SESSION_A);
    expect(persisted).not.toBe(stored);
    expect(countPanes(persisted)).toBe(3);
    expect(layoutTerminalIds(persisted).has('t3')).toBe(true);
  });

  it('removeTerminal 落盘为缺一个终端的树', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1', 't2']),
      liveIdsTrusted: true,
    });

    act(() => {
      result.current.removeTerminal('t2');
    });

    const persisted = useUIStateStore.getState().terminalLayoutBySession[SESSION_A];
    expect(persisted).toEqual(makePane('p1', ['t1']));
  });

  it('resetLayout 删除当前会话桶', () => {
    const stored = twoPaneLayout();
    seedSession(SESSION_A, stored);

    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1', 't2']),
      liveIdsTrusted: true,
    });

    act(() => {
      result.current.resetLayout();
    });

    expect(useUIStateStore.getState().terminalLayoutBySession[SESSION_A]).toBeUndefined();
  });
});

describe('sessionKey 与会话隔离', () => {
  it('sessionKey 跟随 lastChatPath，两个会话布局互不干扰', () => {
    const layoutA = twoPaneLayout();
    const layoutB = makePane('pb', ['t9']);
    seedSession(SESSION_A, layoutA);
    seedSession(SESSION_B, layoutB);

    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1', 't2', 't9']),
      liveIdsTrusted: true,
    });

    expect(result.current.sessionKey).toBe(SESSION_B);
    expect(result.current.layout).toBe(layoutB);

    act(() => {
      useUIStateStore.getState().setLastChatPath(SESSION_A);
    });

    expect(result.current.sessionKey).toBe(SESSION_A);
    expect(result.current.layout).toBe(layoutA);
  });

  it('在 A 会话的操作只写 A 的桶，不污染 B', () => {
    const layoutA = twoPaneLayout();
    const layoutB = makePane('pb', ['t9']);
    seedSession(SESSION_A, layoutA);
    seedSession(SESSION_B, layoutB);

    act(() => {
      useUIStateStore.getState().setLastChatPath(SESSION_A);
    });
    const { result } = renderLayout({
      liveTerminalIds: new Set(['t1', 't2', 't9']),
      liveIdsTrusted: true,
    });

    act(() => {
      result.current.removePane('p2');
    });

    const state = useUIStateStore.getState();
    expect(state.terminalLayoutBySession[SESSION_A]).toEqual(makePane('p1', ['t1']));
    expect(state.terminalLayoutBySession[SESSION_B]).toBe(layoutB);
  });
});
