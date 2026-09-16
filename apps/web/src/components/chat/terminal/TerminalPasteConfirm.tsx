/**
 * 大段粘贴的二次确认（T-03 粘贴保护）。
 *
 * 贴底内嵌而不是全屏模态：终端里读日志时被一整屏遮罩打断的体验很差，
 * 底部条既完成确认，又保留上下文可见。
 */

import { useEffect, useRef, useState } from 'react';
import type { PasteGuardSummary } from './terminal-paste-guard.js';
import { AlertTriangleIcon } from './TerminalIcons.js';

export interface TerminalPasteConfirmProps {
  summary: PasteGuardSummary;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function TerminalPasteConfirm({ summary, onConfirm, onCancel }: TerminalPasteConfirmProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-label="确认粘贴大段文本"
      aria-modal="true"
      data-testid="terminal-paste-confirm"
      className="terminal-paste-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="terminal-paste-confirm__head">
        <span className="terminal-paste-confirm__icon">
          <AlertTriangleIcon size={16} />
        </span>
        <span>
          即将粘贴 {summary.chars} 个字符
          {summary.lines > 0 ? ` · ${summary.lines} 个换行` : ''}
          ，可能直接执行多条命令
        </span>
      </div>
      <pre className="terminal-paste-confirm__preview">{summary.preview}</pre>
      <div className="terminal-paste-confirm__foot">
        <label className="terminal-paste-confirm__remember">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(event) => setDontAskAgain(event.target.checked)}
          />
          不再提示
        </label>
        <span className="terminal-paste-confirm__buttons">
          <button
            type="button"
            className="terminal-paste-confirm__cancel"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="terminal-paste-confirm__confirm"
            onClick={() => onConfirm(dontAskAgain)}
          >
            确认粘贴
          </button>
        </span>
      </div>
    </div>
  );
}
