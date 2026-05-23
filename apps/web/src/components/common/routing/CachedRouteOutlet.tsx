import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentProps } from 'react';
import { UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation, useOutlet } from 'react-router';
import { usePrefersReducedMotion } from '../../../hooks/ui/usePrefersReducedMotion.js';
import PageTransitionLoader from '../feedback/PageTransitionLoader.js';

const PageActivationContext = createContext<boolean>(true);
const ROUTE_TRANSITION_DURATION_MS = 360;
const ROUTE_LABELS: Record<string, string> = {
  agents: 'Agent 管理',
  artifacts: '产物中心',
  channels: '消息频道',
  chat: '会话工作台',
  schedules: '计划任务',
  sessions: '会话列表',
  settings: '设置中心',
  skills: '技能库',
  usage: '用量统计',
};

interface CachedRouteOutletProps {
  maxCacheEntries?: number;
}

interface CachedRouteEntry {
  cacheKey: string;
  element: React.ReactNode;
  locationContextValue: ComponentProps<typeof UNSAFE_LocationContext.Provider>['value'];
  pathname: string;
  routeContextValue: ComponentProps<typeof UNSAFE_RouteContext.Provider>['value'];
}

type LocationContextValue = ComponentProps<typeof UNSAFE_LocationContext.Provider>['value'];
type RouteContextValue = ComponentProps<typeof UNSAFE_RouteContext.Provider>['value'];

interface RouteTransitionState {
  enteringCacheKey: string;
  leavingCacheKey: string;
  targetLabel: string;
}

function getRouteCacheKey(pathname: string): string {
  const [firstSegment = 'root'] = pathname.split('/').filter(Boolean);
  return firstSegment;
}

function getRouteDisplayLabel(pathname: string): string {
  const cacheKey = getRouteCacheKey(pathname);
  return ROUTE_LABELS[cacheKey] ?? '页面切换中';
}

export function usePageActivation(): boolean {
  return useContext(PageActivationContext);
}

