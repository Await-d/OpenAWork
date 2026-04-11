import type { ReactNode } from 'react';
import type { SharedSessionSummaryRecord } from '@openAwork/web-client';
import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import type { TeamActionFeedback } from '../use-team-collaboration.js';
import { TeamSectionHeader } from '../team-page-sections.js';
import type { TeamRuntimeMetric, TeamWorkspaceCardSummary } from './team-runtime-model.js';
import { formatWorkspaceLabel, getSharedSessionStateLabel } from './team-runtime-model.js';
import { TeamRuntimeBuddy } from './team-runtime-buddy.js';
import { TeamRuntimeRoleBindingPanel } from './team-runtime-role-binding-panel.js';

const tabListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

const activeTabStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  width: '100%',
  padding: '11px 12px',
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--accent) 14%, var(--surface))',
  color: 'var(--text)',
  textAlign: 'left',
  cursor: 'pointer',
};

const inactiveTabStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  width: '100%',
  padding: '11px 12px',
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
  color: 'var(--text-3)',
  textAlign: 'left',
  cursor: 'pointer',
};

const shellPanelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 18,
  border: '1px solid color-mix(in srgb, var(--border) 78%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 88%, var(--bg))',
};

const shellInsetPanelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 74%, var(--bg))',
};

function CompactMetricPill({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: number | string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 2,
        minWidth: 112,
        padding: '8px 10px',
        borderRadius: 12,
        border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4 }}>{hint}</span>
    </div>
  );
}

function RailEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div style={shellInsetPanelStyle}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65 }}>{description}</span>
    </div>
  );
}

interface TeamRuntimeSelectedRunSummary {
  activeViewerCount: number;
  commentCount: number;
  pendingApprovalCount: number;
  pendingQuestionCount: number;
  sharedByEmail: string;
  stateLabel: string;
  title: string;
  workspaceLabel: string;
}

interface TeamRuntimeShellFrameProps {
  activeTabKey: string;
  activeTabLabel: string;
  activeTabSummary: string;
  buddyProjection: {
    activeAgentCount: number;
    blockedCount: number;
    pendingApprovalCount: number;
    pendingQuestionCount: number;
    runningCount: number;
    sessionTitle: string | null;
    workspaceLabel: string;
  };
  busy: boolean;
  error: string | null;
  feedback: TeamActionFeedback | null;
  filteredSessionCount: number;
  filteredSessionShareCount: number;
  filteredSharedSessions: SharedSessionSummaryRecord[];
  headerMetrics: TeamRuntimeMetric[];
  interactionDraft: string;
  isSingleColumn: boolean;
  isTwoColumn: boolean;
  mainContent: ReactNode;
  onActiveTabChange: (tabKey: string) => void;
  onInteractionDraftChange: (value: string) => void;
  onLaunchWorkflowTemplate: () => Promise<boolean>;
  onRoleBindingChange: (role: CoreRole, agentId: string) => void;
  onSelectSharedSession: (sessionId: string) => void;
  onSelectWorkspaceKey: (workspaceKey: string) => void;
  onSubmitInteractionDraft: () => void;
  roleBindingAgents: ManagedAgentRecord[];
  roleBindingCards: Array<{
    recommendedCapabilities: CapabilityDescriptor[];
    role: CoreRole;
    roleLabel: string;
    selectedAgent: ManagedAgentRecord | null;
    selectedAgentId: string;
  }>;
  roleBindingError: string | null;
  roleBindingLoading: boolean;
  selectedRunSummary: TeamRuntimeSelectedRunSummary | null;
  selectedSharedSessionId: string | null;
  selectedWorkspaceKey: string;
  selectedWorkspaceLabel: string;
  selectedWorkspaceRunningCount: number;
  tabs: Array<{ key: string; label: string; summary: string }>;
  workspaceOverviewLines: string[];
  workspaceSummaries: TeamWorkspaceCardSummary[];
  workflowLaunch: {
    nodeCount: number;
    templateDescription: string;
    templateId: string;
    templateName: string;
  } | null;
}

