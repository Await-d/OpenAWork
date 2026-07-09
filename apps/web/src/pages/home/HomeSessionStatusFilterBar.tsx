export type HomeSessionStatusFilter = 'all' | 'running' | 'paused' | 'idle';

export type HomeSessionStatusCounts = Record<HomeSessionStatusFilter, number>;

interface HomeSessionStatusFilterBarProps {
  readonly counts: HomeSessionStatusCounts;
  readonly value: HomeSessionStatusFilter;
  readonly onChange: (value: HomeSessionStatusFilter) => void;
}

const HOME_SESSION_STATUS_OPTIONS: readonly {
  readonly label: string;
  readonly value: HomeSessionStatusFilter;
}[] = [
  { label: '全部', value: 'all' },
  { label: '运行中', value: 'running' },
  { label: '暂停', value: 'paused' },
  { label: '空闲', value: 'idle' },
];

export function HomeSessionStatusFilterBar({
  counts,
  value,
  onChange,
}: HomeSessionStatusFilterBarProps) {
  return (
    <div className="home-status-filter" role="group" aria-label="按会话状态筛选">
      {HOME_SESSION_STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="home-status-filter-button"
          aria-pressed={value === option.value}
          data-active={value === option.value ? 'true' : 'false'}
          onClick={() => onChange(option.value)}
        >
          <span>{option.label}</span>
          <strong>{counts[option.value]}</strong>
        </button>
      ))}
    </div>
  );
}
