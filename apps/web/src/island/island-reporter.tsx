import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useUIStateStore } from '../stores/ui/uiState.js';
import { subscribeSessionRunState } from '../utils/session/session-list-events.js';
import { hasIslandBridge, islandInvoke, islandListen } from './island-bridge.js';
import type { IslandAgentState } from './island-types.js';

interface NavigatePayload {
  sessionId?: unknown;
}

/**
 * 主窗口 → 灵动岛的状态上报器(不渲染任何内容)。
 *
 * 数据源刻意选 `subscribeSessionRunState` 这条已有总线:它只在
 * idle↔running↔paused 翻转时触发且自带 `queueMicrotask` 合批,避免按 token
 * 高频 IPC。会话上下文(标题 / id)从 UI store 的当前标签页取。
 */
export function IslandReporter() {
  const navigate = useNavigate();
  const activeSessionId = useUIStateStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.sessionId ?? null;
  });
  const activeTitle = useUIStateStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.title ?? null;
  });
  /** 各会话最近一次已知运行态:切标签时用它回填,避免误报 idle。 */
  const lastStateBySession = useRef(new Map<string, IslandAgentState>());

  const report = (
    state: IslandAgentState,
    sessionId: string | null,
    title: string | null,
  ): void => {
    if (!hasIslandBridge()) {
      return;
    }
    void islandInvoke('island_report_agent_state', {
      state,
      sessionId,
      title,
      preview: null,
    }).catch(() => undefined);
  };

  useEffect(() => {
    const known = activeSessionId ? lastStateBySession.current.get(activeSessionId) : undefined;
    report(known ?? 'idle', activeSessionId, activeTitle);
  }, [activeSessionId, activeTitle]);

  useEffect(() => {
    if (!hasIslandBridge()) {
      return;
    }
    return subscribeSessionRunState((sessionId, state) => {
      lastStateBySession.current.set(sessionId, state);
      if (sessionId !== activeSessionId) {
        return;
      }
      report(state, sessionId, activeTitle);
    });
  }, [activeSessionId, activeTitle]);

  useEffect(() => {
    if (!hasIslandBridge()) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void islandListen<NavigatePayload>('island:navigate', (payload) => {
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      if (sessionId.length === 0) {
        return;
      }
      void navigate(`/chat/${sessionId}`);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [navigate]);

  return null;
}
