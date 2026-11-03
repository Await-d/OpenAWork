/**
 * 技能页左列：视图切换（市场 / 本地 / 已安装）+ 搜索 + 列表 + 视图相关底部动作。
 *
 * 形态取舍：市场不再用卡片网格——卡片把版本、来源、更新状态挤进视觉块里，横向比较
 * 需要来回扫视；列表行把「名称 · 版本 · 来源 · 状态」压到两行内，一屏能比较更多条目。
 */

import { Fragment } from 'react';
import { SkillsTabBar } from './skills-tab-bar.js';
import { buildVisiblePages, formatSourceLabel } from './skills-page-model.js';
import type { SkillRow } from './skills-page-model.js';
import type { SkillsTab } from './skills-tab-bar.js';

function SkillRowButton({
  row,
  active,
  onSelect,
}: {
  row: SkillRow;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`console-row skills-row${active ? ' is-active' : ''}`}
      aria-current={active ? 'true' : undefined}
      title={row.description || row.name}
      onClick={() => onSelect(row.id)}
    >
      <span className="skills-row__name">
        {row.verified ? (
          <span className="console-badge console-badge--success" title="已验证来源">
            ✓
          </span>
        ) : null}
        <span>{row.name}</span>
      </span>
      <span className="skills-row__ver">
        {row.hasUpdate && row.latestVersion ? (
          <>
            v{row.version} → v{row.latestVersion}
          </>
        ) : (
          <>v{row.version}</>
        )}
      </span>
      <span className="skills-row__sub">
        {row.preinstalled ? <span className="console-badge">系统预装</span> : null}
        {row.systemSourced ? (
          <span className="console-badge console-badge--aux">系统目录</span>
        ) : null}
        {row.hasUpdate ? (
          <span className="console-badge console-badge--contrast">可更新</span>
        ) : row.installedVersion !== null ? (
          <span className="console-badge">已安装</span>
        ) : null}
        {row.enabled === false ? <span className="console-badge">已禁用</span> : null}
        <span className="skills-row__src" title={row.source}>
          {formatSourceLabel(row.source)}
        </span>
      </span>
    </button>
  );
}

export function SkillsCatalogList({
  activeTab,
  updateCount,
  onTabChange,
  query,
  onQueryChange,
  onSearch,
  rows,
  loading,
  error,
  selectedId,
  onSelect,
  currentPage,
  total,
  pageSize,
  onPageChange,
  onCheckUpdates,
  onRescan,
  busy,
}: {
  activeTab: SkillsTab;
  updateCount: number;
  onTabChange: (tab: SkillsTab) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  rows: SkillRow[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  currentPage: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onCheckUpdates: () => void;
  onRescan: () => void;
  busy: boolean;
}) {
  const isMarket = activeTab === 'market';
  const totalPages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  const visiblePages = buildVisiblePages(currentPage, totalPages);
  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(total, currentPage * pageSize);
  const updateLabel = rows.filter((row) => row.hasUpdate).length;

  return (
    <section className="console-col" aria-label="技能列表">
      <div className="console-col__head">
        <SkillsTabBar activeTab={activeTab} updateCount={updateCount} onTabChange={onTabChange} />
      </div>

      <div className="skills-search console-search">
        <input
          className="console-field"
          value={query}
          placeholder={isMarket ? '搜索技能…' : '按名称或路径过滤…'}
          aria-label="搜索技能"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSearch();
            }
          }}
        />
        {isMarket ? (
          <button type="button" className="console-btn console-btn--sm" onClick={onSearch}>
            搜索
          </button>
        ) : null}
      </div>

      <div className="console-col__scroll">
        {error ? (
          <div className="console-alert console-alert--inset" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="console-empty">正在加载技能列表…</div>
        ) : rows.length === 0 ? (
          <div className="console-empty">
            {isMarket
              ? '没有匹配的技能。'
              : activeTab === 'local'
                ? '未在工作区发现技能。'
                : '暂无已安装技能。'}
          </div>
        ) : (
          rows.map((row) => (
            <SkillRowButton
              key={row.id}
              row={row}
              active={row.id === selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {isMarket ? (
        totalPages > 1 ? (
          <div className="skills-pager">
            <span className="console-statline">
              显示 <b>{rangeStart}</b>-<b>{rangeEnd}</b> / 共 <b>{total}</b>
            </span>
            <span className="console-spacer" />
            <button
              type="button"
              className="console-btn console-btn--sm"
              disabled={currentPage === 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              上一页
            </button>
            {visiblePages.map((page, index) => (
              <Fragment key={page}>
                {visiblePages[index - 1] !== undefined && page - visiblePages[index - 1]! > 1 ? (
                  <span className="console-statline">…</span>
                ) : null}
                <button
                  type="button"
                  className={`skills-pager__page${page === currentPage ? ' is-active' : ''}`}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </button>
              </Fragment>
            ))}
            <button
              type="button"
              className="console-btn console-btn--sm"
              disabled={currentPage === totalPages}
              onClick={() => onPageChange(currentPage + 1)}
            >
              下一页
            </button>
          </div>
        ) : (
          <div className="skills-pager">
            <span className="console-statline">
              共 <b>{total}</b> 个技能
            </span>
          </div>
        )
      ) : null}

      {activeTab === 'local' ? (
        <div className="skills-pager">
          <span className="console-statline">
            工作区技能 <b>{rows.length}</b> 个
          </span>
          <span className="console-spacer" />
          <button
            type="button"
            className="console-btn console-btn--sm"
            disabled={busy}
            onClick={onRescan}
          >
            重新扫描
          </button>
        </div>
      ) : null}

      {activeTab === 'installed' ? (
        <div className="skills-pager">
          <span className={`console-statline${updateLabel > 0 ? ' console-statline--warn' : ''}`}>
            已安装 <b>{rows.length}</b>
            {updateLabel > 0 ? (
              <>
                {' '}
                · 可更新 <b>{updateLabel}</b>
              </>
            ) : null}
          </span>
          <span className="console-spacer" />
          <button
            type="button"
            className="console-btn console-btn--sm"
            disabled={busy}
            onClick={onCheckUpdates}
          >
            检查更新
          </button>
        </div>
      ) : null}
    </section>
  );
}
