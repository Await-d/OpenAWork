import type { ContextMenuItem } from './ContextMenu.js';
import { getRelativePath } from '../../../utils/workspace-path.js';

/**
 * 「文件内容面」右键菜单的统一构建逻辑。
 *
 * 三个宿主共用这一份：文件编辑器（代码 / 预览两视图）、团队页文件预览浮层、
 * 产物预览面。它们能做的事并不相同——只有编辑器有 Monaco 编辑动作与视图切换，
 * 只有磁盘上的真实文件才有路径与「系统默认程序打开」，产物预览甚至没有可关闭的
 * 标签。差异靠下面两条规则表达，不再引入一堆 `canXxx` 布尔开关。
 *
 * ## 规则一：能力由 `actions` 里有没有对应回调决定
 *
 * **传了回调就渲染对应菜单项；没传，整组（连同它前面的分隔线）都不出现。**
 * 调用方因此天然不会渲染出「点了没反应」的项。例如产物预览只传 `copyText`，
 * 菜单就只剩复制类动作；团队页浮层额外传 `referenceToChat`，才多出一组引用项。
 *
 * ## 规则二：没有 `path` 就没有路径语义
 *
 * `target.path` 缺省（产物预览只有虚拟文件名）时，顶部信息行、复制路径族、
 * 引用到对话整组消失——这些操作离开真实路径就说不通。注意这两条规则是叠加的：
 * 组件面上是否出现引用项，取决于 `path` 与 `referenceToChat` **同时**成立。
 */

export type ContentContextMenuVariant = 'code' | 'preview';

/** 需要转交给 Monaco 执行的编辑动作。 */
export type ContentClipboardAction = 'cut' | 'copy' | 'paste' | 'selectAll';

export interface ContentContextMenuTarget {
  /**
   * 目标文件的完整路径。产物预览这类没有磁盘路径的内容面可以不传——
   * 届时路径相关的分组统计消失（见文件头「规则二」）。
   */
  path?: string;
  /** 目标内容的完整文本（「复制全部内容」用）。 */
  content: string;
  /**
   * 呼出菜单瞬间的选中文本；空串表示没有选区。
   * 代码视图取自 Monaco 选区，只读内容面取自容器内的 `window.getSelection()`。
   */
  selection: string;
  /** 是否为当前活跃标签，用于决定是否展示 ⌘W 快捷键提示。 */
  isActive: boolean;
  /** 二进制 / 非文本内容：编辑与内容类操作不可用。 */
  isBinary: boolean;
}

export interface ContentContextMenuActions {
  /** 复制文本到剪贴板。必填——任何内容面都至少能复制内容。 */
  copyText: (text: string) => void;
  /** 把文本追加到聊天输入框（复用 composer 引用事件）。缺省则不出现引用类动作。 */
  referenceToChat?: (text: string) => void;
  /** 交给 Monaco 执行的编辑动作。缺省则不出现剪切 / 复制 / 粘贴 / 全选。 */
  runEditorAction?: (action: ContentClipboardAction) => void;
  /** 用系统默认程序打开该文件。缺省则不出现该项。 */
  openInSystem?: () => void;
  /** 关闭（标签 / 浮层）。缺省则不出现该项。 */
  close?: () => void;
  /** 切到代码视图 —— 预览菜单里的「在编辑器中打开」。 */
  switchToCode?: () => void;
  /** 切到预览视图 —— 代码菜单里的「切换到预览视图」。 */
  switchToPreview?: () => void;
}

export interface BuildContentContextMenuItemsOptions {
  /**
   * `code`：前段补上 Monaco 的编辑动作。编辑器关掉了 Monaco 自带的右键菜单
   *   （`contextmenu: false`），这些高频能力必须在这里重建，否则会凭空消失。
   * `preview`：没有编辑动作，但多一个「复制选中内容」。
   */
  variant: ContentContextMenuVariant;
  target: ContentContextMenuTarget;
  /**
   * 工作区根路径，用于计算相对路径；缺失时引用回退为完整路径，
   * 且「复制相对路径」置灰（置灰而非隐藏，以免同一份菜单在文件之间跳动）。
   */
  workspacePath: string | null;
  actions: ContentContextMenuActions;
}

/** 一个菜单分组：分组之间自动插入分隔线，空分组连同其分隔线一起消失。 */
interface MenuSection {
  /** 分隔线 id，仅在该分组不是第一个可见分组时使用。 */
  id: string;
  items: ContextMenuItem[];
}

export function buildContentContextMenuItems({
  variant,
  target,
  workspacePath,
  actions,
}: BuildContentContextMenuItemsOptions): ContextMenuItem[] {
  const { path, content, selection, isActive, isBinary } = target;
  const hasPath = typeof path === 'string' && path.length > 0;
  const relativePath = hasPath && workspacePath ? getRelativePath(path, workspacePath) : null;
  // 引用到对话优先用相对路径 —— 更短，且与文件树的引用行为保持一致。
  const referencePath = relativePath ?? path ?? '';
  const hasSelection = selection.length > 0;

  const sections: MenuSection[] = [
    {
      // 顶部信息行：把完整路径摊开给用户看，避免「不知道这是哪个文件」的歧义。
      id: 'sep-header',
      items: hasPath ? [{ id: 'target-path', type: 'header', hint: '文件路径', label: path }] : [],
    },
    { id: 'sep-edit', items: buildEditorSection(variant, hasSelection, actions) },
    {
      id: 'sep-reference',
      // 没有路径就无从引用——引用文本的形态本身就是 `@路径`。
      items: hasPath ? buildReferenceSection(actions, hasSelection, referencePath, selection) : [],
    },
    {
      id: 'sep-copy',
      items: buildCopySection(variant, actions, {
        content,
        isBinary,
        hasSelection,
        selection,
        path: hasPath ? path : null,
        relativePath,
      }),
    },
    { id: 'sep-view', items: buildViewSection(variant, actions, isBinary) },
    { id: 'sep-system', items: buildSystemSection(actions) },
    { id: 'sep-close', items: buildCloseSection(actions, isActive) },
  ];

  const items: ContextMenuItem[] = [];
  for (const section of sections) {
    if (section.items.length === 0) continue;
    if (items.length > 0) {
      items.push({ id: section.id, type: 'separator' });
    }
    items.push(...section.items);
  }
  return items;
}

