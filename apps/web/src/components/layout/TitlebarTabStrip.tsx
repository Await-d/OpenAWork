import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { TitlebarHomeButton } from './TitlebarHomeButton.js';
import { TeamTitlebarSummary } from './TeamTitlebarSummary.js';
import { TitlebarTab } from './TitlebarTab.js';
import { TitlebarToolsMenu } from './TitlebarToolsMenu.js';
import { isTauriRuntime } from '../../utils/gateway/desktop-gateway.js';
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

  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const { stackedTeamTitlebar } = useTitlebarResponsiveState();

  const currentSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;
  const isTeamRoute = location.pathname.startsWith('/team');

  useEffect(() => {
    if (!currentSessionId) {
      return;
    }

    const existingTab = tabs.find(
      (tab) => tab.type === 'session' && tab.sessionId === currentSessionId,
    );
    if (existingTab && existingTab.id !== activeTabId) {
      selectTab(existingTab.id);
      return;
    }
    if (!existingTab) {
      addSessionTab(currentSessionId, `会话 ${currentSessionId.slice(0, 8)}`);
    }
  }, [activeTabId, addSessionTab, currentSessionId, selectTab, tabs]);

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
      <TitlebarHomeButton active={isHomeActive} onClick={handleGoHome} />
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
