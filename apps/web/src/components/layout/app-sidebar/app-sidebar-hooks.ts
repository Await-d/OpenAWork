/**
 * AppSidebar 相关的布局与状态 hook（由 AppSidebar 主文件拆出）。
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { createHealthClient } from '@openAwork/web-client';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';

const WIDE_VIEWPORT_QUERY = '(min-width: 1280px)';

export function useWideViewport(): boolean {
  const [isWide, setIsWide] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia(WIDE_VIEWPORT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const update = () => setIsWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isWide;
}

export type GatewayStatus = 'online' | 'offline' | 'warning';

/**
 * 网关探活一次；任何失败都按 offline 处理（与原 try/catch 语义一致）。
 *
 * 必须留在模块级：try 内的 `healthy ? … : …` 是值块，会让编译器报
 * "Support value blocks … within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
async function probeGatewayHealthOnce(
  client: ReturnType<typeof createHealthClient>,
): Promise<'online' | 'offline'> {
  try {
    const healthy = await client.check({ timeoutMs: 4000 });
    return healthy ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

export function useGatewayStatus(gatewayUrl: string): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('online');

  useEffect(() => {
    if (!gatewayUrl) {
      setStatus('offline');
      return;
    }
    let cancelled = false;
    let intervalId: number | null = null;
    const client = createHealthClient(gatewayUrl);

    const probe = async () => {
      // 探活（含 try/catch 与值块）下沉到模块级 `probeGatewayHealthOnce`；取消守卫留在这里。
      const nextStatus = await probeGatewayHealthOnce(client);
      if (cancelled) return;
      setStatus(nextStatus);
    };

    void probe();
    intervalId = window.setInterval(() => void probe(), 30_000);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [gatewayUrl]);

  return status;
}

export const navItemStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  width: '100%',
  minHeight: 34,
  alignItems: 'center',
  gap: 10,
  borderRadius: 9,
  textDecoration: 'none',
  background: 'transparent',
  color: 'var(--fg-muted)',
  fontWeight: 500,
  overflow: 'visible',
};

/**
 * 侧栏导航：集中管理路由跳转与预加载，避免主组件堆叠重复回调。
 */
export function useAppSidebarNavigation() {
  const navigate = useNavigate();
  const triggerTeamNewWorkspace = useUIStateStore((s) => s.triggerTeamNewWorkspace);

  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const preloadChatRoute = useCallback((sessionIdToPreload: string) => {
    void preloadRouteModuleByPath(`/chat/${sessionIdToPreload}`);
  }, []);

  const openChatSession = useCallback(
    (sessionIdToOpen: string) => {
      preloadChatRoute(sessionIdToOpen);
      void navigate(`/chat/${sessionIdToOpen}`);
    },
    [navigate, preloadChatRoute],
  );

  const handleNewTeamWorkspace = useCallback(() => {
    preloadRoute('/team');
    triggerTeamNewWorkspace();
    void navigate('/team?action=newWorkspace');
  }, [navigate, preloadRoute, triggerTeamNewWorkspace]);

  return {
    navigate,
    preloadRoute,
    preloadChatRoute,
    openChatSession,
    handleNewTeamWorkspace,
  };
}
