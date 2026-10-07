import { useMemo } from 'react';
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
 */
export function CsvPreview({
  content,
  delimiter,
  path,
}: {
  content: string;
  delimiter: string;
  path: string;
}) {
  const preview = useMemo(
    () => parseDelimitedPreview(content, delimiter, DEFAULT_DELIMITED_PREVIEW_ROWS),
    [content, delimiter],
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
        <div className="oaw-preview-status" data-testid="file-editor-csv-truncated">
          {`已展示前 ${preview.parsedLines} 行，另有 ${preview.truncatedRows} 行未渲染。可在左侧编辑器中查看完整内容。`}
        </div>
      )}
    </div>
  );
}
