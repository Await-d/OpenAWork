import type { CSSProperties } from 'react';

export interface GitHubTriggerConfigProps {
  repos: Array<{ owner: string; name: string }>;
  selectedRepo?: string;
  events: string[];
  selectedEvents: string[];
  onRepoChange?: (repo: string) => void;
  onEventsChange?: (events: string[]) => void;
  filterPattern?: string;
  onFilterChange?: (pattern: string) => void;
  style?: CSSProperties;
}

export function GitHubTriggerConfig({
  repos,
  selectedRepo,
  events,
  selectedEvents,
  onRepoChange,
  onEventsChange,
  filterPattern,
  onFilterChange,
  style,
}: GitHubTriggerConfigProps) {
  const toggleEvent = (ev: string) => {
    if (!onEventsChange) return;
    if (selectedEvents.includes(ev)) {
      onEventsChange(selectedEvents.filter((e) => e !== ev));
    } else {
      onEventsChange([...selectedEvents, ev]);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: 'var(--color-surface, #1e293b)',
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 10,
        padding: '1rem',
        ...style,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label
          htmlFor="gh-repo"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          仓库
        </label>
        <select
          id="gh-repo"
          value={selectedRepo ?? ''}
          onChange={(e) => onRepoChange?.(e.target.value)}
          style={{
            padding: '0.4rem 0.6rem',
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            color: 'var(--color-text, #f1f5f9)',
            fontSize: 12,
          }}
        >
          <option value="">选择仓库…</option>
          {repos.map((r) => {
            const val = `${r.owner}/${r.name}`;
            return (
              <option key={val} value={val}>
                {val}
              </option>
            );
          })}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          事件
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {events.map((ev) => (
            <label
              key={ev}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                color: 'var(--color-text, #f1f5f9)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selectedEvents.includes(ev)}
                onChange={() => toggleEvent(ev)}
              />
              {ev}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label
          htmlFor="gh-filter"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--color-muted, #94a3b8)',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          文件过滤规则
        </label>
        <input
          id="gh-filter"
          type="text"
          placeholder="e.g. src/**/*.ts"
          value={filterPattern ?? ''}
          onChange={(e) => onFilterChange?.(e.target.value)}
          style={{
            padding: '0.4rem 0.6rem',
            background: 'var(--color-bg, #0f172a)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            color: 'var(--color-text, #f1f5f9)',
            fontSize: 12,
          }}
        />
      </div>
    </div>
  );
}
