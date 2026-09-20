/**
 * ChatOverviewTabContent — 会话概览正文（经典右栏 `overview` tab 与 Fusion 停靠面板
 * 「会话概览」tab 共用的唯一实现）。
 *
 * 信息层级（渐进披露）：
 *   1. Hero：上下文用量 meter + 「压缩会话」入口（二者唯一 owner，wrapper 不得重复渲染）
 *   2. 关键指标：去重后的单行指标（每个 datum 只出现一次）
 *   3. 会话元信息（可折叠）
 *   4. 待办与任务：主待办 / 临时待办 / 计划任务 / 任务状态
 *   5. 诊断（默认折叠）：流式诊断、聚焦请求、检查点与恢复、上下文注入
 */

import { Fragment, useId, useState, type ReactNode } from 'react';
import { ContextPanel } from '@openAwork/shared-ui';
import type { AttachmentItem, ContextItem } from '@openAwork/shared-ui';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { Link } from 'react-router';
import { copyTextToClipboard } from '../../../components/layout/file-tree/file-tree-actions.js';
import {
  COMPOSER_PERMISSION_MODE_OPTIONS,
  type ComposerPermissionMode,
} from '../../../components/chat/composer/ComposerPermissionModeSelect.js';
import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type {
  ChatMessage,
  WorkspaceFileMentionItem,
} from '../../../components/conversation-runtime/messages/support.js';
import type { DialogueMode } from '../mode/dialogue-mode.js';
import {
  buildUpstreamSummaryGroupContextText,
  formatCompactionShortLabel,
  formatContextCompactionHint,
  formatUpstreamSummaryGroupHeadline,
  formatUpstreamSummaryMetricLine,
  formatUpstreamSummaryStatusLabel,
  groupUpstreamSummariesByRequest,
  splitSessionTodosByLane,
  type CompactionItem,
  type SessionTodoItem,
  type UpstreamSummaryItem,
  type UpstreamSummaryRequestGroup,
} from './chat-overview-model.js';
import './chat-overview-tab-content.css';

type HierarchicalSessionTask = SessionTask & {
  completedSubtaskCount?: number;
  depth?: number;
  readySubtaskCount?: number;
  subtaskCount?: number;
  unmetDependencyCount?: number;
};

/**
 * Fusion 运行态摘要（计划任务 / DAG / MCP / 工具调用）。
 *
 * 只在 Fusion 布局传入：经典右栏没有这些数据源。注意 `childSessionCount` /
 * `pendingPermissionCount` 不在本组件消费——「子会话」「待处理审批」的 owner 是
 * 会话自身数据（`childSessions` / `pendingPermissions`），避免同一 datum 渲染两次。
 */
export interface ChatOverviewRuntimeSummary {
  readonly activePlanTaskCount: number;
  readonly childSessionCount: number;
  readonly dagEdgeCount: number;
  readonly dagNodeCount: number;
  readonly failedToolCallCount: number;
  readonly mcpServerCount: number;
  readonly pendingPermissionCount: number;
  readonly toolCallCount: number;
  readonly totalPlanTaskCount: number;
}

export interface ChatOverviewTabContentProps {
  attachmentItems: AttachmentItem[];
  artifactsWorkspaceHref: string | null;
  childSessions: Session[];
  compactions: CompactionItem[];
  upstreamSummaries: UpstreamSummaryItem[];
  focusedUpstreamGroupKey?: string | null;
  contextUsageSnapshot: ChatContextUsageSnapshot | null;
  contentArtifactCount: number;
  contentArtifactCountStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentSessionId: string | null;
  dialogueMode: DialogueMode;
  effectiveWorkingDirectory: string | null;
  effectiveContextMessageCount?: number;
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestionsCount: number;
  sessionStateStatus: 'idle' | 'running' | 'paused' | 'completed' | 'error' | null;
  sessionTodos: SessionTodoItem[];
  sessionTasks: HierarchicalSessionTask[];
  workspaceFileItems: WorkspaceFileMentionItem[];
  /** 审批方式档位（比 yoloMode 布尔更细）；未传入时按 legacy 布尔回退推导。 */
  permissionMode?: ComposerPermissionMode;
  yoloMode: boolean;
  onCompactSession: () => void;
  onOpenRecoveryStrategy: () => void;
  /** Fusion 运行摘要（可选）；不传时只展示会话自身数据。 */
  runtimeSummary?: ChatOverviewRuntimeSummary;
}

