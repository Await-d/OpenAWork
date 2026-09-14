import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { extractTableData, toCsv, toDelimitedText } from './markdown-table-data.js';

/** 复制成功提示的停留时长，与代码块保持一致。 */
const COPY_FEEDBACK_MS = 1500;
/** 列数达到该值后收紧单元格内边距，避免宽表在聊天列里被挤爆。 */
const COMPACT_COLUMN_THRESHOLD = 6;
/** 判定「存在横向溢出」的容差，避免亚像素误差导致提示闪烁。 */
const OVERFLOW_EPSILON = 2;

/**
 * 聊天消息里的 Markdown 表格。
 *
 * 在原生 `<table>` 之上补三件事：
 *   1. 工具栏——行×列统计、一键复制（TSV，可直接粘进 Excel / 飞书表格）、
 *      下载 CSV（带 BOM，Excel 打开中文不乱码）；
 *   2. 独立滚动容器 + 右侧渐隐提示，宽表不会把整条消息撑出横向滚动条；
 *   3. 与主题同源的配色与密度（列多时自动收紧）。
 */
export const ChatMarkdownTable = memo(function ChatMarkdownTable({
  node,
  children,
}: {
  node?: unknown;
  children: ReactNode;
}) {
  const table = useMemo(() => extractTableData(node), [node]);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const { scrollRef, overflowing, atEnd } = useTableOverflow();

  useEffect(
    () => () => {
      if (copyTimerRef.current != null) {
        window.clearTimeout(copyTimerRef.current);
      }
    },
    [],
  );

  const rowCount = table?.rows.length ?? 0;
  const columnCount = table?.columnCount ?? 0;
  const density = columnCount >= COMPACT_COLUMN_THRESHOLD ? 'compact' : 'comfortable';

  // 复制内容包含表头；表头缺失时只有数据行。
  const pasteableText = useMemo(() => {
    if (!table) {
      return '';
    }

    const lines = table.header.length > 0 ? [table.header, ...table.rows] : table.rows;
    return toDelimitedText(lines, '\t');
  }, [table]);

  const csvText = useMemo(() => (table ? toCsv(table) : ''), [table]);

  const handleCopy = useCallback(() => {
    const writeText = navigator.clipboard?.writeText;
    if (!writeText || pasteableText === '') {
      return;
    }

    void writeText
      .call(navigator.clipboard, pasteableText)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current != null) {
          window.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => undefined);
  }, [pasteableText]);

  const handleDownload = useCallback(() => {
    if (csvText === '') {
      return;
    }

    // 前置 BOM：让 Excel 以 UTF-8 打开，中文列名不会变成乱码。
    const blob = new Blob([`\uFEFF${csvText}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `table-${Date.now()}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [csvText]);

  return (
    <div
      className="chat-markdown-table-shell"
      data-testid="chat-markdown-table"
      data-density={density}
    >
      {table && (
        <div className="chat-markdown-code-toolbar chat-markdown-table-toolbar">
          <div className="chat-markdown-code-toolbar-meta">
            <div className="chat-markdown-code-label">表格</div>
            <span className="chat-markdown-table-meta">{`${rowCount} 行 × ${columnCount} 列`}</span>
          </div>
          <div className="chat-markdown-code-actions">
            <button
              type="button"
              data-testid="chat-markdown-table-copy"
              data-copied={copied ? 'true' : undefined}
              className="chat-markdown-code-copy"
              title="复制为可粘贴到表格软件的纯文本"
              onClick={handleCopy}
            >
              {copied ? '✓ 已复制' : '复制表格'}
            </button>
            <button
              type="button"
              data-testid="chat-markdown-table-download"
              className="chat-markdown-code-copy"
              title="导出为 CSV 文件"
              onClick={handleDownload}
            >
              下载 CSV
            </button>
          </div>
        </div>
      )}
      <div className="chat-markdown-table-viewport">
        <div
          ref={scrollRef}
          className="chat-markdown-table-wrap"
          data-overflowing={overflowing ? 'true' : undefined}
          data-at-end={atEnd ? 'true' : undefined}
        >
          <table className="chat-markdown-table">{children}</table>
        </div>
        {overflowing && !atEnd && <span className="chat-markdown-table-fade" aria-hidden="true" />}
      </div>
    </div>
  );
});

interface TableOverflowState {
  scrollRef: RefObject<HTMLDivElement | null>;
  overflowing: boolean;
  atEnd: boolean;
}

/**
 * 跟踪表格滚动容器的横向溢出与是否已滚到最右。
 * 只在真的溢出时提示「右侧还有内容」，滚到底后又自动撤掉，避免长期视觉噪音。
 */
function useTableOverflow(): TableOverflowState {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ overflowing: false, atEnd: false });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    const update = (): void => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      const overflowing = maxScroll > OVERFLOW_EPSILON;
      const atEnd = !overflowing || maxScroll - element.scrollLeft <= OVERFLOW_EPSILON;
      setState((previous) =>
        previous.overflowing === overflowing && previous.atEnd === atEnd
          ? previous
          : { overflowing, atEnd },
      );
    };

    update();
    element.addEventListener('scroll', update, { passive: true });

    // 表格宽度既可能随容器变化（窗口缩放），也可能随内容变化（流式追加）。
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(element);
      const content = element.firstElementChild;
      if (content) {
        observer.observe(content);
      }
    } else {
      window.addEventListener('resize', update);
    }

    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
      if (!observer) {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  return { scrollRef, overflowing: state.overflowing, atEnd: state.atEnd };
}
