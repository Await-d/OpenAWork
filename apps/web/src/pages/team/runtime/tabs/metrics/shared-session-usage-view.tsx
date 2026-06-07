import { useMemo, type CSSProperties } from 'react';
import type { Message } from '@openAwork/shared';
import type { SharedSessionDetailRecord, SharedSessionSummaryRecord } from '@openAwork/web-client';
import { EmptyState, MetricGrid, StatCard } from '../../shared/content-kit/index.js';

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function sharedSessionTitle(
  selectedSessionTitle: string | null | undefined,
  summary: SharedSessionSummaryRecord | null,
): string {
  return selectedSessionTitle?.trim() || summary?.title?.trim() || summary?.sessionId || '共享会话';
}

interface SharedUsageRow {
  id: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: number;
}

interface SharedToolRow {
  failures: number;
  invocations: number;
  toolName: string;
}

function aggregateUsageRows(messages: Message[]): SharedUsageRow[] {
  return messages
    .filter((message) => message.role === 'assistant' && message.providerUsage)
    .map((message) => ({
      id: message.id,
      inputTokens: message.providerUsage?.inputTokens ?? 0,
      outputTokens: message.providerUsage?.outputTokens ?? 0,
      totalTokens: message.providerUsage?.totalTokens ?? 0,
      createdAt: message.createdAt,
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function aggregateToolRows(messages: Message[]): SharedToolRow[] {
  const toolCalls = new Map<
    string,
    {
      failed: boolean;
      toolName: string;
    }
  >();

  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'tool_call') {
        toolCalls.set(part.toolCallId, {
          failed: false,
          toolName: part.toolName,
        });
        continue;
      }
      if (part.type === 'tool_result') {
        const existing = toolCalls.get(part.toolCallId);
        toolCalls.set(part.toolCallId, {
          failed: part.isError,
          toolName: part.toolName ?? existing?.toolName ?? 'tool',
        });
      }
    }
  }

  const byTool = new Map<string, SharedToolRow>();
  for (const { failed, toolName } of toolCalls.values()) {
    const current = byTool.get(toolName) ?? { failures: 0, invocations: 0, toolName };
    current.invocations += 1;
    current.failures += failed ? 1 : 0;
    byTool.set(toolName, current);
  }

  return Array.from(byTool.values()).sort((left, right) => right.invocations - left.invocations);
}

export function SharedSessionUsageView({
  mode,
  selectedSessionId,
  selectedSessionTitle,
  sharedSession,
  sharedSessionLoading,
  sharedSummary,
}: {
  mode: 'usage' | 'tools';
  selectedSessionId: string;
  selectedSessionTitle?: string | null;
  sharedSession: SharedSessionDetailRecord | null;
  sharedSessionLoading: boolean;
  sharedSummary: SharedSessionSummaryRecord | null;
}) {
  const title = sharedSessionTitle(selectedSessionTitle, sharedSummary);
  const messages = sharedSession?.session.messages ?? [];
  const usageRows = useMemo(() => aggregateUsageRows(messages), [messages]);
  const toolRows = useMemo(() => aggregateToolRows(messages), [messages]);
  const usageTotals = useMemo(
    () =>
      usageRows.reduce(
        (acc, row) => ({
          assistantResponses: acc.assistantResponses + 1,
          inputTokens: acc.inputTokens + row.inputTokens,
          outputTokens: acc.outputTokens + row.outputTokens,
          totalTokens: acc.totalTokens + row.totalTokens,
        }),
        {
          assistantResponses: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      ),
    [usageRows],
  );
  const toolTotals = useMemo(
    () =>
      toolRows.reduce(
        (acc, row) => ({
          failures: acc.failures + row.failures,
          invocations: acc.invocations + row.invocations,
        }),
        { failures: 0, invocations: 0 },
      ),
    [toolRows],
  );

  const containerStyle: CSSProperties = {
    display: 'grid',
    gap: 10,
  };

  if (sharedSessionLoading && !sharedSession) {
    return (
      <EmptyState
        emoji={mode === 'usage' ? '🔋' : '🛠️'}
        title={mode === 'usage' ? '正在同步共享用量' : '正在同步共享工具调用'}
        description="共享会话详情加载完成后，这里会展示共享快照里的真实统计信息。"
      />
    );
  }

  if (!sharedSummary) {
    return (
      <EmptyState
        emoji={mode === 'usage' ? '🔋' : '🛠️'}
        title={mode === 'usage' ? '共享用量暂不可用' : '共享工具调用暂不可用'}
        description="当前只拿到了共享会话选择状态，详细共享快照还未同步。"
      />
    );
  }

  if (mode === 'usage' && usageRows.length === 0) {
    return (
      <EmptyState
        emoji="🔋"
        title="当前共享会话暂无用量数据"
        description="共享快照里的 assistant 消息尚未附带 providerUsage。后续同步到 token 统计后，这里会自动展示。"
      />
    );
  }

  if (mode === 'tools' && toolRows.length === 0) {
    return (
      <EmptyState
        emoji="🛠️"
        title="当前共享会话暂无工具调用数据"
        description="共享快照里还没有可聚合的 tool_call / tool_result 片段。"
      />
    );
  }

  return (
    <div
      data-testid={mode === 'usage' ? 'shared-usage-view' : 'shared-tool-usage-view'}
      style={containerStyle}
    >
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 10,
          border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
          background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-overlay))',
          color: 'var(--fg-default)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        当前统计范围：{title}（共享会话快照）。
        {mode === 'usage'
          ? ' 用量来自共享 assistant 消息上的 providerUsage。'
          : ' 工具统计来自共享快照里的 tool_call / tool_result 片段。'}
      </div>

      {mode === 'usage' ? (
        <>
          <MetricGrid>
            <StatCard label="assistant 响应" value={String(usageTotals.assistantResponses)} />
            <StatCard label="输入 token" value={formatTokens(usageTotals.inputTokens)} />
            <StatCard label="输出 token" value={formatTokens(usageTotals.outputTokens)} />
            <StatCard
              label="总 token"
              value={formatTokens(usageTotals.totalTokens)}
              tone="accent"
            />
          </MetricGrid>

          <div style={{ display: 'grid', gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              最近 {usageRows.length} 条带用量的共享消息
            </span>
            {usageRows.map((row) => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                  fontSize: 11,
                  color: 'var(--fg-default)',
                }}
              >
                <span style={{ minWidth: 72, color: 'var(--fg-muted)' }}>
                  {formatTime(row.createdAt)}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  in {formatTokens(row.inputTokens)} · out {formatTokens(row.outputTokens)} · total{' '}
                  {formatTokens(row.totalTokens)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <MetricGrid>
            <StatCard label="工具种类" value={String(toolRows.length)} />
            <StatCard label="总调用数" value={String(toolTotals.invocations)} />
            <StatCard
              label="失败数"
              value={String(toolTotals.failures)}
              tone={toolTotals.failures > 0 ? 'warning' : 'default'}
            />
          </MetricGrid>

          <div style={{ display: 'grid', gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--fg-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              工具调用排行
            </span>
            {toolRows.map((row) => (
              <div
                key={row.toolName}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid color-mix(in srgb, var(--border-default) 45%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
                  fontSize: 12,
                }}
              >
                <strong
                  style={{
                    minWidth: 160,
                    color: 'var(--fg-strong)',
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  }}
                >
                  {row.toolName}
                </strong>
                <span style={{ color: 'var(--fg-muted)' }}>{row.invocations} 次</span>
                <span
                  style={{
                    color: row.failures > 0 ? 'var(--warning)' : 'var(--fg-muted)',
                    fontWeight: row.failures > 0 ? 700 : 600,
                  }}
                >
                  失败 {row.failures}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
