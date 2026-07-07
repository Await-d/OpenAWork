/**
 * TitlebarTabStrip — 顶部会话标签页栏。
 *
 * 功能：
 *  - Home 按钮（导航到 /chat 无 sessionId）
 *  - 标签列表（横向滚动，溢出隐藏）
 *  - 新建按钮
 *  - 键盘快捷键：Ctrl+T（新建）、Ctrl+W（关闭当前）、Ctrl+Tab/Ctrl+Shift+Tab（切换）
 *  - 数字键 1-9 快速切换到对应标签
 *  - 拖拽排序（HTML5 drag/drop）
 *
 * 从 uiState store 读取 tabs / activeTabId，通过路由导航切换会话。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { TeamTitlebarSummary } from './TeamTitlebarSummary.js';
import { TitlebarTab } from './TitlebarTab.js';
import { TitlebarToolsMenu } from './TitlebarToolsMenu.js';

const COMPACT_ACTION_LABEL_QUERY = '(max-width: 520px)';
const STACKED_TEAM_TITLEBAR_QUERY = '(max-width: 640px)';

function useCompactActionLabels(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_ACTION_LABEL_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(COMPACT_ACTION_LABEL_QUERY);
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return compact;
}

function useStackedTeamTitlebar(): boolean {
  const [stacked, setStacked] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(STACKED_TEAM_TITLEBAR_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia(STACKED_TEAM_TITLEBAR_QUERY);
    const update = () => setStacked(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return stacked;
}

export interface TitlebarTabStripProps {
  /** 当前主题（'dark' | 'light'），传给 ToolsMenu */
  readonly theme?: 'dark' | 'light';
  /** 主题切换回调，传给 ToolsMenu */
  readonly onToggleTheme?: () => void;
}

