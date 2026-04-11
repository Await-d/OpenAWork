import { useState, type CSSProperties, type ReactNode } from 'react';
import type { SharedSessionSummaryRecord } from '@openAwork/web-client';
import type { CapabilityDescriptor, CoreRole, ManagedAgentRecord } from '@openAwork/shared';
import type { TeamActionFeedback } from '../use-team-collaboration.js';
import { TeamSectionHeader } from '../team-page-sections.js';
import type { TeamRuntimeMetric, TeamWorkspaceCardSummary } from './team-runtime-model.js';
import { formatWorkspaceLabel, getSharedSessionStateLabel } from './team-runtime-model.js';
import { TeamRuntimeBuddy } from './team-runtime-buddy.js';
import { TeamRuntimeRoleBindingPanel } from './team-runtime-role-binding-panel.js';

const APP_FRAME_STYLE: CSSProperties = {
  display: 'grid',
  gap: 0,
  minHeight: 'max(760px, calc(100dvh - 96px))',
  borderRadius: 28,
  overflow: 'hidden',
  border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, var(--bg)) 0%, color-mix(in srgb, var(--bg-2) 92%, var(--bg)) 100%)',
  boxShadow: 'var(--shadow-lg)',
};

const PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 0,
  minWidth: 0,
  minHeight: 0,
  background: 'color-mix(in srgb, var(--surface) 86%, var(--bg))',
};

const PANEL_SECTION_STYLE: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 14,
};

const PANEL_HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '14px 14px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
  background:
    'linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 82%, var(--bg)) 100%)',
};

const INSET_PANEL_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 14,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
};

const STATUS_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  padding: '0 9px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
  fontSize: 11,
  color: 'var(--text-2)',
  whiteSpace: 'nowrap',
};

const ACTIVITY_BUTTON_BASE_STYLE: CSSProperties = {
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  width: '100%',
  minHeight: 44,
  borderRadius: 12,
  border: '1px solid transparent',
  background: 'transparent',
  fontSize: 16,
  fontWeight: 700,
  transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
};

type DetailRailPanelKey = 'buddy' | 'interaction' | 'role-bindings' | 'selected-run';

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

function getRuntimeTabGlyph(tabKey: string): string {
  if (tabKey === 'overview') {
    return '◎';
  }
  if (tabKey === 'sessions') {
    return '◫';
  }
  if (tabKey === 'tasks') {
    return '✓';
  }
  if (tabKey === 'context') {
    return '≣';
  }
  if (tabKey === 'timeline') {
    return '↯';
  }
  if (tabKey === 'artifacts') {
    return '◇';
  }
  if (tabKey === 'changes') {
    return '∆';
  }

  return '•';
}

function getDetailRailPanelLabel(panelKey: DetailRailPanelKey): string {
  if (panelKey === 'selected-run') {
    return '当前运行';
  }
  if (panelKey === 'interaction') {
    return '交互代理';
  }
  if (panelKey === 'buddy') {
    return 'Buddy';
  }

  return '角色绑定';
}

function RuntimeRailCounter({ label, value }: { label: string; value: string }) {
  return (
    <div
      title={label}
      style={{
        display: 'grid',
        placeItems: 'center',
        gap: 2,
        minHeight: 34,
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 74%, var(--bg))',
        color: 'var(--text-3)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  );
}

function ChromeBadge({ children }: { children: ReactNode }) {
  return <span style={STATUS_BADGE_STYLE}>{children}</span>;
}

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
        gap: 3,
        minWidth: 116,
        padding: '8px 10px',
        borderRadius: 12,
        border: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
        background: 'color-mix(in srgb, var(--surface) 76%, var(--bg))',
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.35 }}>{hint}</span>
    </div>
  );
}

function RailEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div style={INSET_PANEL_STYLE}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65 }}>{description}</span>
    </div>
  );
}

