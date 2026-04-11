import { useEffect, useMemo, useState } from 'react';
import type { ManagedAgentRecord } from '@openAwork/shared';
import type { TeamActionFeedback } from '../use-team-collaboration.js';
import { TeamRuntimeShellFrame } from './team-runtime-shell-frame.js';
import {
  referenceActivities,
  referenceAgents,
  referenceBuddyProjection,
  referenceChangedFiles,
  referenceFileTree,
  referenceKanbanColumns,
  referenceMetrics,
  referenceMessages,
  referenceOverviewLines,
  referencePaneAgents,
  referenceRoleBindingCards,
  referenceSelectedRunSummary,
  referenceSessionCards,
  referenceSharedSessions,
  referenceTabs,
  referenceWorkspaceSummaries,
  type ReferenceActivityItem,
  type ReferenceFileTreeNode,
  type ReferenceWorkbenchMessage,
} from './team-runtime-reference-mock.js';

type ReferenceTabKey = (typeof referenceTabs)[number]['key'];

const selectedRunSummaryById: Record<string, typeof referenceSelectedRunSummary> = {
  'spectrai-session-1': referenceSelectedRunSummary,
  'spectrai-session-2': {
    ...referenceSelectedRunSummary,
    title: 'Agent Tree Audit',
    workspaceLabel: '/repo/openawork',
    sharedByEmail: 'review@spectrai.local',
    stateLabel: '等待输入',
    pendingApprovalCount: 1,
    pendingQuestionCount: 3,
    commentCount: 6,
    activeViewerCount: 2,
  },
  'spectrai-session-3': {
    ...referenceSelectedRunSummary,
    title: 'Telegram Bot Rollout',
    workspaceLabel: '/repo/research-lab',
    sharedByEmail: 'ops@spectrai.local',
    stateLabel: '运行中',
    pendingApprovalCount: 0,
    pendingQuestionCount: 2,
    commentCount: 9,
    activeViewerCount: 3,
  },
};

const sessionCountByWorkspace: Record<string, number> = {
  '/repo/claudeops': 68,
  '/repo/openawork': 44,
  '/repo/research-lab': 97,
};

const shareCountByWorkspace: Record<string, number> = {
  '/repo/claudeops': 9,
  '/repo/openawork': 6,
  '/repo/research-lab': 12,
};

function tileStyle(color: string): React.CSSProperties {
  return {
    display: 'grid',
    gap: 8,
    padding: 16,
    borderRadius: 16,
    border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
    background: 'color-mix(in srgb, var(--surface) 82%, var(--bg))',
    boxShadow: 'var(--shadow-sm)',
    minHeight: 110,
    alignContent: 'start',
    color,
  };
}

function DashboardStatCard({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div style={tileStyle(color)}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>实时刷新 mock 看板指标</span>
    </div>
  );
}

function SessionOverviewCard({ item }: { item: (typeof referenceSessionCards)[number] }) {
  return (
    <div
      className="content-card"
      style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 18, textAlign: 'left' }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
      >
        <span style={{ fontSize: 14, fontWeight: 700 }}>{item.title}</span>
        <span
          style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
            color: 'var(--text-2)',
          }}
        >
          {item.status}
        </span>
      </div>
      <div
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-3)' }}
      >
        <span>{item.provider}</span>
        <span>{item.duration}</span>
        <span>{item.tokens}</span>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{item.summary}</span>
    </div>
  );
}

function ActivityRow({ item }: { item: ReferenceActivityItem }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '72px 132px minmax(0, 1fr)',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 12,
        background: 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.timestamp}</span>
      <span style={{ fontSize: 11, color: 'var(--accent)' }}>{item.sessionName}</span>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>{item.detail}</span>
    </div>
  );
}

