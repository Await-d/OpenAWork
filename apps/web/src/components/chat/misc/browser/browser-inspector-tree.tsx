/**
 * 检查器的树视图（DOM 树 / 无障碍树共用）。
 *
 * 无障碍语义按 WAI-ARIA `tree` 约定实现：容器 `role="tree"`，行是扁平的
 * `role="treeitem"`（用 `aria-level` 表达层级，这是虚拟化树的标准做法），
 * `aria-expanded` 只出现在真的有子节点的行上。
 *
 * 键盘：↑/↓ 移动、→ 展开或进入第一个子节点、← 折叠或回到父节点、Home/End 首尾、
 * Enter/Space 选中；roving tabindex 保证整棵树只有一个 Tab 停留点。
 *
 * 行内容由「标签片段」数组渲染（片段在生产端的纯函数里生成），样式与颜色一律走
 * token 映射，组件本身不做任何颜色判断。
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { InspectorChevron } from './browser-inspector-chrome.js';
import {
  INSPECTOR_LABEL_TONE,
  INSPECTOR_TOKEN,
  mergeInspectorShadows,
} from './browser-inspector-tokens.js';
import type { InspectorLabelPart } from './browser-inspector-model.js';

export interface InspectorTreeItem {
  id: string;
  depth: number;
  parts: InspectorLabelPart[];
  hasChildren: boolean;
  expanded: boolean;
  /** 已忽略的无障碍节点等：整行降透明度，表达「存在于树里但不参与」。 */
  dimmed?: boolean;
  /** 行尾补充说明（如 a11y 的子树节点数）。 */
  note?: string;
}

export interface InspectorTreeViewProps {
  ariaLabel: string;
  testId: string;
  rowTestId: string;
  toggleTestId: string;
  items: readonly InspectorTreeItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  /** 变化即把选中行滚进视野（拾取定位用）；普通点击选中不需要滚动。 */
  scrollTick?: number;
}

const INDENT_PER_LEVEL = 12;

export function InspectorTreeView({
  ariaLabel,
  testId,
  rowTestId,
  toggleTestId,
  items,
  selectedId,
  onSelect,
  onToggle,
  scrollTick = 0,
}: InspectorTreeViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (selectedId === null) return;
    const row = rowRefs.current.get(selectedId);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, scrollTick]);

  const focusRow = (id: string): void => {
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };

  const indexOf = (id: string | null): number =>
    id === null ? -1 : items.findIndex((item) => item.id === id);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) return;
    // 当前行优先取事件目标上的 `data-row-id`：它反映真实焦点位置。只用 state 会在
    // 焦点未经 React onFocus 变更时（程序化 focus / 浏览器恢复焦点）读到过期行，
    // 于是键盘操作落在错误的节点上。
    const targetId = (event.target as HTMLElement | null)?.getAttribute?.('data-row-id') ?? null;
    const currentId =
      targetId !== null && indexOf(targetId) >= 0
        ? targetId
        : (activeId ?? selectedId ?? items[0]?.id ?? null);
    const currentIndex = indexOf(currentId);
    const item = currentIndex >= 0 ? items[currentIndex] : undefined;

    const moveTo = (index: number): void => {
      const clamped = Math.min(Math.max(index, 0), items.length - 1);
      const target = items[clamped];
      if (target !== undefined) focusRow(target.id);
    };

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        moveTo(currentIndex < 0 ? 0 : currentIndex + 1);
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        moveTo(currentIndex < 0 ? 0 : currentIndex - 1);
        return;
      }
      case 'ArrowRight': {
        event.preventDefault();
        if (item === undefined) return;
        if (item.hasChildren && !item.expanded) {
          onToggle(item.id);
          return;
        }
        const next = items[currentIndex + 1];
        if (next !== undefined && next.depth > item.depth) moveTo(currentIndex + 1);
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (item === undefined) return;
        if (item.hasChildren && item.expanded) {
          onToggle(item.id);
          return;
        }
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const candidate = items[index];
          if (candidate !== undefined && candidate.depth < item.depth) {
            moveTo(index);
            return;
          }
        }
        return;
      }
      case 'Home': {
        event.preventDefault();
        moveTo(0);
        return;
      }
      case 'End': {
        event.preventDefault();
        moveTo(items.length - 1);
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (item !== undefined) onSelect(item.id);
        return;
      }
      default:
        return;
    }
  };

  const activeRowId =
    indexOf(activeId) >= 0
      ? activeId
      : indexOf(selectedId) >= 0
        ? selectedId
        : (items[0]?.id ?? null);

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <InspectorTreeRow
            key={item.id}
            item={item}
            selected={selected}
            active={item.id === activeRowId}
            rowTestId={rowTestId}
            toggleTestId={toggleTestId}
            registerRef={(element) => {
              if (element === null) {
                rowRefs.current.delete(item.id);
              } else {
                rowRefs.current.set(item.id, element);
              }
            }}
            onSelect={onSelect}
            onToggle={onToggle}
            onFocusRow={setActiveId}
          />
        );
      })}
    </div>
  );
}