function buildEditorSection(
  variant: ContentContextMenuVariant,
  hasSelection: boolean,
  actions: ContentContextMenuActions,
): ContextMenuItem[] {
  const runEditorAction = actions.runEditorAction;
  if (variant !== 'code' || !runEditorAction) {
    return [];
  }
  return [
    {
      id: 'editor-cut',
      label: '剪切',
      disabled: !hasSelection,
      onSelect: () => runEditorAction('cut'),
    },
    {
      id: 'editor-copy',
      label: '复制',
      disabled: !hasSelection,
      onSelect: () => runEditorAction('copy'),
    },
    { id: 'editor-paste', label: '粘贴', onSelect: () => runEditorAction('paste') },
    { id: 'editor-select-all', label: '全选', onSelect: () => runEditorAction('selectAll') },
  ];
}

function buildReferenceSection(
  actions: ContentContextMenuActions,
  hasSelection: boolean,
  referencePath: string,
  selection: string,
): ContextMenuItem[] {
  const referenceToChat = actions.referenceToChat;
  if (!referenceToChat) {
    return [];
  }
  const items: ContextMenuItem[] = [
    {
      id: 'reference-to-chat',
      label: '引用到对话',
      onSelect: () => referenceToChat(`@${referencePath} `),
    },
  ];
  if (hasSelection) {
    items.push({
      id: 'reference-selection-to-chat',
      label: '引用选中内容到对话',
      onSelect: () => referenceToChat(`@${referencePath}\n${selection}`),
    });
  }
  return items;
}

interface CopySectionInput {
  content: string;
  isBinary: boolean;
  hasSelection: boolean;
  selection: string;
  /** 有磁盘 / 工作区路径时才提供路径族复制项；产物预览传 null。 */
  path: string | null;
  relativePath: string | null;
}

function buildCopySection(
  variant: ContentContextMenuVariant,
  actions: ContentContextMenuActions,
  input: CopySectionInput,
): ContextMenuItem[] {
  const { copyText } = actions;
  const { content, isBinary, hasSelection, selection, path, relativePath } = input;
  const items: ContextMenuItem[] = [];

  // 代码视图已有 Monaco 的「复制」（作用于选区），不必再来一个同义项；
  // 只读内容面没有编辑器动作，所以这里要自己提供。
  if (variant === 'preview' && hasSelection) {
    items.push({
      id: 'copy-selection',
      label: '复制选中内容',
      onSelect: () => copyText(selection),
    });
  }

  items.push({
    id: 'copy-content',
    label: '复制全部内容',
    disabled: isBinary,
    onSelect: () => copyText(content),
  });

  if (path === null) {
    return items;
  }

  items.push(
    {
      id: 'copy-path',
      label: '复制完整路径',
      onSelect: () => copyText(path),
    },
    {
      id: 'copy-relative-path',
      label: '复制相对路径',
      disabled: relativePath === null,
      onSelect: () => {
        if (relativePath !== null) {
          copyText(relativePath);
        }
      },
    },
    {
      id: 'copy-name',
      label: '复制文件名',
      onSelect: () => copyText(path.split('/').pop() ?? path),
    },
  );
  return items;
}

function buildViewSection(
  variant: ContentContextMenuVariant,
  actions: ContentContextMenuActions,
  isBinary: boolean,
): ContextMenuItem[] {
  // 二进制文件在编辑器里只会显示 utf-8 解码后的乱码，两个方向都禁用。
  if (variant === 'preview') {
    const switchToCode = actions.switchToCode;
    return switchToCode
      ? [
          {
            id: 'open-in-editor',
            label: '在编辑器中打开',
            disabled: isBinary,
            onSelect: () => switchToCode(),
          },
        ]
      : [];
  }
  const switchToPreview = actions.switchToPreview;
  return switchToPreview
    ? [
        {
          id: 'switch-to-preview',
          label: '切换到预览视图',
          onSelect: () => switchToPreview(),
        },
      ]
    : [];
}

function buildSystemSection(actions: ContentContextMenuActions): ContextMenuItem[] {
  const openInSystem = actions.openInSystem;
  if (!openInSystem) {
    return [];
  }
  return [
    {
      id: 'open-in-system',
      label: '用系统默认程序打开',
      onSelect: () => openInSystem(),
    },
  ];
}

function buildCloseSection(
  actions: ContentContextMenuActions,
  isActive: boolean,
): ContextMenuItem[] {
  const close = actions.close;
  if (!close) {
    return [];
  }
  return [
    {
      id: 'close',
      label: '关闭',
      ...(isActive ? { shortcut: '⌘W' } : {}),
      onSelect: () => close(),
    },
  ];
}
