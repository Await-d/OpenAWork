import { describe, expect, it, vi } from 'vitest';

import type { ContextMenuItem } from './ContextMenu.js';
import {
  buildContentContextMenuItems,
  type ContentContextMenuActions,
  type ContentContextMenuTarget,
  type ContentContextMenuVariant,
} from './content-context-menu-items.js';

const WORKSPACE = '/workspace/demo';

/** 编辑器场景：能力给满，便于逐条断言「有回调就有菜单项」。 */
function createEditorActions(): ContentContextMenuActions {
  return {
    copyText: vi.fn(),
    referenceToChat: vi.fn(),
    runEditorAction: vi.fn(),
    openInSystem: vi.fn(),
    close: vi.fn(),
    switchToCode: vi.fn(),
    switchToPreview: vi.fn(),
  };
}

function createTarget(overrides: Partial<ContentContextMenuTarget> = {}): ContentContextMenuTarget {
  return {
    path: `${WORKSPACE}/src/app.ts`,
    content: 'console.log(1);',
    selection: '',
    isActive: true,
    isBinary: false,
    ...overrides,
  };
}

interface BuildOptions {
  variant?: ContentContextMenuVariant;
  target?: ContentContextMenuTarget;
  workspacePath?: string | null;
  actions?: ContentContextMenuActions;
}

function build(options: BuildOptions = {}): {
  items: ContextMenuItem[];
  actions: ContentContextMenuActions;
} {
  const actions = options.actions ?? createEditorActions();
  const items = buildContentContextMenuItems({
    variant: options.variant ?? 'preview',
    target: options.target ?? createTarget(),
    workspacePath: options.workspacePath === undefined ? WORKSPACE : options.workspacePath,
    actions,
  });
  return { items, actions };
}

function actionableIds(items: ContextMenuItem[]): string[] {
  return items.filter((item) => item.type !== 'separator').map((item) => item.id);
}

function findItem(items: ContextMenuItem[], id: string): ContextMenuItem {
  const found = items.find((item) => item.id === id);
  if (!found) {
    throw new Error(`菜单项缺失：${id}`);
  }
  return found;
}

describe('buildContentContextMenuItems — 两种视图共有', () => {
  it('顶部以信息行展示完整路径', () => {
    const { items } = build();

    expect(actionableIds(items)[0]).toBe('target-path');
    expect(findItem(items, 'target-path')).toMatchObject({
      type: 'header',
      hint: '文件路径',
      label: `${WORKSPACE}/src/app.ts`,
    });
  });

  it('工作区内文件用相对路径引用到对话', () => {
    const { items, actions } = build();

    findItem(items, 'reference-to-chat').onSelect?.();

    expect(actions.referenceToChat).toHaveBeenCalledWith('@src/app.ts ');
  });

  it('工作区外文件禁用相对路径项，引用退回绝对路径', () => {
    const { items, actions } = build({ target: createTarget({ path: '/elsewhere/notes.md' }) });

    const relativeItem = findItem(items, 'copy-relative-path');
    expect(relativeItem.disabled).toBe(true);
    relativeItem.onSelect?.();
    expect(actions.copyText).not.toHaveBeenCalled();

    findItem(items, 'reference-to-chat').onSelect?.();
    expect(actions.referenceToChat).toHaveBeenCalledWith('@/elsewhere/notes.md ');
  });

  it('没有选区时不出现选中内容相关菜单项', () => {
    const { items } = build({ target: createTarget({ selection: '' }) });

    const ids = actionableIds(items);
    expect(ids).not.toContain('reference-selection-to-chat');
    expect(ids).not.toContain('copy-selection');
  });

  it('有选区时同时提供复制与引用选中内容', () => {
    const { items, actions } = build({ target: createTarget({ selection: 'const answer = 42;' }) });

    findItem(items, 'copy-selection').onSelect?.();
    expect(actions.copyText).toHaveBeenCalledWith('const answer = 42;');

    findItem(items, 'reference-selection-to-chat').onSelect?.();
    expect(actions.referenceToChat).toHaveBeenCalledWith('@src/app.ts\nconst answer = 42;');
  });

  it('复制路径类菜单项分别带上对应文本', () => {
    const { items, actions } = build();

    findItem(items, 'copy-path').onSelect?.();
    expect(actions.copyText).toHaveBeenLastCalledWith(`${WORKSPACE}/src/app.ts`);

    findItem(items, 'copy-relative-path').onSelect?.();
    expect(actions.copyText).toHaveBeenLastCalledWith('src/app.ts');

    findItem(items, 'copy-name').onSelect?.();
    expect(actions.copyText).toHaveBeenLastCalledWith('app.ts');
  });

  it('缺少工作区根路径时不出现可用的相对路径项', () => {
    const { items } = build({ workspacePath: null });

    expect(findItem(items, 'copy-relative-path').disabled).toBe(true);
    expect(findItem(items, 'target-path').label).toBe(`${WORKSPACE}/src/app.ts`);
  });

  it('相邻分组之间插入分隔线，且不出现连续分隔线', () => {
    const { items } = build();

    expect(items.some((item) => item.type === 'separator')).toBe(true);
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      expect(
        previous && current && previous.type === 'separator' && current.type === 'separator',
      ).toBe(false);
    }
  });
});