function UsageBlock() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        {[
          ['今日 Token', '4.8M'],
          ['运行时长', '177h'],
          ['Agent', '31'],
          ['Provider', '5'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="content-card"
            style={{ display: 'grid', gap: 4, padding: 14 }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{label}</span>
            <span style={{ fontSize: 22, fontWeight: 800 }}>{value}</span>
          </div>
        ))}
      </div>

      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>30 天 Token 趋势</span>
        <div style={{ display: 'flex', alignItems: 'end', gap: 8, minHeight: 180 }}>
          {[
            { day: '1', height: 32 },
            { day: '2', height: 48 },
            { day: '3', height: 58 },
            { day: '4', height: 34 },
            { day: '5', height: 66 },
            { day: '6', height: 72 },
            { day: '7', height: 54 },
            { day: '8', height: 80 },
            { day: '9', height: 62 },
            { day: '10', height: 88 },
            { day: '11', height: 74 },
            { day: '12', height: 96 },
          ].map((item) => (
            <div
              key={item.day}
              style={{ flex: 1, display: 'grid', gap: 6, justifyItems: 'center' }}
            >
              <div
                style={{
                  width: '100%',
                  height: `${item.height}px`,
                  borderRadius: '10px 10px 4px 4px',
                  background:
                    'linear-gradient(180deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 55%, var(--bg)) 100%)',
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{item.day}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>会话 Token 分布</span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px minmax(0, 1fr)',
            gap: 16,
            alignItems: 'center',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 180,
              height: 180,
              borderRadius: '50%',
              background:
                'conic-gradient(var(--accent) 0 36%, #22c55e 36% 58%, #f59e0b 58% 78%, #a855f7 78% 100%)',
            }}
          />
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              ['ClaudeOps Sprint Sync', '36%'],
              ['Telegram Bot Rollout', '22%'],
              ['Agent Tree Audit', '20%'],
              ['其他会话', '22%'],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}
              >
                <span>{label}</span>
                <span style={{ color: 'var(--text-3)' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ item }: { item: ReferenceWorkbenchMessage }) {
  const toneStyles: Record<ReferenceWorkbenchMessage['tone'], React.CSSProperties> = {
    agent: {
      background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
      border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
    },
    system: {
      background: 'color-mix(in srgb, var(--accent) 10%, var(--surface))',
      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
    },
    user: {
      background: 'color-mix(in srgb, var(--bg-2) 88%, var(--bg))',
      border: '1px solid color-mix(in srgb, var(--border) 68%, transparent)',
    },
  };

  return (
    <div
      style={{ ...toneStyles[item.tone], display: 'grid', gap: 8, padding: 14, borderRadius: 16 }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.meta}</span>
      </div>
      <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>{item.body}</span>
    </div>
  );
}

function FileTree({ nodes }: { nodes: ReferenceFileTreeNode[] }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {nodes.map((node) => (
        <div key={node.name} style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--text-3)' }}>{node.children ? '▾' : '•'}</span>
            <span>{node.name}</span>
            {node.changed ? (
              <span
                style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }}
              />
            ) : null}
          </div>
          {node.children?.length ? (
            <div style={{ display: 'grid', gap: 8, paddingLeft: 18 }}>
              <FileTree nodes={node.children} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TeamRuntimeDashboardTab() {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
        <DashboardStatCard color="var(--accent)" label="总会话" value="209" />
        <DashboardStatCard color="#22c55e" label="运行中" value="12" />
        <DashboardStatCard color="#f59e0b" label="等待中" value="5" />
        <DashboardStatCard color="#ef4444" label="异常" value="0" />
        <DashboardStatCard color="var(--text)" label="已完成" value="177" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.75fr) minmax(320px, 1fr)',
          gap: 16,
        }}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <section style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>活跃会话</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>4 个高优先级会话</span>
            </div>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
            >
              {referenceSessionCards.map((item) => (
                <SessionOverviewCard key={item.id} item={item} />
              ))}
            </div>
          </section>

          <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>最近活动</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>跨会话活动流</span>
            </div>
            <div style={{ display: 'grid', gap: 8, maxHeight: 310, overflow: 'auto' }}>
              {referenceActivities.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        </div>

        <UsageBlock />
      </div>
    </div>
  );
}

function TeamRuntimeSessionsTab({ selectedRunTitle }: { selectedRunTitle: string }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {referenceSessionCards.map((item) => (
            <button
              key={item.id}
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 34,
                padding: '0 12px',
                borderRadius: 999,
                border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                background:
                  item.title === selectedRunTitle
                    ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                    : 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                color: 'var(--text)',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background:
                    item.status === '运行中'
                      ? '#22c55e'
                      : item.status === '等待输入'
                        ? '#f59e0b'
                        : 'var(--text-3)',
                }}
              />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{item.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.status}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
        <section className="content-card" style={{ display: 'grid', gap: 14, padding: 16 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>当前会话</span>
            <span style={{ fontSize: 18, fontWeight: 800 }}>{selectedRunTitle}</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              Claude Code · desk_code/claudeops · 多标签结构化会话视图
            </span>
          </div>

          {referenceMessages.map((item) => (
            <MessageBubble key={item.id} item={item} />
          ))}

          <div className="content-card" style={{ display: 'grid', gap: 10, padding: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>输入区</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                readOnly
                value="输入需求、粘贴图片或通过 / 命令唤起工具…"
                style={{ flex: 1, minHeight: 42, borderRadius: 12, padding: '0 12px' }}
              />
              <button type="button" className="primary-button">
                发送
              </button>
            </div>
          </div>
        </section>

        <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>子任务追踪</span>
          {referenceAgents.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'grid',
                gap: 4,
                padding: 12,
                borderRadius: 14,
                background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.path}</span>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-2)' }}>
                <span>{item.provider}</span>
                <span>{item.status}</span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function TeamRuntimeFilesTab() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
        gap: 16,
      }}
    >
      <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>文件资源管理器</span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            左侧资源树 + 变更蓝点 + 工作目录层级
          </span>
        </div>
        <FileTree nodes={referenceFileTree} />
      </section>

      <section style={{ display: 'grid', gap: 16 }}>
        <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>会话改动列表</span>
          <div style={{ display: 'grid', gap: 8 }}>
            {referenceChangedFiles.map((file) => (
              <div
                key={file}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                }}
              >
                <span style={{ fontSize: 12 }}>{file}</span>
                <span style={{ fontSize: 11, color: 'var(--accent)' }}>修改</span>
              </div>
            ))}
          </div>
        </section>

        <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>代码预览</span>
          <pre
            style={{
              margin: 0,
              minHeight: 320,
              overflow: 'auto',
              padding: 16,
              borderRadius: 16,
              background: '#0b1220',
              color: '#dbeafe',
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            {`export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <TitleBar />
      <div className="flex-1 overflow-hidden flex">
        <ActivityBar />
        <Allotment>
          <Sidebar />
          <MainPanel />
          <DetailPanel />
        </Allotment>
      </div>
      <StatusBar />
    </div>
  );
}`}
          </pre>
        </section>
      </section>
    </div>
  );
}

function TeamRuntimeKanbanTab() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
      {referenceKanbanColumns.map((column) => (
        <section
          key={column.id}
          className="content-card"
          style={{ display: 'grid', gap: 12, padding: 14 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700 }}>{column.title}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{column.cards.length}</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {column.cards.map((card) => (
              <div
                key={card.id}
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: 12,
                  borderRadius: 14,
                  background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</span>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{card.owner}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TeamRuntimeReferencePage() {
  const [activeTabKey, setActiveTabKey] = useState<ReferenceTabKey>('dashboard');
  const [interactionDraft, setInteractionDraft] = useState('');
  const [feedback, setFeedback] = useState<TeamActionFeedback | null>(null);
  const [selectedWorkspaceKey, setSelectedWorkspaceKey] = useState(
    referenceWorkspaceSummaries[0]?.key ?? '',
  );
  const [selectedSharedSessionId, setSelectedSharedSessionId] = useState(
    referenceSharedSessions[0]?.sessionId ?? null,
  );
  const [roleBindingCards, setRoleBindingCards] = useState(referenceRoleBindingCards);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isSingleColumn = viewportWidth < 1120;
  const isTwoColumn = viewportWidth >= 1120 && viewportWidth < 1500;

  const selectedWorkspace =
    referenceWorkspaceSummaries.find((workspace) => workspace.key === selectedWorkspaceKey) ??
    referenceWorkspaceSummaries[0]!;

  const filteredSharedSessions = referenceSharedSessions.filter(
    (session) => session.workspacePath === selectedWorkspace.key,
  );

  const selectedRunSummary =
    (selectedSharedSessionId ? selectedRunSummaryById[selectedSharedSessionId] : null) ??
    selectedRunSummaryById[filteredSharedSessions[0]?.sessionId ?? 'spectrai-session-1'] ??
    referenceSelectedRunSummary;

  const activeTab = referenceTabs.find((tab) => tab.key === activeTabKey) ?? referenceTabs[0];

  const mainContent = useMemo(() => {
    if (activeTabKey === 'sessions') {
      return <TeamRuntimeSessionsTab selectedRunTitle={selectedRunSummary.title} />;
    }
    if (activeTabKey === 'files') {
      return <TeamRuntimeFilesTab />;
    }
    if (activeTabKey === 'kanban') {
      return <TeamRuntimeKanbanTab />;
    }
    return <TeamRuntimeDashboardTab />;
  }, [activeTabKey, selectedRunSummary.title]);

  return (
    <TeamRuntimeShellFrame
      activeTabKey={activeTab.key}
      activeTabLabel={activeTab.label}
      activeTabSummary={activeTab.summary}
      buddyProjection={referenceBuddyProjection}
      busy={false}
      error={null}
      feedback={feedback}
      filteredSessionCount={sessionCountByWorkspace[selectedWorkspace.key] ?? 0}
      filteredSessionShareCount={shareCountByWorkspace[selectedWorkspace.key] ?? 0}
      filteredSharedSessions={filteredSharedSessions}
      headerMetrics={referenceMetrics}
      interactionDraft={interactionDraft}
      isSingleColumn={isSingleColumn}
      isTwoColumn={isTwoColumn}
      mainContent={mainContent}
      onActiveTabChange={(tabKey) => setActiveTabKey(tabKey as ReferenceTabKey)}
      onInteractionDraftChange={setInteractionDraft}
      onLaunchWorkflowTemplate={async () => {
        setFeedback({
          message: '已从 mock workflow handoff 发起当前参考页任务。',
          tone: 'success',
        });
        return true;
      }}
      onRoleBindingChange={(role, agentId) => {
        setRoleBindingCards((current) =>
          current.map((card) =>
            card.role === role
              ? {
                  ...card,
                  selectedAgentId: agentId,
                  selectedAgent:
                    referencePaneAgents.find((agent) => agent.id === agentId) ?? card.selectedAgent,
                }
              : card,
          ),
        );
      }}
      onSelectSharedSession={(sessionId) => {
        setSelectedSharedSessionId(sessionId);
        setActiveTabKey('sessions');
      }}
      onSelectWorkspaceKey={(workspaceKey) => {
        setSelectedWorkspaceKey(workspaceKey);
        const nextSession = referenceSharedSessions.find(
          (session) => session.workspacePath === workspaceKey,
        );
        setSelectedSharedSessionId(nextSession?.sessionId ?? null);
      }}
      onSubmitInteractionDraft={() => {
        if (!interactionDraft.trim()) {
          return;
        }
        setFeedback({
          message: `已将 mock 指令“${interactionDraft.trim()}”投递到交互代理预览。`,
          tone: 'success',
        });
        setInteractionDraft('');
      }}
      roleBindingAgents={referencePaneAgents as ManagedAgentRecord[]}
      roleBindingCards={roleBindingCards}
      roleBindingError={null}
      roleBindingLoading={false}
      selectedRunSummary={selectedRunSummary}
      selectedSharedSessionId={selectedSharedSessionId}
      selectedWorkspaceKey={selectedWorkspace.key}
      selectedWorkspaceLabel={selectedWorkspace.label}
      selectedWorkspaceRunningCount={selectedWorkspace.runningCount}
      statusBarSummary={{
        activeCount: 12,
        totalCount: 209,
        runningCount: 12,
        waitingCount: 5,
        errorCount: 0,
        todayTokens: '4.8M tok',
        runtimeLabel: '运行 177h',
      }}
      tabs={[...referenceTabs]}
      workspaceOverviewLines={referenceOverviewLines}
      workspaceSummaries={referenceWorkspaceSummaries}
      workflowLaunch={{
        nodeCount: 6,
        templateId: 'spectrai-template-1',
        templateName: 'Agent Sprint Orchestration',
        templateDescription: '参考 SpectrAI 的多会话调度流程模板，用于静态页面还原。',
      }}
    />
  );
}
