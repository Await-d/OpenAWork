import { HomeCommandIcon, type HomeCommandIconName } from './HomeCommandIcon.js';
import {
  formatRelativeTime,
  getSessionTitle,
  getWorkspaceName,
  getWorkingDirectory,
} from './utils/session-grouping.js';
import type { HomeSessionLike } from './utils/session-grouping.js';

interface HomeDashboardPanelProps<TSession extends HomeSessionLike> {
  readonly activeProjectCount: number;
  readonly attentionSessions: readonly TSession[];
  readonly pausedCount: number;
  readonly projectCount: number;
  readonly runningCount: number;
  readonly selectedContextPath: string | null | undefined;
  readonly selectedProjectLabel: string | null | undefined;
  readonly totalSessionCount: number;
  readonly onCreateSession: () => void;
  readonly onOpenRoute: (path: string) => void;
  readonly onOpenSession: (sessionId: string, title: string | null | undefined) => void;
}

const MAX_ATTENTION_SESSIONS = 4;

export function HomeDashboardPanel<TSession extends HomeSessionLike>({
  activeProjectCount,
  attentionSessions,
  pausedCount,
  projectCount,
  runningCount,
  selectedContextPath,
  selectedProjectLabel,
  totalSessionCount,
  onCreateSession,
  onOpenRoute,
  onOpenSession,
}: HomeDashboardPanelProps<TSession>) {
  const contextLabel = selectedProjectLabel ?? '未绑定工作区';
  const highlightedSessions = attentionSessions.slice(0, MAX_ATTENTION_SESSIONS);
  const quickResumeSession = highlightedSessions[0];
  const hiddenAttentionCount = attentionSessions.length - highlightedSessions.length;
  const quickResumeLabel = quickResumeSession ? '继续最近任务' : '打开工作流';
  const handleQuickResume = quickResumeSession
    ? () => onOpenSession(quickResumeSession.id, quickResumeSession.title)
    : () => onOpenRoute('/workflows');
  const contextPathHint = selectedContextPath ?? '未选择工作区，创建会话时会使用全局上下文。';
  const runningHint =
    activeProjectCount > 0 ? `${activeProjectCount} 个项目正在推进` : '暂时没有项目在运行';
  const agendaNote =
    highlightedSessions.length === 0
      ? '空闲'
      : hiddenAttentionCount > 0
        ? `优先 ${highlightedSessions.length}/${attentionSessions.length}`
        : '优先处理';
  const sessionContextDescription = selectedContextPath
    ? `沿用 ${getWorkspaceName(selectedContextPath)} 上下文`
    : '会沿用当前工作区上下文';

  return (
    <section className="home-dashboard" aria-label="工作台控制台">
      <section className="home-hero">
        <div className="home-hero-top">
          <div className="home-hero-copy">
            <span className="home-eyebrow">工作台</span>
            <h1>接着手上的活往下推进</h1>
            <p>左边换工作区，右边挑会话，中间直接开新的。</p>
            <div className="home-hero-actions" aria-label="主要操作">
              <button type="button" className="home-primary-action" onClick={onCreateSession}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.9"
                  />
                </svg>
                新建会话
              </button>
              <button
                type="button"
                className="home-secondary-action"
                onClick={() => onOpenRoute('/team')}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 19c.5-2.7 1.9-4 3.5-4s3 1.3 3.5 4M12.5 19c.5-2.7 1.9-4 3.5-4s3 1.3 3.5 4"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.75"
                  />
                </svg>
                团队编排
              </button>
              <button type="button" className="home-secondary-action" onClick={handleQuickResume}>
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m7 6 10 6-10 6V6Z"
                    stroke="currentColor"
                    strokeLinejoin="round"
                    strokeWidth="1.75"
                  />
                </svg>
                {quickResumeLabel}
              </button>
            </div>
          </div>

          <aside className="home-context-card" aria-label="当前上下文">
            <span className="home-eyebrow">当前上下文</span>
            <strong title={contextLabel}>{contextLabel}</strong>
            <small title={selectedContextPath ?? undefined}>{contextPathHint}</small>
            <div className="home-context-chip-row">
              <span className="home-context-chip" data-tone="accent">
                {projectCount} 个项目
              </span>
              <span className="home-context-chip" data-tone="aux">
                {totalSessionCount} 个会话
              </span>
              <span className="home-context-chip" data-tone="contrast">
                {pausedCount} 个待恢复
              </span>
            </div>
            <p className="home-context-running">
              <span data-active={runningCount > 0 ? 'true' : 'false'} aria-hidden="true" />
              {runningHint}
            </p>
          </aside>
        </div>

        <section className="home-agenda" aria-label="最近需要继续的任务">
          <header className="home-agenda-header">
            <span>最近需要继续的任务</span>
            <small>{agendaNote}</small>
          </header>

          {highlightedSessions.length === 0 ? (
            <div className="home-agenda-empty">
              <strong>当前没有卡住的任务</strong>
              <span>运行中或暂停的会话会优先出现在这里，方便你直接接着做。</span>
            </div>
          ) : (
            <div className="home-agenda-list">
              {highlightedSessions.map((session) => {
                const workspacePath = getWorkingDirectory(session.metadata_json);
                return (
                  <button
                    key={session.id}
                    type="button"
                    className="home-agenda-item"
                    onClick={() => onOpenSession(session.id, session.title)}
                  >
                    <span
                      className="home-agenda-state"
                      data-state={session.state_status ?? 'idle'}
                      aria-hidden="true"
                    />
                    <span className="home-agenda-copy">
                      <strong>{getSessionTitle(session)}</strong>
                      <small>
                        {getWorkspaceName(workspacePath)} · {formatRelativeTime(session.updated_at)}
                      </small>
                    </span>
                    <span
                      className="home-agenda-state-label"
                      data-state={session.state_status ?? 'idle'}
                    >
                      {formatSessionState(session.state_status)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <section className="home-command-panel" aria-label="快捷入口">
        <header className="home-section-header">
          <span className="home-eyebrow">从这里开始</span>
          <h2>选择一种推进方式</h2>
        </header>
        <div className="home-command-grid">
          <HomeCommandCard
            description={sessionContextDescription}
            icon="plus"
            tone="accent"
            title="单 Agent 会话"
            onClick={onCreateSession}
          />
          <HomeCommandCard
            description="拆解任务，分配给多层 Agent"
            icon="team"
            tone="contrast"
            title="团队编排"
            onClick={() => onOpenRoute('/team')}
          />
          <HomeCommandCard
            description="管理可复用流程和自动化"
            icon="workflow"
            tone="aux"
            title="工作流"
            onClick={() => onOpenRoute('/workflows')}
          />
          <HomeCommandCard
            description="查看生成文件、图片和交付物"
            icon="artifact"
            tone="complement"
            title="产物中心"
            onClick={() => onOpenRoute('/artifacts')}
          />
        </div>
      </section>
    </section>
  );
}

type HomeCommandTone = 'accent' | 'aux' | 'complement' | 'contrast';

interface HomeCommandCardProps {
  readonly description: string;
  readonly icon: HomeCommandIconName;
  readonly title: string;
  readonly tone: HomeCommandTone;
  readonly onClick: () => void;
}

function HomeCommandCard({ description, icon, title, tone, onClick }: HomeCommandCardProps) {
  return (
    <button type="button" className="home-command-card" onClick={onClick}>
      <span className="home-command-icon" data-tone={tone} aria-hidden="true">
        <HomeCommandIcon icon={icon} />
      </span>
      <span className="home-command-copy">
        <strong>{title}</strong>
        <small title={description}>{description}</small>
      </span>
      <span className="home-command-arrow" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="m9 6 6 6-6 6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
      </span>
    </button>
  );
}

function formatSessionState(state: HomeSessionLike['state_status']): string {
  switch (state) {
    case 'paused':
      return '暂停';
    case 'running':
      return '运行';
    case 'idle':
    case undefined:
      return '空闲';
  }
}
