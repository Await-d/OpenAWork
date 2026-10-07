/**
 * XLSX preview — uses SheetJS to parse the workbook and render each
 * sheet as an HTML table. A tab bar at the top switches between
 * sheets; the active sheet renders into a scrollable container.
 *
 * Numbers and dates use SheetJS' formatted text (`{type:'string'}`)
 * so values look like the user expected (123,456.78 not 123456.78,
 * dates as locale strings) without us having to reimplement Excel
 * formatting.
 *
 * Bundle: `xlsx` (SheetJS Community) is ~1.2MB minified — we lazy
 * load this component (parent already wraps in Suspense) so users
 * not opening spreadsheets don't pay the cost.
 */

import { useEffect, useMemo, useState } from 'react';
import { sanitizeRichHtml } from '../../utils/html/sanitize-rich-html.js';

/**
 * 单表最多读取的行数。用来限制不可信工作簿的解析与渲染规模（配合下方
 * `XLSX.read` 的 `sheetRows`），避免一个几十万行的表把主线程卡死。
 */
const MAX_SHEET_ROWS = 2_000;

interface SheetData {
  name: string;
  html: string;
}

interface XlsxPreviewProps {
  buffer: ArrayBuffer;
}

export default function XlsxPreview({ buffer }: XlsxPreviewProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; sheets: SheetData[] }
    | { status: 'error'; error: string }
  >({ status: 'loading' });
  const [activeSheet, setActiveSheet] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const XLSX = await import('xlsx');
        // 依赖当前锁定在 xlsx@0.18.x：该版本对 CVE-2024-22363（ReDoS）与
        // CVE-2023-30533（原型污染）均未修复，而输入是工作区里可能来自第三方
        // 仓库的不可信文件。升级 SheetJS 需要评估破坏性变更，因此先用
        // `sheetRows` 限制单表行数，压缩恶意文件的爆炸半径。
        const workbook = XLSX.read(buffer, { type: 'array', sheetRows: MAX_SHEET_ROWS });
        const sheets: SheetData[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name];
          if (!sheet) return { name, html: '' };
          // `sheet_to_html` honours merged cells and Excel formats. It does NOT
          // sanitise, hence the whitelist pass before it reaches the host DOM.
          const html = sanitizeRichHtml(
            XLSX.utils.sheet_to_html(sheet, {
              id: 'oaw-xlsx-table',
              editable: false,
            }),
          );
          return { name, html };
        });
        if (cancelled) return;
        setState({ status: 'ready', sheets });
        setActiveSheet(0);
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : '解析失败',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buffer]);

  const activeSheetData = useMemo(() => {
    if (state.status !== 'ready') return null;
    return state.sheets[activeSheet] ?? null;
  }, [state, activeSheet]);

  if (state.status === 'loading') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--fg-muted)',
          fontSize: 12,
        }}
      >
        正在解析 XLSX…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--danger)',
          fontSize: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        XLSX 解析失败:{state.error}
      </div>
    );
  }

  return (
    <div
      data-testid="xlsx-preview"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-overlay)',
      }}
    >
      {state.sheets.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {state.sheets.map((sheet, i) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => setActiveSheet(i)}
              aria-pressed={activeSheet === i}
              style={{
                height: 24,
                padding: '0 10px',
                borderRadius: 5,
                border: '1px solid var(--border-subtle)',
                background: activeSheet === i ? 'var(--accent)' : 'transparent',
                color: activeSheet === i ? 'var(--fg-on-accent)' : 'var(--fg-default)',
                fontSize: 11,
                fontWeight: activeSheet === i ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 16,
        }}
      >
        <div
          className="xlsx-preview-table"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: 8,
            color: 'var(--fg-default)',
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
            overflow: 'auto',
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 已由 sanitizeRichHtml 白名单清洗
          dangerouslySetInnerHTML={{ __html: activeSheetData?.html ?? '' }}
        />
      </div>
    </div>
  );
}
