import type { CSSProperties } from 'react';
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
import { TaskToolInline } from '../../components/chat/task-tool-inline.js';
import { ChatHistoryTabContent, ChatOverviewTabContent } from './right-panel-sections.js';
import { SubSessionDetailPanel } from './sub-session-detail-panel.js';
import {
  RIGHT_PANEL_TABS,
  RIGHT_PANEL_TAB_META,
  renderRightPanelTabIcon,
} from './right-panel-tabs.js';
import type { RightPanelTabId } from './right-panel-tabs.js';
import type { ChatMessage, WorkspaceFileMentionItem } from './support.js';
import type { ChatContextUsageSnapshot } from './context-usage.js';
import type { SessionStateStatus, SessionTodoItem } from './session-runtime.js';
import type { TaskToolRuntimeLookup, TaskToolRuntimeSnapshot } from './task-tool-runtime.js';
import type { DialogueMode } from '../dialogue-mode.js';

interface CompactionItem {
  id: string;
  summary: string;
  trigger: 'manual' | 'automatic';
  occurredAt: number;
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
      : 'clamp(320px, 32vw, 400px)'
    : 0;
  const rightPanelMaxWidth = rightOpen ? 'calc(100vw - 88px)' : 0;
  const activeRightTabMeta = RIGHT_PANEL_TAB_META[rightTab ?? 'overview'];

  return (
    <div
      aria-hidden={!rightOpen}
      style={{
        width: rightPanelWidth,
        maxWidth: rightPanelMaxWidth,
        flexShrink: 0,
        overflow: 'hidden',
        borderLeft: rightOpen ? '1px solid var(--border)' : 'none',
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
            background: 'color-mix(in oklch, var(--surface) 96%, var(--bg) 4%)',
          }}
        >
          <div
            data-testid="chat-right-nav-rail"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 4,
              width: 52,
              minWidth: 52,
              padding: '8px 4px',
              borderRight: '1px solid var(--border)',
              flexShrink: 0,
              background:
                'linear-gradient(180deg, color-mix(in oklch, var(--surface) 92%, var(--bg) 8%), color-mix(in oklch, var(--surface) 88%, var(--bg) 12%))',
            }}
          >
            <div
              role="tablist"
              aria-label="右侧面板切换"
              aria-orientation="vertical"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
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
                    className={`toolbar-btn${isActive ? ' active' : ''}`}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 34,
                      padding: '6px 0',
                      borderRadius: 8,
                      border: isActive
                        ? '1px solid color-mix(in oklch, var(--accent) 24%, var(--border))'
                        : '1px solid transparent',
                      background: isActive
                        ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))'
                        : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--text-2)',
                      boxShadow: isActive
                        ? 'inset 0 0 0 1px color-mix(in oklch, var(--accent) 10%, transparent)'
                        : 'none',
                      fontSize: 0,
                    }}
                  >
                    {renderRightPanelTabIcon(tab.id)}
                  </button>
                );
              })}
            </div>
          </div>
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
              background: 'color-mix(in oklch, var(--surface) 98%, var(--bg) 2%)',
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
                    padding: '10px 12px 8px',
                    borderBottom: '1px solid color-mix(in oklch, var(--border) 86%, transparent)',
                    background:
                      'linear-gradient(180deg, color-mix(in oklch, var(--surface) 96%, var(--bg) 4%), color-mix(in oklch, var(--surface) 98%, var(--bg) 2%))',
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}
                  >
                    {activeRightTabMeta.title}
                  </div>
                  <div
                    style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45, marginTop: 2 }}
                  >
                    {activeRightTabMeta.description}
                  </div>
                </div>
                <div
                  data-testid={`chat-right-panel-body-${rightTab}`}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '8px 10px 10px',
                    scrollbarGutter: 'stable',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {rightTab === 'plan' && <PlanPanel tasks={planTasks} />}
                  {rightTab === 'tools' &&
                    renderToolsPanel(
                      toolCallCards,
                      toolFilter,
                      setToolFilter,
                      openChildSessionInspector,
                      taskToolRuntimeLookup,
                      resolveTaskToolRuntimeSnapshot,
                      selectedChildSessionId,
                    )}
                  {rightTab === 'viz' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={sharedUiThemeVars}>
                        <AgentDAGGraph nodes={dagNodes} edges={dagEdges} />
                      </div>
                      <div style={sharedUiThemeVars}>
                        <AgentVizPanel events={agentEvents} />
                      </div>
                    </div>
                  )}
                  {rightTab === 'history' && (
                    <ChatHistoryTabContent
                      childSessions={childSessions}
                      compactions={compactions}
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
                  {rightTab === 'mcp' && (
                    <div style={sharedUiThemeVars}>
                      <MCPServerList servers={mcpServers} />
                    </div>
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

function renderToolsPanel(
  toolCallCards: ToolCallCardEntry[],
  toolFilter: string,
  setToolFilter: (f: 'all' | 'lsp' | 'file' | 'network' | 'other') => void,
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
  const filtered = toolCallCards.filter((tc) => {
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  ? '1px solid color-mix(in oklch, var(--accent) 26%, var(--border))'
                  : '1px solid var(--border-subtle)',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background:
                toolFilter === f
                  ? 'color-mix(in oklch, var(--accent) 14%, var(--surface))'
                  : 'color-mix(in oklch, var(--surface) 86%, transparent)',
              color: toolFilter === f ? 'var(--accent)' : 'var(--text-3)',
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
          toolCall.toolName.trim().toLowerCase() === 'task' ? (
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
        <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '6px 2px' }}>
          暂无工具调用记录
        </div>
      )}
    </div>
  );
}
