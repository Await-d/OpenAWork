import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { IslandPill } from './island-pill.js';
import { hasIslandBridge, islandInvoke, islandListen } from './island-bridge.js';
import { useIslandStore } from './island-store.js';
import {
  ISLAND_DEFAULT_ANCHOR_RATIO,
  clampAnchorRatio,
  normalizeAgentState,
  normalizeGatewayHealth,
  presentIslandStatus,
  ratioFromDrag,
  shouldSnapToCenter,
} from './island-types.js';

/** Rust `island_get_state` 返回值。 */
interface IslandStateResponse {
  enabled?: boolean;
  visible?: boolean;
  expanded?: boolean;
}

/** Rust `island_get_anchor` 返回值。 */
interface IslandAnchorInfo {
  ratio?: unknown;
  travelPx?: unknown;
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
/** 超过该位移才判定为拖动(避免点击被误判)。 */
const DRAG_THRESHOLD_PX = 4;
/** 单击后等待这么久没有再双击,才真正执行「打开会话」。 */
const DOUBLE_CLICK_GUARD_MS = 220;
/** 拖动结束后吞掉紧随其后 click 的时间窗(毫秒)。 */
const DRAG_CLICK_SUPPRESS_MS = 300;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * 灵动岛窗口根组件。
 *
 * 职责:
 * - 订阅 Rust 转发的事件(`island:agent-state` / `gateway:health`),上报宿主就绪;
 * - 驱动展开 / 折叠(窗口尺寸补间在 Rust 侧,这里只切 `is-expanded` 类);
 * - 沿顶部拖动改锚点(`island_set_anchor`)、双击复位居中、打开会话。
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

  const [dragging, setDragging] = useState(false);

