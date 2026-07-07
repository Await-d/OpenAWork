import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { HomeProjectColumn } from './HomeProjectColumn.js';
import { HomeSessionList } from './HomeSessionList.js';
import { HomeSessionSearch } from './HomeSessionSearch.js';
import './home.css';
import { useSessions } from '../../hooks/workspace/useSessions.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { buildHomeProjects, filterSessionsByProject } from './utils/session-grouping.js';

export default function HomePage() {
  const navigate = useNavigate();
  const { sessions, newSession } = useSessions();
  const selectedWorkspacePath = useUIStateStore((state) => state.selectedWorkspacePath);
  const addDraftTab = useUIStateStore((state) => state.addDraftTab);
  const addSessionTab = useUIStateStore((state) => state.addSessionTab);
  const [selectedProjectKey, setSelectedProjectKey] = useState('all');

  const projects = useMemo(() => buildHomeProjects(sessions), [sessions]);
  const selectedProject = projects.find((project) => project.key === selectedProjectKey);
  const filteredSessions = useMemo(
    () => filterSessionsByProject(sessions, selectedProjectKey),
    [selectedProjectKey, sessions],
  );
  const runningCount = sessions.filter((session) => session.state_status === 'running').length;

  const createSession = (workspacePath?: string | null) => {
    const path = workspacePath ?? selectedWorkspacePath;
    addDraftTab(path ?? undefined);
    void preloadRouteModuleByPath('/chat');
    void newSession(path);
  };

  const openSession = (sessionId: string, title: string | null | undefined) => {
    addSessionTab(sessionId, title ?? `会话 ${sessionId.slice(0, 8)}`);
    void preloadRouteModuleByPath(`/chat/${sessionId}`);
    void navigate(`/chat/${sessionId}`);
  };

  const openRoute = (path: string) => {
    void preloadRouteModuleByPath(path);
    void navigate(path);
  };

  return (
    <main className="home-page" aria-label="首页">
      <div className="home-shell">
        <HomeProjectColumn
          projects={projects}
          selectedProjectKey={selectedProjectKey}
          totalSessionCount={sessions.length}
          onAddProjectSession={() => createSession(selectedProject?.path)}
          onOpenHelp={() => openRoute('/settings/about')}
          onOpenSettings={() => openRoute('/settings')}
          onSelectProject={setSelectedProjectKey}
        />

        <div className="home-main-column">
          <section className="home-overview" aria-label="工作台概览">
            <section className="home-hero">
              <div className="home-hero-copy">
                <span className="home-eyebrow">工作台概览</span>
                <h1>OpenAWork</h1>
                <p>从这里进入最近会话、当前项目和 Agent 工作流，不需要先进入某个聊天线程。</p>
              </div>
              <button type="button" className="home-primary-action" onClick={() => createSession()}>
                新建会话
              </button>
            </section>

            <section className="home-kpi-grid" aria-label="工作台指标">
              <article className="home-kpi-card" data-tone="accent">
                <span>会话总数</span>
                <strong>{sessions.length}</strong>
              </article>
              <article className="home-kpi-card" data-tone="contrast">
                <span>运行中</span>
                <strong>{runningCount}</strong>
              </article>
              <article className="home-kpi-card" data-tone="aux">
                <span>项目</span>
                <strong>{projects.length}</strong>
              </article>
            </section>
          </section>

          <HomeSessionList
            emptyDescription={
              selectedProjectKey === 'all'
                ? '新建会话后，这里会按更新时间展示最近任务。'
                : '这个项目下还没有会话，点击新建会话即可开始。'
            }
            sessions={filteredSessions}
            title={
              selectedProjectKey === 'all' ? '最近会话' : `${selectedProject?.label ?? '项目'} 会话`
            }
            onCreateSession={() =>
              createSession(
                selectedProjectKey === 'all' ? selectedWorkspacePath : selectedProject?.path,
              )
            }
            onOpenSession={openSession}
          >
            <HomeSessionSearch sessions={sessions} onSelectSession={openSession} />
          </HomeSessionList>
        </div>
      </div>
    </main>
  );
}
