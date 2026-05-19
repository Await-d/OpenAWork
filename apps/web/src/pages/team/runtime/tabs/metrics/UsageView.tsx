/**
 * 260516-team-page-v2 · T-13 · UsageView
 *
 * 「用量 & 费用」tab：从 useTeamUsageStore 读取按 provider/agent/session 的聚合值。
 *
 * 当前若 store 为空（事件还未接入），显示「等待数据接入」提示。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTeamUsageStore, type UsageBucket } from '../../../../../stores/team/team-usage.js';
import { TabContainer } from '../TabContainer.js';

const CONTAINER_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const SECTION_TITLE_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const STAT_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
};

const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
};

const TAB_BTN_STYLE: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'transparent',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--fg-muted)',
};

const TAB_BTN_ACTIVE_STYLE: CSSProperties = {
  ...TAB_BTN_STYLE,
  background: 'color-mix(in srgb, var(--accent) 16%, var(--bg-overlay))',
  borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  color: 'var(--fg-strong)',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  borderRadius: 12,
  border: '1px dashed color-mix(in srgb, var(--border-default) 60%, transparent)',
  color: 'var(--fg-muted)',
  fontSize: 13,
  gap: 6,
  textAlign: 'center',
};

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

type GroupKey = 'provider' | 'agent' | 'session';

export function UsageView() {
  const total = useTeamUsageStore((s) => s.total);
  const byProvider = useTeamUsageStore((s) => s.byProvider);
  const byAgent = useTeamUsageStore((s) => s.byAgent);
  const bySession = useTeamUsageStore((s) => s.bySession);
  const recent = useTeamUsageStore((s) => s.recent);

  const [group, setGroup] = useState<GroupKey>('provider');

  const groupedRows = useMemo(() => {
    const map = group === 'provider' ? byProvider : group === 'agent' ? byAgent : bySession;
    return Array.from(map.entries())
      .map(([key, bucket]) => ({ key, bucket }))
      .sort(
        (a, b) =>
          b.bucket.inputTokens +
          b.bucket.outputTokens -
          (a.bucket.inputTokens + a.bucket.outputTokens),
      );
  }, [byAgent, byProvider, bySession, group]);

  const hasData = total.count > 0;

  if (!hasData) {
    return (
      <TabContainer
        title="用量 & 费用"
        subtitle="按 provider / agent / session 维度聚合 token 与成本。"
      >
        <div style={CONTAINER_STYLE}>
          <div style={EMPTY_STYLE}>
            <span style={{ fontSize: 26 }} aria-hidden>
              🔋
            </span>
            <strong style={{ color: 'var(--fg-default)' }}>暂无用量数据</strong>
            <span style={{ maxWidth: 420 }}>
              用量数据来自 agent-gateway 的 stream usage 事件。
              <br />
              等待后端通过 team-events 推送 <code>team_usage</code> 事件， 前端{' '}
              <code>useTeamUsageStore.applyUsageEvent</code> 会自动累计。
            </span>
          </div>
        </div>
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="用量 & 费用"
      subtitle="按 provider / agent / session 维度聚合 token 与成本。"
    >
      <div style={CONTAINER_STYLE}>
        <span style={SECTION_TITLE_STYLE}>总览</span>
        <div style={STAT_GRID_STYLE}>
          <UsageCard label="调用次数" value={String(total.count)} />
          <UsageCard label="输入 token" value={formatTokens(total.inputTokens)} />
          <UsageCard label="输出 token" value={formatTokens(total.outputTokens)} />
          <UsageCard label="缓存命中" value={formatTokens(total.cacheReadTokens)} />
          <UsageCard label="缓存写入" value={formatTokens(total.cacheWriteTokens)} />
          <UsageCard label="推理 token" value={formatTokens(total.reasoningTokens)} />
          <UsageCard label="估算成本" value={formatCost(total.costUsd)} />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={SECTION_TITLE_STYLE}>分组明细</span>
          <span style={{ flex: 1 }} />
          <GroupBtn
            label="按 provider"
            active={group === 'provider'}
            onClick={() => setGroup('provider')}
          />
          <GroupBtn label="按 agent" active={group === 'agent'} onClick={() => setGroup('agent')} />
          <GroupBtn
            label="按 session"
            active={group === 'session'}
            onClick={() => setGroup('session')}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {groupedRows.length === 0 ? (
            <div style={{ padding: 16, color: 'var(--fg-muted)', fontSize: 12 }}>
              该维度暂无聚合数据。
            </div>
          ) : (
            groupedRows.map(({ key, bucket }) => <UsageRow key={key} label={key} bucket={bucket} />)
          )}
        </div>

        <span style={SECTION_TITLE_STYLE}>最近 {recent.length} 条调用</span>
        <div style={{ display: 'grid', gap: 4, fontSize: 11, color: 'var(--fg-default)' }}>
          {recent
            .slice()
            .reverse()
            .slice(0, 20)
            .map((event, idx) => (
              <div
                key={`${event.timestamp}-${idx}`}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-overlay)',
                }}
              >
                <span style={{ minWidth: 90, color: 'var(--fg-muted)' }}>
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span style={{ minWidth: 90, color: 'var(--fg-default)' }}>
                  {event.provider ?? '—'}
                </span>
                <span style={{ minWidth: 80, color: 'var(--fg-default)' }}>
                  {event.model ?? ''}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  in {formatTokens(event.inputTokens)} · out {formatTokens(event.outputTokens)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </TabContainer>
  );
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={CARD_STYLE}>
      <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--fg-strong)' }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function UsageRow({ label, bucket }: { label: string; bucket: UsageBucket }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
        background: 'color-mix(in srgb, var(--bg-overlay) 80%, var(--bg-base))',
        fontSize: 12,
      }}
    >
      <strong
        style={{
          minWidth: 140,
          color: 'var(--fg-strong)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </strong>
      <span style={{ color: 'var(--fg-muted)' }}>{bucket.count} 次</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-default)' }}>
        in <strong style={{ color: 'var(--fg-strong)' }}>{formatTokens(bucket.inputTokens)}</strong>
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-default)' }}>
        out{' '}
        <strong style={{ color: 'var(--fg-strong)' }}>{formatTokens(bucket.outputTokens)}</strong>
      </span>
      {bucket.cacheReadTokens > 0 ? (
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)' }}>
          cache {formatTokens(bucket.cacheReadTokens)}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      <span
        style={{
          color: 'var(--fg-strong)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatCost(bucket.costUsd)}
      </span>
    </div>
  );
}

function GroupBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={active ? TAB_BTN_ACTIVE_STYLE : TAB_BTN_STYLE}>
      {label}
    </button>
  );
}
