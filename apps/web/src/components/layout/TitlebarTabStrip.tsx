import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { TitlebarNewSessionButton, TitlebarNewTeamButton } from './TitlebarActionButtons.js';
import { TitlebarHomeButton } from './TitlebarHomeButton.js';
import { TitlebarLayoutModeControl } from './TitlebarLayoutModeControl.js';
import { TeamTitlebarSummary } from './TeamTitlebarSummary.js';
import { TitlebarTab } from './TitlebarTab.js';
import { TitlebarToolsMenu } from './TitlebarToolsMenu.js';
import { useTitlebarKeyboardShortcuts } from './useTitlebarKeyboardShortcuts.js';
import { useTitlebarResponsiveState } from './useTitlebarResponsiveState.js';
import './TitlebarTabStrip.css';

export interface TitlebarTabStripProps {
  readonly theme?: 'dark' | 'light';
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
  const { compactActionLabels, stackedTeamTitlebar } = useTitlebarResponsiveState();

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

  const handleNewTeamWorkspace = useCallback(() => {
    void navigate('/team?action=newWorkspace');
  }, [navigate]);

  const isHomeActive = !currentSessionId && location.pathname.startsWith('/chat');
  const teamTitlebarStacked = isTeamRoute && stackedTeamTitlebar;
  const className = teamTitlebarStacked
    ? 'titlebar-tab-strip titlebar-tab-strip--stacked'
    : 'titlebar-tab-strip';
  const layoutControls = (
    <div className="titlebar-tab-strip__global-actions">
      <TitlebarLayoutModeControl density={teamTitlebarStacked ? 'compact' : 'normal'} />
      <TitlebarToolsMenu theme={theme} onToggleTheme={onToggleTheme} />
    </div>
  );

  return (
    <div role="group" aria-label="工作台顶部栏" className={className}>
      {teamTitlebarStacked ? (
        <>
          <div aria-label="全局工作台控制" className="titlebar-tab-strip__global-row">
            <TitlebarHomeButton active={isHomeActive} onClick={handleGoHome} />
            {layoutControls}
          </div>
          <div aria-label="Team 工作台上下文" className="titlebar-tab-strip__team-row">
            <TeamTitlebarSummary pathname={location.pathname} />
            <TitlebarNewTeamButton
              compact={compactActionLabels}
              stacked={teamTitlebarStacked}
              onClick={handleNewTeamWorkspace}
            />
          </div>
        </>
      ) : (
        <>
          <TitlebarHomeButton active={isHomeActive} onClick={handleGoHome} />

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

          {!isTeamRoute ? (
            <TitlebarNewSessionButton onClick={handleNewTab} />
          ) : (
            <TitlebarNewTeamButton
              compact={compactActionLabels}
              stacked={teamTitlebarStacked}
              onClick={handleNewTeamWorkspace}
            />
          )}
          {layoutControls}
        </>
      )}
    </div>
  );
}