function RuntimeActivityRail({
  activeTabKey,
  filteredSessionCount,
  filteredSharedSessionCount,
  onActiveTabChange,
  selectedWorkspaceRunningCount,
  tabs,
}: {
  activeTabKey: string;
  filteredSessionCount: number;
  filteredSharedSessionCount: number;
  onActiveTabChange: (tabKey: string) => void;
  selectedWorkspaceRunningCount: number;
  tabs: Array<{ key: string; label: string }>;
}) {
  return (
    <aside
      aria-label="Team Runtime 活动栏"
      style={{
        ...PANEL_STYLE,
        gridTemplateRows: 'auto 1fr auto',
        width: 56,
        borderRight: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--bg-2) 94%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 88%, var(--bg)) 100%)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 10,
          padding: '12px 8px 10px',
          borderBottom: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
          justifyItems: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: 'grid',
            gap: 4,
            justifyItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 4 }}>
            {['#ef4444', '#f59e0b', '#22c55e'].map((color) => (
              <span
                key={color}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color,
                  opacity: 0.88,
                }}
              />
            ))}
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-3)',
            }}
          >
            RT
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', alignContent: 'start', gap: 8, padding: 8 }}>
        {tabs.map((tab) => {
          const isActive = tab.key === activeTabKey;
          return (
            <button
              key={tab.key}
              type="button"
              aria-label={`切换到${tab.label}`}
              title={tab.label}
              onClick={() => onActiveTabChange(tab.key)}
              style={{
                ...ACTIVITY_BUTTON_BASE_STYLE,
                color: isActive ? 'var(--accent)' : 'var(--text-3)',
                borderColor: isActive
                  ? 'color-mix(in srgb, var(--accent) 36%, transparent)'
                  : 'transparent',
                background: isActive
                  ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                  : 'transparent',
              }}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: -8,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    borderRadius: 999,
                    background: 'var(--accent)',
                  }}
                />
              ) : null}
              <span aria-hidden="true">{getRuntimeTabGlyph(tab.key)}</span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: 8,
          borderTop: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
        }}
      >
        <RuntimeRailCounter label="运行" value={String(selectedWorkspaceRunningCount)} />
        <RuntimeRailCounter label="共享" value={String(filteredSharedSessionCount)} />
        <RuntimeRailCounter label="会话" value={String(filteredSessionCount)} />
      </div>
    </aside>
  );
}

