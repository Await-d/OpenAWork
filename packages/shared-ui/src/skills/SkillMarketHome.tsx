import { color, font, radius, spacing } from '../tokens.js';
import type { CSSProperties, ReactNode } from 'react';
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

/**
 * 技能市场内容区（无面板外壳——由页面决定承载表面）。
 *
 * 与旧版差异：
 *   - 删除自带 padding/minHeight/背景，避免「卡片套卡片」；
 *   - `categories` 为空时不再渲染只有一个「全部」的分类行；
 *   - 卡片加了独立的「详情 / 安装」按钮，键盘可达（旧版整卡可点但不可聚焦）；
 *   - 颜色/圆角/间距全部走 token。
 */
const styles = `
[data-openawork-skill-market] .skm-card {
  transition: border-color 120ms ease, background 120ms ease;
}
[data-openawork-skill-market] .skm-card:hover {
  border-color: var(--border-emphasis);
  background: var(--bg-surface);
}
[data-openawork-skill-market] .skm-card:focus-within {
  border-color: var(--accent-border);
}
[data-openawork-skill-market] :where(button, input):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
[data-openawork-skill-market] .skm-ghost-btn {
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: ${radius.sm}px;
  color: ${color.fgDefault};
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}
[data-openawork-skill-market] .skm-ghost-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-emphasis);
  color: ${color.fgStrong};
}
[data-openawork-skill-market] .skm-install-btn {
  background: ${color.accentMuted};
  border: 1px solid ${color.accentBorder};
  border-radius: ${radius.sm}px;
  color: ${color.accent};
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  transition: background 100ms ease, color 100ms ease;
}
[data-openawork-skill-market] .skm-install-btn:hover:not(:disabled) {
  background: ${color.accent};
  color: ${color.fgOnAccent};
}
[data-openawork-skill-market] .skm-install-btn:disabled {
  background: transparent;
  border-color: var(--border-default);
  color: ${color.fgSubtle};
  cursor: not-allowed;
}
`;

const searchInputStyle: CSSProperties = {
  background: color.bgOverlay,
  border: `1px solid ${color.borderDefault}`,
  borderRadius: radius.sm,
  boxSizing: 'border-box',
  color: color.fgDefault,
  flex: '1 1 200px',
  fontSize: 12,
  height: 30,
  minWidth: 0,
  padding: `0 ${spacing[2] + 2}px`,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gap: spacing[3],
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
};

const cardStyle: CSSProperties = {
  background: color.bgOverlay,
  border: `1px solid ${color.borderSubtle}`,
  borderRadius: radius.lg,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing[2],
  padding: spacing[3],
};

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

function ToolbarButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? 'skm-install-btn' : 'skm-ghost-btn'}
      disabled={disabled}
      onClick={onClick}
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    >
      {children}
    </button>
  );
}

