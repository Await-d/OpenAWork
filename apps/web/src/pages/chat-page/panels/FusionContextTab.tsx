import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';
import { ChatOverviewTabContent } from './right-panel-sections.js';

export type FusionContextOverviewProps = Parameters<typeof ChatOverviewTabContent>[0];

export interface FusionContextRuntimeSummary {
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

export interface FusionContextTabProps {
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly effectiveWorkingDirectory: string | null;
  readonly onCompactSession: () => void;
  readonly overview?: FusionContextOverviewProps;
  readonly runtimeSummary?: FusionContextRuntimeSummary;
  readonly workspaceFileItems: readonly WorkspaceFileMentionItem[];
}

function formatTokenCount(value: number | null): string {
  if (value === null) return '-';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function renderRuntimeSummary(summary: FusionContextRuntimeSummary) {
  const items = [
    {
      description:
        summary.failedToolCallCount > 0 ? `${summary.failedToolCallCount} 个失败` : '全部正常',
      label: '工具调用',
      tone: summary.failedToolCallCount > 0 ? 'danger' : 'default',
      value: `${summary.toolCallCount} 次`,
    },
    {
      description:
        summary.totalPlanTaskCount > 0
          ? `${summary.activePlanTaskCount}/${summary.totalPlanTaskCount} 进行中`
          : '暂无计划',
      label: '计划任务',
      tone: summary.activePlanTaskCount > 0 ? 'accent' : 'default',
      value: `${summary.totalPlanTaskCount} 项`,
    },
    {
      description: `${summary.dagNodeCount} 节点 / ${summary.dagEdgeCount} 边`,
      label: 'DAG',
      tone: summary.dagNodeCount > 0 ? 'aux' : 'default',
      value: `${summary.dagNodeCount}`,
    },
    {
      description: `${summary.mcpServerCount} 个服务`,
      label: 'MCP',
      tone: summary.mcpServerCount > 0 ? 'aux' : 'default',
      value: `${summary.mcpServerCount}`,
    },
    {
      description: `${summary.pendingPermissionCount} 项`,
      label: '待审批',
      tone: summary.pendingPermissionCount > 0 ? 'warning' : 'default',
      value: `${summary.pendingPermissionCount}`,
    },
    {
      description: `${summary.childSessionCount} 个`,
      label: '子会话',
      tone: summary.childSessionCount > 0 ? 'accent' : 'default',
      value: `${summary.childSessionCount}`,
    },
  ] as const;

  return (
    <section className="fusion-side-panel__runtime-summary" aria-label="Fusion 运行摘要">
      {items.map((item) => (
        <div key={item.label} data-tone={item.tone}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.description}</small>
        </div>
      ))}
    </section>
  );
}

export function FusionContextTab({
  contextUsageSnapshot,
  currentSessionId,
  effectiveWorkingDirectory,
  onCompactSession,
  overview,
  runtimeSummary,
  workspaceFileItems,
}: FusionContextTabProps) {
  const usedTokens = contextUsageSnapshot?.usedTokens ?? null;
  const maxTokens = contextUsageSnapshot?.maxTokens ?? null;
  const rawPercent =
    usedTokens !== null && maxTokens !== null
      ? Math.round((usedTokens / Math.max(1, maxTokens)) * 100)
      : null;
  const displayPercent = rawPercent === null ? 0 : Math.min(100, rawPercent);
  const usageTone =
    rawPercent === null
      ? 'muted'
      : rawPercent >= 90
        ? 'danger'
        : rawPercent >= 70
          ? 'warning'
          : 'ok';

  return (
    <div className="fusion-side-panel__scroll">
      <div className="fusion-side-panel__section-head">
        <div>
          <div className="fusion-side-panel__eyebrow">Context</div>
          <div className="fusion-side-panel__title">
            {rawPercent === null ? '等待上下文窗口' : `${rawPercent}% 已用`}
          </div>
        </div>
        <button
          type="button"
          className="fusion-side-panel__ghost-button"
          onClick={onCompactSession}
        >
          压缩会话
        </button>
      </div>

      {runtimeSummary ? renderRuntimeSummary(runtimeSummary) : null}

      {overview ? (
        <ChatOverviewTabContent {...overview} />
      ) : (
        <>
          <div className="fusion-side-panel__usage-card" data-tone={usageTone}>
            <div className="fusion-side-panel__usage-head">
              <span>{contextUsageSnapshot?.estimated ? '估算用量' : '上下文用量'}</span>
              <strong>
                {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
              </strong>
            </div>
            <div
              className="fusion-side-panel__usage-meter"
              role="meter"
              aria-label="上下文用量"
              aria-valuemin={0}
              aria-valuemax={maxTokens ?? 100}
              aria-valuenow={usedTokens ?? 0}
            >
              <span style={{ width: `${displayPercent}%` }} />
            </div>
          </div>

          <div className="fusion-side-panel__stat-grid">
            <div>
              <span>会话</span>
              <strong>{currentSessionId ? `${currentSessionId.slice(0, 8)}...` : '-'}</strong>
            </div>
            <div>
              <span>工作区</span>
              <strong title={effectiveWorkingDirectory ?? undefined}>
                {effectiveWorkingDirectory ? basename(effectiveWorkingDirectory) : '-'}
              </strong>
            </div>
            <div>
              <span>文件上下文</span>
              <strong>{workspaceFileItems.length}</strong>
            </div>
            <div>
              <span>剩余 Token</span>
              <strong>
                {usedTokens !== null && maxTokens !== null
                  ? formatTokenCount(Math.max(0, maxTokens - usedTokens))
                  : '-'}
              </strong>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
