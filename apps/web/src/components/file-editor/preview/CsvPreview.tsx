import { useEffect, useMemo, useState } from 'react';
import {
  parseDelimitedPreview,
  DEFAULT_DELIMITED_PREVIEW_ROWS,
} from '../../../utils/file/parse-delimited-preview.js';
import { CopyButton } from './CopyButton.js';
import { PreviewToolbar } from './PreviewToolbar.js';
import './preview-surface.css';

/**
 * CSV / TSV 表格预览：首行作表头，数据行按列对齐，列宽自适应 + 横向滚动。
 *
 * 与产物侧的 CSV 预览（`artifact-preview-surface.tsx`）共用
 * `parseDelimitedPreview`，区别只在这里有工具栏、行数统计与更大的行上限。
 *
 * 超过首屏行数时提供「显示更多」渐进加载，不必离开预览面板去看编辑器。
 */

/** 「显示更多」单次追加的数据行数。 */
export const CSV_PREVIEW_ROW_STEP = 500;

export function CsvPreview({
  content,
  delimiter,
  path,
}: {
  content: string;
  delimiter: string;
  path: string;
}) {
  const [rowLimit, setRowLimit] = useState(DEFAULT_DELIMITED_PREVIEW_ROWS);

  // 切换文件时复位渐进上限（与 TextPreview 同一口径）。
  useEffect(() => {
    setRowLimit(DEFAULT_DELIMITED_PREVIEW_ROWS);
  }, [path]);

  const preview = useMemo(
    () => parseDelimitedPreview(content, delimiter, rowLimit),
    [content, delimiter, rowLimit],
  );
  const summary =
    preview.headers.length === 0
      ? '空文件'
      : `${preview.headers.length} 列 · ${preview.rows.length} 行`;

  if (preview.headers.length === 0) {
    return (
      <div
        className="oaw-preview"
        data-testid="file-editor-csv-preview"
        style={{ padding: 12, boxSizing: 'border-box', background: 'var(--bg-overlay)' }}
      >
        <PreviewToolbar label={delimiter === '\t' ? 'TSV' : 'CSV'} badge={summary} />
        <pre className="oaw-preview-source">{content}</pre>
      </div>
    );
  }

  return (
    <div
      className="oaw-preview"
      data-testid="file-editor-csv-preview"
      style={{ padding: 12, boxSizing: 'border-box', background: 'var(--bg-overlay)' }}
    >
      <PreviewToolbar label={delimiter === '\t' ? 'TSV' : 'CSV'} badge={summary}>
        <CopyButton text={content} label="复制源码" testId="file-editor-csv-copy" />
      </PreviewToolbar>
      <div className="oaw-preview-table-wrap" data-testid="file-editor-csv-table">
        <table className="oaw-preview-table">
          <thead>
            <tr>
              {preview.headers.map((header, index) => (
                <th key={`${header}-${index}`} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join('|')}`}>
                {preview.headers.map((_header, columnIndex) => (
                  <td key={`${rowIndex}-${columnIndex}`}>{row[columnIndex] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.truncatedRows > 0 && (
        <div
          className="oaw-preview-status"
          data-testid="file-editor-csv-truncated"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{`已展示前 ${preview.parsedLines} 行，另有 ${preview.truncatedRows} 行未渲染。`}</span>
          <button
            type="button"
            className="oaw-preview-btn"
            data-testid="file-editor-csv-show-more"
            onClick={() => setRowLimit((limit) => limit + CSV_PREVIEW_ROW_STEP)}
          >
            {preview.truncatedRows <= CSV_PREVIEW_ROW_STEP
              ? `显示余下 ${preview.truncatedRows} 行`
              : `显示更多（+${CSV_PREVIEW_ROW_STEP} 行）`}
          </button>
        </div>
      )}
    </div>
  );
}
