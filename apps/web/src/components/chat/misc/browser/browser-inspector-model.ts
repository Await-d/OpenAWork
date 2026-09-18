/**
 * 元素检查器（DOM 树 / 无障碍树 / 计算样式）的纯逻辑层。
 *
 * 视图组件只负责渲染与交互状态；树的展开记账、按拾取结果定位节点、计算样式的
 * 「值得看」筛选、无障碍状态 → 芯片映射都收在这里。它们是纯函数：可以脱离
 * React 直接单测，也避免 451 条计算样式的筛选规则散落进 JSX。
 *
 * 线路数据的收窄也在这里（`toDomPayload` / `toA11yPayload` / `toNodePayload`）：
 * WS 下行是不可信输入，形状不符时返回 null 而不是让渲染层崩掉。
 *
 * 本文件不涉及任何样式（颜色 / 间距见 `browser-inspector-tokens.ts`）。
 */

import type {
  BrowserLiveA11yNode,
  BrowserLiveA11yPayload,
  BrowserLiveDomNode,
  BrowserLiveDomPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';

// ── 视图与请求状态 ──────────────────────────────────────────────────────

/** 检查器的两个视图：DOM 树 / 无障碍树。 */
export type BrowserInspectorView = 'dom' | 'a11y';

/**
 * 单次请求的状态。
 *
 * `idle` 表示从未请求（渲染空态而不是错误）；`loading` 表示请求在途、
 * 回包未到；`error` 表示协议错误回包（`ch:'error'`）到达。
 */
export type BrowserInspectorLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** `dom.tree` 的默认深度；与后端 `BROWSER_LIVE_DOM_DEFAULT_DEPTH` 同值。 */
export const INSPECTOR_DEFAULT_DEPTH = 4;

/** `dom.tree` 后端允许的最大深度（`BROWSER_LIVE_DOM_MAX_DEPTH`）。 */
export const INSPECTOR_MAX_DEPTH = 12;

/** 「更深」每次递增的步长。 */
export const INSPECTOR_DEPTH_STEP = 4;

/** 把任意输入收敛到合法深度区间；非有限值回落默认深度。 */
export function clampInspectorDepth(depth: number | undefined): number {
  if (typeof depth !== 'number' || !Number.isFinite(depth)) return INSPECTOR_DEFAULT_DEPTH;
  return Math.min(Math.max(Math.round(depth), 1), INSPECTOR_MAX_DEPTH);
}

/** 下一档深度；已在最大值时返回最大值（UI 据此禁用「更深」）。 */
export function nextInspectorDepth(current: number | undefined): number {
  return clampInspectorDepth(clampInspectorDepth(current) + INSPECTOR_DEPTH_STEP);
}

/** 是否已经到后端允许的最大深度。 */
export function isMaxInspectorDepth(depth: number | undefined): boolean {
  return clampInspectorDepth(depth) >= INSPECTOR_MAX_DEPTH;
}

// ── 标签片段（树的单行展示）────────────────────────────────────────────

/**
 * 行内文本片段的语义色调。渲染端把它映射到 E · Nebula 文字 token；
 * 纯逻辑层只给语义，不碰颜色。
 */
export type InspectorLabelTone = 'tag' | 'attr' | 'value' | 'muted' | 'flag';

export interface InspectorLabelPart {
  text: string;
  tone: InspectorLabelTone;
}

/** 单行化并截断：CDP 的 name / value 可能带换行与超长文本。 */
export function toInspectorInline(value: string, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  if (maxChars <= 1) return '…';
  return `${flat.slice(0, maxChars - 1)}…`;
}

/** CDP 的 `nodeName` 大写（`#document`），展示时统一小写。 */
export function normalizeNodeName(nodeName: string): string {
  return nodeName.trim().toLowerCase();
}

const DOM_LABEL_ATTRIBUTE_LIMIT = 48;
const DOM_LABEL_CLASS_LIMIT = 3;

/**
 * DOM 节点的单行标签：`<div#app.shell.grid …+12>`。
 *
 * - `id` 优先展示（定位元素最快的锚点）；
 * - `class` 最多 3 个，其余折叠成 `+N`；
 * - 树里没有下发的子节点（深度裁剪）用 `…+N` 收尾，提示「还有一个更深的子节点」——
 *   这是比静默省略更诚实的表达，也解释了为什么该行不能展开。
 */
export function buildDomNodeLabelParts(node: BrowserLiveDomNode): InspectorLabelPart[] {
  const parts: InspectorLabelPart[] = [
    { text: `<${normalizeNodeName(node.nodeName)}`, tone: 'tag' },
  ];

  const id = node.attributes['id'];
  if (typeof id === 'string' && id.length > 0) {
    parts.push({ text: `#${toInspectorInline(id, DOM_LABEL_ATTRIBUTE_LIMIT)}`, tone: 'value' });
  }

  const classNames = collectClassNames(node.attributes['class']);
  for (const className of classNames.slice(0, DOM_LABEL_CLASS_LIMIT)) {
    parts.push({ text: `.${className}`, tone: 'attr' });
  }
  if (classNames.length > DOM_LABEL_CLASS_LIMIT) {
    parts.push({ text: `.+${classNames.length - DOM_LABEL_CLASS_LIMIT}`, tone: 'muted' });
  }

  parts.push({ text: '>', tone: 'tag' });

  const loadedChildren = node.children?.length ?? 0;
  const missingChildren = Math.max(node.childCount - loadedChildren, 0);
  if (missingChildren > 0) {
    parts.push({ text: `…+${missingChildren}`, tone: 'muted' });
  }
  return parts;
}

/** 无障碍节点的单行标签：`button “提交订单”`。 */
export function buildA11yNodeLabelParts(node: BrowserLiveA11yNode): InspectorLabelPart[] {
  const role = toInspectorInline(node.role, 40);
  const parts: InspectorLabelPart[] = [{ text: role.length > 0 ? role : 'unknown', tone: 'tag' }];

  const name = toInspectorInline(node.name, 60);
  if (name.length > 0) {
    parts.push({ text: ` “${name}”`, tone: 'value' });
  }

  const value = toInspectorInline(node.value ?? '', 40);
  if (value.length > 0) {
    parts.push({ text: ` = ${value}`, tone: 'muted' });
  }

  if (typeof node.level === 'number') {
    parts.push({ text: ` h${node.level}`, tone: 'flag' });
  }
  return parts;
}

function collectClassNames(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(/\s+/)
    .filter((entry) => entry.length > 0)
    .slice(0, 12);
}

// ── DOM 树 ─────────────────────────────────────────────────────────────

export interface DomTreeRow {
  node: BrowserLiveDomNode;
  id: number;
  depth: number;
  /** 树里确实带着子节点，展开有内容可看。 */
  hasChildren: boolean;
  expanded: boolean;
}

/** DOM 树的节点总数（含根）。 */
export function countDomTreeNodes(root: BrowserLiveDomNode | null): number {
  if (root === null) return 0;
  let total = 0;
  const walk = (node: BrowserLiveDomNode): void => {
    total += 1;
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return total;
}

/**
 * 默认展开集合：payload 内所有带子节点的节点。
 *
 * 默认「全展开」是有意的——请求深度本身已经是舒适的默认值（4 层），
 * 因此不需要再让用户在两层展开之间来回点。用户手动折叠后的状态由视图持有。
 */
export function defaultExpandedDomIds(root: BrowserLiveDomNode | null): Set<number> {
  const ids = new Set<number>();
  if (root === null) return ids;
  const walk = (node: BrowserLiveDomNode): void => {
    const children = node.children ?? [];
    if (children.length === 0) return;
    ids.add(node.nodeId);
    for (const child of children) walk(child);
  };
  walk(root);
  return ids;
}

/** 展开 / 折叠一个 id，返回新集合（不修改入参）。 */
export function toggleExpandedId<T>(ids: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** 把一组 id 并入展开集合（拾取定位时展开祖先链用）。 */
export function expandIds<T>(ids: ReadonlySet<T>, additions: readonly T[]): Set<T> {
  const next = new Set(ids);
  for (const id of additions) next.add(id);
  return next;
}

/**
 * 按展开状态把 DOM 树压平成可见行（深度优先，文档顺序）。
 *
 * 折叠的节点只输出自己那一行；`childCount > children.length` 的节点不输出额外行
 * （没有数据可展开），由标签里的 `…+N` 提示需要「更深」。
 */
export function flattenDomTree(
  root: BrowserLiveDomNode | null,
  expanded: ReadonlySet<number>,
): DomTreeRow[] {
  if (root === null) return [];
  const rows: DomTreeRow[] = [];
  const walk = (node: BrowserLiveDomNode, depth: number): void => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = hasChildren && expanded.has(node.nodeId);
    rows.push({ node, id: node.nodeId, depth, hasChildren, expanded: isExpanded });
    if (!isExpanded) return;
    for (const child of children) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}

/** 查找节点以及它的祖先链（root → … → parent），未命中返回空数组。 */
export function findDomNodePath(
  root: BrowserLiveDomNode | null,
  nodeId: number,
): BrowserLiveDomNode[] {
  if (root === null) return [];
  const walk = (node: BrowserLiveDomNode, trail: BrowserLiveDomNode[]): BrowserLiveDomNode[] => {
    const next = [...trail, node];
    if (node.nodeId === nodeId) return next;
    for (const child of node.children ?? []) {
      const found = walk(child, next);
      if (found.length > 0) return found;
    }
    return [];
  };
  return walk(root, []);
}

export function findDomNode(
  root: BrowserLiveDomNode | null,
  nodeId: number,
): BrowserLiveDomNode | null {
  const path = findDomNodePath(root, nodeId);
  return path.length > 0 ? (path[path.length - 1] ?? null) : null;
}

/**
 * 默认选中的节点：从根往下找第一个真实元素。
 *
 * `dom.tree` 的根是 `#document`，它的详情（无属性、无文本）对使用者没有信息量；
 * 选中首个元素（通常是 `html`）才符合「打开检查器就想看点什么」的预期。
 * 整棵树都是文档节点时回落到根。
 */
export function firstElementNodeId(root: BrowserLiveDomNode | null): number | null {
  if (root === null) return null;
  let found: number | null = null;
  const walk = (node: BrowserLiveDomNode): void => {
    if (found !== null) return;
    if (!node.nodeName.startsWith('#')) {
      found = node.nodeId;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return found ?? root.nodeId;
}

/** 命中节点的定位结果：`ancestorIds` 不含自身，供展开祖先链使用。 */
export interface DomNodeMatch {
  node: BrowserLiveDomNode;
  ancestorIds: number[];
}

/**
 * 把拾取结果（`ch:'node'`）对应回 DOM 树节点。
 *
 * 拾取回包不带 `nodeId`，所以只能按「标签名 + 属性」反查：
 *
 * - 标签名大小写不敏感（CDP 两边都是大写）；
 * - 回包里的每个属性都必须在候选节点上存在且等值；
 * - 命中多个候选时取最深的一个（拾取命中的是点上的元素，祖先通常也满足属性匹配
 *   但不该被选中）；仍并列时按文档顺序取第一个；
 * - 回包没有任何属性、又存在多个同名候选时返回 null —— 宁可「未在树中定位到」，
 *   也不要随机选一个误导用户。
 */
export function matchDomNodeForNodePayload(
  root: BrowserLiveDomNode | null,
  payload: Pick<BrowserLiveNodePayload, 'nodeName' | 'attributes'>,
): DomNodeMatch | null {
  if (root === null) return null;
  const wantedName = payload.nodeName.trim().toUpperCase();
  if (wantedName.length === 0) return null;
  const source = payload.attributes ?? {};
  const wantedAttributes = Object.keys(source)
    .filter((key) => typeof source[key] === 'string')
    .map((key) => [key, source[key] ?? ''] as const);

  const candidates: Array<{ node: BrowserLiveDomNode; ancestorIds: number[]; depth: number }> = [];
  const walk = (node: BrowserLiveDomNode, ancestorIds: number[], depth: number): void => {
    if (node.nodeName.trim().toUpperCase() === wantedName) {
      const matches = wantedAttributes.every(([key, value]) => node.attributes[key] === value);
      if (matches) candidates.push({ node, ancestorIds, depth });
    }
    for (const child of node.children ?? []) {
      walk(child, [...ancestorIds, node.nodeId], depth + 1);
    }
  };
  walk(root, [], 0);

  const first = candidates[0];
  if (first === undefined) return null;
  if (candidates.length > 1 && wantedAttributes.length === 0) return null;

  let best = first;
  for (const candidate of candidates) {
    if (candidate.depth > best.depth) best = candidate;
  }
  return { node: best.node, ancestorIds: best.ancestorIds };
}

// ── 无障碍树 ───────────────────────────────────────────────────────────

export interface A11yTreeRow {
  node: BrowserLiveA11yNode;
  id: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

/** 无障碍节点的稳定 id：按下标路径生成（线路协议不带 nodeId）。 */
export function a11yNodePathId(path: readonly number[]): string {
  return path.length === 0 ? '0' : path.join('.');
}

function walkA11yPath(
  node: BrowserLiveA11yNode,
  path: number[],
  visit: (node: BrowserLiveA11yNode, id: string, depth: number) => boolean,
): void {
  const id = a11yNodePathId(path);
  const descend = visit(node, id, path.length - 1);
  if (!descend) return;
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    walkA11yPath(child, [...path, index], visit);
  }
}

/** 默认展开集合：payload 内所有带子节点的无障碍节点。 */
export function defaultExpandedA11yIds(root: BrowserLiveA11yNode | null): Set<string> {
  const ids = new Set<string>();
  if (root === null) return ids;
  walkA11yPath(root, [0], (node, id) => {
    const children = node.children ?? [];
    if (children.length === 0) return false;
    ids.add(id);
    return true;
  });
  return ids;
}

/** 按展开状态把无障碍树压平成可见行。 */
export function flattenA11yTree(
  root: BrowserLiveA11yNode | null,
  expanded: ReadonlySet<string>,
): A11yTreeRow[] {
  if (root === null) return [];
  const rows: A11yTreeRow[] = [];
  walkA11yPath(root, [0], (node, id, depth) => {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isExpanded = hasChildren && expanded.has(id);
    rows.push({ node, id, depth, hasChildren, expanded: isExpanded });
    return isExpanded;
  });
  return rows;
}

export function findA11yNode(
  root: BrowserLiveA11yNode | null,
  id: string,
): BrowserLiveA11yNode | null {
  if (root === null || id.length === 0) return null;
  return searchA11yNode(root, [0], id);
}

function searchA11yNode(
  node: BrowserLiveA11yNode,
  path: number[],
  id: string,
): BrowserLiveA11yNode | null {
  if (a11yNodePathId(path) === id) return node;
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    const found = searchA11yNode(child, [...path, index], id);
    if (found !== null) return found;
  }
  return null;
}

// ── 无障碍状态芯片 ─────────────────────────────────────────────────────

export type InspectorChipTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export interface A11yStateChip {
  key: string;
  label: string;
  tone: InspectorChipTone;
}

/**
 * 无障碍状态 → 芯片。
 *
 * `true` 状态一律显式呈现；`false` 只对「有展开 / 选择语义」的状态成芯片
 * （已折叠 / 未选中 / 未勾选）——`focused` / `disabled` 的 false 是默认值，
 * 给每个节点都挂一枚「未禁用」是噪音而不是信息。
 * `checked` 支持三态：`'mixed'` 是部分勾选。
 */
export function describeA11yStateChips(node: BrowserLiveA11yNode): A11yStateChip[] {
  const chips: A11yStateChip[] = [];
  if (node.focused === true) chips.push({ key: 'focused', label: '聚焦', tone: 'accent' });
  if (node.disabled === true) chips.push({ key: 'disabled', label: '禁用', tone: 'danger' });
  if (node.expanded === true) chips.push({ key: 'expanded', label: '已展开', tone: 'info' });
  if (node.expanded === false) chips.push({ key: 'collapsed', label: '已折叠', tone: 'muted' });
  if (node.selected === true) chips.push({ key: 'selected', label: '已选中', tone: 'accent' });
  if (node.selected === false) chips.push({ key: 'unselected', label: '未选中', tone: 'muted' });
  if (node.checked === true) chips.push({ key: 'checked', label: '已勾选', tone: 'success' });
  if (node.checked === 'mixed') chips.push({ key: 'mixed', label: '部分勾选', tone: 'warning' });
  if (node.checked === false) chips.push({ key: 'unchecked', label: '未勾选', tone: 'muted' });
  if (node.ignored === true) chips.push({ key: 'ignored', label: '已忽略', tone: 'warning' });
  return chips;
}

// ── 计算样式 ───────────────────────────────────────────────────────────

/**
 * 默认视图保留的样式属性（前缀匹配，例如 `border` 覆盖 `border-top-width`）。
 *
 * 选取标准：布局 / 尺寸 / 间距 / 排版 / 颜色 / 层级 / 交互 —— 这些是「读懂这个
 * 元素长什么样」所需要的全部；其余（`-webkit-*`、内部属性、UA 无关项）只在
 * 「显示全部」里出现。
 */
export const INSPECTOR_NOTABLE_STYLE_KEYS: readonly string[] = [
  'display',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'float',
  'clear',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'aspect-ratio',
  'margin',
  'padding',
  'border',
  'border-radius',
  'outline',
  'background',
  'color',
  'font',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text',
  'white-space',
  'word-break',
  'overflow',
  'direction',
  'writing-mode',
  'vertical-align',
  'flex',
  'order',
  'gap',
  'grid',
  'align',
  'justify',
  'place',
  'transform',
  'transition',
  'animation',
  'opacity',
  'visibility',
  'mix-blend-mode',
  'isolation',
  'filter',
  'box-shadow',
  'clip-path',
  'cursor',
  'pointer-events',
  'user-select',
  'content',
  'list-style',
  'object-fit',
  'resize',
  'scroll',
  'will-change',
];

/**
 * 已知的「默认值 / 无操作值」表。
 *
 * 命中即从默认视图隐藏：`z-index: auto`、`margin-*: 0px`、`background-image: none`
 * 这类声明每页都有、对使用者零信息量。表里没列出的属性不做「猜默认值」判断——
 * 宁可多显示一行，也不要藏掉真实生效的声明。
 * 键按前缀归族（`margin` 覆盖 `margin-top` 等），`INSPECTOR_STYLE_DEFAULT_VALUES`
 * 先精确匹配、再前缀匹配。
 */
export const INSPECTOR_STYLE_DEFAULT_VALUES: Readonly<Record<string, readonly string[]>> = {
  position: ['static'],
  float: ['none'],
  clear: ['none'],
  'z-index': ['auto'],
  inset: ['auto'],
  top: ['auto'],
  right: ['auto'],
  bottom: ['auto'],
  left: ['auto'],
  'min-width': ['auto', '0px'],
  'min-height': ['auto', '0px'],
  'max-width': ['none'],
  'max-height': ['none'],
  'aspect-ratio': ['auto'],
  margin: ['0px'],
  'margin-top': ['0px'],
  'margin-right': ['0px'],
  'margin-bottom': ['0px'],
  'margin-left': ['0px'],
  padding: ['0px'],
  'padding-top': ['0px'],
  'padding-right': ['0px'],
  'padding-bottom': ['0px'],
  'padding-left': ['0px'],
  'border-top-width': ['0px'],
  'border-right-width': ['0px'],
  'border-bottom-width': ['0px'],
  'border-left-width': ['0px'],
  'border-top-style': ['none'],
  'border-right-style': ['none'],
  'border-bottom-style': ['none'],
  'border-left-style': ['none'],
  'border-width': ['0px'],
  'border-style': ['none'],
  'border-radius': ['0px'],
  'border-collapse': ['separate'],
  'border-spacing': ['0px 0px'],
  'border-image-source': ['none'],
  'border-image-slice': ['100%'],
  'border-image-width': ['1'],
  'border-image-outset': ['0'],
  'border-image-repeat': ['stretch'],
  'outline-width': ['0px'],
  'outline-style': ['none'],
  'background-color': ['rgba(0, 0, 0, 0)', 'transparent'],
  'background-image': ['none'],
  'background-repeat': ['repeat', 'repeat repeat'],
  'background-size': ['auto', 'auto auto'],
  'background-position': ['0% 0%'],
  'background-attachment': ['scroll'],
  'background-clip': ['border-box'],
  'background-origin': ['padding-box'],
  'background-blend-mode': ['normal'],
  'font-style': ['normal'],
  'font-variant': ['normal'],
  'font-stretch': ['100%'],
  'font-kerning': ['auto'],
  'font-size-adjust': ['none'],
  'font-optical-sizing': ['auto'],
  'line-height': ['normal'],
  'letter-spacing': ['normal'],
  'word-spacing': ['normal'],
  'text-align': ['start'],
  'text-transform': ['none'],
  'text-decoration-line': ['none'],
  'text-overflow': ['clip'],
  'text-shadow': ['none'],
  'text-indent': ['0px'],
  'text-rendering': ['auto'],
  'text-size-adjust': ['auto'],
  'text-wrap': ['wrap'],
  'white-space': ['normal'],
  'word-break': ['normal'],
  'overflow-wrap': ['normal'],
  'overflow-x': ['visible'],
  'overflow-y': ['visible'],
  direction: ['ltr'],
  'writing-mode': ['horizontal-tb'],
  'vertical-align': ['baseline'],
  'flex-grow': ['0'],
  'flex-shrink': ['1'],
  'flex-basis': ['auto'],
  'flex-direction': ['row'],
  'flex-wrap': ['nowrap'],
  order: ['0'],
  gap: ['normal'],
  'row-gap': ['normal', '0px'],
  'column-gap': ['normal', '0px'],
  'grid-auto-columns': ['auto'],
  'grid-auto-rows': ['auto'],
  'grid-auto-flow': ['row'],
  'grid-column-start': ['auto'],
  'grid-column-end': ['auto'],
  'grid-row-start': ['auto'],
  'grid-row-end': ['auto'],
  'grid-template-columns': ['none'],
  'grid-template-rows': ['none'],
  'grid-template-areas': ['none'],
  'grid-column-gap': ['normal', '0px'],
  'grid-row-gap': ['normal', '0px'],
  'align-items': ['normal'],
  'align-content': ['normal'],
  'align-self': ['auto'],
  'justify-content': ['normal'],
  'justify-items': ['legacy', 'normal'],
  'justify-self': ['auto'],
  'place-items': ['normal'],
  'place-content': ['normal'],
  transform: ['none'],
  'transform-origin': ['50% 50%'],
  'transition-property': ['all'],
  'transition-duration': ['0s'],
  'transition-delay': ['0s'],
  'animation-name': ['none'],
  'animation-duration': ['0s'],
  'animation-delay': ['0s'],
  'animation-iteration-count': ['1'],
  'animation-fill-mode': ['none'],
  'animation-play-state': ['running'],
  'animation-direction': ['normal'],
  opacity: ['1'],
  visibility: ['visible'],
  'mix-blend-mode': ['normal'],
  isolation: ['auto'],
  filter: ['none'],
  'backdrop-filter': ['none'],
  'box-shadow': ['none'],
  'clip-path': ['none'],
  'mask-image': ['none'],
  cursor: ['auto'],
  'pointer-events': ['auto'],
  'user-select': ['auto'],
  'caret-color': ['auto'],
  'accent-color': ['auto'],
  content: ['none', 'normal'],
  'list-style-type': ['disc'],
  'list-style-image': ['none'],
  'list-style-position': ['outside'],
  'object-fit': ['fill'],
  'object-position': ['50% 50%'],
  resize: ['none'],
  'scroll-behavior': ['auto'],
  'scrollbar-width': ['auto'],
  'will-change': ['auto'],
  'overflow-anchor': ['auto'],
  'overscroll-behavior': ['auto'],
  'touch-action': ['auto'],
  'color-scheme': ['normal'],
  'paint-order': ['normal'],
  'shape-rendering': ['auto'],
  'image-rendering': ['auto'],
  'backface-visibility': ['visible'],
  perspective: ['none'],
  'transform-style': ['flat'],
  contain: ['none'],
  'container-type': ['normal'],
};

const INSPECTOR_NOTABLE_STYLE_SET: ReadonlySet<string> = new Set(INSPECTOR_NOTABLE_STYLE_KEYS);

/** 命中「已知默认值」表（支持 `margin` → `margin-top` 这类前缀归族）。 */
export function isDefaultStyleDeclaration(property: string, value: string): boolean {
  const exact = INSPECTOR_STYLE_DEFAULT_VALUES[property];
  if (exact !== undefined && exact.includes(value)) return true;
  const separator = property.indexOf('-');
  if (separator <= 0) return false;
  const family = INSPECTOR_STYLE_DEFAULT_VALUES[property.slice(0, separator)];
  return family !== undefined && family.includes(value);
}

/**
 * 是否「值得看」：在保留清单内，且不是已知默认值。
 *
 * 厂商前缀属性（`-webkit-*` / `-moz-*` / `-internal-*`）默认一律隐藏——它们
 * 数量大、含义重叠，只在「显示全部」里出现。
 */
export function isNotableStyle(property: string, value: string): boolean {
  if (property.startsWith('-')) return false;
  const base = property.toLowerCase();
  if (!INSPECTOR_NOTABLE_STYLE_SET.has(base)) {
    const separator = base.indexOf('-');
    const family = separator > 0 ? base.slice(0, separator) : base;
    if (!INSPECTOR_NOTABLE_STYLE_SET.has(family)) return false;
  }
  return !isDefaultStyleDeclaration(base, value);
}

export interface InspectorStyleRow {
  property: string;
  value: string;
  notable: boolean;
}

export interface InspectorStyleView {
  rows: InspectorStyleRow[];
  /** 全部声明数（未筛选前）。 */
  total: number;
  /** 其中「值得看」的条数。 */
  notableCount: number;
  /** 被默认视图隐藏的条数（= total - notableCount）。 */
  hiddenCount: number;
  /** 是否处于关键字搜索态（搜索会跨过「值得看」筛选）。 */
  searching: boolean;
}

/**
 * 计算样式的展示模型。
 *
 * 规则：
 * - 有搜索词时在**全部**声明里搜（属性名或值，大小写不敏感），不受「显示全部」影响
 *   ——否则用户按名字找一条被默认视图藏起来的声明会永远找不到；
 * - 无搜索词时默认只给「值得看」的行，`showAll` 打开后给全部；
 * - 顺序保持 payload 原序（CDP 回包本身是有序的），同输入永远同输出。
 */
export function buildInspectorStyleView(
  styles: Readonly<Record<string, string>>,
  options: { query?: string; showAll?: boolean } = {},
): InspectorStyleView {
  const query = (options.query ?? '').trim().toLowerCase();
  const searching = query.length > 0;
  const rows: InspectorStyleRow[] = [];
  let total = 0;
  let notableCount = 0;

  for (const [property, value] of Object.entries(styles)) {
    if (typeof value !== 'string') continue;
    total += 1;
    const notable = isNotableStyle(property, value);
    if (notable) notableCount += 1;
    if (searching) {
      if (!property.toLowerCase().includes(query) && !value.toLowerCase().includes(query)) continue;
    } else if (options.showAll !== true && !notable) {
      continue;
    }
    rows.push({ property, value, notable });
  }

  return { rows, total, notableCount, hiddenCount: total - notableCount, searching };
}

// ── 节点详情 ───────────────────────────────────────────────────────────

export interface InspectorNodeDetail {
  nodeName: string;
  attributes: Record<string, string>;
  text: string;
  selector: string | null;
  selectorStrategy: string | null;
  /** 服务端判定选择器可能命中多个元素（`selectorUnique === false`）。 */
  selectorAmbiguous: boolean;
  /** 可用样式（优先 `fullComputedStyles`）；没有拾取结果时为 null。 */
  styles: Record<string, string> | null;
  /** 当前样式来自 `node.styles`（完整样式请求）。 */
  fullStyles: boolean;
  /** 详情来自元素拾取（而不是纯粹的树节点）。 */
  fromPick: boolean;
}

/**
 * 合并「树选中节点」与「拾取回包」成一个详情模型。
 *
 * 树节点只有标签与属性；拾取回包才有选择器 / 文本 / 计算样式。两者指向同一个
 * 元素时（拾取后自动选中对应树节点）合成一份详情，否则以选中项为准。
 */
export function buildInspectorNodeDetail(
  selected: BrowserLiveDomNode | null,
  payload: BrowserLiveNodePayload | null,
): InspectorNodeDetail | null {
  if (selected === null && payload === null) return null;

  const styles = payload?.fullComputedStyles ?? payload?.computedStyles ?? null;
  const selector = typeof payload?.selector === 'string' ? payload.selector : '';

  return {
    nodeName: selected?.nodeName ?? payload?.nodeName ?? '',
    attributes: payload?.attributes ?? selected?.attributes ?? {},
    text: typeof payload?.text === 'string' ? payload.text : '',
    selector: selector.length > 0 ? selector : null,
    selectorStrategy:
      typeof payload?.selectorStrategy === 'string' && payload.selectorStrategy.length > 0
        ? payload.selectorStrategy
        : null,
    selectorAmbiguous: payload?.selectorUnique === false,
    styles: styles !== null && Object.keys(styles).length > 0 ? styles : null,
    fullStyles: payload?.fullComputedStyles !== undefined,
    fromPick: payload !== null,
  };
}

// ── 线路数据收窄 ───────────────────────────────────────────────────────

/** 深挖收窄的节点预算：超出后不再校验更深的层级（服务端节点上限已兜底）。 */
const MAX_VALIDATED_TREE_NODES = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    result[key] = entry;
  }
  return result;
}

function isDomNodeLike(value: unknown, budget: { remaining: number }): value is BrowserLiveDomNode {
  if (!isRecord(value)) return false;
  if (typeof value['nodeId'] !== 'number' || typeof value['nodeName'] !== 'string') return false;
  if (typeof value['backendNodeId'] !== 'number') return false;
  if (typeof value['childCount'] !== 'number') return false;
  if (toStringRecord(value['attributes']) === null) return false;
  const children = value['children'];
  if (children === undefined) return true;
  if (!Array.isArray(children)) return false;
  budget.remaining -= 1;
  if (budget.remaining <= 0) return true;
  return children.every((child) => isDomNodeLike(child, budget));
}

export function toDomPayload(value: unknown): BrowserLiveDomPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value['truncated'] !== 'boolean') return null;
  if (!isDomNodeLike(value['root'], { remaining: MAX_VALIDATED_TREE_NODES })) return null;
  return { root: value['root'], truncated: value['truncated'] };
}

