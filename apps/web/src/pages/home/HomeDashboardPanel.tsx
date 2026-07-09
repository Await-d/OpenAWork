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

  return (
    <section className="home-dashboard" aria-label="工作台控制台">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-eyebrow">Mission control</span>
          <h1>从项目上下文开始，把任务送到正确的工作流</h1>
          <p>
            首页现在用于选择上下文、观察运行状态、恢复暂停任务，并快速进入会话、团队、工作流和产物中心。
          </p>
          <div className="home-hero-actions" aria-label="主要操作">
            <button type="button" className="home-primary-action" onClick={onCreateSession}>
              新建会话
            </button>
            <button
              type="button"
              className="home-secondary-action"
              onClick={() => onOpenRoute('/team')}
            >
              团队运行台
            </button>
          </div>
        </div>

        <div className="home-context-card">
          <span className="home-eyebrow">Current context</span>
          <strong>{contextLabel}</strong>
          <small>{selectedContextPath ?? '未选择工作区，创建会话时会使用全局上下文。'}</small>
          <dl>
            <div>
              <dt>运行</dt>
              <dd>{runningCount}</dd>
            </div>
            <div>
              <dt>暂停</dt>
              <dd>{pausedCount}</dd>
            </div>
            <div>
              <dt>项目</dt>
              <dd>{projectCount}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="home-kpi-grid" aria-label="工作台指标">
        <article className="home-kpi-card" data-tone="accent">
          <span>会话总数</span>
          <strong>{totalSessionCount}</strong>
          <small>覆盖当前可见工作上下文</small>
        </article>
        <article className="home-kpi-card" data-tone="contrast">
          <span>运行中</span>
          <strong>{runningCount}</strong>
          <small>{activeProjectCount} 个项目有活动任务</small>
        </article>
        <article className="home-kpi-card" data-tone="aux">
          <span>暂停中</span>
          <strong>{pausedCount}</strong>
          <small>等待回复或继续执行</small>
        </article>
        <article className="home-kpi-card" data-tone="complement">
          <span>项目</span>
          <strong>{projectCount}</strong>
          <small>按会话活跃度排序</small>
        </article>
      </section>

      <section className="home-command-panel" aria-label="快捷入口">
        <header className="home-section-header">
          <span className="home-eyebrow">Start here</span>
          <h2>选择工作方式</h2>
        </header>
        <div className="home-command-grid">
          <HomeCommandCard
            description={selectedContextPath ?? '使用当前工作区上下文'}
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
            tone="accent"
            title="产物中心"
            onClick={() => onOpenRoute('/artifacts')}
          />
        </div>
      </section>

      <section className="home-attention-panel" aria-label="需要关注的任务">
        <header className="home-section-header">
          <span className="home-eyebrow">Needs attention</span>
          <h2>进行中与暂停任务</h2>
        </header>
        {attentionSessions.length === 0 ? (
          <div className="home-attention-empty">
            <strong>当前没有需要处理的任务</strong>
            <span>运行中或暂停的会话会出现在这里，方便你直接恢复。</span>
          </div>
        ) : (
          <div className="home-attention-list">
            {attentionSessions.map((session) => {
              const workspacePath = getWorkingDirectory(session.metadata_json);
              return (
                <button
                  key={session.id}
                  type="button"
                  className="home-attention-row"
                  onClick={() => onOpenSession(session.id, session.title)}
                >
                  <span
                    className="home-attention-state"
                    data-state={session.state_status ?? 'idle'}
                  >
                    {formatSessionState(session.state_status)}
                  </span>
                  <span className="home-attention-copy">
                    <strong>{getSessionTitle(session)}</strong>
                    <small>
                      {getWorkspaceName(workspacePath)} · {formatRelativeTime(session.updated_at)}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

type HomeCommandTone = 'accent' | 'aux' | 'contrast';

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
