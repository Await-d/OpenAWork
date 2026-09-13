export interface ComposerDragOverlayProps {
  readonly visible: boolean;
}

/** 文件拖入输入框时覆盖在 composer-shell 上的提示层。 */
export function ComposerDragOverlay({ visible }: ComposerDragOverlayProps) {
  if (!visible) return null;

  return (
    <div className="composer-drag-overlay">
      <span className="composer-drag-overlay__label">释放以添加附件</span>
    </div>
  );
}