function RuntimeSidebar({
  busy,
  countsLine,
  filteredSessionShareCount,
  filteredSharedSessions,
  onLaunchWorkflowTemplate,
  onSelectSharedSession,
  onSelectWorkspaceKey,
  onSwitchToSessions,
  selectedSharedSessionId,
  selectedWorkspaceKey,
  selectedWorkspaceLabel,
  selectedWorkspaceRunningCount,
  workspaceOverviewLines,
  workspaceSummaries,
  workflowLaunch,
}: {
  busy: boolean;
  countsLine: string;
  filteredSessionShareCount: number;
  filteredSharedSessions: SharedSessionSummaryRecord[];
  onLaunchWorkflowTemplate: () => Promise<boolean>;
  onSelectSharedSession: (sessionId: string) => void;
  onSelectWorkspaceKey: (workspaceKey: string) => void;
  onSwitchToSessions: () => void;
  selectedSharedSessionId: string | null;
  selectedWorkspaceKey: string;
  selectedWorkspaceLabel: string;
  selectedWorkspaceRunningCount: number;
  workspaceOverviewLines: string[];
  workspaceSummaries: TeamWorkspaceCardSummary[];
  workflowLaunch: {
    nodeCount: number;
    templateDescription: string;
    templateId: string;
    templateName: string;
  } | null;
}) {
  return (
    <aside
      aria-label="Team Runtime 导航侧栏"
      style={{
        ...PANEL_STYLE,
        borderRight: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
      }}
    >
      <div style={PANEL_HEADER_STYLE}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
          }}
        >
          Team Runtime
        </span>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.03em' }}>工作台导航</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>{countsLine}</span>
      </div>

      <div style={{ display: 'grid', gap: 0, minHeight: 0, overflowY: 'auto' }}>
        <section style={PANEL_SECTION_STYLE}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ChromeBadge>工作区：{selectedWorkspaceLabel}</ChromeBadge>
            <ChromeBadge>{selectedWorkspaceRunningCount} 运行中</ChromeBadge>
            <ChromeBadge>{filteredSessionShareCount} 共享记录</ChromeBadge>
          </div>
        </section>

        <section
          style={{
            ...PANEL_SECTION_STYLE,
            borderTop: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Workspace navigator
            </span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>工作区切片</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
              这里承担 SpectrAI 左侧 Sidebar 的工作区入口角色，持续决定中间主面板的观察范围。
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
                    ...INSET_PANEL_STYLE,
                    gap: 6,
                    width: '100%',
                    textAlign: 'left',
                    borderColor: isActive
                      ? 'color-mix(in srgb, var(--accent) 38%, transparent)'
                      : 'color-mix(in srgb, var(--border) 72%, transparent)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--accent) 13%, var(--surface))'
                      : 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
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
                      style={{ fontSize: 10, color: isActive ? 'var(--accent)' : 'var(--text-3)' }}
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

        <section
          style={{
            ...PANEL_SECTION_STYLE,
            borderTop: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
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
                      onSwitchToSessions();
                    }}
                    style={{
                      ...INSET_PANEL_STYLE,
                      gap: 4,
                      width: '100%',
                      textAlign: 'left',
                      borderColor: isSelected
                        ? 'color-mix(in srgb, var(--accent) 40%, transparent)'
                        : 'color-mix(in srgb, var(--border) 72%, transparent)',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                        : 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
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

        <section
          style={{
            ...PANEL_SECTION_STYLE,
            borderTop: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Workflow handoff
            </span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>
              {workflowLaunch ? workflowLaunch.templateName : '暂无工作流接力'}
            </span>
          </div>
          {workflowLaunch ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={INSET_PANEL_STYLE}>
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
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
            </div>
          ) : (
            <RailEmptyState
              title="暂时没有模板接力"
              description="当前页面没有携带 workflow handoff 参数，但这块位置会持续保留给流程接力入口。"
            />
          )}
        </section>

        <section
          style={{
            ...PANEL_SECTION_STYLE,
            borderTop: '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
          }}
        >
          <div style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Workspace brief
            </span>
            <span style={{ fontSize: 15, fontWeight: 800 }}>当前摘要</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {workspaceOverviewLines.map((line) => (
              <div key={line} style={INSET_PANEL_STYLE}>
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.65 }}>
                  {line}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

function RuntimeMainPanel({
  activeTabKey,
  activeTabLabel,
  activeTabSummary,
  filteredSessionCount,
  filteredSessionShareCount,
  mainContent,
  onActiveTabChange,
  selectedWorkspaceLabel,
  tabs,
}: {
  activeTabKey: string;
  activeTabLabel: string;
  activeTabSummary: string;
  filteredSessionCount: number;
  filteredSessionShareCount: number;
  mainContent: ReactNode;
  onActiveTabChange: (tabKey: string) => void;
  selectedWorkspaceLabel: string;
  tabs: Array<{ key: string; label: string; summary: string }>;
}) {
  return (
    <main aria-label="Team Runtime 主面板" style={{ ...PANEL_STYLE, background: 'var(--bg)' }}>
      <div style={PANEL_HEADER_STYLE}>
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
            <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Main panel
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em' }}>
              {activeTabLabel}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
              {activeTabSummary}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ChromeBadge>视角：{selectedWorkspaceLabel}</ChromeBadge>
            <ChromeBadge>{filteredSessionCount} 会话</ChromeBadge>
            <ChromeBadge>{filteredSessionShareCount} 共享记录</ChromeBadge>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Team Runtime 主工作区切换"
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            paddingTop: 4,
          }}
        >
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
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 34,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: isActive
                    ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                    : '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                  background: isActive
                    ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                    : 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
                  color: isActive ? 'var(--text)' : 'var(--text-3)',
                  cursor: 'pointer',
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 14 }}>
                  {getRuntimeTabGlyph(tab.key)}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`team-runtime-panel-${activeTabKey}`}
        role="tabpanel"
        aria-labelledby={`team-runtime-tab-${activeTabKey}`}
        style={{
          minWidth: 0,
          minHeight: 0,
          overflow: 'auto',
          padding: 16,
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg) 94%, var(--surface)) 0%, color-mix(in srgb, var(--bg) 100%, var(--surface)) 100%)',
        }}
      >
        {mainContent}
      </div>
    </main>
  );
}

