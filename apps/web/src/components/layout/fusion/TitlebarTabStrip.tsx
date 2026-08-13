import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { useSessions } from '../../../hooks/workspace/useSessions.js';
import { TitlebarHomeButton } from './TitlebarHomeButton.js';
import { TeamTitlebarSummary } from '../shared/TeamTitlebarSummary.js';
import { TitlebarTab } from './TitlebarTab.js';
import { TitlebarToolsMenu } from './TitlebarToolsMenu.js';
import { isTauriRuntime } from '../../../utils/gateway/desktop-gateway.js';
import { useTitlebarKeyboardShortcuts } from './useTitlebarKeyboardShortcuts.js';
import { useTitlebarResponsiveState } from './useTitlebarResponsiveState.js';
import './TitlebarTabStrip.css';

export interface TitlebarTabStripProps {
  readonly theme?: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
}

type TitlebarWindowAction = 'close' | 'minimize' | 'toggleMaximize';

function isMacDesktopTauri(): boolean {
  if (typeof navigator === 'undefined' || !isTauriRuntime()) {
    return false;
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;

  return /mac/i.test(platform);
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
  const updateTabTitle = useUIStateStore((s) => s.updateTabTitle);

  const { sessions } = useSessions();
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const { stackedTeamTitlebar } = useTitlebarResponsiveState();

  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const isTeamRoute = location.pathname.startsWith('/team');

  // 记录"正在被主动关闭"的会话 ID：closeTab 同步移除 tab 后，navigate 的路由变化
  // 要到下一轮渲染才提交，中间会有一次 currentSessionId 仍指向旧会话、但 tabs 里
  // 已经没有它的"夹缝"渲染。若不跳过，下面的同步 effect 会把它误判为新会话重新建 tab。
  const pendingCloseSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    // 一旦路由不再指向"正在关闭"的会话（无论是切到新会话还是回到首页），
    // 待跳过标记就失去意义，必须清掉，否则用户之后重新打开同一会话时会被误跳过。
    const pendingCloseSessionId = pendingCloseSessionIdRef.current;
    if (pendingCloseSessionId !== null && pendingCloseSessionId !== currentSessionId) {
      pendingCloseSessionIdRef.current = null;
    }

    if (!currentSessionId) {
      return;
    }

    if (pendingCloseSessionIdRef.current === currentSessionId) {
      return;
    }

    const session = sessions.find((s) => s.id === currentSessionId);
    const title = session?.title || `会话 ${currentSessionId.slice(0, 8)}`;

    const existingTab = tabs.find(
      (tab) => tab.type === 'session' && tab.sessionId === currentSessionId,
    );
    if (existingTab) {
      // 更新已存在 tab 的标题
      if (existingTab.title !== title) {
        updateTabTitle(existingTab.id, title);
      }
      if (existingTab.id !== activeTabId) {
        selectTab(existingTab.id);
      }
      return;
    }
    // 创建新 tab
    addSessionTab(currentSessionId, title);
  }, [activeTabId, addSessionTab, currentSessionId, selectTab, sessions, tabs, updateTabTitle]);

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
      const closingTab = tabs.find((tab) => tab.id === tabId);
      if (closingTab?.type === 'session' && closingTab.sessionId === currentSessionId) {
        pendingCloseSessionIdRef.current = closingTab.sessionId;
      }

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
    [closeTab, currentSessionId, navigate, navigateToHome, tabs],
  );

  const handleNewTab = useCallback(() => {
    addDraftTab();
    navigateToHome();
    void navigate('/chat');
  }, [addDraftTab, navigate, navigateToHome]);

  useTitlebarKeyboardShortcuts({
    activeTabId,
    tabs,
    onClickTab: handleClickTab,
    onCloseTab: handleCloseTab,
    onNewTab: handleNewTab,
  });

  const handleDragStart = useCallback((index: number) => {
    setDragFromIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (index: number) => {
      if (dragFromIndex === null || dragFromIndex === index) {
        return;
      }
      reorderTabs(dragFromIndex, index);
      setDragFromIndex(index);
    },
    [dragFromIndex, reorderTabs],
  );

  const handleDrop = useCallback(() => {
    setDragFromIndex(null);
  }, []);

  const handleGoHome = useCallback(() => {
    navigateToHome();
    void navigate('/chat');
  }, [navigate, navigateToHome]);

  const handleWindowAction = useCallback((action: TitlebarWindowAction) => {
    if (!isMacDesktopTauri()) {
      return;
    }

    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const currentWindow = getCurrentWindow();

        switch (action) {
          case 'close':
            await currentWindow.close();
            break;
          case 'minimize':
            await currentWindow.minimize();
            break;
          case 'toggleMaximize':
            await currentWindow.toggleMaximize();
            break;
        }
      })
      .catch(() => undefined);
  }, []);

  const isHomeActive = !currentSessionId && location.pathname.startsWith('/chat');
  const teamTitlebarStacked = isTeamRoute && stackedTeamTitlebar;
  const showTrafficLights = isMacDesktopTauri();
  const className = teamTitlebarStacked
    ? 'titlebar-tab-strip titlebar-tab-strip--stacked'
    : 'titlebar-tab-strip';
  const leadingControls = (
    <div className="titlebar-tab-strip__leading-controls">
      {showTrafficLights ? (
        <div className="titlebar-tab-strip__traffic-lights" aria-label="窗口控制">
          <button
            type="button"
            title="关闭窗口"
            aria-label="关闭窗口"
            className="titlebar-tab-strip__traffic-light"
            data-tone="close"
            onClick={() => handleWindowAction('close')}
          />
          <button
            type="button"
            title="最小化窗口"
            aria-label="最小化窗口"
            className="titlebar-tab-strip__traffic-light"
            data-tone="minimize"
            onClick={() => handleWindowAction('minimize')}
          />
          <button
            type="button"
            title="切换窗口最大化"
            aria-label="切换窗口最大化"
            className="titlebar-tab-strip__traffic-light"
            data-tone="maximize"
            onClick={() => handleWindowAction('toggleMaximize')}
          />
        </div>
      ) : null}
      <div className="titlebar-tab-strip__home-slot">
        <TitlebarHomeButton active={isHomeActive} onClick={handleGoHome} />
      </div>
    </div>
  );
  const layoutControls = (
    <div className="titlebar-tab-strip__global-actions">
      <TitlebarToolsMenu theme={theme} onToggleTheme={onToggleTheme} />
    </div>
  );

  return (
    <div role="group" aria-label="工作台顶部栏" className={className}>
      {teamTitlebarStacked ? (
        <>
          <div aria-label="全局工作台控制" className="titlebar-tab-strip__global-row">
            {leadingControls}
            {layoutControls}
          </div>
          <div aria-label="Team 工作台上下文" className="titlebar-tab-strip__team-row">
            <TeamTitlebarSummary pathname={location.pathname} />
          </div>
        </>
      ) : (
        <>
          {leadingControls}

          {(!isTeamRoute && tabs.length > 0) || isTeamRoute ? (
            <div aria-hidden="true" className="titlebar-tab-strip__divider" />
          ) : null}

          {!isTeamRoute ? (
            <div role="tablist" aria-label="Chat 会话标签" className="titlebar-tab-strip__tab-list">
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
          {layoutControls}
        </>
      )}
    </div>
  );
}
