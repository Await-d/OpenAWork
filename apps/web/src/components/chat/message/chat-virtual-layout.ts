import type { ChatRenderGroup } from './chat-message-group-list.js';

export const VIRTUAL_BLOCK_ENTRY_LIMIT = 8;

export interface ChatVirtualBlock {
  key: string;
  group: ChatRenderGroup;
  groupIndex: number;
  entryOffset: number;
  isLast: boolean;
}

/** 子块仅改变挂载粒度，不改变消息的视觉分组与身份。 */
export function buildChatVirtualBlocks(
  groups: ChatRenderGroup[],
  previous: ChatVirtualBlock[] = [],
): ChatVirtualBlock[] {
  const previousByKey = new Map(previous.map((block) => [block.key, block]));
  return groups.flatMap((group, groupIndex) => {
    if (group.kind !== 'messages' || group.entries.length <= VIRTUAL_BLOCK_ENTRY_LIMIT) {
      return [{ key: group.key, group, groupIndex, entryOffset: 0, isLast: true }];
    }
    const blocks: ChatVirtualBlock[] = [];
    for (let offset = 0; offset < group.entries.length; offset += VIRTUAL_BLOCK_ENTRY_LIMIT) {
      const key = `${group.key}:virtual:${offset}`;
      const entries = group.entries.slice(offset, offset + VIRTUAL_BLOCK_ENTRY_LIMIT);
      const old = previousByKey.get(key);
      const oldGroup = old?.group;
      const blockGroup =
        oldGroup?.kind === 'messages' &&
        (offset > 0 || oldGroup.actions === group.actions) &&
        oldGroup.role === group.role &&
        oldGroup.entries.length === entries.length &&
        oldGroup.entries.every((entry, index) => entry === entries[index])
          ? oldGroup
          : { ...group, entries };
      blocks.push({
        key,
        group: blockGroup,
        groupIndex,
        entryOffset: offset,
        isLast: offset + VIRTUAL_BLOCK_ENTRY_LIMIT >= group.entries.length,
      });
    }
    return blocks;
  });
}

/** Fenwick 前缀和：单块实测更新 O(log n)，不重算全表偏移。 */
export class ChatVirtualLayout {
  private keys: string[] = [];
  private heights: number[] = [];
  private tree: number[] = [0];
  private positions = new Map<string, number>();

  reconcile(keys: string[], readHeight: (index: number) => number): void {
    const sameKeys =
      keys.length === this.keys.length && keys.every((key, i) => key === this.keys[i]);
    if (!sameKeys) {
      this.keys = keys;
      this.heights = Array.from({ length: keys.length }, () => 0);
      this.tree = Array.from({ length: keys.length + 1 }, () => 0);
      this.positions = new Map(keys.map((key, index) => [key, index]));
    }
    keys.forEach((key, index) => this.update(key, readHeight(index)));
  }

  update(key: string, height: number): void {
    const index = this.positions.get(key);
    if (index === undefined) return;
    const delta = height - (this.heights[index] ?? 0);
    if (delta === 0) return;
    this.heights[index] = height;
    for (let i = index + 1; i < this.tree.length; i += i & -i) {
      this.tree[i] = (this.tree[i] ?? 0) + delta;
    }
  }

  offset(index: number): number {
    let sum = 0;
    for (let i = Math.min(index, this.keys.length); i > 0; i -= i & -i) {
      sum += this.tree[i] ?? 0;
    }
    return sum;
  }

  get totalHeight(): number {
    return this.offset(this.keys.length);
  }

  /** 实测更新后发布新读视图，让 React Compiler 以版本身份失效布局读取。 */
  readView(version: number) {
    return {
      version,
      totalHeight: this.totalHeight,
      offset: (index: number) => this.offset(index),
      lowerBound: (boundary: number) => this.lowerBound(boundary),
    };
  }

  /** 二分提升定位首个结束位置不早于边界的块。 */
  lowerBound(boundary: number): number {
    let index = 0;
    let sum = 0;
    let step = 1;
    while (step * 2 <= this.keys.length) step *= 2;
    for (; step >= 1; step /= 2) {
      const next = index + step;
      if (next <= this.keys.length && sum + (this.tree[next] ?? 0) < boundary) {
        sum += this.tree[next] ?? 0;
        index = next;
      }
    }
    return index;
  }
}
