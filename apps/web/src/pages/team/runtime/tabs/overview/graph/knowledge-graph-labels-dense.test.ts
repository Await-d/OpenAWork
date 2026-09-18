import { describe, expect, it } from 'vitest';
import { aggregateRadiusFor } from './knowledge-graph-layout.js';
import {
  estimateLabelBox,
  selectVisibleLabels,
  type LabelBox,
  type LabelCandidate,
} from './knowledge-graph-labels.js';

const AGGREGATE_LABEL = 'knowledge:规格、计划、任务、实现与评审产物';

function makeCandidate(
  overrides: Partial<LabelCandidate> & Pick<LabelCandidate, 'id'>,
): LabelCandidate {
  return {
    kind: 'knowledge',
    depth: 1,
    persisted: false,
    highlighted: false,
    x: 100,
    y: 100,
    radius: 14,
    label: '节点标签',
    index: 0,
    ...overrides,
  } satisfies LabelCandidate;
}

function boxesOverlap(left: LabelBox, right: LabelBox): boolean {
  return (
    left.left < right.right &&
    right.left < left.right &&
    left.top < right.bottom &&
    right.top < left.bottom
  );
}

function boxHitsDisc(
  box: LabelBox,
  disc: { readonly x: number; readonly y: number; readonly radius: number },
): boolean {
  const closestX = Math.min(Math.max(disc.x, box.left), box.right);
  const closestY = Math.min(Math.max(disc.y, box.top), box.bottom);
  const dx = disc.x - closestX;
  const dy = disc.y - closestY;
  return dx * dx + dy * dy < disc.radius * disc.radius;
}

describe('密集场景零重叠（DEFECT B 回归锁）', () => {
  it('密集网格：每个被接受的标签盒都不与其它标签盒、也不与任一节点圆重叠', () => {
    const columns = 10;
    const rows = 8;
    const candidates: LabelCandidate[] = [];
    const obstacles: { readonly x: number; readonly y: number; readonly radius: number }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = 200 + column * 46;
        const y = 200 + row * 44;
        const radius = 14;
        candidates.push(
          makeCandidate({
            id: `grid-${row}-${column}`,
            depth: 3,
            x,
            y,
            radius,
            label: `密集标签 ${row}-${column}：用于验证零重叠的合成场景`,
            index: row * columns + column,
          }),
        );
        obstacles.push({ x, y, radius });
      }
    }

    const visible = selectVisibleLabels(candidates, { obstacles });
    expect(visible.size).toBeGreaterThan(0);
    expect(visible.size).toBeLessThan(candidates.length);

    const boxes = candidates
      .filter((candidate) => visible.has(candidate.id))
      .map((candidate) => estimateLabelBox(candidate));

    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        expect(boxesOverlap(boxes[left]!, boxes[right]!)).toBe(false);
      }
      for (const disc of obstacles) {
        expect(boxHitsDisc(boxes[left]!, disc)).toBe(false);
      }
    }
  });

  it('优先级顺序被尊重：选中标签保留，与之碰撞的低优先级标签被丢弃', () => {
    const selected = makeCandidate({
      id: 'selected',
      highlighted: true,
      x: 300,
      y: 300,
      index: 1,
    });
    const low = makeCandidate({ id: 'low', x: 305, y: 302, index: 0 });

    const visible = selectVisibleLabels([low, selected]);

    expect(visible.has('selected')).toBe(true);
    expect(visible.has('low')).toBe(false);
  });

  it('选中 / 聚焦标签即使落在节点圆上也不被丢弃', () => {
    const selected = makeCandidate({
      id: 'selected',
      highlighted: true,
      x: 300,
      y: 300,
      radius: 14,
      index: 0,
    });

    const visible = selectVisibleLabels([selected], {
      obstacles: [{ x: 300, y: 322, radius: 16 }],
    });

    expect(visible.has('selected')).toBe(true);
  });

  it('折叠聚合优先级高于普通内容标签，但同样必须让开节点圆', () => {
    const aggregate = makeCandidate({
      id: 'agg',
      kind: 'knowledge',
      x: 300,
      y: 300,
      radius: aggregateRadiusFor(942),
      aggregate: true,
      descendantCount: 942,
      label: AGGREGATE_LABEL,
      index: 1,
    });
    const leaf = makeCandidate({ id: 'leaf', depth: 3, x: 300, y: 330, index: 0 });

    const visible = selectVisibleLabels([leaf, aggregate]);

    expect(visible.has('agg')).toBe(true);
    expect(visible.has('leaf')).toBe(false);

    const blocked = selectVisibleLabels([aggregate], {
      obstacles: [{ x: aggregate.x, y: aggregate.y + aggregate.radius + 10, radius: 12 }],
    });
    expect(blocked.has('agg')).toBe(false);
  });
});
