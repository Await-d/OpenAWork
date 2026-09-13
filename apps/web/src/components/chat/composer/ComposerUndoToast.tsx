export interface ComposerUndoToastProps {
  /** 被清空的文本；非 null 时展示撤销操作。 */
  readonly undoText: string | null;
  /** 是否展示「再按一次 Esc」提示。 */
  readonly escapeHint: boolean;
  readonly onRestore: (text: string) => void;
  readonly onDismiss: () => void;
}

/** 清空输入后的撤销条，以及连按 Esc 的二次确认提示，两者共用同一位置。 */
export function ComposerUndoToast({
  undoText,
  escapeHint,
  onRestore,
  onDismiss,
}: ComposerUndoToastProps) {
  if (undoText === null && !escapeHint) return null;

  return (
    <div className="composer-undo-toast">
      {undoText === null ? (
        <span>再按一次 Esc 清空输入</span>
      ) : (
        <>
          <span>已清空输入</span>
          <button
            type="button"
            className="composer-undo-toast__action"
            onClick={() => onRestore(undoText)}
          >
            恢复
          </button>
          <button
            type="button"
            className="composer-undo-toast__dismiss"
            onClick={onDismiss}
            aria-label="关闭提示"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}
