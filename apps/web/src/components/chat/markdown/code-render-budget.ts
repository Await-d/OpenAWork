interface CodeBudgetNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: CodeBudgetNode[];
}

export const MAX_CODE_PREVIEW_CHARS = 12_000;
export const CODE_PREVIEW_LINES = 36;

/** 在 highlighter 运行前限额，保留完整源码给复制和显式展开。 */
export function rehypeCodeHighlightBudget() {
  return (tree: CodeBudgetNode) => {
    let remaining = 80_000;
    const visit = (node: CodeBudgetNode): void => {
      if (node.type === 'element' && node.tagName === 'code') {
        const text = (node.children ?? [])
          .map((child) => (child.type === 'text' ? (child.value ?? '') : ''))
          .join('');
        if (text.length > remaining || text.split('\n').length > 101) {
          const properties = (node.properties ??= {});
          const classes = properties.className;
          properties.className = [...(Array.isArray(classes) ? classes : []), 'no-highlight'];
        } else {
          remaining -= text.length;
        }
        return;
      }
      for (const child of node.children ?? []) {
        if (child.type === 'element') visit(child);
      }
    };
    visit(tree);
  };
}

export function codePreviewText(text: string): string {
  return text.split('\n', CODE_PREVIEW_LINES).join('\n').slice(0, MAX_CODE_PREVIEW_CHARS);
}