export function TitlebarTabStrip({ theme, onToggleTheme }: TitlebarTabStripProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = useUIStateStore((s) => s.tabs);
  const activeTabId = useUIStateStore((s) => s.activeTabId);
  const selectTab = useUIStateStore((s) => s.selectTab);
  const closeTab = useUIStateStore((s) => s.closeTab);
  const reorderTabs = useUIStateStore((s) => s.reorderTabs);
  const addSessionTab = useUIStateStore((s) => s.addSessionTab);
  const addDraftTab = useUIStateStore((s) => s.addDraftTab);
  const navigateToHome = useUIStateStore((s) => s.navigateToHome);

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const compactActionLabels = useCompactActionLabels();
  const stackedTeamTitlebar = useStackedTeamTitlebar();

  // Sync active tab with route
  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const isTeamRoute = location.pathname.startsWith('/team');

  // When route changes to /chat/:sessionId, ensure a tab exists for it
  useEffect(() => {
    if (!currentSessionId) return;
    const existingTab = tabs.find((t) => t.type === 'session' && t.sessionId === currentSessionId);
    if (existingTab && existingTab.id !== activeTabId) {
      selectTab(existingTab.id);
      return;
    }
    if (!existingTab) {
      addSessionTab(currentSessionId, `会话 ${currentSessionId.slice(0, 8)}`);
    }
  }, [currentSessionId, tabs, activeTabId, selectTab, addSessionTab]);

  const handleClickTab = useCallback(
    (tabId: string) => {
      const tab = selectTab(tabId);
      if (tab?.type === 'session' && tab.sessionId) {
        void navigate(`/chat/${tab.sessionId}`);
      } else if (tab?.type === 'draft') {
        void navigate('/chat');
      }
    },
    [navigate, selectTab],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      const nextTab = closeTab(tabId);
      if (nextTab?.type === 'session' && nextTab.sessionId) {
        void navigate(`/chat/${nextTab.sessionId}`);
      } else if (nextTab?.type === 'draft') {
        void navigate('/chat');
      } else {
        navigateToHome();
        void navigate('/chat');
      }
    },
    [closeTab, navigate, navigateToHome],
  );

  const handleNewTab = useCallback(() => {
    addDraftTab();
    navigateToHome();
    void navigate('/chat');
  }, [addDraftTab, navigate, navigateToHome]);

  // Keyboard shortcuts: Ctrl+T (new), Ctrl+W (close), Ctrl+Tab/Ctrl+Shift+Tab (cycle)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.metaKey || e.ctrlKey;

      // Ctrl+T: new tab
      if (ctrl && e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        handleNewTab();
        return;
      }

      // Ctrl+W: close current tab
      if (ctrl && e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        if (activeTabId) {
          handleCloseTab(activeTabId);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: cycle tabs
      if (ctrl && e.key === 'Tab') {
        e.preventDefault();
        if (tabs.length < 2) return;
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        const offset = e.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
        const nextTab = tabs[nextIndex];
        if (nextTab) {
          handleClickTab(nextTab.id);
        }
        return;
      }

      // Number keys 1-9: jump to tab at that index
      if (ctrl && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        const tab = tabs[index];
        if (tab) {
          handleClickTab(tab.id);
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, handleNewTab, handleCloseTab, handleClickTab, tabs]);

  const handleDragStart = useCallback((index: number) => {
    setDragFromIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (index: number) => {
      if (dragFromIndex === null || dragFromIndex === index) return;
      reorderTabs(dragFromIndex, index);
      setDragFromIndex(index);
    },
    [dragFromIndex, reorderTabs],
  );

  const handleDrop = useCallback(() => {
    setDragFromIndex(null);
  }, []);

  const isHomeActive = !currentSessionId && location.pathname.startsWith('/chat');
  const teamTitlebarStacked = isTeamRoute && stackedTeamTitlebar;
  const homeButton = (
    <button
      type="button"
      role="tab"
      aria-selected={isHomeActive}
      title="首页"
      aria-label="首页"
      onClick={() => {
        navigateToHome();
        void navigate('/chat');
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        border: 'none',
        background: isHomeActive
          ? 'color-mix(in oklch, var(--accent) 12%, var(--bg-overlay))'
          : 'transparent',
        color: isHomeActive ? 'var(--accent)' : 'var(--fg-muted)',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => {
        if (!isHomeActive) {
          e.currentTarget.style.background =
            'color-mix(in oklch, var(--fg-default) 6%, var(--bg-overlay))';
        }
      }}
      onMouseLeave={(e) => {
        if (!isHomeActive) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      <svg
        aria-hidden="true"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    </button>
  );
  const newTeamButton = (
    <button
      type="button"
      title="新建团队工作区"
      onClick={() => {
        void navigate('/team?action=newWorkspace');
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: teamTitlebarStacked ? 24 : 26,
        padding: teamTitlebarStacked ? '0 9px' : '0 10px',
        borderRadius: 6,
        border: '1px solid var(--accent-border)',
        background: 'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay))',
        color: 'var(--accent)',
        cursor: 'pointer',
        fontSize: teamTitlebarStacked ? 11 : 12,
        fontWeight: 650,
        lineHeight: 1,
        flexShrink: 0,
        transition: 'background 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          'color-mix(in oklch, var(--accent) 16%, var(--bg-overlay))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background =
          'color-mix(in oklch, var(--accent) 10%, var(--bg-overlay))';
      }}
    >
      {compactActionLabels ? '新建' : '新建团队'}
    </button>
  );

  return (
    <div
      role="group"
      aria-label="工作台顶部栏"
      style={{
        display: 'flex',
        flexDirection: teamTitlebarStacked ? 'column' : 'row',
        alignItems: 'center',
        gap: teamTitlebarStacked ? 4 : 6,
        height: teamTitlebarStacked ? 64 : 36,
        minHeight: teamTitlebarStacked ? 64 : 36,
        padding: teamTitlebarStacked ? '4px 6px 5px' : '0 6px',
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {teamTitlebarStacked ? (
        <>
          <div
            aria-label="全局工作台控制"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 6,
              width: '100%',
              minWidth: 0,
              height: 28,
              flexShrink: 0,
            }}
          >
            {homeButton}
            <TitlebarToolsMenu theme={theme} onToggleTheme={onToggleTheme} />
          </div>
          <div
            aria-label="Team 工作台上下文"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              minWidth: 0,
              height: 24,
              flexShrink: 0,
            }}
          >
            <TeamTitlebarSummary pathname={location.pathname} />
            {newTeamButton}
          </div>
        </>
      ) : (
        <>
          {homeButton}

          {/* Divider */}
          {(!isTeamRoute && tabs.length > 0) || isTeamRoute ? (
            <div
              aria-hidden="true"
              style={{
                width: 1,
                height: 18,
                background: 'var(--border-subtle)',
                flexShrink: 0,
              }}
            />
          ) : null}

          {/* Tab list (scrollable) */}
          {!isTeamRoute ? (
            <div
              role="tablist"
              aria-label="Chat 会话标签"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flex: 1,
                minWidth: 0,
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollbarWidth: 'thin',
                height: '100%',
              }}
            >
              {tabs.map((tab, index) => (
                <TitlebarTab
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  index={index}
                  onClick={() => handleClickTab(tab.id)}
                  onClose={() => handleCloseTab(tab.id)}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                />
              ))}
            </div>
          ) : (
            <TeamTitlebarSummary pathname={location.pathname} />
          )}

          {/* New tab button */}
          {!isTeamRoute ? (
            <button
              type="button"
              title="新建会话 (Ctrl+T)"
              onClick={handleNewTab}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                borderRadius: 5,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--fg-muted)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                flexShrink: 0,
                transition: 'background 120ms ease, color 120ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'color-mix(in oklch, var(--accent) 10%, transparent)';
                e.currentTarget.style.color = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--fg-muted)';
              }}
            >
              +
            </button>
          ) : (
            newTeamButton
          )}
          <TitlebarToolsMenu theme={theme} onToggleTheme={onToggleTheme} />
        </>
      )}
    </div>
  );
}