describe('buildContentContextMenuItems — 能力由回调是否存在决定', () => {
  it('没传 referenceToChat 就没有任何引用项', () => {
    const { items } = build({ actions: { copyText: vi.fn() } });

    const ids = actionableIds(items);
    expect(ids).not.toContain('reference-to-chat');
    expect(ids).not.toContain('reference-selection-to-chat');
  });

  it('没传 openInSystem 就隐藏「用系统默认程序打开」', () => {
    const withoutAction = build({ actions: { copyText: vi.fn() } }).items;
    expect(actionableIds(withoutAction)).not.toContain('open-in-system');

    const { items, actions } = build();
    expect(actionableIds(items)).toContain('open-in-system');
    findItem(items, 'open-in-system').onSelect?.();
    expect(actions.openInSystem).toHaveBeenCalledTimes(1);
  });

  it('没传 close 就不出现「关闭」项（产物预览这类无标签的面）', () => {
    const { items } = build({ actions: { copyText: vi.fn() } });

    expect(actionableIds(items)).not.toContain('close');
  });

  it('仅活跃标签展示关闭快捷键提示', () => {
    expect(
      findItem(build({ target: createTarget({ isActive: true }) }).items, 'close').shortcut,
    ).toBe('⌘W');
    expect(
      findItem(build({ target: createTarget({ isActive: false }) }).items, 'close').shortcut,
    ).toBeUndefined();
  });

  it('关闭动作正确转发', () => {
    const { items, actions } = build();

    findItem(items, 'close').onSelect?.();

    expect(actions.close).toHaveBeenCalledTimes(1);
  });
});

describe('buildContentContextMenuItems — 无路径的内容面（产物预览）', () => {
  const artifactTarget = createTarget({ path: undefined, content: '# 报告\n正文' });

  it('路径相关的整组动作都消失：信息行 / 引用 / 路径族复制项', () => {
    const { items } = build({
      target: artifactTarget,
      actions: { copyText: vi.fn(), referenceToChat: vi.fn() },
    });

    const ids = actionableIds(items);
    expect(ids).not.toContain('target-path');
    expect(ids).not.toContain('reference-to-chat');
    expect(ids).not.toContain('copy-path');
    expect(ids).not.toContain('copy-relative-path');
    expect(ids).not.toContain('copy-name');
  });

  it('保留下来的只有内容级复制动作', () => {
    const copyText = vi.fn();
    const { items } = build({ target: artifactTarget, actions: { copyText } });

    expect(actionableIds(items)).toEqual(['copy-content']);
    findItem(items, 'copy-content').onSelect?.();
    expect(copyText).toHaveBeenCalledWith('# 报告\n正文');
  });

  it('有选区时补上「复制选中内容」', () => {
    const copyText = vi.fn();
    const { items } = build({
      target: createTarget({ path: undefined, selection: '报告' }),
      actions: { copyText },
    });

    expect(actionableIds(items)).toEqual(['copy-selection', 'copy-content']);
    findItem(items, 'copy-selection').onSelect?.();
    expect(copyText).toHaveBeenCalledWith('报告');
  });
});

