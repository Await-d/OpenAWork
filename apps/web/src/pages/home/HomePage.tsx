import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { HomeDashboardPanel } from './HomeDashboardPanel.js';
import { HomeProjectColumn } from './HomeProjectColumn.js';
import { HomeSessionList } from './HomeSessionList.js';
import { HomeSessionSearch } from './HomeSessionSearch.js';
import {
  HomeSessionStatusFilterBar,
  type HomeSessionStatusCounts,
  type HomeSessionStatusFilter,
} from './HomeSessionStatusFilterBar.js';
import './home.css';
import { useSessions } from '../../hooks/workspace/useSessions.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { buildHomeProjects, filterSessionsByProject } from './utils/session-grouping.js';
import type { HomeSessionLike } from './utils/session-grouping.js';

export default function HomePage() {
  const navigate = useNavigate();
  const { sessions, newSession } = useSessions();
  const selectedWorkspacePath = useUIStateStore((state) => state.selectedWorkspacePath);
  const addDraftTab = useUIStateStore((state) => state.addDraftTab);
  const addSessionTab = useUIStateStore((state) => state.addSessionTab);
  const [selectedProjectKey, setSelectedProjectKey] = useState('all');
  const [statusFilter, setStatusFilter] = useState<HomeSessionStatusFilter>('all');

  const projects = useMemo(() => buildHomeProjects(sessions), [sessions]);
  const selectedProject = projects.find((project) => project.key === selectedProjectKey);
  const projectSessions = useMemo(
    () => filterSessionsByProject(sessions, selectedProjectKey),
    [selectedProjectKey, sessions],
  );
  const visibleSessions = useMemo(
    () => filterSessionsByStatus(projectSessions, statusFilter),
    [projectSessions, statusFilter],
  );
  const statusCounts = useMemo(() => countSessionsByStatus(projectSessions), [projectSessions]);
  const attentionSessions = useMemo(
    () =>
      projectSessions
        .filter(
          (session) => session.state_status === 'running' || session.state_status === 'paused',
        )
        .slice(0, 4),
    [projectSessions],
  );
  const runningCount = statusCounts.running;
  const pausedCount = statusCounts.paused;
  const activeProjectCount = projects.filter((project) => project.runningCount > 0).length;
  const selectedProjectLabel = selectedProjectKey === 'all' ? '全部项目' : selectedProject?.label;
  const selectedContextPath =
    selectedProjectKey === 'all' ? selectedWorkspacePath : selectedProject?.path;

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
          <HomeDashboardPanel
            activeProjectCount={activeProjectCount}
            attentionSessions={attentionSessions}
            pausedCount={pausedCount}
            projectCount={projects.length}
            runningCount={runningCount}
            selectedContextPath={selectedContextPath}
            selectedProjectLabel={selectedProjectLabel}
            totalSessionCount={projectSessions.length}
            onCreateSession={() =>
              createSession(
                selectedProjectKey === 'all' ? selectedWorkspacePath : selectedProject?.path,
              )
            }
            onOpenRoute={openRoute}
            onOpenSession={openSession}
          />

          <HomeSessionList
            emptyDescription={
              statusFilter !== 'all'
                ? '当前筛选条件下没有会话，可以切回全部或新建会话。'
                : selectedProjectKey === 'all'
                  ? '新建会话后，这里会按更新时间展示最近任务。'
                  : '这个项目下还没有会话，点击新建会话即可开始。'
            }
            sessions={visibleSessions}
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
            <HomeSessionSearch sessions={projectSessions} onSelectSession={openSession} />
            <HomeSessionStatusFilterBar
              counts={statusCounts}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          </HomeSessionList>
        </div>
      </div>
    </main>
  );
}

function filterSessionsByStatus<TSession extends HomeSessionLike>(
  sessions: readonly TSession[],
  statusFilter: HomeSessionStatusFilter,
): TSession[] {
  if (statusFilter === 'all') {
    return [...sessions];
  }

  return sessions.filter((session) => (session.state_status ?? 'idle') === statusFilter);
}

function countSessionsByStatus(sessions: readonly HomeSessionLike[]): HomeSessionStatusCounts {
  return sessions.reduce<HomeSessionStatusCounts>(
    (counts, session) => {
      const status = session.state_status ?? 'idle';
      return {
        ...counts,
        all: counts.all + 1,
        [status]: counts[status] + 1,
      };
    },
    { all: 0, idle: 0, paused: 0, running: 0 },
  );
}
