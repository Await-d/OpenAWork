import { useState } from 'react';
import type { ResultBadge, ResultRow, ResultTable, ResultView } from '../shared/result-view.js';
import { resultToneIndex } from '../shared/result-view.js';

/**
 * 「结果视图」的唯一渲染器：行卡列表与表格两种形态。
 *
 * 管理类、模型检索、渠道读取三类工具的 view-model 各不相同，但最终都收敛到这里，
 * 因此行高、徽章、空状态、hover 行为只有一份实现。
 *
 * `alternate` 用于同一份数据存在两种合理排版的情况（`models` 的行卡适合「确认某个
 * 模型在不在」、表格适合「比价」）——两者互斥，给个切换比硬选一个更实在。
 */
export function ResultViewPreview({
  view,
  alternate,
}: {
  view: ResultView;
  alternate?: ResultView;
}) {
  const [showAlternate, setShowAlternate] = useState(false);
  const active = showAlternate && alternate !== undefined ? alternate : view;

  const hasRows = (active.groups?.length ?? 0) > 0;
  if (!hasRows && !active.table) return null;

  return (
    <div className="result-view">
      {(active.note !== undefined || alternate !== undefined) && (
        <div className="result-view-bar">
          <span className="result-view-note">{active.note ?? ''}</span>
          <span className="result-view-spacer" />
          {alternate !== undefined && (
            <button
              type="button"
              className="result-view-toggle"
              onClick={() => setShowAlternate((previous) => !previous)}
            >
              {showAlternate ? '行卡视图' : '表格视图'}
            </button>
          )}
        </div>
      )}

      {active.groups?.map((group, groupIndex) => (
        <div className="result-group" key={`${group.label ?? ''}-${groupIndex}`}>
          {group.label && (
            <div className="result-group-title">
              {group.label}
              {group.count !== undefined && (
                <span className="result-badge" data-tone="count">
                  {group.count}
                </span>
              )}
            </div>
          )}
          <div className="result-rows">
            {group.rows.map((row, rowIndex) => (
              <ResultRowItem row={row} key={`${row.title}-${rowIndex}`} />
            ))}
          </div>
        </div>
      ))}

      {active.table && <ResultTableView table={active.table} />}

      {active.footnote && <div className="result-view-footnote">{active.footnote}</div>}
    </div>
  );
}

function ResultRowItem({ row }: { row: ResultRow }) {
  return (
    <div className="result-row">
      {row.avatar !== undefined && (
        <span
          className="result-row-avatar"
          data-tone={row.tone ?? resultToneIndex(row.title)}
          aria-hidden="true"
        >
          {row.avatar}
        </span>
      )}
      <span className="result-row-main">
        <span className="result-row-line">
          <span className="result-row-title">{row.title}</span>
          {row.badges?.map((badge) => (
            <ResultBadgeChip badge={badge} key={`${badge.tone}-${badge.label}`} />
          ))}
        </span>
        {row.description && <span className="result-row-desc">{row.description}</span>}
        {row.meta && row.meta.length > 0 && (
          <span className="result-row-meta">
            {row.meta.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </span>
        )}
      </span>
      {row.trailing && (
        <span className="result-row-trailing" title={row.trailingTitle}>
          {row.trailing}
        </span>
      )}
    </div>
  );
}

function ResultBadgeChip({ badge }: { badge: ResultBadge }) {
  return (
    <span className="result-badge" data-tone={badge.tone}>
      {badge.label}
    </span>
  );
}

function ResultTableView({ table }: { table: ResultTable }) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          {table.columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {table.columns.map((column, cellIndex) => {
              const cell = row[cellIndex];
              return (
                <td
                  key={column}
                  data-mono={cell?.mono ? 'true' : undefined}
                  data-strong={cell?.strong ? 'true' : undefined}
                >
                  {cell?.badge ? <ResultBadgeChip badge={cell.badge} /> : (cell?.text ?? '')}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