describe('buildContentContextMenuItems — code variant', () => {
  it('补齐被关掉的 Monaco 编辑动作，且顺序在引用之前', () => {
    const { items } = build({ variant: 'code' });

    const ids = actionableIds(items);
    expect(ids.indexOf('editor-cut')).toBeGreaterThan(ids.indexOf('target-path'));
    expect(ids.indexOf('editor-cut')).toBeLessThan(ids.indexOf('reference-to-chat'));
    expect(ids).toEqual(
      expect.arrayContaining(['editor-cut', 'editor-copy', 'editor-paste', 'editor-select-all']),
    );
  });

  it('没传 runEditorAction 时不出现编辑动作（该面没有编辑器）', () => {
    const { items } = build({ variant: 'code', actions: { copyText: vi.fn() } });

    const ids = actionableIds(items);
    expect(ids).not.toContain('editor-cut');
    expect(ids).not.toContain('editor-paste');
  });

  it('剪切与复制在没有选区时禁用，粘贴与全选始终可用', () => {
    const { items } = build({ variant: 'code', target: createTarget({ selection: '' }) });

    expect(findItem(items, 'editor-cut').disabled).toBe(true);
    expect(findItem(items, 'editor-copy').disabled).toBe(true);
    expect(findItem(items, 'editor-paste').disabled).toBeUndefined();
    expect(findItem(items, 'editor-select-all').disabled).toBeUndefined();
  });

  it('编辑动作转发给 Monaco 执行', () => {
    const { items, actions } = build({
      variant: 'code',
      target: createTarget({ selection: 'picked' }),
    });

    findItem(items, 'editor-cut').onSelect?.();
    findItem(items, 'editor-copy').onSelect?.();
    findItem(items, 'editor-paste').onSelect?.();
    findItem(items, 'editor-select-all').onSelect?.();

    expect(actions.runEditorAction).toHaveBeenCalledTimes(4);
    expect(actions.runEditorAction).toHaveBeenNthCalledWith(1, 'cut');
    expect(actions.runEditorAction).toHaveBeenNthCalledWith(2, 'copy');
    expect(actions.runEditorAction).toHaveBeenNthCalledWith(3, 'paste');
    expect(actions.runEditorAction).toHaveBeenNthCalledWith(4, 'selectAll');
  });

  it('代码视图用「复制」承担选区复制，不再重复「复制选中内容」', () => {
    const codeIds = actionableIds(
      build({ variant: 'code', target: createTarget({ selection: 'picked' }) }).items,
    );
    expect(codeIds).toContain('editor-copy');
    expect(codeIds).not.toContain('copy-selection');

    const previewIds = actionableIds(
      build({ variant: 'preview', target: createTarget({ selection: 'picked' }) }).items,
    );
    expect(previewIds).toContain('copy-selection');
  });

  it('两个视图都提供「复制全部内容」', () => {
    expect(actionableIds(build({ variant: 'code' }).items)).toContain('copy-content');
    expect(actionableIds(build({ variant: 'preview' }).items)).toContain('copy-content');
  });

  it('传了 switchToPreview 才提供「切换到预览视图」', () => {
    const { items: without, actions: bare } = build({
      variant: 'code',
      actions: { copyText: vi.fn() },
    });
    expect(actionableIds(without)).not.toContain('switch-to-preview');
    void bare;

    const { items, actions } = build({ variant: 'code' });
    findItem(items, 'switch-to-preview').onSelect?.();
    expect(actions.switchToPreview).toHaveBeenCalledTimes(1);
  });

  it('代码视图不出现「在编辑器中打开」', () => {
    expect(actionableIds(build({ variant: 'code' }).items)).not.toContain('open-in-editor');
  });
});

describe('buildContentContextMenuItems — preview variant', () => {
  it('二进制文件禁用复制全部内容与在编辑器中打开', () => {
    const { items } = build({
      variant: 'preview',
      target: createTarget({ path: `${WORKSPACE}/doc/report.pdf`, isBinary: true }),
    });

    expect(findItem(items, 'copy-content').disabled).toBe(true);
    expect(findItem(items, 'open-in-editor').disabled).toBe(true);
    // 路径类操作与二进制无关，必须保持可用。
    expect(findItem(items, 'copy-path').disabled).toBeUndefined();
    expect(findItem(items, 'copy-name').disabled).toBeUndefined();
  });

  it('「在编辑器中打开」切到代码视图', () => {
    const { items, actions } = build({ variant: 'preview' });

    findItem(items, 'open-in-editor').onSelect?.();

    expect(actions.switchToCode).toHaveBeenCalledTimes(1);
  });

  it('没传 switchToCode 时不出现「在编辑器中打开」（浮层没接编辑器出口）', () => {
    const { items } = build({ variant: 'preview', actions: { copyText: vi.fn() } });

    expect(actionableIds(items)).not.toContain('open-in-editor');
  });

  it('预览视图不出现 Monaco 编辑动作', () => {
    const ids = actionableIds(build({ variant: 'preview' }).items);

    expect(ids).not.toContain('editor-cut');
    expect(ids).not.toContain('editor-paste');
    expect(ids).not.toContain('switch-to-preview');
  });
});
