import type { CSSProperties } from 'react';

export interface SkillsPageHeaderProps {
  marketTotal: number;
  installedCount: number;
  sourceCount: number;
  updateCount: number;
  busy: boolean;
  onRefresh: () => void;
}

const ghostButton: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  color: 'var(--fg-default)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
};

const statLabel: CSSProperties = {
  color: 'var(--fg-muted)',
  fontSize: 11,
  whiteSpace: 'nowrap',
};

/**
 * `/skills` 页头：标题 + 说明 + 内联统计 + 刷新。
 * 取代旧版 Hero 大卡（4 个统计卡 + 渐变背景），信息等价但纵向占用从 ~180px 降到 ~44px。
 */
export function SkillsPageHeader({
  marketTotal,
  installedCount,
  sourceCount,
  updateCount,
  busy,
  onRefresh,
}: SkillsPageHeaderProps) {
  return (
    <header
      style={{
        alignItems: 'flex-end',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ color: 'var(--fg-strong)', fontSize: 18, fontWeight: 700, margin: 0 }}>
          技能
        </h1>
        <p style={{ color: 'var(--fg-muted)', fontSize: 12, lineHeight: 1.6, margin: '2px 0 0' }}>
          浏览技能市场、管理已安装技能与注册源。
        </p>
      </div>

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <span style={statLabel}>
            市场 <strong style={{ color: 'var(--fg-default)' }}>{marketTotal}</strong>
          </span>
          <span style={statLabel}>
            已安装 <strong style={{ color: 'var(--fg-default)' }}>{installedCount}</strong>
          </span>
          <span style={statLabel}>
            注册源 <strong style={{ color: 'var(--fg-default)' }}>{sourceCount}</strong>
          </span>
          <span style={statLabel}>
            可更新{' '}
            <strong style={{ color: updateCount > 0 ? 'var(--contrast)' : 'var(--fg-default)' }}>
              {updateCount}
            </strong>
          </span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          style={{
            ...ghostButton,
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? '刷新中…' : '刷新'}
        </button>
      </div>
    </header>
  );
}
