import { useEffect, useState, type CSSProperties } from 'react';
import {
  PlanPanel,
  ToolCallCard,
  AgentDAGGraph,
  AgentVizPanel,
  MCPServerList,
} from '@openAwork/shared-ui';
import type {
  MCPServerStatus,
  AttachmentItem,
  HistoricalPlan,
  DAGNodeInfo,
  DAGEdgeInfo,
  AgentVizEvent,
  ToolCallCardProps,
  PlanTask,
} from '@openAwork/shared-ui';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import type { UpstreamStreamSummary } from '@openAwork/shared';
import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import { TaskToolInline } from '../../../components/chat/tool-call/display/task-tool-inline.js';
import SkillSettingsPanel from '../../../components/chat/misc/SkillSettingsPanel.js';
import {
  buildUpstreamSummaryGroupContextText,
  ChatHistoryTabContent,
  ChatOverviewTabContent,
  groupUpstreamSummariesByRequest,
  formatUpstreamSummaryGroupHeadline,
} from './right-panel-sections.js';
import { SnapshotTimelinePanel } from '../../../components/chat/snapshot/SnapshotTimelinePanel.js';
import type { SessionTerminalView } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import { deleteSessionTerminal } from '../../../components/conversation-runtime/terminals/terminals-api.js';
import type { SessionTerminalStatus } from '@openAwork/shared';
import { SubSessionDetailPanel } from './sub-session-detail-panel.js';
import { BookmarksPanel } from '../../../components/chat/misc/bookmarks-panel.js';
import {
  RIGHT_PANEL_TABS,
  RIGHT_PANEL_TAB_META,
  renderRightPanelTabIcon,
} from './right-panel-tabs.js';
import type { RightPanelTabId } from './right-panel-tabs.js';
import { FocusedRequestBanner } from './focused-request-banner.js';
import { RequestScopeEffectNote } from './request-scope-effect-note.js';
import type {
  ChatMessage,
  WorkspaceFileMentionItem,
} from '../../../components/conversation-runtime/messages/support.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import type {
  TaskToolRuntimeLookup,
  TaskToolRuntimeSnapshot,
} from '../conversation/render/task-tool-runtime.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';

const EMPTY_KILL_SET = new Set<string>();

const TERMINAL_STATUS_LABELS: Record<SessionTerminalStatus, string> = {
  running: '运行中',
  idle: '空闲',
  exited: '已退出',
  aborted: '已取消',
  timeout: '超时',
  spawn_error: '启动失败',
  killed: '已终止',
  stale: '已失效',
  'tmux-spawned': 'tmux 运行中',
  'tmux-killed': 'tmux 已关闭',
};

const TERMINAL_STATUS_COLORS: Record<SessionTerminalStatus, string> = {
  running: 'var(--success)',
  idle: 'var(--fg-muted)',
  exited: 'var(--fg-muted)',
  aborted: 'var(--warning)',
  timeout: 'var(--warning)',
  spawn_error: 'var(--danger)',
  killed: 'var(--danger)',
  stale: 'var(--fg-muted)',
  'tmux-spawned': 'var(--aux)',
  'tmux-killed': 'var(--fg-muted)',
};

const ACTIVE_TERMINAL_STATUSES: ReadonlySet<SessionTerminalStatus> = new Set([
  'running',
  'tmux-spawned',
]);

interface CompactionItem {
  id: string;
  summary: string;
  trigger: 'manual' | 'automatic';
  occurredAt: number;
}

interface UpstreamSummaryItem {
  id: string;
  occurredAt: number;
  requestId?: string;
  runId?: string;
  summary: UpstreamStreamSummary;
}

type HierarchicalSessionTask = SessionTask & {
  completedSubtaskCount?: number;
  depth?: number;
  readySubtaskCount?: number;
  subtaskCount?: number;
  unmetDependencyCount?: number;
};

interface ToolCallCardEntry {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  requestId?: string;
  output?: unknown;
  isError: boolean;
  resumedAfterApproval?: boolean;
  status?: ToolCallCardProps['status'];
}