  const collapseTimer = useRef<number | null>(null);
  const pendingOpenTimer = useRef<number | null>(null);
  const anchorInfo = useRef<{ ratio: number; travelPx: number }>({
    ratio: ISLAND_DEFAULT_ANCHOR_RATIO,
    travelPx: 0,
  });
  const pointerId = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragStartX = useRef(0);
  const dragStartRatio = useRef(ISLAND_DEFAULT_ANCHOR_RATIO);
  /** 拖动结束后短暂吞掉紧随其后的 click;用时间戳而非布尔,异常路径下不会卡住。 */
  const suppressClickUntil = useRef(0);
  const pendingAnchorRatio = useRef<number | null>(null);
  const anchorFrame = useRef<number | null>(null);

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
        const info = await islandInvoke<IslandAnchorInfo>('island_get_anchor');
        if (!disposed) {
          anchorInfo.current = {
            ratio: clampAnchorRatio(info.ratio),
            travelPx: readFiniteNumber(info.travelPx, 0),
          };
        }
      } catch (error: unknown) {
        console.warn('[island] 回读锚点失败', error);
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
      if (pendingOpenTimer.current !== null) {
        window.clearTimeout(pendingOpenTimer.current);
      }
      if (anchorFrame.current !== null) {
        window.cancelAnimationFrame(anchorFrame.current);
      }
    };
  }, []);

  const clearCollapseTimer = useCallback((): void => {
    if (collapseTimer.current !== null) {
      window.clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const clearPendingOpen = useCallback((): void => {
    if (pendingOpenTimer.current !== null) {
      window.clearTimeout(pendingOpenTimer.current);
      pendingOpenTimer.current = null;
    }
  }, []);

  const setWindowExpanded = useCallback(
    (next: boolean): void => {
      if (useIslandStore.getState().expanded === next) {
        return;
      }
      setExpanded(next);
      void islandInvoke('island_set_expanded', { expanded: next }).catch((error: unknown) => {
        console.warn('[island] 切换展开态失败', error);
      });
    },
    [setExpanded],
  );

  const handleExpand = useCallback((): void => {
    clearCollapseTimer();
    setWindowExpanded(true);
  }, [clearCollapseTimer, setWindowExpanded]);

  const handleScheduleCollapse = useCallback((): void => {
    clearCollapseTimer();
    collapseTimer.current = window.setTimeout(() => {
      collapseTimer.current = null;
      setWindowExpanded(false);
    }, COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, setWindowExpanded]);

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

  /**
   * 头部单击:延迟执行,给双击让路。
   *
   * 双击要复位居中,不能顺带触发一次「打开会话」(那会唤回主窗口),
   * 因此单击先挂 220ms 定时器,双击到达时取消。
   */
  const handleHeaderActivate = useCallback((): void => {
    if (Date.now() < suppressClickUntil.current) {
      return;
    }
    clearPendingOpen();
    pendingOpenTimer.current = window.setTimeout(() => {
      pendingOpenTimer.current = null;
      handleOpenSession();
    }, DOUBLE_CLICK_GUARD_MS);
  }, [clearPendingOpen, handleOpenSession]);

  const handleRecenter = useCallback((): void => {
    clearPendingOpen();
    clearCollapseTimer();
    anchorInfo.current = { ...anchorInfo.current, ratio: ISLAND_DEFAULT_ANCHOR_RATIO };
    setWindowExpanded(false);
    void islandInvoke('island_set_anchor', {
      ratio: ISLAND_DEFAULT_ANCHOR_RATIO,
      persist: true,
    }).catch((error: unknown) => {
      console.warn('[island] 复位锚点失败', error);
    });
  }, [clearCollapseTimer, clearPendingOpen, setWindowExpanded]);

  const queueAnchorRatio = useCallback((ratio: number): void => {
    pendingAnchorRatio.current = ratio;
    if (anchorFrame.current !== null) {
      return;
    }
    anchorFrame.current = window.requestAnimationFrame(() => {
      anchorFrame.current = null;
      const latest = pendingAnchorRatio.current;
      pendingAnchorRatio.current = null;
      if (latest === null) {
        return;
      }
      void islandInvoke('island_set_anchor', { ratio: latest, persist: false }).catch(
        (error: unknown) => {
          console.warn('[island] 拖动锚点失败', error);
        },
      );
    });
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest('.island-btn') !== null) {
        return;
      }
      clearPendingOpen();
      pointerId.current = event.pointerId;
      draggingRef.current = false;
      // 必须用屏幕坐标:拖动时窗口会跟着指针一起移动,若用 clientX(相对窗口)
      // 就会形成「窗口动了 → 相对坐标变了 → 又移动窗口」的反馈回路,表现为抖动。
      dragStartX.current = event.screenX;
      dragStartRatio.current = anchorInfo.current.ratio;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [clearPendingOpen],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (pointerId.current === null || event.pointerId !== pointerId.current) {
        return;
      }
      const deltaX = event.screenX - dragStartX.current;

      if (!draggingRef.current) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
          return;
        }
        draggingRef.current = true;
        setDragging(true);
        clearCollapseTimer();
        /* 拖动即收起:细条更好拖,也让落点看得清 */
        setWindowExpanded(false);
      }

      queueAnchorRatio(ratioFromDrag(dragStartRatio.current, deltaX, anchorInfo.current.travelPx));
    },
    [clearCollapseTimer, queueAnchorRatio, setWindowExpanded],
  );

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerId.current === null || event.pointerId !== pointerId.current) {
      return;
    }
    pointerId.current = null;

    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    setDragging(false);
    suppressClickUntil.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;

    const travelPx = anchorInfo.current.travelPx;
    const landed = ratioFromDrag(
      dragStartRatio.current,
      event.screenX - dragStartX.current,
      travelPx,
    );
    const ratio = shouldSnapToCenter(landed, travelPx) ? ISLAND_DEFAULT_ANCHOR_RATIO : landed;
    anchorInfo.current = { ratio, travelPx };

    void islandInvoke('island_set_anchor', { ratio, persist: true }).catch((error: unknown) => {
      console.warn('[island] 落位失败', error);
    });
  }, []);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerId.current !== null && event.pointerId === pointerId.current) {
      pointerId.current = null;
      draggingRef.current = false;
      setDragging(false);
    }
  }, []);

  const { label, tone } = presentIslandStatus(agentState, gatewayHealth);

  return (
    <IslandPill
      label={label}
      tone={tone}
      expanded={expanded}
      dragging={dragging}
      sessionTitle={sessionTitle}
      preview={lastMessagePreview}
      hasSession={Boolean(activeSessionId)}
      onOpenSession={handleHeaderActivate}
      onHide={handleHide}
      onRecenter={handleRecenter}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onMouseEnter={handleExpand}
      onMouseLeave={handleScheduleCollapse}
    />
  );
}
