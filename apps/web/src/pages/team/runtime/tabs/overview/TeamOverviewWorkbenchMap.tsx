import { PRIMARY_TABS, type PrimaryTabKey } from '../team-page-v2-tabs.js';
import { TeamTabIcon } from '../team-tab-icons.js';

interface WorkbenchMapCopy {
  readonly summary: string;
  readonly signal: string;
}

const WORKBENCH_MAP_COPY = {
  overview: {
    summary: '状态图谱汇总。',
    signal: '默认落点',
  },
  conversation: {
    summary: '对话层级追踪。',
    signal: '协作流',
  },
  tasks: {
    summary: '看板产物评审。',
    signal: '交付面',
  },
  metrics: {
    summary: '用量耗时工具。',
    signal: '观测面',
  },
  governance: {
    summary: '模板共享审计。',
    signal: '控制面',
  },
} satisfies Record<PrimaryTabKey, WorkbenchMapCopy>;

const TOTAL_WORKBENCH_VIEW_COUNT = PRIMARY_TABS.reduce(
  (count, tab) => count + tab.children.length,
  0,
);

export function TeamOverviewWorkbenchMap() {
  return (
    <section className="team-v2-overview-workbench-map" aria-label="Team 工作台层级导览">
      <header className="team-v2-overview-workbench-header">
        <div className="team-v2-overview-workbench-heading">
          <span className="team-v2-overview-workbench-kicker">工作台层级</span>
          <h3>Team 页面结构</h3>
        </div>
        <span className="team-v2-overview-workbench-count">
          {PRIMARY_TABS.length} 个主域 · {TOTAL_WORKBENCH_VIEW_COUNT} 个页内视图
        </span>
      </header>

      <div className="team-v2-overview-workbench-grid">
        {PRIMARY_TABS.map((tab) => {
          const copy = WORKBENCH_MAP_COPY[tab.key];
          return (
            <article key={tab.key} className="team-v2-overview-workbench-card">
              <div className="team-v2-overview-workbench-card-head">
                <span className="team-v2-overview-workbench-icon">
                  <TeamTabIcon name={tab.icon} size={15} />
                </span>
                <div className="team-v2-overview-workbench-title-group">
                  <span className="team-v2-overview-workbench-title">{tab.label}</span>
                  <span className="team-v2-overview-workbench-signal">{copy.signal}</span>
                </div>
              </div>

              <p className="team-v2-overview-workbench-summary">{copy.summary}</p>

              <div
                className="team-v2-overview-workbench-children"
                aria-label={`${tab.label}子视图`}
              >
                {tab.children.map((child) => (
                  <span key={child.key} className="team-v2-overview-workbench-chip">
                    <TeamTabIcon name={child.icon} size={11} />
                    {child.label}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
