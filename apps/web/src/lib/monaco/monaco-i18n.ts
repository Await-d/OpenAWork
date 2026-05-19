/**
 * Lightweight Chinese localization for Monaco editor's overlays
 * (right-click context menu, command palette, hover popups, etc.).
 *
 * Why DOM-level:
 *   `monaco-editor` ESM bakes English strings into every `localize()`
 *   call at module load time. The official locale switch (`vs/nls`)
 *   only works through the AMD loader on the CDN, which we deliberately
 *   bypass via `loader.config({ monaco })` (see ./monaco-loader.ts).
 *   Replacing labels on the rendered menu is contained, easy to update,
 *   and degrades gracefully — anything we don't translate stays in
 *   English.
 *
 * How it works:
 *   A permanent MutationObserver on `<html>` re-runs translation on
 *   every relevant DOM change. **Crucially we observe documentElement,
 *   not body** — Monaco mounts its `.context-view` overlay as a direct
 *   child of `<html>`, so observing only `<body>` would miss the
 *   insertion entirely. The translateAll() filter inside the callback
 *   ignores anything outside Monaco's overlay containers, so cost
 *   stays low.
 *
 *   We also listen on `contextmenu` and `mouseover` as belt-and-braces
 *   triggers — translation is idempotent, so extra passes are harmless.
 *
 *   Translation is keyed off the visible English string. To add a new
 *   entry, just append one line to TRANSLATIONS below.
 *
 * Idempotent: calling install twice is a no-op.
 */

/** English → Chinese map for menu labels we recognise. */
const TRANSLATIONS: Record<string, string> = {
  // ─── Editing ───────────────────────────────────────────────
  Cut: '剪切',
  Copy: '复制',
  Paste: '粘贴',
  'Copy As': '复制为',
  'Copy With Syntax Highlighting': '带语法高亮复制',
  Undo: '撤销',
  Redo: '重做',
  'Select All': '全选',

  // ─── Navigation ─────────────────────────────────────────────
  'Go to Definition': '转到定义',
  'Go to Declaration': '转到声明',
  'Go to Type Definition': '转到类型定义',
  'Go to Implementations': '转到实现',
  'Go to References': '转到引用',
  'Go to Symbol...': '转到符号…',
  'Go to Line/Column...': '转到行/列…',
  'Peek Definition': '速览定义',
  'Peek Declaration': '速览声明',
  'Peek Type Definition': '速览类型定义',
  'Peek Implementations': '速览实现',
  'Peek References': '速览引用',
  'Find All References': '查找所有引用',
  'Find All Implementations': '查找所有实现',

  // ─── Refactoring ────────────────────────────────────────────
  'Rename Symbol': '重命名符号',
  'Change All Occurrences': '更改所有匹配项',
  Refactor: '重构…',
  'Refactor...': '重构…',
  'Source Action': '源代码操作…',
  'Source Action...': '源代码操作…',
  'Quick Fix...': '快速修复…',
  'Format Document': '格式化文档',
  'Format Selection': '格式化选定内容',

  // ─── Find/Replace ───────────────────────────────────────────
  Find: '查找',
  Replace: '替换',
  'Find in Selection': '在选定内容中查找',

  // ─── Folding ────────────────────────────────────────────────
  Folding: '折叠',
  Fold: '折叠',
  Unfold: '展开',
  'Fold All': '全部折叠',
  'Unfold All': '全部展开',
  'Fold All Block Comments': '折叠所有块注释',
  'Fold All Regions': '折叠所有区域',
  'Unfold All Regions': '展开所有区域',
  'Toggle Fold': '切换折叠',

  // ─── Multi-cursor / selection ───────────────────────────────
  'Add Cursor Above': '在上方添加光标',
  'Add Cursor Below': '在下方添加光标',

  // ─── Command palette / misc ─────────────────────────────────
  'Command Palette': '命令面板',
  'Show Hover': '显示悬停',
  'Show Definition Preview Hover': '显示定义预览悬停',
};

function translateLabel(label: HTMLElement): boolean {
  const raw = label.textContent ?? '';
  const text = raw.trim();
  if (!text) return false;

  // Direct match.
  let translated = TRANSLATIONS[text];

  // Mnemonic-stripped match (Monaco/VS Code uses "&Foo" for alt-key
  // mnemonics; usually Monaco's `cleanMnemonic` strips them already,
  // but cover the path where mnemonics are enabled).
  if (!translated) {
    const cleaned = text.replace(/&&/g, '&').replace(/&([^&])/g, '$1');
    if (cleaned !== text) translated = TRANSLATIONS[cleaned];
  }

  // Trailing ellipsis variants: VS Code uses both "..." and "…"
  // depending on the action source.
  if (!translated) {
    if (text.endsWith('...')) translated = TRANSLATIONS[`${text.slice(0, -3)}…`];
    else if (text.endsWith('…')) translated = TRANSLATIONS[`${text.slice(0, -1)}...`];
  }

  if (!translated || translated === text) return false;

  label.textContent = translated;
  return true;
}

function translateAll(): void {
  const labels = document.querySelectorAll<HTMLElement>(
    '.monaco-menu .action-label, .action-widget .action-label, .context-view .action-label, .quick-input-widget .action-label',
  );
  labels.forEach(translateLabel);
}

let installed = false;

export function installMonacoI18n(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  // Permanent observer on <html> (NOT <body> — Monaco's `.context-view`
  // overlay attaches as a direct child of <html>).
  let lastLabelCount = 0;
  const observer = new MutationObserver(() => {
    const labels = document.querySelectorAll<HTMLElement>(
      '.monaco-menu .action-label, .context-view .action-label',
    );
    if (labels.length > 0 && labels.length !== lastLabelCount) {
      lastLabelCount = labels.length;
      // eslint-disable-next-line no-console
      console.debug(`[monaco-i18n] observer fired, found ${labels.length} labels`);
      labels.forEach(translateLabel);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Belt-and-braces: re-run after right-click and on hover inside an
  // overlay (submenu expansion).
  document.addEventListener(
    'contextmenu',
    () => {
      translateAll();
      requestAnimationFrame(translateAll);
      setTimeout(translateAll, 16);
      setTimeout(translateAll, 50);
      setTimeout(translateAll, 150);
    },
    true,
  );
  document.addEventListener(
    'mouseover',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t.closest('.monaco-menu') ||
        t.closest('.context-view') ||
        t.closest('.action-widget') ||
        t.closest('.quick-input-widget')
      ) {
        translateAll();
      }
    },
    true,
  );

  // Initial pass for anything already mounted.
  translateAll();
}