function RuntimeDetailRail({
  activeDetailPanel,
  buddyProjection,
  detailPanels,
  interactionDraft,
  onInteractionDraftChange,
  onRoleBindingChange,
  onSubmitInteractionDraft,
  roleBindingAgents,
  roleBindingCards,
  roleBindingError,
  roleBindingLoading,
  selectedRunSummary,
  setActiveDetailPanel,
}: {
  activeDetailPanel: DetailRailPanelKey;
  buddyProjection: TeamRuntimeShellFrameProps['buddyProjection'];
  detailPanels: DetailRailPanelKey[];
  interactionDraft: string;
  onInteractionDraftChange: (value: string) => void;
  onRoleBindingChange: (role: CoreRole, agentId: string) => void;
  onSubmitInteractionDraft: () => void;
  roleBindingAgents: ManagedAgentRecord[];
  roleBindingCards: TeamRuntimeShellFrameProps['roleBindingCards'];
  roleBindingError: string | null;
  roleBindingLoading: boolean;
  selectedRunSummary: TeamRuntimeSelectedRunSummary | null;
  setActiveDetailPanel: (key: DetailRailPanelKey) => void;
}) {
  return (
    <aside
      aria-label="Team Runtime 细节轨"
      style={{
        ...PANEL_STYLE,
        borderLeft: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
      }}
    >
      <div style={PANEL_HEADER_STYLE}>
        <span style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>
          Detail rail
        </span>
        <span style={{ fontSize: 15, fontWeight: 800 }}>细节轨</span>
        <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>
          右侧保持单一 detail host，通过切换不同面板持续盯住当前运行对象。
        </span>
      </div>

      <div style={{ display: 'grid', gap: 12, minHeight: 0, overflow: 'auto', padding: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {detailPanels.map((panelKey) => {
            const isActive = panelKey === activeDetailPanel;
            const label = getDetailRailPanelLabel(panelKey);

            return (
              <button
                key={panelKey}
                type="button"
                onClick={() => setActiveDetailPanel(panelKey)}
                aria-pressed={isActive}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 32,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: isActive
                    ? '1px solid color-mix(in srgb, var(--accent) 40%, transparent)'
                    : '1px solid color-mix(in srgb, var(--border) 72%, transparent)',
                  background: isActive
                    ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))'
                    : 'color-mix(in srgb, var(--surface) 78%, var(--bg))',
                  color: isActive ? 'var(--text)' : 'var(--text-3)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeDetailPanel === 'selected-run' ? (
          <section style={{ display: 'grid', gap: 12 }}>
            <TeamSectionHeader
              eyebrow="Selected run"
              title="当前共享运行"
              description="默认聚焦当前选中的共享会话，让运行摘要不再淹没在主内容里。"
            />
            {selectedRunSummary ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={INSET_PANEL_STYLE}>
                  <span style={{ fontSize: 16, fontWeight: 800 }}>{selectedRunSummary.title}</span>
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
                    <div key={item.label} style={INSET_PANEL_STYLE}>
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
        ) : null}

        {activeDetailPanel === 'interaction' ? (
          <section style={{ display: 'grid', gap: 12 }}>
            <TeamSectionHeader
              eyebrow="Interaction agent"
              title="统一交互代理"
              description="保持常驻输入入口，让需求改写在 Detail Rail 中持续可达。"
            />
            <textarea
              aria-label="interaction-agent 输入区"
              rows={4}
              value={interactionDraft}
              onChange={(event) => onInteractionDraftChange(event.target.value)}
              placeholder="先把人类意图写在这里，后续会由 interaction-agent 做需求改写…"
            />
            <button
              type="button"
              className="primary-button"
              onClick={() => void onSubmitInteractionDraft()}
              disabled={!interactionDraft.trim()}
            >
              交由 interaction-agent
            </button>
          </section>
        ) : null}

        {activeDetailPanel === 'buddy' ? (
          <TeamRuntimeBuddy
            activeAgentCount={buddyProjection.activeAgentCount}
            blockedCount={buddyProjection.blockedCount}
            pendingApprovalCount={buddyProjection.pendingApprovalCount}
            pendingQuestionCount={buddyProjection.pendingQuestionCount}
            runningCount={buddyProjection.runningCount}
            sessionTitle={buddyProjection.sessionTitle}
            workspaceLabel={buddyProjection.workspaceLabel}
          />
        ) : null}

        {activeDetailPanel === 'role-bindings' ? (
          <TeamRuntimeRoleBindingPanel
            agents={roleBindingAgents}
            cards={roleBindingCards}
            error={roleBindingError}
            loading={roleBindingLoading}
            onChange={onRoleBindingChange}
          />
        ) : null}
      </div>
    </aside>
  );
}

function RuntimeStatusBar({
  activeTabLabel,
  filteredSharedSessions,
  isSingleColumn,
  isTwoColumn,
  selectedRunSummary,
  selectedWorkspaceLabel,
}: {
  activeTabLabel: string;
  filteredSharedSessions: SharedSessionSummaryRecord[];
  isSingleColumn: boolean;
  isTwoColumn: boolean;
  selectedRunSummary: TeamRuntimeSelectedRunSummary | null;
  selectedWorkspaceLabel: string;
}) {
  const layoutModeLabel = isSingleColumn ? '单栏' : isTwoColumn ? '双栏' : '三栏';

  return (
    <footer
      className="content-card"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '10px 14px',
        borderTop: '1px solid color-mix(in srgb, var(--border) 76%, transparent)',
        borderRadius: 0,
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--surface) 88%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 82%, var(--bg)) 100%)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          `工作区 ${selectedWorkspaceLabel}`,
          `当前区块 ${activeTabLabel}`,
          `布局 ${layoutModeLabel}`,
          `${filteredSharedSessions.length} 个共享运行`,
        ].map((item) => (
          <ChromeBadge key={item}>{item}</ChromeBadge>
        ))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {selectedRunSummary ? `当前焦点：${selectedRunSummary.title}` : '当前尚未选中共享运行'}
      </span>
    </footer>
  );
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
  const [activeDetailPanel, setActiveDetailPanel] = useState<DetailRailPanelKey>('selected-run');
  const detailPanels: DetailRailPanelKey[] = [
    'selected-run',
    'interaction',
    'buddy',
    'role-bindings',
  ];
  const countsLine = `${filteredSessionCount} 个会话 · ${filteredSharedSessions.length} 个共享运行 · ${filteredSessionShareCount} 条共享记录`;

  return (
    <div className="page-root">
      <div className="page-content">
        <div
          style={{
            maxWidth: 'min(1980px, 100%)',
            margin: '0 auto',
            padding: '10px 10px 14px',
            display: 'grid',
            gap: 10,
          }}
        >
          <section style={APP_FRAME_STYLE}>
            <header
              style={{
                display: 'grid',
                gap: 10,
                padding: '12px 16px',
                borderBottom: '1px solid color-mix(in srgb, var(--border) 78%, transparent)',
                background:
                  'linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, var(--bg)) 0%, color-mix(in srgb, var(--surface) 88%, var(--bg)) 100%)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 14,
                    alignItems: 'center',
                    minWidth: 0,
                    flexWrap: 'wrap',
                  }}
                >
                  <div aria-hidden="true" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {['#ef4444', '#f59e0b', '#22c55e'].map((color) => (
                      <span
                        key={color}
                        style={{ width: 10, height: 10, borderRadius: '50%', background: color }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                          color: 'var(--accent)',
                        }}
                      >
                        OpenAWork / Team Runtime
                      </span>
                      <ChromeBadge>工作区：{selectedWorkspaceLabel}</ChromeBadge>
                      <ChromeBadge>{selectedWorkspaceRunningCount} 运行中</ChromeBadge>
                    </div>
                    <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.03em' }}>
                      团队运行工作台
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
                      {countsLine} · 当前焦点：{selectedRunSummary?.title ?? '未选中共享运行'}
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
                    ...INSET_PANEL_STYLE,
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
                    ...INSET_PANEL_STYLE,
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
                minHeight: 0,
                flex: 1,
                gridTemplateColumns: isSingleColumn
                  ? 'minmax(0, 1fr)'
                  : isTwoColumn
                    ? '56px minmax(260px, 300px) minmax(0, 1fr)'
                    : '56px minmax(280px, 320px) minmax(0, 1fr) minmax(320px, 360px)',
                gridAutoRows: isSingleColumn
                  ? 'auto'
                  : isTwoColumn
                    ? 'minmax(0, 1fr) auto'
                    : 'minmax(0, 1fr)',
              }}
            >
              {!isSingleColumn ? (
                <div style={{ gridRow: isTwoColumn ? '1 / span 2' : undefined }}>
                  <RuntimeActivityRail
                    activeTabKey={activeTabKey}
                    filteredSessionCount={filteredSessionCount}
                    filteredSharedSessionCount={filteredSharedSessions.length}
                    onActiveTabChange={onActiveTabChange}
                    selectedWorkspaceRunningCount={selectedWorkspaceRunningCount}
                    tabs={tabs}
                  />
                </div>
              ) : null}

              <div
                style={{
                  minHeight: 0,
                  borderRight: isSingleColumn ? undefined : '1px solid transparent',
                }}
              >
                <RuntimeSidebar
                  busy={busy}
                  countsLine={countsLine}
                  filteredSessionShareCount={filteredSessionShareCount}
                  filteredSharedSessions={filteredSharedSessions}
                  onLaunchWorkflowTemplate={onLaunchWorkflowTemplate}
                  onSelectSharedSession={onSelectSharedSession}
                  onSelectWorkspaceKey={onSelectWorkspaceKey}
                  onSwitchToSessions={() => onActiveTabChange('sessions')}
                  selectedSharedSessionId={selectedSharedSessionId}
                  selectedWorkspaceKey={selectedWorkspaceKey}
                  selectedWorkspaceLabel={selectedWorkspaceLabel}
                  selectedWorkspaceRunningCount={selectedWorkspaceRunningCount}
                  workspaceOverviewLines={workspaceOverviewLines}
                  workspaceSummaries={workspaceSummaries}
                  workflowLaunch={workflowLaunch}
                />
              </div>

              <div style={{ minHeight: 0 }}>
                <RuntimeMainPanel
                  activeTabKey={activeTabKey}
                  activeTabLabel={activeTabLabel}
                  activeTabSummary={activeTabSummary}
                  filteredSessionCount={filteredSessionCount}
                  filteredSessionShareCount={filteredSessionShareCount}
                  mainContent={mainContent}
                  onActiveTabChange={onActiveTabChange}
                  selectedWorkspaceLabel={selectedWorkspaceLabel}
                  tabs={tabs}
                />
              </div>

              {isSingleColumn ? (
                <div style={{ minHeight: 0 }}>
                  <RuntimeDetailRail
                    activeDetailPanel={activeDetailPanel}
                    buddyProjection={buddyProjection}
                    detailPanels={detailPanels}
                    interactionDraft={interactionDraft}
                    onInteractionDraftChange={onInteractionDraftChange}
                    onRoleBindingChange={onRoleBindingChange}
                    onSubmitInteractionDraft={onSubmitInteractionDraft}
                    roleBindingAgents={roleBindingAgents}
                    roleBindingCards={roleBindingCards}
                    roleBindingError={roleBindingError}
                    roleBindingLoading={roleBindingLoading}
                    selectedRunSummary={selectedRunSummary}
                    setActiveDetailPanel={setActiveDetailPanel}
                  />
                </div>
              ) : isTwoColumn ? (
                <div style={{ gridColumn: '2 / 4', minHeight: 0 }}>
                  <RuntimeDetailRail
                    activeDetailPanel={activeDetailPanel}
                    buddyProjection={buddyProjection}
                    detailPanels={detailPanels}
                    interactionDraft={interactionDraft}
                    onInteractionDraftChange={onInteractionDraftChange}
                    onRoleBindingChange={onRoleBindingChange}
                    onSubmitInteractionDraft={onSubmitInteractionDraft}
                    roleBindingAgents={roleBindingAgents}
                    roleBindingCards={roleBindingCards}
                    roleBindingError={roleBindingError}
                    roleBindingLoading={roleBindingLoading}
                    selectedRunSummary={selectedRunSummary}
                    setActiveDetailPanel={setActiveDetailPanel}
                  />
                </div>
              ) : (
                <div style={{ minHeight: 0 }}>
                  <RuntimeDetailRail
                    activeDetailPanel={activeDetailPanel}
                    buddyProjection={buddyProjection}
                    detailPanels={detailPanels}
                    interactionDraft={interactionDraft}
                    onInteractionDraftChange={onInteractionDraftChange}
                    onRoleBindingChange={onRoleBindingChange}
                    onSubmitInteractionDraft={onSubmitInteractionDraft}
                    roleBindingAgents={roleBindingAgents}
                    roleBindingCards={roleBindingCards}
                    roleBindingError={roleBindingError}
                    roleBindingLoading={roleBindingLoading}
                    selectedRunSummary={selectedRunSummary}
                    setActiveDetailPanel={setActiveDetailPanel}
                  />
                </div>
              )}
            </section>

            <RuntimeStatusBar
              activeTabLabel={activeTabLabel}
              filteredSharedSessions={filteredSharedSessions}
              isSingleColumn={isSingleColumn}
              isTwoColumn={isTwoColumn}
              selectedRunSummary={selectedRunSummary}
              selectedWorkspaceLabel={selectedWorkspaceLabel}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