export function CachedRouteOutlet({ maxCacheEntries }: CachedRouteOutletProps) {
  const location = useLocation();
  const outlet = useOutlet();
  const locationContextValue = useContext(UNSAFE_LocationContext) as LocationContextValue;
  const routeContextValue = useContext(UNSAFE_RouteContext) as RouteContextValue;
  const activeCacheKey = useMemo(() => getRouteCacheKey(location.pathname), [location.pathname]);
  const [cacheEntries, setCacheEntries] = useState<CachedRouteEntry[]>([]);
  const resolvedMaxCacheEntries = Number.isFinite(maxCacheEntries)
    ? Math.max(1, Math.floor(maxCacheEntries ?? 1))
    : null;
  const prefersReducedMotion = usePrefersReducedMotion();
  const previousActiveCacheKeyRef = useRef<string | null>(null);
  const transitionTimeoutRef = useRef<number | null>(null);
  const [transitionState, setTransitionState] = useState<RouteTransitionState | null>(null);

  useLayoutEffect(() => {
    if (!outlet) {
      return;
    }

    startTransition(() => {
      setCacheEntries((previousEntries) => {
        const previousEntry = previousEntries.find((entry) => entry.cacheKey === activeCacheKey);
        const nextEntry: CachedRouteEntry = {
          cacheKey: activeCacheKey,
          element:
            previousEntry && previousEntry.pathname === location.pathname
              ? previousEntry.element
              : outlet,
          locationContextValue:
            previousEntry && previousEntry.pathname === location.pathname
              ? previousEntry.locationContextValue
              : locationContextValue,
          pathname: location.pathname,
          routeContextValue:
            previousEntry && previousEntry.pathname === location.pathname
              ? previousEntry.routeContextValue
              : routeContextValue,
        };

        const nextEntries = [
          ...previousEntries.filter((entry) => entry.cacheKey !== activeCacheKey),
          nextEntry,
        ];

        return resolvedMaxCacheEntries === null
          ? nextEntries
          : nextEntries.slice(-resolvedMaxCacheEntries);
      });
    });
  }, [
    activeCacheKey,
    location.pathname,
    locationContextValue,
    outlet,
    resolvedMaxCacheEntries,
    routeContextValue,
  ]);

  const entriesToRender = useMemo(() => {
    const cachedActiveEntry = cacheEntries.find((entry) => entry.cacheKey === activeCacheKey);

    if (cachedActiveEntry) {
      if (cachedActiveEntry.pathname === location.pathname || !outlet) {
        return cacheEntries;
      }

      return cacheEntries.map((entry) =>
        entry.cacheKey === activeCacheKey
          ? {
              ...entry,
              element: outlet,
              locationContextValue,
              pathname: location.pathname,
              routeContextValue,
            }
          : entry,
      );
    }

    if (!outlet) {
      return cacheEntries;
    }

    const nextEntries = [
      ...cacheEntries,
      {
        cacheKey: activeCacheKey,
        element: outlet,
        locationContextValue,
        pathname: location.pathname,
        routeContextValue,
      },
    ];

    return resolvedMaxCacheEntries === null
      ? nextEntries
      : nextEntries.slice(-resolvedMaxCacheEntries);
  }, [
    activeCacheKey,
    cacheEntries,
    location.pathname,
    locationContextValue,
    outlet,
    resolvedMaxCacheEntries,
    routeContextValue,
  ]);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current !== null) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (transitionTimeoutRef.current !== null) {
      window.clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    const previousActiveCacheKey = previousActiveCacheKeyRef.current;
    previousActiveCacheKeyRef.current = activeCacheKey;

    if (
      !previousActiveCacheKey ||
      previousActiveCacheKey === activeCacheKey ||
      prefersReducedMotion
    ) {
      setTransitionState(null);
      return;
    }

    setTransitionState({
      enteringCacheKey: activeCacheKey,
      leavingCacheKey: previousActiveCacheKey,
      targetLabel: getRouteDisplayLabel(location.pathname),
    });

    transitionTimeoutRef.current = window.setTimeout(() => {
      setTransitionState((currentState) => {
        return currentState?.enteringCacheKey === activeCacheKey ? null : currentState;
      });
      transitionTimeoutRef.current = null;
    }, ROUTE_TRANSITION_DURATION_MS);
  }, [activeCacheKey, location.pathname, prefersReducedMotion]);

  const isTransitioning = transitionState !== null;

  if (!outlet && entriesToRender.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        overflow: 'hidden',
        // 把整个路由出口隔离成一个 layout / style / paint containment 边界。
        // 切换页面时频繁触发的 display / animation 变化只在这个子树内部
        // 重算,不会向上冒泡导致 NavRail / Layout 的 flex 重计 — 这是
        // 切换时 [Violation] Forced reflow 40ms 的主要来源之一。
        contain: 'layout style paint',
      }}
    >
      {entriesToRender.map((entry) => {
        const isActive = entry.cacheKey === activeCacheKey;
        const isEntering = transitionState?.enteringCacheKey === entry.cacheKey;
        const isLeaving = transitionState?.leavingCacheKey === entry.cacheKey;
        const shouldDisplay = isActive || isLeaving;

        return (
          <PageActivationContext key={entry.cacheKey} value={isActive}>
            <div
              data-route-cache-key={entry.cacheKey}
              data-route-transition-state={isEntering ? 'entering' : isLeaving ? 'leaving' : 'idle'}
              aria-hidden={!isActive}
              style={{
                display: shouldDisplay ? 'flex' : 'none',
                minWidth: 0,
                minHeight: 0,
                width: '100%',
                overflow: 'hidden',
                // 始终 absolute + inset:0,而不是在 transition 期间从 relative
                // 切到 absolute。position 切换是 reflow trigger,过去每次切页都
                // 要先把所有 entry 重新算一次定位,40ms 的 forced reflow 大头在
                // 这里。父容器是 flex + position:relative,absolute 子级会铺满。
                position: 'absolute',
                inset: 0,
                zIndex: isEntering ? 2 : isLeaving ? 1 : 0,
                pointerEvents: isActive ? undefined : 'none',
                transformOrigin: '50% 18%',
                // 仅在切换的那一帧标 willChange — 一直挂会无谓占用合成层内存。
                willChange: isTransitioning ? 'opacity, transform' : undefined,
                animation: isEntering
                  ? `route-page-enter ${ROUTE_TRANSITION_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`
                  : isLeaving
                    ? `route-page-exit ${ROUTE_TRANSITION_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`
                    : undefined,
                // 单层 layout containment 限制 entry 内部子树 reflow 不外传 —
                // 切到 ChatPage 这种重组件时,messages 数组的初次布局就只在
                // entry 里完成,不会触发整树重算。
                contain: 'layout style',
              }}
            >
              <UNSAFE_LocationContext.Provider value={entry.locationContextValue}>
                <UNSAFE_RouteContext.Provider value={entry.routeContextValue}>
                  {entry.element}
                </UNSAFE_RouteContext.Provider>
              </UNSAFE_LocationContext.Provider>
            </div>
          </PageActivationContext>
        );
      })}

      {transitionState && (
        <PageTransitionLoader
          variant="overlay"
          caption="页面切换中"
          title={transitionState.targetLabel}
          description="已保留当前工作区状态，界面正在完成平滑切换。"
          prefersReducedMotion={prefersReducedMotion}
        />
      )}
    </div>
  );
}
