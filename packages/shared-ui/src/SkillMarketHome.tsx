import type { CSSProperties } from 'react';
import { useState } from 'react';

export interface MarketSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  downloads: number;
  verified: boolean;
  installable?: boolean;
  actionLabel?: string;
}

export interface SkillMarketHomeProps {
  skills: MarketSkill[];
  categories: string[];
  title?: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  onSearch?: (query: string, category?: string) => void;
  currentPage: number;
  pageSize: number;
  total: number;
  onPageChange?: (page: number) => void;
  onInstall: (id: string) => void;
  onSelect: (id: string) => void;
}

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--color-bg, #0f172a)',
    minHeight: '100%',
    fontFamily: 'system-ui, sans-serif',
    color: 'var(--color-text, #e2e8f0)',
    padding: '1.5rem',
  },
  header: { marginBottom: '1.5rem' },
  title: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text, #e2e8f0)' },
  subtitle: { margin: '0.25rem 0 0', fontSize: 12, color: 'var(--color-muted, #94a3b8)' },
  tabs: { display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: '1.5rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: '1rem',
  },
  card: {
    background: 'var(--color-surface, #1e293b)',
    border: '1px solid var(--color-border, #334155)',
    borderRadius: 10,
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    cursor: 'pointer',
  },
  cardName: { fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' },
  cardDesc: { fontSize: 12, color: 'var(--color-muted, #94a3b8)', lineHeight: 1.5, flexGrow: 1 },
  tag: {
    fontSize: 10,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(99,102,241,0.15)',
    color: 'var(--color-accent, #6366f1)',
    fontWeight: 500,
  },
  section: { marginBottom: '1.5rem' },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-muted, #94a3b8)',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: '0.75rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
    marginTop: '1.25rem',
    paddingTop: '1rem',
    borderTop: '1px solid var(--color-border, #334155)',
  },
  pageMeta: { fontSize: 12, color: 'var(--color-muted, #94a3b8)' },
  pager: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
};

function tabBtn(active: boolean): CSSProperties {
  return {
    padding: '0.3rem 0.75rem',
    fontSize: 12,
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
    border: `1px solid ${active ? 'var(--color-accent, #6366f1)' : 'var(--color-border, #334155)'}`,
    background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: active ? 'var(--color-accent, #6366f1)' : 'var(--color-muted, #94a3b8)',
  };
}

function installBtn(): CSSProperties {
  return {
    background: 'rgba(99,102,241,0.15)',
    color: 'var(--color-accent, #6366f1)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 6,
    padding: '0.3rem 0.75rem',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 600,
    alignSelf: 'flex-start' as const,
  };
}

function pagerBtn(active: boolean, disabled = false): CSSProperties {
  return {
    minWidth: 34,
    height: 34,
    padding: '0 0.8rem',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--color-accent, #6366f1)' : 'var(--color-border, #334155)'}`,
    background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: active ? 'var(--color-accent, #6366f1)' : 'var(--color-text, #e2e8f0)',
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}

function buildVisiblePages(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, currentPage - 1, currentPage, currentPage + 1, totalPages];
}

export function SkillMarketHome({
  skills,
  categories,
  title = '技能市场',
  subtitle = '发现并安装适合你 AI 工作流的技能',
  loading,
  error,
  onSearch,
  currentPage,
  pageSize,
  total,
  onPageChange,
  onInstall,
  onSelect,
}: SkillMarketHomeProps) {
  const [active, setActive] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const allCats = ['All', ...categories];
  const filtered = active === 'All' ? skills : skills.filter((sk) => sk.category === active);
  const featured = skills.filter((sk) => sk.verified).slice(0, 3);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = buildVisiblePages(currentPage, totalPages);
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(total, currentPage * pageSize);
  const showFeatured = currentPage === 1 && searchQuery.trim().length === 0 && active === 'All';

  function handleSearch() {
    onSearch?.(searchQuery, active === 'All' ? undefined : active);
  }

  function handleCatChange(cat: string) {
    setActive(cat);
    onSearch?.(searchQuery, cat === 'All' ? undefined : cat);
  }

  if (loading) {
    return (
      <div
        style={{
          ...s.root,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-muted, #94a3b8)' }}>加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...s.root,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
        }}
      >
        <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>
      </div>
    );
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <h1 style={s.title}>{title}</h1>
        <p style={s.subtitle}>{subtitle}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          placeholder="搜索技能..."
          style={{
            flex: 1,
            background: 'var(--color-surface, #1e293b)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 7,
            padding: '0.4rem 0.75rem',
            color: 'var(--color-text, #e2e8f0)',
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleSearch}
          style={{
            padding: '0.4rem 1rem',
            borderRadius: 7,
            background: 'var(--color-accent, #6366f1)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          搜索
        </button>
      </div>

      {showFeatured && featured.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>精选</div>
          <div style={s.grid}>
            {featured.map((sk) => (
              <SkillCard key={sk.id} skill={sk} onInstall={onInstall} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      <div style={s.tabs}>
        {allCats.map((cat) => (
          <button
            key={cat}
            type="button"
            style={tabBtn(active === cat)}
            onClick={() => handleCatChange(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={s.grid}>
        {filtered.map((sk) => (
          <SkillCard key={sk.id} skill={sk} onInstall={onInstall} onSelect={onSelect} />
        ))}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--color-muted, #94a3b8)', fontSize: 12 }}>
            该分类下暂无技能。
          </div>
        )}
      </div>

      <div style={s.footer}>
        <div style={s.pageMeta}>
          显示 {rangeStart}-{rangeEnd} / 共 {total} 个技能
        </div>
        {totalPages > 1 && (
          <div style={s.pager}>
            <button
              type="button"
              style={pagerBtn(false, currentPage === 1)}
              disabled={currentPage === 1}
              onClick={() => onPageChange?.(currentPage - 1)}
            >
              上一页
            </button>
            {visiblePages.map((page, index) => {
              const previous = visiblePages[index - 1];
              const showGap = previous !== undefined && page - previous > 1;
              return (
                <div key={page} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {showGap && <span style={s.pageMeta}>…</span>}
                  <button
                    type="button"
                    style={pagerBtn(currentPage === page)}
                    onClick={() => onPageChange?.(page)}
                  >
                    {page}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              style={pagerBtn(false, currentPage === totalPages)}
              disabled={currentPage === totalPages}
              onClick={() => onPageChange?.(currentPage + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onInstall,
  onSelect,
}: {
  skill: MarketSkill;
  onInstall: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <article
      style={{
        ...s.card,
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        boxSizing: 'border-box' as const,
      }}
      onClick={() => onSelect(skill.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(skill.id);
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={s.cardName}>{skill.name}</div>
        {skill.verified && (
          <span style={{ fontSize: 10, color: '#34d399', fontWeight: 700 }}>✓ 已验证</span>
        )}
      </div>
      <div style={s.cardDesc}>{skill.description}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
        {skill.tags.slice(0, 3).map((t) => (
          <span key={t} style={s.tag}>
            {t}
          </span>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-muted, #94a3b8)' }}>
          {(skill.downloads ?? 0).toLocaleString()} 次安装
        </span>
        <button
          type="button"
          style={installBtn()}
          disabled={skill.installable === false}
          onClick={(e) => {
            e.stopPropagation();
            onInstall(skill.id);
          }}
        >
          {skill.installable === false ? '仅浏览' : (skill.actionLabel ?? '安装')}
        </button>
      </div>
    </article>
  );
}