function InspectorTreeRow({
  item,
  selected,
  active,
  rowTestId,
  toggleTestId,
  registerRef,
  onSelect,
  onToggle,
  onFocusRow,
}: {
  item: InspectorTreeItem;
  selected: boolean;
  active: boolean;
  rowTestId: string;
  toggleTestId: string;
  registerRef: (element: HTMLButtonElement | null) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onFocusRow: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <button
      ref={registerRef}
      type="button"
      role="treeitem"
      data-testid={rowTestId}
      data-row-id={item.id}
      data-depth={item.depth}
      data-expanded={item.hasChildren ? item.expanded : undefined}
      aria-level={item.depth + 1}
      aria-selected={selected}
      aria-expanded={item.hasChildren ? item.expanded : undefined}
      tabIndex={active ? 0 : -1}
      title={item.parts.map((part) => part.text).join('')}
      onClick={() => onSelect(item.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => {
        setFocused(true);
        onFocusRow(item.id);
      }}
      onBlur={() => setFocused(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
        minHeight: 18,
        padding: `0 8px 0 ${4 + item.depth * INDENT_PER_LEVEL}px`,
        border: 'none',
        borderRadius: INSPECTOR_TOKEN.radiusXs,
        background: selected
          ? INSPECTOR_TOKEN.selectedBg
          : pressed
            ? INSPECTOR_TOKEN.pressedBg
            : hovered
              ? INSPECTOR_TOKEN.hoverBg
              : 'transparent',
        color: INSPECTOR_TOKEN.textDefault,
        font: 'inherit',
        fontSize: 10.5,
        textAlign: 'left',
        cursor: 'pointer',
        opacity: item.dimmed === true ? 0.55 : 1,
        outline: focused ? `2px solid ${INSPECTOR_TOKEN.accent}` : 'none',
        outlineOffset: -2,
        boxShadow: mergeInspectorShadows(
          selected ? `inset 2px 0 0 0 ${INSPECTOR_TOKEN.accent}` : null,
          focused ? `0 0 0 4px ${INSPECTOR_TOKEN.focusRing}` : null,
        ),
        transition: `background ${INSPECTOR_TOKEN.motionMicro}`,
      }}
    >
      {item.hasChildren ? (
        <span
          data-testid={toggleTestId}
          role="presentation"
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            onToggle(item.id);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 12,
            height: 12,
            flexShrink: 0,
            color: hovered ? INSPECTOR_TOKEN.textDefault : INSPECTOR_TOKEN.textSubtle,
            transform: item.expanded ? 'rotate(90deg)' : 'none',
            transition: `transform ${INSPECTOR_TOKEN.motionMicro}`,
          }}
        >
          <InspectorChevron />
        </span>
      ) : (
        <span aria-hidden="true" style={{ display: 'inline-block', width: 12, flexShrink: 0 }} />
      )}
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: INSPECTOR_TOKEN.mono,
        }}
      >
        {item.parts.map((part, index) => (
          <span key={`${part.tone}-${index}`} style={{ color: INSPECTOR_LABEL_TONE[part.tone] }}>
            {part.text}
          </span>
        ))}
      </span>
      {item.note !== undefined ? (
        <span style={{ color: INSPECTOR_TOKEN.textSubtle, fontSize: 9, whiteSpace: 'nowrap' }}>
          {item.note}
        </span>
      ) : null}
    </button>
  );
}
