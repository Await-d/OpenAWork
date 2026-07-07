import type { ChatContextUsageSnapshot } from '../../../components/conversation-runtime/messages/context-usage.js';
import type { WorkspaceFileMentionItem } from '../../../components/conversation-runtime/messages/support.js';

export interface FusionContextTabProps {
  readonly contextUsageSnapshot: ChatContextUsageSnapshot | null;
  readonly currentSessionId: string | null;
  readonly effectiveWorkingDirectory: string | null;
  readonly onCompactSession: () => void;
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

export function FusionContextTab({
  contextUsageSnapshot,
  currentSessionId,
  effectiveWorkingDirectory,
  onCompactSession,
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
    </div>
  );
}
