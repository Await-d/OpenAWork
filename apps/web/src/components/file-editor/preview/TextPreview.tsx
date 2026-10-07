import { useMemo } from 'react';
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
 */

/** 渲染上限：面板再大也没必要把十万行铺进 DOM，超出部分只提示。 */
export const TEXT_PREVIEW_MAX_LINES = 2000;

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
  const visibleLines = allLines.slice(0, TEXT_PREVIEW_MAX_LINES);
  const highlighted = useMemo(
    () => highlightCodeLines(visibleLines.join('\n'), language),
    [visibleLines, language],
  );

  const padWidth = String(visibleLines.length).length;
  const badge = language !== 'plaintext' ? language : `${allLines.length} 行`;

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
      {allLines.length > TEXT_PREVIEW_MAX_LINES && (
        <div className="oaw-preview-status" data-testid="file-editor-text-truncated">
          {`已展示前 ${TEXT_PREVIEW_MAX_LINES} 行，共 ${allLines.length} 行。可在左侧编辑器中查看完整内容。`}
        </div>
      )}
    </div>
  );
}