export interface ChatRightPanelProps {
  rightOpen: boolean;
  rightTab: RightPanelTabId;
  setRightTab: (tab: RightPanelTabId) => void;
  selectedChildSessionId: string | null;
  currentUserEmail: string | undefined;
  gatewayUrl: string;
  token: string | null | undefined;
  navigate: (path: string) => void;
  openChildSessionInspector: (sessionId: string) => void;
  taskToolRuntimeLookup: TaskToolRuntimeLookup | undefined;
  toolCallCards: ToolCallCardEntry[];
  toolFilter: string;
  setToolFilter: (f: 'all' | 'lsp' | 'file' | 'network' | 'other') => void;
  compactions: CompactionItem[];
  upstreamSummaries: UpstreamSummaryItem[];
  pendingPermissions: PendingPermissionRequest[];
  resolveInlinePermissionActions?: (requestId: string) =>
    | {
        errorMessage?: string;
        helperMessage?: string;
        items: Array<{
          danger?: boolean;
          disabled?: boolean;
          hint?: string;
          id: string;
          label: string;
          onClick: () => void;
          primary?: boolean;
        }>;
        pendingLabel?: string;
      }
    | undefined;
  planTasks: PlanTask[];
  planHistory: HistoricalPlan[];
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  childSessions: Session[];
  pendingQuestions: Array<unknown>;
  dagNodes: DAGNodeInfo[];
  dagEdges: DAGEdgeInfo[];
  agentEvents: AgentVizEvent[];
  mcpServers: MCPServerStatus[];
  sharedUiThemeVars: CSSProperties;
  resolveTaskToolRuntimeSnapshot: (
    input: Record<string, unknown>,
    output: unknown,
    lookup: TaskToolRuntimeLookup | undefined,
  ) => TaskToolRuntimeSnapshot | undefined;
  onCompactSession: () => void;
  onOpenRecoveryStrategy: () => void;
  providerCatalog: Map<string, { id: string; name: string; type: string }>;
  attachmentItems: AttachmentItem[];
  artifactsWorkspaceHref: string | null;
  contextUsageSnapshot: ChatContextUsageSnapshot | null;
  contentArtifactCount: number;
  contentArtifactCountStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentSessionId: string | null;
  dialogueMode: DialogueMode;
  effectiveWorkingDirectory: string | null;
  messages: ChatMessage[];
  sessionStateStatus: SessionStateStatus | null;
  workspaceFileItems: WorkspaceFileMentionItem[];
  yoloMode: boolean;
  sessionTerminals?: SessionTerminalView[];
  sessionTerminalsRunningCount?: number;
  sessionTerminalsLoading?: boolean;
  sessionTerminalsError?: string | null;
  sessionTerminalsPendingKillIds?: Set<string>;
  onKillTerminal?: (terminalId: string) => Promise<void>;
  onReloadTerminals?: () => void;
  /**
   * Bridge from `ChatPage`: bookmark navigate / future message-jump
   * surfaces use this to expand pagination so a target message that's
   * currently outside the rendered window actually appears in the DOM
   * before we try to scroll to it.
   */
  ensureMessageVisible?: (messageId: string) => Promise<void> | void;
}