function isA11yNodeLike(
  value: unknown,
  budget: { remaining: number },
): value is BrowserLiveA11yNode {
  if (!isRecord(value)) return false;
  if (typeof value['role'] !== 'string' || typeof value['name'] !== 'string') return false;
  if (typeof value['ignored'] !== 'boolean') return false;
  const children = value['children'];
  if (children === undefined) return true;
  if (!Array.isArray(children)) return false;
  budget.remaining -= 1;
  if (budget.remaining <= 0) return true;
  return children.every((child) => isA11yNodeLike(child, budget));
}

export function toA11yPayload(value: unknown): BrowserLiveA11yPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value['nodeCount'] !== 'number') return null;
  const root = value['root'];
  if (root === null) return { root: null, nodeCount: value['nodeCount'] };
  if (!isA11yNodeLike(root, { remaining: MAX_VALIDATED_TREE_NODES })) return null;
  return { root, nodeCount: value['nodeCount'] };
}

export function toNodePayload(value: unknown): BrowserLiveNodePayload | null {
  if (!isRecord(value)) return null;
  const selector = value['selector'];
  const nodeName = value['nodeName'];
  if (typeof selector !== 'string' || selector.length === 0) return null;
  if (typeof nodeName !== 'string') return null;
  const attributes = toStringRecord(value['attributes']);
  if (attributes === null) return null;
  const computedStyles = toStringRecord(value['computedStyles']);
  if (computedStyles === null) return null;

  const payload: BrowserLiveNodePayload = {
    selector,
    nodeName,
    attributes,
    text: typeof value['text'] === 'string' ? value['text'] : '',
    computedStyles,
  };
  if (typeof value['selectorStrategy'] === 'string') {
    payload.selectorStrategy = value['selectorStrategy'];
  }
  if (typeof value['selectorUnique'] === 'boolean') {
    payload.selectorUnique = value['selectorUnique'];
  }
  const fullStyles = toStringRecord(value['fullComputedStyles']);
  if (fullStyles !== null) {
    payload.fullComputedStyles = fullStyles;
  }
  return payload;
}
