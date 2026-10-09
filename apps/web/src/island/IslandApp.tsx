import { useCallback, useEffect, useRef } from 'react';
import { IslandPill } from './island-pill.js';
import { hasIslandBridge, islandInvoke, islandListen } from './island-bridge.js';
import { useIslandStore } from './island-store.js';
import {
  normalizeAgentState,
  normalizeGatewayHealth,
  presentIslandStatus,
} from './island-types.js';

/** Rust `island_get_state` 返回值。 */
interface IslandStateResponse {
  enabled?: boolean;
  visible?: boolean;
  expanded?: boolean;
}

/** Rust `island:agent-state` 事件 payload。 */
interface AgentStateEventPayload {
  state?: unknown;
  sessionId?: unknown;
  title?: unknown;
  preview?: unknown;
}

/** 折叠延迟:给用户从药丸移动到卡片上的缓冲时间。 */
const COLLAPSE_DELAY_MS = 450;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 灵动岛窗口根组件。
 *
 * 职责:订阅 Rust 转发的事件(`island:agent-state` / `gateway:health`)、上报
 * 宿主就绪、驱动展开 / 折叠与「打开会话」动作。
 */
export function IslandApp() {
  const agentState = useIslandStore((state) => state.agentState);
  const gatewayHealth = useIslandStore((state) => state.gatewayHealth);
  const activeSessionId = useIslandStore((state) => state.activeSessionId);
  const sessionTitle = useIslandStore((state) => state.sessionTitle);
  const lastMessagePreview = useIslandStore((state) => state.lastMessagePreview);
  const expanded = useIslandStore((state) => state.expanded);
  const setExpanded = useIslandStore((state) => state.setExpanded);
  const applyAgentState = useIslandStore((state) => state.applyAgentState);
  const applyGatewayHealth = useIslandStore((state) => state.applyGatewayHealth);
  const collapseTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!hasIslandBridge()) {
      return;
    }

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const register = (unlisten: () => void): void => {
      if (disposed) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    };

    const bootstrap = async (): Promise<void> => {
      try {
        const snapshot = await islandInvoke<IslandStateResponse>('island_get_state');
        if (!disposed && snapshot.expanded === true) {
          setExpanded(true);
        }
      } catch (error: unknown) {
        console.warn('[island] 回读状态失败', error);
      }
      try {
        await islandInvoke('mark_island_host_ready');
      } catch (error: unknown) {
        console.warn('[island] 上报就绪失败', error);
      }
    };

    void bootstrap();

    void islandListen<AgentStateEventPayload>('island:agent-state', (payload) => {
      applyAgentState({
        state: normalizeAgentState(payload.state),
        sessionId: readNonEmptyString(payload.sessionId),
        title: readNonEmptyString(payload.title),
        preview: readNonEmptyString(payload.preview) ?? '',
      });
    }).then(register);

    void islandListen<unknown>('gateway:health', (payload) => {
      applyGatewayHealth(normalizeGatewayHealth(payload));
    }).then(register);

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [applyAgentState, applyGatewayHealth, setExpanded]);

  useEffect(() => {
    return () => {
      if (collapseTimer.current !== null) {
        window.clearTimeout(collapseTimer.current);
      }
    };
  }, []);

  const clearCollapseTimer = useCallback((): void => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const handleExpand = useCallback((): void => {
    clearCollapseTimer();
    if (!useIslandStore.getState().expanded) {
      setExpanded(true);
      void islandInvoke('island_set_expanded', { expanded: true }).catch((error: unknown) => {
        console.warn('[island] 展开失败', error);
      });
    }
  }, [clearCollapseTimer, setExpanded]);

  const handleScheduleCollapse = useCallback((): void => {
    clearCollapseTimer();
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      setExpanded(false);
      void islandInvoke('island_set_expanded', { expanded: false }).catch((error: unknown) => {
        console.warn('[island] 折叠失败', error);
      });
    }, COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, setExpanded]);

  const handleOpenSession = useCallback((): void => {
    const sessionId = useIslandStore.getState().activeSessionId;
    if (!sessionId) {
      return;
    }
    void islandInvoke('island_navigate', { sessionId }).catch((error: unknown) => {
      console.warn('[island] 打开会话失败', error);
    });
  }, []);

  const handleHide = useCallback((): void => {
    void islandInvoke('island_toggle_visible').catch((error: unknown) => {
      console.warn('[island] 隐藏失败', error);
    });
  }, []);

  const { label, tone } = presentIslandStatus(agentState, gatewayHealth);

  return (
    <IslandPill
      label={label}
      tone={tone}
      expanded={expanded}
      sessionTitle={sessionTitle}
      preview={lastMessagePreview}
      hasSession={Boolean(activeSessionId)}
      onMouseEnter={handleExpand}
      onMouseLeave={handleScheduleCollapse}
      onOpenSession={handleOpenSession}
      onHide={handleHide}
    />
  );
}
