import type { HomeProjectSummary } from './utils/session-grouping.js';

interface HomeProjectColumnProps {
  readonly projects: readonly HomeProjectSummary[];
  readonly selectedProjectKey: string;
  readonly totalSessionCount: number;
  readonly onAddProjectSession: () => void;
  readonly onOpenHelp: () => void;
  readonly onOpenSettings: () => void;
  readonly onSelectProject: (projectKey: string) => void;
}

export function HomeProjectColumn({
  projects,
  selectedProjectKey,
  totalSessionCount,
  onAddProjectSession,
  onOpenHelp,
  onOpenSettings,
  onSelectProject,
}: HomeProjectColumnProps) {
  return (
    <aside className="home-project-column" aria-label="项目列表">
      <header className="home-project-column-header">
        <div>
          <span className="home-eyebrow">工作区</span>
          <h2>按项目筛选</h2>
          <p className="home-project-column-description">
            先切上下文，右侧欢迎区和会话列表会同步切换。
          </p>
        </div>
        <button
          type="button"
          className="home-icon-button"
          onClick={onAddProjectSession}
          aria-label="在当前项目中新建会话"
          title="新建会话"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </header>

      <div className="home-project-list" role="listbox" aria-label="筛选项目">
        <button
          type="button"
          role="option"
          className="home-project-row"
          aria-selected={selectedProjectKey === 'all'}
          data-active={selectedProjectKey === 'all' ? 'true' : 'false'}
          onClick={() => onSelectProject('all')}
        >
          <span className="home-project-avatar" aria-hidden="true">
            全
          </span>
          <span className="home-project-copy">
            <strong>全部项目</strong>
            <small>{totalSessionCount} 个会话</small>
          </span>
          <span className="home-project-badge">{totalSessionCount}</span>
        </button>

        {projects.map((project) => (
          <button
            key={project.key}
            type="button"
            role="option"
            className="home-project-row"
            aria-selected={selectedProjectKey === project.key}
            data-active={selectedProjectKey === project.key ? 'true' : 'false'}
            onClick={() => onSelectProject(project.key)}
          >
            <span className="home-project-avatar" aria-hidden="true">
              {project.label.slice(0, 1).toUpperCase()}
            </span>
            <span className="home-project-copy">
              <strong>{project.label}</strong>
              <small>{project.path ?? '未绑定路径'}</small>
            </span>
            <span className="home-project-badge">
              {project.runningCount || project.sessionCount}
            </span>
          </button>
        ))}
      </div>

      <footer className="home-project-footer">
        <button type="button" className="home-project-footer-button" onClick={onOpenSettings}>
          设置
        </button>
        <button type="button" className="home-project-footer-button" onClick={onOpenHelp}>
          帮助
        </button>
      </footer>
    </aside>
  );
}
