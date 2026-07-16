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
  const highlightedSessions = attentionSessions.slice(0, 4);
  const quickResumeSession = highlightedSessions[0];
  const hiddenAttentionCount = attentionSessions.length - highlightedSessions.length;
  const quickResumeLabel = quickResumeSession ? '继续最近任务' : '打开工作流';
  const handleQuickResume = quickResumeSession
    ? () => onOpenSession(quickResumeSession.id, quickResumeSession.title)
    : () => onOpenRoute('/workflows');

  return (
    <section className="home-dashboard" aria-label="工作台控制台">
      <section className="home-hero home-hero-aurora">
        <div className="home-hero-copy">
          <span className="home-eyebrow">欢迎回来</span>
          <h1>把想法直接推进到工作区，而不是先被一堆面板吓住</h1>
          <p>
            首页先帮你确认当前上下文，再把新建、协作、恢复任务和最近会话放到一个真正像入口的位置。
          </p>
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

          <div className="home-hero-metrics" aria-label="首页概览">
            <div className="home-hero-metric">
              <strong>{totalSessionCount}</strong>
              <span>当前可见会话</span>
            </div>
            <div className="home-hero-metric">
              <strong>{runningCount}</strong>
              <span>{activeProjectCount} 个项目正在推进</span>
            </div>
            <div className="home-hero-metric">
              <strong>{pausedCount}</strong>
              <span>等待你继续或回复</span>
            </div>
          </div>
        </div>

        <div className="home-context-card">
          <span className="home-eyebrow">当前上下文</span>
          <strong>{contextLabel}</strong>
          <small>{selectedContextPath ?? '未选择工作区，创建会话时会使用全局上下文。'}</small>
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

          <div className="home-context-attention">
            <div className="home-context-attention-header">
              <span>最近需要继续的任务</span>
              <small>
                {highlightedSessions.length === 0
                  ? '空闲'
                  : hiddenAttentionCount > 0
                    ? `优先 ${highlightedSessions.length}/${attentionSessions.length}`
                    : '优先处理'}
              </small>
            </div>

            {highlightedSessions.length === 0 ? (
              <div className="home-context-empty">
                <strong>当前没有卡住的任务</strong>
                <span>运行中或暂停的会话会优先出现在这里，方便你直接接着做。</span>
              </div>
            ) : (
              <div className="home-context-session-list">
                {highlightedSessions.map((session) => {
                  const workspacePath = getWorkingDirectory(session.metadata_json);
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className="home-context-session-row"
                      onClick={() => onOpenSession(session.id, session.title)}
                    >
                      <span
                        className="home-context-session-state"
                        data-state={session.state_status ?? 'idle'}
                        aria-hidden="true"
                      />
                      <span className="home-context-session-copy">
                        <strong>{getSessionTitle(session)}</strong>
                        <small>
                          {getWorkspaceName(workspacePath)} ·{' '}
                          {formatRelativeTime(session.updated_at)}
                        </small>
                      </span>
                      <span
                        className="home-session-state"
                        data-state={session.state_status ?? 'idle'}
                      >
                        {formatSessionState(session.state_status)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="home-command-panel home-command-panel-aurora" aria-label="快捷入口">
        <header className="home-section-header">
          <div>
            <span className="home-eyebrow">从这里开始</span>
            <h2>选择一种推进方式</h2>
          </div>
          <small className="home-section-note">已经知道要做什么时，首页应该让你一眼点进去。</small>
        </header>
        <div className="home-command-grid">
          <HomeCommandCard
            description={selectedContextPath ?? '会沿用当前工作区上下文'}
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
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
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