export function TeamRuntimeShellFrame({
  activeTabKey,
  activeTabLabel,
  activeTabSummary,
  buddyProjection,
  busy,
  error,
  feedback,
  filteredSessionCount,
  filteredSessionShareCount,
  filteredSharedSessions,
  headerMetrics,
  interactionDraft,
  isSingleColumn,
  isTwoColumn,
  mainContent,
  onActiveTabChange,
  onInteractionDraftChange,
  onLaunchWorkflowTemplate,
  onRoleBindingChange,
  onSelectSharedSession,
  onSelectWorkspaceKey,
  onSubmitInteractionDraft,
  roleBindingAgents,
  roleBindingCards,
  roleBindingError,
  roleBindingLoading,
  selectedRunSummary,
  selectedSharedSessionId,
  selectedWorkspaceKey,
  selectedWorkspaceLabel,
  selectedWorkspaceRunningCount,
  tabs,
  workspaceOverviewLines,
  workspaceSummaries,
  workflowLaunch,
}: TeamRuntimeShellFrameProps) {
  const layoutModeLabel = isSingleColumn ? '单栏' : isTwoColumn ? '双栏' : '三栏';

  return (
    <div className="page-root">
      <div className="page-content">
        <div
          style={{
            maxWidth: 'min(1880px, 100%)',
            margin: '0 auto',
            padding: '16px',
            display: 'grid',
            gap: 12,
          }}
        >
          <header
            className="content-card"
            style={{
              display: 'grid',
              gap: 12,
              padding: 14,
              borderRadius: 20,
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 88%, var(--bg)) 100%)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: 'var(--accent)',
                    }}
                  >
                    Team Runtime Console
                  </span>
                  {[
                    `工作区：${selectedWorkspaceLabel}`,
                    `${selectedWorkspaceRunningCount} 运行中`,
                    `${filteredSharedSessions.length} 共享运行`,
                  ].map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        minHeight: 24,
                        padding: '0 9px',
                        borderRadius: 999,
                        border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                        background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                        fontSize: 11,
                        color: 'var(--text-2)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 'clamp(20px, 2.2vw, 28px)', fontWeight: 800 }}>
                    团队运行总控台
                  </span>
                  <span
                    style={{ maxWidth: 980, fontSize: 12, lineHeight: 1.7, color: 'var(--text-2)' }}
                  >
                    以工作区切片组织共享会话、任务推进、交互输入和人工介入，把原先分离的页面块压缩成更接近
                    SpectrAI 的持续工作台结构。
                  </span>
                </div>
              </div>
              <div
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}
              >
                {headerMetrics.map((metric) => (
                  <CompactMetricPill
                    key={metric.label}
                    hint={metric.hint}
                    label={metric.label}
                    value={metric.value}
                  />
                ))}
              </div>
            </div>

            {feedback ? (
              <div
                style={{
                  ...shellInsetPanelStyle,
                  borderColor:
                    feedback.tone === 'success'
                      ? 'color-mix(in srgb, var(--success) 42%, var(--border))'
                      : 'color-mix(in srgb, var(--danger) 42%, var(--border))',
                  background:
                    feedback.tone === 'success'
                      ? 'color-mix(in srgb, var(--success) 10%, var(--surface))'
                      : 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
                  color: feedback.tone === 'success' ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {feedback.message}
              </div>
            ) : null}

            {error ? (
              <div
                style={{
                  ...shellInsetPanelStyle,
                  borderColor: 'color-mix(in srgb, var(--danger) 42%, var(--border))',
                  background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
                  color: 'var(--danger)',
                }}
              >
                {error}
              </div>
            ) : null}
          </header>

          <section
            style={{
              display: 'grid',
              gridTemplateColumns: isSingleColumn
                ? 'minmax(0, 1fr)'
                : isTwoColumn
                  ? 'minmax(260px, 300px) minmax(0, 1fr)'
                  : 'minmax(260px, 300px) minmax(0, 1fr) minmax(300px, 360px)',
              gap: 12,
              alignItems: 'start',
              minHeight: 0,
            }}
          >
            <aside style={{ display: 'grid', gap: 12, minWidth: 0, alignSelf: 'start' }}>
              <section style={shellPanelStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span
                    style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                  >
                    Workspace navigator
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>工作区切片</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                    这里承担 SpectrAI 左侧 Sidebar 的工作区入口角色，始终可切换当前运行视角。
                  </span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {workspaceSummaries.map((workspace) => {
                    const isActive = workspace.key === selectedWorkspaceKey;
                    return (
                      <button
                        key={workspace.key}
                        type="button"
                        onClick={() => onSelectWorkspaceKey(workspace.key)}
                        style={{
                          display: 'grid',
                          gap: 6,
                          width: '100%',
                          padding: '11px 12px',
                          textAlign: 'left',
                          borderRadius: 14,
                          border: isActive
                            ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                            : '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                          background: isActive
                            ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                            : 'color-mix(in srgb, var(--surface) 74%, var(--bg))',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{workspace.label}</span>
                          <span
                            style={{
                              fontSize: 10,
                              color: isActive ? 'var(--accent)' : 'var(--text-3)',
                            }}
                          >
                            {workspace.runningCount} run
                          </span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                          {workspace.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section style={shellPanelStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span
                    style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                  >
                    Console sections
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>主工作区导航</span>
                </div>
                <div style={tabListStyle} role="tablist" aria-label="Team Runtime 视图切换">
                  {tabs.map((tab) => {
                    const isActive = tab.key === activeTabKey;
                    return (
                      <button
                        key={tab.key}
                        id={`team-runtime-tab-${tab.key}`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`team-runtime-panel-${tab.key}`}
                        onClick={() => onActiveTabChange(tab.key)}
                        style={isActive ? activeTabStyle : inactiveTabStyle}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{tab.label}</span>
                        <span
                          style={{
                            fontSize: 11,
                            color: isActive ? 'var(--text-2)' : 'var(--text-3)',
                          }}
                        >
                          {tab.summary}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {workflowLaunch ? (
                <section style={shellPanelStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span
                      style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                    >
                      Workflow handoff
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 800 }}>
                      {workflowLaunch.templateName}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                      {workflowLaunch.templateDescription || '当前模板没有描述。'} ·{' '}
                      {workflowLaunch.nodeCount} 个节点
                    </span>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void onLaunchWorkflowTemplate()}
                    disabled={busy}
                  >
                    {busy ? '发起中…' : '在当前 Team 中发起'}
                  </button>
                </section>
              ) : null}

              <section style={shellPanelStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span
                    style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                  >
                    Workspace brief
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>当前摘要</span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {workspaceOverviewLines.map((line) => (
                    <div key={line} style={shellInsetPanelStyle}>
                      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section style={shellPanelStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <span
                    style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                  >
                    Shared runs
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>快速定位共享运行</span>
                </div>
                {filteredSharedSessions.length === 0 ? (
                  <RailEmptyState title="暂无共享运行" description="当前工作区暂无共享运行。" />
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {filteredSharedSessions.slice(0, 6).map((sharedSession) => {
                      const isSelected = sharedSession.sessionId === selectedSharedSessionId;
                      return (
                        <button
                          key={sharedSession.sessionId}
                          type="button"
                          onClick={() => {
                            onSelectSharedSession(sharedSession.sessionId);
                            onActiveTabChange('sessions');
                          }}
                          style={{
                            display: 'grid',
                            gap: 4,
                            width: '100%',
                            padding: '10px 12px',
                            textAlign: 'left',
                            borderRadius: 12,
                            border: isSelected
                              ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                              : '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                            background: isSelected
                              ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                              : 'color-mix(in srgb, var(--surface) 74%, var(--bg))',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700 }}>
                            {sharedSession.title ?? sharedSession.sessionId}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                            {formatWorkspaceLabel(sharedSession.workspacePath)} ·{' '}
                            {getSharedSessionStateLabel(sharedSession.stateStatus)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </aside>

            <main style={{ display: 'grid', gap: 12, minWidth: 0 }}>
              <section
                className="content-card"
                style={{
                  display: 'grid',
                  gap: 12,
                  padding: 14,
                  borderRadius: 20,
                  background:
                    'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 88%, var(--bg)) 100%)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'grid', gap: 4 }}>
                    <span
                      style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}
                    >
                      Main workspace
                    </span>
                    <span style={{ fontSize: 18, fontWeight: 800 }}>{activeTabLabel}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
                      {activeTabSummary}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      `视角：${selectedWorkspaceLabel}`,
                      `${filteredSessionCount} 会话`,
                      `${filteredSessionShareCount} 共享记录`,
                    ].map((tag) => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 26,
                          padding: '0 10px',
                          borderRadius: 999,
                          border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                          background: 'color-mix(in srgb, var(--surface) 80%, var(--bg))',
                          fontSize: 11,
                          color: 'var(--text-2)',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  id={`team-runtime-panel-${activeTabKey}`}
                  role="tabpanel"
                  aria-labelledby={`team-runtime-tab-${activeTabKey}`}
                  style={{ minWidth: 0 }}
                >
                  {mainContent}
                </div>
              </section>
            </main>

            <aside
              style={{
                display: 'grid',
                gap: 12,
                minWidth: 0,
                gridColumn: isTwoColumn ? '1 / -1' : undefined,
              }}
            >
              <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
                <TeamSectionHeader
                  eyebrow="Selected run"
                  title="当前共享运行"
                  description="右侧细节轨持续盯住当前选中的共享会话，让运行摘要不再淹没在主内容里。"
                />
                {selectedRunSummary ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div className="content-card" style={{ display: 'grid', gap: 4, padding: 14 }}>
                      <span style={{ fontSize: 16, fontWeight: 800 }}>
                        {selectedRunSummary.title}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        工作区：{selectedRunSummary.workspaceLabel}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        状态：{selectedRunSummary.stateLabel}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                        共享者：{selectedRunSummary.sharedByEmail}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 10,
                      }}
                    >
                      {[
                        { label: '评论', value: selectedRunSummary.commentCount },
                        { label: '在线查看者', value: selectedRunSummary.activeViewerCount },
                        { label: '待审批', value: selectedRunSummary.pendingApprovalCount },
                        { label: '待回答', value: selectedRunSummary.pendingQuestionCount },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="content-card"
                          style={{ display: 'grid', gap: 4, padding: 12 }}
                        >
                          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.label}</span>
                          <span style={{ fontSize: 18, fontWeight: 800 }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <RailEmptyState
                    title="尚未选中共享运行"
                    description="在左侧共享运行索引或“会话 / Agent”中选一条共享会话，细节轨会立刻同步。"
                  />
                )}
              </section>

              <section className="content-card" style={{ display: 'grid', gap: 12, padding: 16 }}>
                <TeamSectionHeader
                  eyebrow="Interaction agent"
                  title="统一交互代理"
                  description="保持常驻输入入口，让需求改写在 Detail Rail 中持续可达，而不是挤占主工作区。"
                />
                <textarea
                  aria-label="interaction-agent 输入区"
                  rows={4}
                  value={interactionDraft}
                  onChange={(event) => onInteractionDraftChange(event.target.value)}
                  placeholder="先把人类意图写在这里，后续会由 interaction-agent 做需求改写。"
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void onSubmitInteractionDraft()}
                  disabled={busy || !interactionDraft.trim()}
                >
                  {busy ? '提交中…' : '交由 interaction-agent'}
                </button>
              </section>

              <TeamRuntimeBuddy
                activeAgentCount={buddyProjection.activeAgentCount}
                blockedCount={buddyProjection.blockedCount}
                pendingApprovalCount={buddyProjection.pendingApprovalCount}
                pendingQuestionCount={buddyProjection.pendingQuestionCount}
                runningCount={buddyProjection.runningCount}
                sessionTitle={buddyProjection.sessionTitle}
                workspaceLabel={buddyProjection.workspaceLabel}
              />

              <TeamRuntimeRoleBindingPanel
                agents={roleBindingAgents}
                cards={roleBindingCards}
                error={roleBindingError}
                loading={roleBindingLoading}
                onChange={onRoleBindingChange}
              />
            </aside>
          </section>

          <footer
            className="content-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '10px 14px',
              borderRadius: 16,
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[
                `工作区 ${selectedWorkspaceLabel}`,
                `当前区块 ${activeTabLabel}`,
                `布局 ${layoutModeLabel}`,
                `${filteredSharedSessions.length} 个共享运行`,
              ].map((item) => (
                <span
                  key={item}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    minHeight: 24,
                    padding: '0 9px',
                    borderRadius: 999,
                    border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                    background: 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
                    fontSize: 11,
                    color: 'var(--text-2)',
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {selectedRunSummary
                ? `当前焦点：${selectedRunSummary.title}`
                : '当前尚未选中共享运行'}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
