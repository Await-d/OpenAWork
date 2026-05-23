/**
 * ChatPage 侧栏布局 hook（域 D 子集 · 最小独立单元）
 *
 * 聚合 sidebar 相关的所有状态、副作用与派生值：
 * - 持久化 sidebar 开关（来自 useUIStateStore）
 * - 视口断点监听（窄屏 ≤960px 时切到 overlay 模式）
 * - 挂载首次自愈：宽屏下若 sidebar 因历史原因被关闭，自动展开一次
 * - 派生 overlay 模式标志与宽度
 *
 * 对外契约见返回类型；调用方仅需消费返回值，不再关心内部 effect 编排。
 *
 * @see docs/architecture/chat-page-split-plan.md 域 D
 */

import { useEffect, useRef, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';

const NARROW_VIEWPORT_QUERY = '(max-width: 960px)';

export interface ChatSidebarLayout {
  /** sidebar 是否展开（来自 zustand 持久化 store） */
  leftSidebarOpen: boolean;
  /** 显式设置 sidebar 开关 */
  setLeftSidebarOpen: (open: boolean) => void;
  /** 切换 sidebar 开关 */
  toggleLeftSidebar: () => void;
  /** 当前视口是否窄屏（≤960px） */
  isNarrowViewport: boolean;
  /** 窄屏下 sidebar 改为 overlay 模式（浮在内容区上） */
  shouldOverlaySidebar: boolean;
  /** sidebar 宽度（窄屏 overlay 下与宽屏行内布局下不同） */
  sidebarWidth: string;
}

export function useChatSidebarLayout(): ChatSidebarLayout {
  const leftSidebarOpen = useUIStateStore((s) => s.leftSidebarOpen);
  const setLeftSidebarOpen = useUIStateStore((s) => s.setLeftSidebarOpen);
  const toggleLeftSidebar = useUIStateStore((s) => s.toggleLeftSidebar);

  // 窄屏(≤960px)下 sidebar 改为 overlay 模式,会浮在主对话区上而不是占位。
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 960 : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const update = () => setIsNarrowViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 自愈:首次进入 chat 路由 + 宽屏时,如果 sidebar 因历史原因被关闭,自动展开一次。
  // 只在 hook 挂载的"首次"跑(empty deps),用户后续手动关闭后不会被强制重开。
  const sidebarSelfHealRef = useRef(false);
  useEffect(() => {
    if (sidebarSelfHealRef.current) return;
    sidebarSelfHealRef.current = true;
    if (!leftSidebarOpen && !isNarrowViewport) {
      setLeftSidebarOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shouldOverlaySidebar = isNarrowViewport;
  const sidebarWidth = shouldOverlaySidebar
    ? 'min(86vw, var(--sidebar-width, 260px))'
    : 'var(--sidebar-width, 260px)';

  return {
    leftSidebarOpen,
    setLeftSidebarOpen,
    toggleLeftSidebar,
    isNarrowViewport,
    shouldOverlaySidebar,
    sidebarWidth,
  };
}
