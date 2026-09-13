import { useCallback, useEffect, useState } from 'react';

/** 撤销条自动消失时长。 */
const UNDO_VISIBLE_MS = 3000;
/** 「再按一次 Esc」提示自动消失时长。 */
const ESCAPE_HINT_VISIBLE_MS = 2000;

export interface ComposerUndoToastState {
  readonly undoText: string | null;
  readonly escapeHint: boolean;
  /** 清空输入后展示可撤销提示。 */
  readonly showUndo: (text: string) => void;
  /** 首次按 Esc 时提示「再按一次」。 */
  readonly showEscapeHint: () => void;
  readonly hideEscapeHint: () => void;
  readonly dismiss: () => void;
}

/**
 * 管理输入框清空后的撤销条与 Esc 二次确认提示。
 *
 * 两者互斥：展示撤销条时不会同时展示提示，因此共用同一个渲染位置。
 */
export function useComposerUndoToast(): ComposerUndoToastState {
  const [undoText, setUndoText] = useState<string | null>(null);
  const [escapeHint, setEscapeHint] = useState(false);

  useEffect(() => {
    if (undoText === null) return;
    const id = window.setTimeout(() => setUndoText(null), UNDO_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [undoText]);

  useEffect(() => {
    if (!escapeHint) return;
    const id = window.setTimeout(() => setEscapeHint(false), ESCAPE_HINT_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [escapeHint]);

  const showUndo = useCallback((text: string) => {
    setEscapeHint(false);
    setUndoText(text);
  }, []);

  const showEscapeHint = useCallback(() => {
    setEscapeHint(true);
  }, []);

  const hideEscapeHint = useCallback(() => {
    setEscapeHint(false);
  }, []);

  const dismiss = useCallback(() => {
    setUndoText(null);
    setEscapeHint(false);
  }, []);

  return { undoText, escapeHint, showUndo, showEscapeHint, hideEscapeHint, dismiss };
}