type Tone = 'default' | 'accent' | 'aux' | 'warning' | 'danger';

interface MetricTile {
  readonly description?: string;
  readonly label: string;
  readonly tone: Tone;
  readonly value: string;
}

interface StatusChip {
  readonly label: string;
  readonly tone: 'accent' | 'aux' | 'success' | 'warning' | 'danger';
}

/** 默认压缩阈值（后续可从 active model 注入）。 */
const COMPACTION_THRESHOLD_PERCENT = 95;

function formatTokenCount(value: number | null): string {
  if (value === null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toLocaleString();
}

function resolveUsageTone(rawPercent: number | null): 'ok' | 'warning' | 'danger' | 'muted' {
  if (rawPercent === null) return 'muted';
  if (rawPercent >= 90) return 'danger';
  if (rawPercent >= 70) return 'warning';
  return 'ok';
}

function countActiveTodos(todos: SessionTodoItem[]): number {
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length;
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="chat-overview__section-chevron"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
    </svg>
  );
}

/**
 * 可折叠区块：`aria-expanded` 表达展开态，`aria-controls` 始终指向常驻的 body 容器
 * （折叠时用 `hidden` 隐藏，保证引用永远有效、子树状态不丢）。
 */
function OverviewSection({
  badge,
  children,
  defaultOpen = false,
  title,
}: {
  readonly badge?: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${useId()}-overview-section`;

  return (
    <section className="chat-overview__section">
      <button
        type="button"
        className="chat-overview__section-toggle"
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <ChevronIcon />
        <span className="chat-overview__section-title">{title}</span>
        {badge ? (
          <span aria-hidden="true" className="chat-overview__section-badge">
            {badge}
          </span>
        ) : null}
      </button>
      <div className="chat-overview__section-body" id={contentId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function ProgressRow({
  active,
  label,
  total,
}: {
  readonly active: number;
  readonly label: string;
  readonly total: number;
}) {
  const ratio = total > 0 ? Math.min(100, Math.round((active / total) * 100)) : 0;
  return (
    <div className="chat-overview__progress-row">
      <div className="chat-overview__progress-head">
        <span className="chat-overview__progress-label">{label}</span>
        <span className="chat-overview__progress-value">
          {active}/{total} 项
        </span>
      </div>
      <div className="chat-overview__progress-track" aria-hidden="true">
        <span
          className="chat-overview__progress-fill"
          data-tone={active > 0 ? 'accent' : 'muted'}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}

export function ChatOverviewTabContent(props: ChatOverviewTabContentProps) {
  const {
    attachmentItems,
    artifactsWorkspaceHref,
    childSessions,
    compactions,
    upstreamSummaries,
    focusedUpstreamGroupKey = null,
    contextUsageSnapshot,
    contentArtifactCount,
    contentArtifactCountStatus,
    currentSessionId,
    dialogueMode,
    effectiveWorkingDirectory,
    effectiveContextMessageCount,
    messages,
    pendingPermissions,
    pendingQuestionsCount,
    sessionStateStatus,
    sessionTodos,
    sessionTasks,
    workspaceFileItems,
    permissionMode,
    yoloMode,
    onCompactSession,
    onOpenRecoveryStrategy,
    runtimeSummary,
  } = props;

  const { mainTodos, tempTodos } = splitSessionTodosByLane(sessionTodos);
  const mainActiveCount = countActiveTodos(mainTodos);
  const tempActiveCount = countActiveTodos(tempTodos);
  const activeTaskCount = sessionTasks.filter(
    (task) => task.status === 'pending' || task.status === 'running',
  ).length;
  const completedTaskCount = sessionTasks.filter((task) => task.status === 'completed').length;
  const failedTaskCount = sessionTasks.filter((task) => task.status === 'failed').length;

  const focusedUpstreamGroup = focusedUpstreamGroupKey
    ? (groupUpstreamSummariesByRequest(upstreamSummaries).find(
        (group) => group.key === focusedUpstreamGroupKey,
      ) ?? null)
    : null;
  const focusedUpstreamSummaries = focusedUpstreamGroup?.items ?? upstreamSummaries;
  const latestCompaction = compactions[0] ?? null;
  const latestCompactionLabel = latestCompaction
    ? formatCompactionShortLabel(latestCompaction)
    : '无';
  const artifactCountLabel =
    contentArtifactCountStatus === 'loading'
      ? '同步中…'
      : contentArtifactCountStatus === 'error'
        ? '暂不可用'
        : `${contentArtifactCount} 个`;

  const contextItems: ContextItem[] = [
    ...attachmentItems.map((item) => ({
      id: item.id,
      kind: 'file' as const,
      label: item.name,
      description: `附件 · ${item.type}`,
    })),
    ...workspaceFileItems.slice(0, 8).map((item) => ({
      id: item.path,
      kind: 'file' as const,
      label: item.label,
      description: item.relativePath,
    })),
    ...(yoloMode
      ? [
          {
            id: 'context-yolo-mode',
            kind: 'custom' as const,
            label: 'YOLO 模式',
            description: '当前会话允许更激进的执行策略。',
          },
        ]
      : []),
  ];

  const recoverySummary =
    sessionStateStatus === 'paused'
      ? pendingPermissions.length > 0
        ? '当前会话已暂停，等待审批后会自动继续。'
        : pendingQuestionsCount > 0
          ? '当前会话已暂停，等待你回答问题后继续。'
          : '当前会话已暂停，可从恢复策略里查看下一步动作。'
      : compactions.length > 0
        ? '当前会话已有最近检查点，可刷新页面后继续同步恢复。'
        : '当前会话没有最近检查点，主要依赖实时 attach / replay 恢复。';

  // 档位优先；未传档位时按 legacy 布尔推导（与 ChatTopBar 只读 chip 同一规则）。
  const resolvedPermissionMode = permissionMode ?? (yoloMode ? 'yolo' : 'ask');
  // 档位文案直接取输入框档位控件的选项标签，避免两处措辞漂移。
  const permissionModeLabel =
    COMPOSER_PERMISSION_MODE_OPTIONS.find((option) => option.value === resolvedPermissionMode)
      ?.label ?? resolvedPermissionMode;

  const metaRows: Array<{ label: string; value: string; highlight?: boolean }> = [
    {
      label: '会话 ID',
      value: currentSessionId ? `${currentSessionId.slice(0, 8)}…` : '—',
    },
    {
      label: '有效上下文',
      value: `${effectiveContextMessageCount ?? messages.length} 条`,
    },
    { label: '会话消息', value: `${messages.length} 条` },
    {
      label: '工作区',
      value: effectiveWorkingDirectory ?? '未绑定',
    },
    {
      label: '对话模式',
      value: dialogueMode === 'clarify' ? '澄清' : dialogueMode === 'coding' ? '编程' : '程序员',
    },
    {
      label: '审批方式',
      value: permissionModeLabel,
      highlight: resolvedPermissionMode === 'yolo',
    },
    { label: '最近压缩', value: latestCompactionLabel },
  ];

  // 关键指标：每个 datum 只在这里出现一次。
  // 「计划任务」（planTasks，Fusion 专属）不进指标行——它在「待办与任务」区块里
  // 以进度行呈现，避免与「任务」（sessionTasks）在同一行里重复表达"任务"。
  const metrics: MetricTile[] = [];
  if (runtimeSummary) {
    metrics.push(
      {
        description:
          runtimeSummary.failedToolCallCount > 0
            ? `${runtimeSummary.failedToolCallCount} 个失败`
            : '全部正常',
        label: '工具调用',
        tone: runtimeSummary.failedToolCallCount > 0 ? 'danger' : 'default',
        value: `${runtimeSummary.toolCallCount} 次`,
      },
      {
        description: `${runtimeSummary.dagNodeCount} 节点 / ${runtimeSummary.dagEdgeCount} 边`,
        label: 'DAG',
        tone: runtimeSummary.dagNodeCount > 0 ? 'aux' : 'default',
        value: `${runtimeSummary.dagNodeCount}`,
      },
      {
        description: `${runtimeSummary.mcpServerCount} 个服务`,
        label: 'MCP',
        tone: runtimeSummary.mcpServerCount > 0 ? 'aux' : 'default',
        value: `${runtimeSummary.mcpServerCount}`,
      },
    );
  }
  metrics.push(
    {
      label: '子会话',
      tone: childSessions.length > 0 ? 'accent' : 'default',
      value: `${childSessions.length} 个`,
    },
    {
      label: '待处理审批',
      tone: pendingPermissions.length > 0 ? 'warning' : 'default',
      value: `${pendingPermissions.length} 项`,
    },
    {
      description: `${activeTaskCount}/${sessionTasks.length} 进行中`,
      label: '任务',
      tone: activeTaskCount > 0 ? 'accent' : 'default',
      value: `${sessionTasks.length} 项`,
    },
  );

  const taskStatusChips: StatusChip[] = [];
  if (activeTaskCount > 0) {
    taskStatusChips.push({ label: `进行中 ${activeTaskCount}`, tone: 'accent' });
  }
  if (completedTaskCount > 0) {
    taskStatusChips.push({ label: `已完成 ${completedTaskCount}`, tone: 'success' });
  }
  if (failedTaskCount > 0) {
    taskStatusChips.push({ label: `失败 ${failedTaskCount}`, tone: 'danger' });
  }

  const contextChips: Array<{ icon: ReactNode; label: string; tone?: 'warning' | 'accent' }> = [];
  if (yoloMode) {
    contextChips.push({ icon: <BoltIcon />, label: 'YOLO', tone: 'warning' });
  }
  if (attachmentItems.length > 0) {
    contextChips.push({ icon: <PaperclipIcon />, label: `${attachmentItems.length} 附件` });
  }
  if (workspaceFileItems.length > 0) {
    contextChips.push({ icon: <FolderIcon />, label: `${workspaceFileItems.length} 索引文件` });
  }

  const diagnosticsBadge =
    focusedUpstreamSummaries.length > 0 ? `${focusedUpstreamSummaries.length} 条诊断` : undefined;

  return (
    <div className="chat-overview">
      <UsageHero
        contextUsageSnapshot={contextUsageSnapshot}
        latestCompaction={latestCompaction}
        onCompactSession={onCompactSession}
      />

      <ul className="chat-overview__metrics" aria-label="关键指标">
        {metrics.map((metric) => (
          <li className="chat-overview__metric" data-tone={metric.tone} key={metric.label}>
            <span className="chat-overview__metric-label">{metric.label}</span>
            <strong className="chat-overview__metric-value">{metric.value}</strong>
            {metric.description ? (
              <small className="chat-overview__metric-note">{metric.description}</small>
            ) : null}
          </li>
        ))}
      </ul>

      <SessionMetaSection
        contextChips={contextChips}
        contextItems={contextItems}
        contextUsageSnapshot={contextUsageSnapshot}
        metaRows={metaRows}
      />

      <TodosAndTasksSection
        mainActiveCount={mainActiveCount}
        mainTodos={mainTodos}
        runtimeSummary={runtimeSummary}
        sessionTasks={sessionTasks}
        taskStatusChips={taskStatusChips}
        tempActiveCount={tempActiveCount}
        tempTodos={tempTodos}
      />

      <DiagnosticsSection
        artifactCountLabel={artifactCountLabel}
        artifactsWorkspaceHref={artifactsWorkspaceHref}
        badge={diagnosticsBadge}
        focusedUpstreamGroup={focusedUpstreamGroup}
        focusedUpstreamSummaries={focusedUpstreamSummaries}
        onOpenRecoveryStrategy={onOpenRecoveryStrategy}
        recoverySummary={recoverySummary}
        sessionStateStatus={sessionStateStatus}
      />
    </div>
  );
}

/** 1. Hero：上下文用量 meter 与「压缩会话」入口的唯一来源。 */
function UsageHero({
  contextUsageSnapshot,
  latestCompaction,
  onCompactSession,
}: {
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly latestCompaction: CompactionItem | null;
  readonly onCompactSession: () => void;
}) {
  const usedTokens = contextUsageSnapshot?.usedTokens ?? null;
  const maxTokens = contextUsageSnapshot?.maxTokens ?? null;
  const rawPercent =
    usedTokens !== null && maxTokens !== null
      ? Math.round((usedTokens / Math.max(1, maxTokens)) * 100)
      : null;
  const displayPercent = rawPercent === null ? 0 : Math.min(100, rawPercent);
  const usageTitle =
    usedTokens !== null && maxTokens !== null && rawPercent !== null
      ? `${contextUsageSnapshot?.estimated ? '上下文估算已用' : '上下文已用'} ${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} (${rawPercent}%)`
      : '等待上下文窗口';

  return (
    <section
      className="chat-overview__hero"
      data-tone={resolveUsageTone(rawPercent)}
      aria-label="上下文用量与压缩"
    >
      <div className="chat-overview__hero-head">
        <span className="chat-overview__hero-label">上下文用量</span>
        {rawPercent === null ? (
          <span className="chat-overview__hero-value">等待上下文窗口</span>
        ) : (
          <span className="chat-overview__hero-value" title={usageTitle}>
            {contextUsageSnapshot?.estimated ? '≈' : ''}
            {rawPercent}%
            <span className="chat-overview__hero-tokens">
              {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
            </span>
          </span>
        )}
      </div>
      {rawPercent !== null && maxTokens !== null && usedTokens !== null ? (
        <div
          className="chat-overview__meter"
          role="meter"
          aria-label="上下文用量"
          aria-valuemin={0}
          aria-valuemax={maxTokens}
          aria-valuenow={Math.min(usedTokens, maxTokens)}
          title={usageTitle}
        >
          <span className="chat-overview__meter-fill" style={{ width: `${displayPercent}%` }} />
          <span
            className="chat-overview__meter-tick"
            aria-hidden="true"
            style={{ left: `${COMPACTION_THRESHOLD_PERCENT}%` }}
          />
        </div>
      ) : null}
      <div className="chat-overview__hero-foot">
        <span className="chat-overview__hero-hint">
          {contextUsageSnapshot && rawPercent !== null
            ? formatContextCompactionHint(latestCompaction, contextUsageSnapshot.estimated)
            : '会话上下文窗口尚未就绪，稍后会自动刷新。'}
        </span>
        <button type="button" className="chat-overview__action-button" onClick={onCompactSession}>
          压缩会话
        </button>
      </div>
    </section>
  );
}

/** 3. 会话元信息 + 上下文注入（默认收起）。 */
function SessionMetaSection({
  contextChips,
  contextItems,
  contextUsageSnapshot,
  metaRows,
}: {
  readonly contextChips: ReadonlyArray<{
    readonly icon: ReactNode;
    readonly label: string;
    readonly tone?: 'warning' | 'accent';
  }>;
  readonly contextItems: ContextItem[];
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly metaRows: ReadonlyArray<{ label: string; value: string; highlight?: boolean }>;
}) {
  return (
    <OverviewSection title="会话元信息">
      <dl className="chat-overview__meta">
        {metaRows.map(({ label, value, highlight }) => (
          <Fragment key={label}>
            <dt className="chat-overview__meta-label">{label}</dt>
            <dd
              className="chat-overview__meta-value"
              data-highlight={highlight ? 'true' : 'false'}
              title={value}
            >
              {value}
            </dd>
          </Fragment>
        ))}
      </dl>
      <div className="chat-overview__diag-block">
        <div className="chat-overview__block-head">
          <span className="chat-overview__block-title">上下文注入</span>
          <span className="chat-overview__block-meta">
            {contextItems.length > 0 ? `${contextItems.length} 项` : '无额外注入'}
          </span>
        </div>
        {contextChips.length > 0 ? (
          <div className="chat-overview__context-chips">
            {contextChips.map((chip) => (
              <span
                className="chat-overview__context-chip"
                data-tone={chip.tone ?? 'default'}
                key={chip.label}
              >
                {chip.icon}
                {chip.label}
              </span>
            ))}
          </div>
        ) : null}
        <ContextPanel
          items={contextItems}
          totalTokens={contextUsageSnapshot?.usedTokens}
          tokenLimit={contextUsageSnapshot?.maxTokens}
        />
      </div>
    </OverviewSection>
  );
}

/** 4. 待办与任务（默认展开：连续工作的主操作数据）。 */
function TodosAndTasksSection({
  mainActiveCount,
  mainTodos,
  runtimeSummary,
  sessionTasks,
  taskStatusChips,
  tempActiveCount,
  tempTodos,
}: {
  readonly mainActiveCount: number;
  readonly mainTodos: SessionTodoItem[];
  readonly runtimeSummary?: ChatOverviewRuntimeSummary;
  readonly sessionTasks: HierarchicalSessionTask[];
  readonly taskStatusChips: StatusChip[];
  readonly tempActiveCount: number;
  readonly tempTodos: SessionTodoItem[];
}) {
  return (
    <OverviewSection
      badge={`主 ${mainActiveCount}/${mainTodos.length} · 临时 ${tempActiveCount}/${tempTodos.length}`}
      defaultOpen
      title="待办与任务"
    >
      <div className="chat-overview__progress-list">
        <ProgressRow active={mainActiveCount} label="主待办" total={mainTodos.length} />
        <ProgressRow active={tempActiveCount} label="临时待办" total={tempTodos.length} />
        {runtimeSummary ? (
          <ProgressRow
            active={runtimeSummary.activePlanTaskCount}
            label="计划任务"
            total={runtimeSummary.totalPlanTaskCount}
          />
        ) : null}
      </div>
      <div className="chat-overview__task-status">
        <span className="chat-overview__task-status-label">任务状态</span>
        <span className="chat-overview__task-status-value">{sessionTasks.length} 项</span>
        {taskStatusChips.map((chip) => (
          <span className="chat-overview__chip" data-tone={chip.tone} key={chip.label}>
            {chip.label}
          </span>
        ))}
      </div>
    </OverviewSection>
  );
}

/** 5. 诊断（默认折叠）：聚焦请求 / 流式诊断 / 检查点与恢复。 */
function DiagnosticsSection({
  artifactCountLabel,
  artifactsWorkspaceHref,
  badge,
  focusedUpstreamGroup,
  focusedUpstreamSummaries,
  onOpenRecoveryStrategy,
  recoverySummary,
  sessionStateStatus,
}: {
  readonly artifactCountLabel: string;
  readonly artifactsWorkspaceHref: string | null;
  readonly badge?: string;
  readonly focusedUpstreamGroup: UpstreamSummaryRequestGroup | null;
  readonly focusedUpstreamSummaries: UpstreamSummaryItem[];
  readonly onOpenRecoveryStrategy: () => void;
  readonly recoverySummary: string;
  readonly sessionStateStatus: 'idle' | 'running' | 'paused' | 'completed' | 'error' | null;
}) {
  return (
    <OverviewSection badge={badge} title="诊断">
      {focusedUpstreamGroup ? (
        <div className="chat-overview__diag-block">
          <div className="chat-overview__block-head">
            <span className="chat-overview__block-title">当前聚焦请求</span>
          </div>
          <div className="chat-overview__focus-card">
            <div className="chat-overview__focus-main">
              <span className="chat-overview__focus-title">{focusedUpstreamGroup.label}</span>
              <span className="chat-overview__focus-headline">
                {formatUpstreamSummaryGroupHeadline(focusedUpstreamGroup)}
              </span>
              {focusedUpstreamSummaries[0] ? (
                <span className="chat-overview__focus-note">
                  最近状态 · {formatUpstreamSummaryStatusLabel(focusedUpstreamSummaries[0].summary)}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="chat-overview__action-button"
              aria-label="复制当前聚焦请求诊断上下文"
              onClick={() =>
                void copyTextToClipboard(buildUpstreamSummaryGroupContextText(focusedUpstreamGroup))
              }
            >
              <CopyIcon />
              复制诊断上下文
            </button>
          </div>
        </div>
      ) : null}

      <div className="chat-overview__diag-block">
        <div className="chat-overview__block-head">
          <span className="chat-overview__block-title">流式诊断</span>
          <span className="chat-overview__block-meta">
            {focusedUpstreamSummaries.length > 0
              ? `${focusedUpstreamSummaries.length} 条`
              : '暂无记录'}
          </span>
        </div>
        {focusedUpstreamSummaries.slice(0, 3).map((item) => (
          <div className="chat-overview__diag-item" key={item.id}>
            <strong>{formatUpstreamSummaryStatusLabel(item.summary)}</strong>
            <span>{formatUpstreamSummaryMetricLine(item.summary)}</span>
          </div>
        ))}
      </div>

      <div className="chat-overview__diag-block">
        <div className="chat-overview__block-head">
          <span className="chat-overview__block-title">检查点与恢复</span>
        </div>
        <div className="chat-overview__recovery">
          <div className="chat-overview__recovery-head">
            <div className="chat-overview__recovery-main">
              <span
                className="chat-overview__recovery-title"
                data-tone={sessionStateStatus === 'paused' ? 'warning' : 'default'}
              >
                {sessionStateStatus === 'paused' ? '等待处理' : '恢复就绪'}
              </span>
              <span className="chat-overview__recovery-note">{recoverySummary}</span>
            </div>
            <button
              type="button"
              className="chat-overview__action-button"
              onClick={onOpenRecoveryStrategy}
            >
              恢复详情
            </button>
          </div>
          <div className="chat-overview__recovery-row">
            <span className="chat-overview__recovery-row-label">
              产物工作区
              <span className="chat-overview__recovery-row-value">{artifactCountLabel}</span>
            </span>
            {artifactsWorkspaceHref ? (
              <Link className="chat-overview__action-button" to={artifactsWorkspaceHref}>
                进入工作区
              </Link>
            ) : (
              <span className="chat-overview__recovery-row-label">进入工作区</span>
            )}
          </div>
        </div>
      </div>
    </OverviewSection>
  );
}