export function SkillMarketHome({
  skills,
  categories,
  title,
  subtitle,
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
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const allCats = ['All', ...categories];
  const filtered =
    activeCategory === 'All' ? skills : skills.filter((sk) => sk.category === activeCategory);
  const featured = skills.filter((sk) => sk.verified).slice(0, 3);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const visiblePages = buildVisiblePages(currentPage, totalPages);
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(total, currentPage * pageSize);
  const showFeatured =
    currentPage === 1 && searchQuery.trim().length === 0 && activeCategory === 'All';
  const showCategoryRow = categories.length > 0;

  function handleSearch() {
    onSearch?.(searchQuery, activeCategory === 'All' ? undefined : activeCategory);
  }

  function handleCatChange(cat: string) {
    setActiveCategory(cat);
    onSearch?.(searchQuery, cat === 'All' ? undefined : cat);
  }

  if (loading) {
    return (
      <div style={{ color: color.fgMuted, fontSize: 12, padding: `${spacing[6]}px 0` }}>
        加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        style={{ color: color.danger, fontSize: 12, lineHeight: 1.6, padding: `${spacing[4]}px 0` }}
      >
        {error}
      </div>
    );
  }

  return (
    <div data-openawork-skill-market="true" style={{ display: 'grid', gap: spacing[4] }}>
      <style>{styles}</style>

      {title ? (
        <div>
          <h2 style={{ color: color.fgStrong, fontSize: 14, fontWeight: 700, margin: 0 }}>
            {title}
          </h2>
          {subtitle ? (
            <p style={{ color: color.fgMuted, fontSize: 12, lineHeight: 1.6, margin: '2px 0 0' }}>
              {subtitle}
            </p>
          ) : null}
        </div>
      ) : null}

      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: spacing[2] }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          placeholder="搜索技能…"
          aria-label="搜索技能"
          style={searchInputStyle}
        />
        <button type="button" className="skm-install-btn" onClick={handleSearch}>
          搜索
        </button>
      </div>

      {showCategoryRow ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allCats.map((cat) => (
            <ToolbarButton
              key={cat}
              active={activeCategory === cat}
              onClick={() => handleCatChange(cat)}
            >
              {cat === 'All' ? '全部' : cat}
            </ToolbarButton>
          ))}
        </div>
      ) : null}

      {showFeatured && featured.length > 0 ? (
        <div style={{ display: 'grid', gap: spacing[2] }}>
          <div
            style={{
              color: color.fgMuted,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.6,
            }}
          >
            精选
          </div>
          <div style={gridStyle}>
            {featured.map((sk) => (
              <SkillCard key={sk.id} skill={sk} onInstall={onInstall} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ) : null}

      <div style={gridStyle}>
        {filtered.map((sk) => (
          <SkillCard key={sk.id} skill={sk} onInstall={onInstall} onSelect={onSelect} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: color.fgMuted, fontSize: 12, padding: `${spacing[4]}px 0` }}>
          {searchQuery.trim() ? '没有匹配的技能。' : '该分类下暂无技能。'}
        </div>
      ) : null}

      <div
        style={{
          alignItems: 'center',
          borderTop: `1px solid ${color.borderSubtle}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[3],
          justifyContent: 'space-between',
          paddingTop: spacing[3],
        }}
      >
        <div style={{ color: color.fgMuted, fontSize: 11 }}>
          显示 {rangeStart}-{rangeEnd} / 共 {total} 个技能
        </div>
        {totalPages > 1 ? (
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <ToolbarButton
              disabled={currentPage === 1}
              onClick={() => onPageChange?.(currentPage - 1)}
            >
              上一页
            </ToolbarButton>
            {visiblePages.map((page, index) => {
              const previous = visiblePages[index - 1];
              const showGap = previous !== undefined && page - previous > 1;
              return (
                <div key={page} style={{ alignItems: 'center', display: 'flex', gap: 6 }}>
                  {showGap ? <span style={{ color: color.fgMuted, fontSize: 11 }}>…</span> : null}
                  <button
                    type="button"
                    className={currentPage === page ? 'skm-install-btn' : 'skm-ghost-btn'}
                    onClick={() => onPageChange?.(page)}
                  >
                    {page}
                  </button>
                </div>
              );
            })}
            <ToolbarButton
              disabled={currentPage === totalPages}
              onClick={() => onPageChange?.(currentPage + 1)}
            >
              下一页
            </ToolbarButton>
          </div>
        ) : null}
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
  const installable = skill.installable !== false;
  return (
    <article
      className="skm-card"
      data-skm-card={skill.id}
      style={cardStyle}
      onClick={() => onSelect(skill.id)}
    >
      <div style={{ alignItems: 'flex-start', display: 'flex', gap: spacing[2] }}>
        <div
          style={{
            color: color.fgStrong,
            flex: 1,
            fontFamily: font.sans,
            fontSize: 12,
            fontWeight: 600,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={skill.name}
        >
          {skill.name}
        </div>
        {skill.verified ? (
          <span style={{ color: color.success, flexShrink: 0, fontSize: 10, fontWeight: 700 }}>
            ✓ 已验证
          </span>
        ) : null}
      </div>

      <div
        style={{
          color: color.fgMuted,
          display: '-webkit-box',
          fontSize: 12,
          lineHeight: 1.5,
          minHeight: 36,
          overflow: 'hidden',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        }}
      >
        {skill.description}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {skill.tags.slice(0, 3).map((t) => (
          <span
            key={t}
            style={{
              background: color.auxSubtle,
              borderRadius: radius.xs,
              color: color.aux,
              fontSize: 10,
              padding: '1px 6px',
            }}
          >
            {t}
          </span>
        ))}
      </div>

      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: spacing[2],
          justifyContent: 'space-between',
          marginTop: 'auto',
        }}
      >
        <span style={{ color: color.fgSubtle, fontSize: 11 }}>
          {(skill.downloads ?? 0).toLocaleString()} 次安装
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="skm-ghost-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(skill.id);
            }}
          >
            详情
          </button>
          <button
            type="button"
            className="skm-install-btn"
            disabled={!installable}
            title={installable ? undefined : '该来源暂不支持在产品内安装'}
            onClick={(e) => {
              e.stopPropagation();
              onInstall(skill.id);
            }}
          >
            {installable ? (skill.actionLabel ?? '安装') : '仅浏览'}
          </button>
        </div>
      </div>
    </article>
  );
}
