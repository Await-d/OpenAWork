import { useCallback, useState } from 'react';

/** 超过该长度的粘贴文本折叠为内联卡片，不进入 textarea。 */
export const PASTE_COLLAPSE_THRESHOLD = 500;

export interface CollapsedPaste {
  readonly text: string;
  readonly lineCount: number;
}

export interface ComposerPasteCollapse {
  readonly collapsed: CollapsedPaste | null;
  readonly previewExpanded: boolean;
  /** 折叠一段粘贴文本，并收起展开态。 */
  readonly collapse: (text: string) => void;
  /** 清除折叠内容并收起展开态。 */
  readonly clear: () => void;
  readonly togglePreview: () => void;
  readonly updateText: (text: string) => void;
}

/**
 * 管理「大段粘贴折叠成卡片」的状态。
 *
 * 折叠期间文本不进入 textarea，用户可继续正常输入；发送/入队时由调用方把
 * 折叠文本与当前输入合并后一并提交。
 */
export function useComposerPasteCollapse(): ComposerPasteCollapse {
  const [collapsed, setCollapsed] = useState<CollapsedPaste | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const collapse = useCallback((text: string) => {
    setCollapsed({ text, lineCount: text.split('\n').length });
    setPreviewExpanded(false);
  }, []);

  const clear = useCallback(() => {
    setCollapsed(null);
    setPreviewExpanded(false);
  }, []);

  const togglePreview = useCallback(() => {
    setPreviewExpanded((previous) => !previous);
  }, []);

  const updateText = useCallback((text: string) => {
    setCollapsed((previous) => (previous ? { ...previous, text } : previous));
  }, []);

  return { collapsed, previewExpanded, collapse, clear, togglePreview, updateText };
}
