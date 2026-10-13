import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { detectLanguage, highlightCodeLines } from '@openAwork/shared-ui';
import type { DiffToken } from '@openAwork/shared-ui';
import { CopyButton } from './CopyButton.js';
import { PreviewToolbar } from './PreviewToolbar.js';
import './preview-surface.css';

/**
 * 纯文本预览（txt / log / yaml / xml / sql 等）：行号 + 语法高亮。
 *
 * 高亮复用 `@openAwork/shared-ui` 的 lowlight 封装（与工具调用的文件内容
 * 预览、diff 预览同一套），超预算或语言不支持时自动退回纯文本。
 *
 * 行数超过首屏上限时提供「显示更多」渐进加载：既避免把十万行一次铺进
 * DOM，又不必离开预览面板去看编辑器。
 */

/** 首屏渲染上限：先渲染这部分，其余通过「显示更多」按需追加。 */
export const TEXT_PREVIEW_MAX_LINES = 2000;

/** 「显示更多」单次追加的行数。 */
export const TEXT_PREVIEW_LINE_STEP = 5000;

/** 渲染高亮 token；无高亮时退回纯文本，空行保留一行高度。 */
function renderTokens(tokens: DiffToken[] | undefined, line: string): ReactNode {
  if (!tokens || tokens.length === 0) {
    return line || ' ';
  }

  return tokens.map((token, index) => {
    const key = `${index}:${token.text.slice(0, 8)}`;
    return token.className ? (
      <span key={key} className={token.className}>
        {token.text}
      </span>
    ) : (
      <span key={key}>{token.text}</span>
    );
  });
}

export function TextPreview({ content, path }: { content: string; path: string }) {
  const language = useMemo(() => detectLanguage(path), [path]);
  const allLines = useMemo(() => content.split('\n'), [content]);
  const [visibleLimit, setVisibleLimit] = useState(TEXT_PREVIEW_MAX_LINES);

  // 切换文件时复位渐进上限：避免上一个文件展开到全部后，新文件一进来
  // 就承担大渲染（尤其是超大日志文件）。
  useEffect(() => {
    setVisibleLimit(TEXT_PREVIEW_MAX_LINES);
  }, [path]);

  const visibleLines = useMemo(() => allLines.slice(0, visibleLimit), [allLines, visibleLimit]);
  const highlighted = useMemo(
    () => highlightCodeLines(visibleLines.join('\n'), language),
    [visibleLines, language],
  );

  const padWidth = String(visibleLines.length).length;
  const badge = language !== 'plaintext' ? language : `${allLines.length} 行`;
  const hiddenLines = allLines.length - visibleLines.length;

  return (
    <div
      className="oaw-preview"
      data-testid="file-editor-text-preview"
      style={{ padding: 12, boxSizing: 'border-box', background: 'var(--bg-overlay)' }}
    >
      <PreviewToolbar label="TEXT" badge={badge}>
        <CopyButton text={content} label="复制源码" testId="file-editor-text-copy" />
      </PreviewToolbar>
      <div
        className="oaw-preview-code"
        data-testid="file-editor-text-code"
        role="region"
        aria-label="文件内容"
      >
        {visibleLines.map((line, index) => (
          <div className="oaw-preview-code-line" key={index}>
            <span className="oaw-preview-code-num" aria-hidden="true">
              {String(index + 1).padStart(padWidth, ' ')}
            </span>
            <span className="oaw-preview-code-text">
              {renderTokens(highlighted?.[index], line)}
            </span>
          </div>
        ))}
      </div>
      {hiddenLines > 0 && (
        <div
          className="oaw-preview-status"
          data-testid="file-editor-text-truncated"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>{`已展示前 ${visibleLimit} 行，共 ${allLines.length} 行。`}</span>
          <button
            type="button"
            className="oaw-preview-btn"
            data-testid="file-editor-text-show-more"
            onClick={() =>
              setVisibleLimit((limit) => Math.min(limit + TEXT_PREVIEW_LINE_STEP, allLines.length))
            }
          >
            {hiddenLines <= TEXT_PREVIEW_LINE_STEP
              ? `显示余下 ${hiddenLines} 行`
              : `显示更多（+${TEXT_PREVIEW_LINE_STEP} 行）`}
          </button>
        </div>
      )}
    </div>
  );
}
