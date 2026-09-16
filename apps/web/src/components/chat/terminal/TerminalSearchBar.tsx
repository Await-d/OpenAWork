/**
 * 终端内嵌搜索条（Ctrl/⌘+F 打开）。
 *
 * 三个设计约束：
 *  - 绝对定位浮在终端右上角，**未打开时不渲染**，所以不会改变 xterm 的
 *    容器尺寸（`FitAddon` 不会因此触发多余的 resize）；
 *  - 每次输入即增量搜索（和 VS Code 一致），`findNext` 返回 false 时
 *    展示「无结果」而不是静默失败；
 *  - 搜索不到时也要能继续操作：用户可以直接改词或 Esc 关闭。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from './TerminalIcons.js';

export interface TerminalSearchBarProps {
  open: boolean;
  onClose: () => void;
  onFindNext: (term: string, caseSensitive: boolean) => boolean;
  onFindPrevious: (term: string, caseSensitive: boolean) => boolean;
}

export function TerminalSearchBar({
  open,
  onClose,
  onFindNext,
  onFindPrevious,
}: TerminalSearchBarProps) {
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [noResult, setNoResult] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setNoResult(false);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  if (!open) return null;

  const runFind = (direction: 'next' | 'previous', value: string, matchCase: boolean) => {
    if (value.length === 0) {
      setNoResult(false);
      return;
    }
    const found =
      direction === 'next' ? onFindNext(value, matchCase) : onFindPrevious(value, matchCase);
    setNoResult(!found);
  };

  return (
    <div className="terminal-search-bar" data-testid="terminal-search-bar" role="search">
      <input
        ref={inputRef}
        className="terminal-search-input"
        data-testid="terminal-search-input"
        // 面板级快捷键放行判据，见 terminal-panel-shortcuts.ts 的 TERMINAL_UI_INPUT_ATTR
        data-terminal-ui-input=""
        type="text"
        value={term}
        placeholder="在终端中搜索"
        aria-label="在终端中搜索"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value;
          setTerm(value);
          runFind('next', value, caseSensitive);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setNoResult(false);
            onClose();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            runFind(event.shiftKey ? 'previous' : 'next', term, caseSensitive);
          }
        }}
      />
      {noResult ? (
        <span className="terminal-search-status" role="status" data-testid="terminal-search-status">
          无结果
        </span>
      ) : null}
      <button
        type="button"
        className="terminal-overlay-btn"
        aria-label="上一个匹配"
        title="上一个匹配 (Shift+Enter)"
        onClick={() => runFind('previous', term, caseSensitive)}
      >
        <ChevronUpIcon />
      </button>
      <button
        type="button"
        className="terminal-overlay-btn"
        aria-label="下一个匹配"
        title="下一个匹配 (Enter)"
        onClick={() => runFind('next', term, caseSensitive)}
      >
        <ChevronDownIcon />
      </button>
      <button
        type="button"
        className="terminal-overlay-btn"
        aria-label="区分大小写"
        aria-pressed={caseSensitive}
        title="区分大小写"
        onClick={() => {
          const next = !caseSensitive;
          setCaseSensitive(next);
          runFind('next', term, next);
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 11, fontWeight: 600 }}>
          Aa
        </span>
      </button>
      <button
        type="button"
        className="terminal-overlay-btn"
        aria-label="关闭搜索"
        title="关闭搜索 (Esc)"
        onClick={() => {
          setNoResult(false);
          onClose();
        }}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