export function ChatRightPanel(props: ChatRightPanelProps) {
  const {
    rightOpen,
    rightTab,
    setRightTab,
    selectedChildSessionId,
    currentUserEmail,
    gatewayUrl,
    token,
    navigate,
    openChildSessionInspector,
    taskToolRuntimeLookup,
    toolCallCards,
    toolFilter,
    setToolFilter,
    compactions,
    upstreamSummaries,
    pendingPermissions,
    resolveInlinePermissionActions,
    planTasks,
    planHistory,
    sessionTodos,
    sessionTasks,
    childSessions,
    pendingQuestions,
    dagNodes,
    dagEdges,
    agentEvents,
    mcpServers,
    sharedUiThemeVars,
    resolveTaskToolRuntimeSnapshot,
    onCompactSession,
    onOpenRecoveryStrategy,
    providerCatalog,
    attachmentItems,
    artifactsWorkspaceHref,
    contextUsageSnapshot,
    contentArtifactCount,
    contentArtifactCountStatus,
    currentSessionId,
    dialogueMode,
    effectiveWorkingDirectory,
    messages,
    sessionStateStatus,
    workspaceFileItems,
    yoloMode,
  } = props;

  const rightPanelWidth = rightOpen
    ? rightTab === 'agent'
      ? 'clamp(360px, 40vw, 520px)'
      : 'clamp(300px, 30vw, 380px)'
    : 0;
  const rightPanelMaxWidth = rightOpen ? 'calc(100vw - 88px)' : 0;
  const activeRightTabMeta = RIGHT_PANEL_TAB_META[rightTab ?? 'overview'];
  const [focusedUpstreamGroupKey, setFocusedUpstreamGroupKey] = useState<string | null>(null);
  const focusedRequestId = focusedUpstreamGroupKey?.startsWith('request:')
    ? focusedUpstreamGroupKey.slice('request:'.length)
    : null;
  const clearFocusedRequest = () => setFocusedUpstreamGroupKey(null);
  const visibleAgentEvents = focusedRequestId
    ? agentEvents.filter((event) => event.requestId === focusedRequestId)
    : agentEvents;
  const focusedUpstreamGroup = focusedRequestId
    ? (groupUpstreamSummariesByRequest(upstreamSummaries).find(
        (candidate) => candidate.key === `request:${focusedRequestId}`,
      ) ?? null)
    : null;
  const focusedRequestToolCalls = focusedRequestId
    ? toolCallCards.filter((toolCall) => toolCall.requestId === focusedRequestId)
    : toolCallCards;
  const focusedRequestSummary = focusedUpstreamGroup
    ? formatUpstreamSummaryGroupHeadline(focusedUpstreamGroup)
    : null;
  const handleCopyFocusedRequestSummary = () => {
    if (!focusedRequestId) return;
    const summaryText = focusedUpstreamGroup
      ? buildUpstreamSummaryGroupContextText(focusedUpstreamGroup)
      : `请求 ${focusedRequestId}`;
    void copyTextToClipboard(summaryText);
  };

  return (
    <div
      aria-hidden={!rightOpen}
      style={{
        width: rightPanelWidth,
        maxWidth: rightPanelMaxWidth,
        flexShrink: 0,
        overflow: 'hidden',
        borderLeft: rightOpen ? '1px solid var(--border-default)' : 'none',
        transition: 'width 200ms ease',
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
      }}
    >
      {rightOpen ? (
        <div
          style={{
            width: rightPanelWidth,
            maxWidth: rightPanelMaxWidth,
            display: 'flex',
            flexDirection: 'row',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            background: 'var(--bg-overlay)',
          }}
        >
          {/* ─── Compact nav rail ─── */}
          <div
            data-testid="chat-right-nav-rail"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              width: 40,
              minWidth: 40,
              padding: '6px 2px',
              borderRight: '1px solid var(--border-subtle)',
              flexShrink: 0,
              background: 'var(--bg-overlay)',
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            <div
              role="tablist"
              aria-label="右侧面板切换"
              aria-orientation="vertical"
              style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}
            >
              {RIGHT_PANEL_TABS.map((tab) => {
                const isActive = rightTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-label={tab.label}
                    aria-selected={isActive}
                    aria-controls={`chat-right-panel-${tab.id}`}
                    id={`chat-right-tab-${tab.id}`}
                    tabIndex={isActive ? 0 : -1}
                    title={tab.label}
                    onClick={() => setRightTab(tab.id)}
                    style={{
                      width: 34,
                      height: 30,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 7,
                      border: 'none',
                      background: isActive ? 'var(--accent)' : 'transparent',
                      color: isActive ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
                      cursor: 'pointer',
                      transition: 'background 100ms ease, color 100ms ease, transform 80ms ease',
                      transform: isActive ? 'scale(1)' : 'scale(0.92)',
                      opacity: isActive ? 1 : 0.75,
                      margin: '0 auto',
                      padding: 0,
                      fontSize: 0,
                    }}
                  >
                    {renderRightPanelTabIcon(tab.id)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─── Panel content ─── */}
          <div
            role="tabpanel"
            id={`chat-right-panel-${rightTab}`}
            aria-labelledby={`chat-right-tab-${rightTab}`}
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-overlay)',
            }}
          >
            {rightTab === 'agent' && (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  padding: '10px 10px 12px',
                  boxSizing: 'border-box',
                }}
              >
                <SubSessionDetailPanel
                  childSessionId={selectedChildSessionId}
                  currentUserEmail={currentUserEmail ?? ''}
                  gatewayUrl={gatewayUrl}
                  onOpenFullSession={(nextSessionId) => {
                    void navigate(`/chat/${nextSessionId}`);
                  }}
                  parentTaskRuntimeLookup={taskToolRuntimeLookup}
                  providerCatalog={providerCatalog}
                  token={token ?? null}
                />
              </div>
            )}
            {rightTab !== 'agent' && (
              <>
                <div
                  data-testid={`chat-right-panel-header-${rightTab}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border-subtle)',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--fg-strong)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {activeRightTabMeta.title}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      color: 'var(--fg-subtle)',
                      maxWidth: 140,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={activeRightTabMeta.description}
                  >
                    {activeRightTabMeta.description}
                  </span>
                </div>
                {focusedRequestId && (
                  <FocusedRequestBanner
                    requestId={focusedRequestId}
                    summary={focusedRequestSummary ?? undefined}
                    onCopy={handleCopyFocusedRequestSummary}
                    onClear={clearFocusedRequest}
                  />
                )}
                <div
                  data-testid={`chat-right-panel-body-${rightTab}`}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '6px 8px 10px',
                    scrollbarGutter: 'stable',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {rightTab === 'plan' && <PlanPanel tasks={planTasks} />}
                  {rightTab === 'tools' &&
                    renderToolsPanel(
                      toolCallCards,
                      toolFilter,
                      setToolFilter,
                      focusedRequestId,
                      focusedRequestToolCalls.length,
                      focusedRequestSummary,
                      openChildSessionInspector,
                      taskToolRuntimeLookup,
                      resolveTaskToolRuntimeSnapshot,
                      selectedChildSessionId,
                    )}
                  {rightTab === 'bookmarks' && (
                    <BookmarksPanel
                      sessionId={currentSessionId ?? ''}
                      onNavigateToMessage={(messageId) => {
                        // Scroll to the message in the chat. If it's
                        // not in the rendered window (paged-out), let
                        // the host expand pagination first, then poll
                        // briefly for the node to land in the DOM.
                        const flash = (target: HTMLElement) => {
                          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          target.setAttribute('data-search-flash', 'true');
                          setTimeout(() => {
                            target.removeAttribute('data-search-flash');
                          }, 1500);
                        };
                        const tryFocus = () => {
                          const scrollRegion = document.querySelector(
                            '[data-testid="chat-scroll-region"]',
                          );
                          if (!scrollRegion) return null;
                          return scrollRegion.querySelector<HTMLElement>(
                            `[data-message-id="${messageId}"]`,
                          );
                        };
                        const initial = tryFocus();
                        if (initial) {
                          flash(initial);
                          return;
                        }
                        if (!props.ensureMessageVisible) return;
                        void Promise.resolve(props.ensureMessageVisible(messageId)).then(
                          async () => {
                            const deadlineMs = performance.now() + 1500;
                            let target: HTMLElement | null = null;
                            while (!target && performance.now() < deadlineMs) {
                              await new Promise<void>((resolve) =>
                                requestAnimationFrame(() => resolve()),
                              );
                              target = tryFocus();
                            }
                            if (target) flash(target);
                          },
                        );
                      }}
                    />
                  )}
                  {rightTab === 'viz' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {focusedRequestId && (
                        <RequestScopeEffectNote
                          title="当前可视化已聚焦"
                          requestId={focusedRequestId}
                          visibleCount={visibleAgentEvents.length}
                          totalCount={agentEvents.length}
                          summary={focusedRequestSummary ?? undefined}
                          description="下方事件时间线仅显示当前 request 的相关事件。"
                        />
                      )}
                      <div style={sharedUiThemeVars}>
                        <AgentDAGGraph nodes={dagNodes} edges={dagEdges} />
                      </div>
                      <div style={sharedUiThemeVars}>
                        <AgentVizPanel events={visibleAgentEvents} title="Agent 活动" />
                      </div>
                    </div>
                  )}
                  {rightTab === 'history' && (
                    <ChatHistoryTabContent
                      childSessions={childSessions}
                      compactions={compactions}
                      upstreamSummaries={upstreamSummaries}
                      focusedUpstreamGroupKey={focusedUpstreamGroupKey}
                      onSelectUpstreamGroup={setFocusedUpstreamGroupKey}
                      pendingPermissions={pendingPermissions}
                      resolveInlinePermissionActions={resolveInlinePermissionActions}
                      planHistory={planHistory}
                      sessionTodos={sessionTodos}
                      sessionTasks={sessionTasks}
                      onOpenSession={(nextSessionId) => {
                        void navigate(`/chat/${nextSessionId}`);
                      }}
                      sharedUiThemeVars={sharedUiThemeVars}
                    />
                  )}
                  {rightTab === 'overview' && (
                    <ChatOverviewTabContent
                      attachmentItems={attachmentItems}
                      artifactsWorkspaceHref={artifactsWorkspaceHref}
                      childSessions={childSessions}
                      compactions={compactions}
                      upstreamSummaries={upstreamSummaries}
                      focusedUpstreamGroupKey={focusedUpstreamGroupKey}
                      contextUsageSnapshot={contextUsageSnapshot}
                      contentArtifactCount={contentArtifactCount}
                      contentArtifactCountStatus={contentArtifactCountStatus}
                      currentSessionId={currentSessionId}
                      dialogueMode={dialogueMode}
                      effectiveWorkingDirectory={effectiveWorkingDirectory}
                      messages={messages}
                      pendingPermissions={pendingPermissions}
                      pendingQuestionsCount={pendingQuestions.length}
                      sessionStateStatus={sessionStateStatus ?? null}
                      sessionTodos={sessionTodos}
                      sessionTasks={sessionTasks}
                      workspaceFileItems={workspaceFileItems}
                      yoloMode={yoloMode}
                      onCompactSession={onCompactSession}
                      onOpenRecoveryStrategy={onOpenRecoveryStrategy}
                    />
                  )}
                  {rightTab === 'terminals' && (
                    <RightPanelTerminalsContent
                      terminals={props.sessionTerminals ?? []}
                      runningCount={props.sessionTerminalsRunningCount ?? 0}
                      loading={props.sessionTerminalsLoading ?? false}
                      error={props.sessionTerminalsError ?? null}
                      pendingKillIds={props.sessionTerminalsPendingKillIds ?? EMPTY_KILL_SET}
                      onKill={props.onKillTerminal}
                      onReload={props.onReloadTerminals}
                      gatewayUrl={gatewayUrl}
                      token={token}
                      sessionId={currentSessionId}
                    />
                  )}
                  {rightTab === 'mcp' && (
                    <div style={sharedUiThemeVars}>
                      <MCPServerList servers={mcpServers} />
                    </div>
                  )}
                  {rightTab === 'skills' && (
                    <SkillSettingsPanel
                      sessionId={currentSessionId}
                      workspacePath={effectiveWorkingDirectory}
                      accessToken={token ?? null}
                      gatewayUrl={gatewayUrl}
                    />
                  )}
                  {rightTab === 'snapshots' && currentSessionId && (
                    <SnapshotTimelinePanel sessionId={currentSessionId} gatewayUrl={gatewayUrl} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RightPanelTerminalsContent({
  terminals,
  runningCount,
  loading,
  error,
  pendingKillIds,
  onKill,
  onReload,
  gatewayUrl,
  token,
  sessionId,
}: {
  terminals: SessionTerminalView[];
  runningCount: number;
  loading: boolean;
  error: string | null;
  pendingKillIds: Set<string>;
  onKill?: (terminalId: string) => Promise<void>;
  onReload?: () => void;
  gatewayUrl: string;
  token: string | null | undefined;
  sessionId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const active = terminals.filter((t) => ACTIVE_TERMINAL_STATUSES.has(t.status));
  const closed = terminals.filter((t) => !ACTIVE_TERMINAL_STATUSES.has(t.status));
  const sorted = [...active, ...closed];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {runningCount > 0 ? `${runningCount} 个运行中` : '无运行中终端'}
          {' / '}共 {terminals.length} 条
        </span>
        {onReload && (
          <button
            type="button"
            onClick={onReload}
            style={{
              fontSize: 10,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--fg-default)',
              padding: '2px 8px',
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            刷新
          </button>
        )}
        {loading && <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>加载中…</span>}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: 'var(--danger)', padding: '4px 0' }}>{error}</div>
      )}
      {sorted.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '6px 2px' }}>
          当前会话还没有跑过终端命令。
        </div>
      ) : (
        sorted.map((terminal) => {
          const isActive = ACTIVE_TERMINAL_STATUSES.has(terminal.status);
          const isExpanded = expandedId === terminal.terminalId;
          const isPendingKill = pendingKillIds.has(terminal.terminalId);
          const statusColor = TERMINAL_STATUS_COLORS[terminal.status] ?? 'var(--fg-muted)';
          const statusLabel = TERMINAL_STATUS_LABELS[terminal.status] ?? terminal.status;
          return (
            <div
              key={terminal.terminalId}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '8px 10px',
                background: isActive
                  ? 'color-mix(in oklch, var(--bg-overlay) 94%, var(--success) 6%)'
                  : 'var(--bg-overlay)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '1px 7px',
                    borderRadius: 9999,
                    fontSize: 10,
                    fontWeight: 600,
                    color: statusColor,
                    background: `${statusColor}1a`,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: statusColor,
                      animation: isActive ? 'pulse 1.4s ease-in-out infinite' : undefined,
                    }}
                  />
                  {statusLabel}
                </span>
                <code
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    fontSize: 11,
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--fg-strong)',
                  }}
                  title={terminal.command}
                >
                  {terminal.command}
                </code>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : terminal.terminalId)}
                  style={{
                    fontSize: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--fg-default)',
                    padding: '2px 7px',
                    borderRadius: 5,
                    cursor: 'pointer',
                  }}
                >
                  {isExpanded ? '收起' : '详情'}
                </button>
                {isActive && onKill ? (
                  <button
                    type="button"
                    disabled={isPendingKill}
                    onClick={() => void onKill(terminal.terminalId)}
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)',
                      background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
                      color: 'var(--danger)',
                      padding: '2px 7px',
                      borderRadius: 5,
                      cursor: isPendingKill ? 'wait' : 'pointer',
                      opacity: isPendingKill ? 0.6 : 1,
                    }}
                  >
                    {isPendingKill ? '终止中…' : '终止'}
                  </button>
                ) : !isActive && sessionId && token ? (
                  <button
                    type="button"
                    onClick={() => {
                      void deleteSessionTerminal({
                        gatewayUrl,
                        sessionId,
                        terminalId: terminal.terminalId,
                        token,
                      }).then(() => onReload?.());
                    }}
                    style={{
                      fontSize: 10,
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      color: 'var(--fg-muted)',
                      padding: '2px 7px',
                      borderRadius: 5,
                      cursor: 'pointer',
                    }}
                  >
                    清理
                  </button>
                ) : null}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                }}
              >
                <span>{terminal.toolName}</span>
                <span
                  style={{
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={terminal.cwd}
                >
                  {terminal.cwd}
                </span>
                {terminal.exitCode !== undefined && (
                  <span
                    style={{
                      color: terminal.exitCode === 0 ? 'var(--success)' : 'var(--danger)',
                    }}
                  >
                    exit {terminal.exitCode}
                  </span>
                )}
              </div>
              {isExpanded && (
                <pre
                  style={{
                    margin: 0,
                    padding: '6px 8px',
                    background: 'color-mix(in srgb, var(--bg-overlay) 60%, #000 30%)',
                    color: '#dcdcdc',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    maxHeight: 220,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'var(--font-mono, monospace)',
                    fontSize: 10.5,
                    lineHeight: 1.45,
                  }}
                >
                  {terminal.outputTail || '(无输出)'}
                </pre>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function renderToolsPanel(
  toolCallCards: ToolCallCardEntry[],
  toolFilter: string,
  setToolFilter: (f: 'all' | 'lsp' | 'file' | 'network' | 'other') => void,
  focusedRequestId: string | null,
  focusedToolCount: number,
  focusedRequestSummary: string | null,
  openChildSessionInspector: (sessionId: string) => void,
  taskToolRuntimeLookup: TaskToolRuntimeLookup | undefined,
  resolveTaskToolRuntimeSnapshot: (
    input: Record<string, unknown>,
    output: unknown,
    lookup: TaskToolRuntimeLookup | undefined,
  ) => TaskToolRuntimeSnapshot | undefined,
  selectedChildSessionId: string | null,
) {
  const lspPrefixes = ['lsp_', 'ast_grep'];
  const filePrefixes = ['read', 'write', 'edit', 'glob', 'multi_edit', 'workspace_'];
  const networkPrefixes = ['webfetch', 'websearch', 'google_search', 'playwright', 'mcp_'];
  const isInFocusedScope = Boolean(focusedRequestId);
  const filtered = toolCallCards.filter((tc) => {
    if (focusedRequestId && tc.requestId !== focusedRequestId) return false;
    if (toolFilter === 'all') return true;
    const n = tc.toolName.toLowerCase();
    if (toolFilter === 'lsp') return lspPrefixes.some((p) => n.startsWith(p));
    if (toolFilter === 'file') return filePrefixes.some((p) => n.startsWith(p));
    if (toolFilter === 'network') return networkPrefixes.some((p) => n.startsWith(p));
    return (
      !lspPrefixes.some((p) => n.startsWith(p)) &&
      !filePrefixes.some((p) => n.startsWith(p)) &&
      !networkPrefixes.some((p) => n.startsWith(p))
    );
  });
  const scopeVisibleCount = filtered.length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isInFocusedScope && (
        <RequestScopeEffectNote
          title="当前工具视图已聚焦"
          requestId={focusedRequestId ?? 'unknown-request'}
          visibleCount={scopeVisibleCount}
          totalCount={focusedToolCount}
          summary={focusedRequestSummary ?? '当前已限制到单个 request。'}
          description="工具分类筛选只会在这个 request 的工具调用范围内继续细分。"
        />
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(['all', 'lsp', 'file', 'network', 'other'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setToolFilter(f)}
            style={{
              minHeight: 22,
              padding: '0 7px',
              borderRadius: 999,
              border:
                toolFilter === f
                  ? '1px solid color-mix(in oklch, var(--accent) 26%, var(--border-default))'
                  : '1px solid var(--border-subtle)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background:
                toolFilter === f
                  ? 'color-mix(in oklch, var(--accent) 14%, var(--bg-overlay))'
                  : 'var(--bg-overlay)',
              color: toolFilter === f ? 'var(--accent)' : 'var(--fg-muted)',
            }}
          >
            {f === 'all'
              ? '全部'
              : f === 'lsp'
                ? 'LSP'
                : f === 'file'
                  ? '文件'
                  : f === 'network'
                    ? '网络'
                    : '其他'}
          </button>
        ))}
      </div>
      {filtered.length > 0 ? (
        filtered.map((toolCall, index) =>
          ['task', 'agent', 'call_omo_agent', 'delegate_task'].includes(
            toolCall.toolName.trim().toLowerCase(),
          ) ? (
            <TaskToolInline
              key={`${toolCall.toolName}-${index}`}
              toolCallId={toolCall.toolCallId}
              toolName={toolCall.toolName}
              input={toolCall.input}
              output={toolCall.output}
              isError={toolCall.isError}
              status={toolCall.status}
              onOpenChildSession={openChildSessionInspector}
              runtimeSnapshot={resolveTaskToolRuntimeSnapshot(
                toolCall.input,
                toolCall.output,
                taskToolRuntimeLookup,
              )}
              selectedChildSessionId={selectedChildSessionId}
            />
          ) : (
            <ToolCallCard
              key={`${toolCall.toolName}-${index}`}
              toolCallId={toolCall.toolCallId}
              toolName={toolCall.toolName}
              input={toolCall.input}
              output={toolCall.output}
              isError={toolCall.isError}
              resumedAfterApproval={toolCall.resumedAfterApproval}
              status={toolCall.status}
            />
          ),
        )
      ) : (
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '6px 2px' }}>
          暂无工具调用记录
        </div>
      )}
    </div>
  );
}
