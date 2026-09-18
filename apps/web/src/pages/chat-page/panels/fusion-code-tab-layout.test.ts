import { describe, expect, it } from 'vitest';
import {
  FILE_TREE_WIDTH_DEFAULT,
  FILE_TREE_WIDTH_MAX,
  FILE_TREE_WIDTH_MIN,
} from '../../../components/file-editor/workspace-resize.js';
import {
  DOCK_FILE_TREE_MAX_WIDTH_RATIO,
  DOCK_FILE_TREE_MIN_WIDTH_PX,
  DOCK_FILE_TREE_NARROW_MAX_PX,
  resolveDockFileTreeLayout,
} from './fusion-code-tab-layout.js';

describe('resolveDockFileTreeLayout', () => {
  it('未测量到宽度时沿用全局默认文件树宽度与区间', () => {
    const layout = resolveDockFileTreeLayout(0);

    expect(layout.initialWidth).toBe(FILE_TREE_WIDTH_DEFAULT);
    expect(layout.bounds).toEqual({ min: FILE_TREE_WIDTH_MIN, max: FILE_TREE_WIDTH_MAX });
  });

  it('宽停靠沿用全局默认宽度与区间', () => {
    const layout = resolveDockFileTreeLayout(DOCK_FILE_TREE_NARROW_MAX_PX);

    expect(layout.initialWidth).toBe(FILE_TREE_WIDTH_DEFAULT);
    expect(layout.bounds).toEqual({ min: FILE_TREE_WIDTH_MIN, max: FILE_TREE_WIDTH_MAX });
  });

  it('窄停靠把文件树上限压到宿主宽度的 45%，编辑器保留多数列宽', () => {
    const hostWidth = 300;
    const layout = resolveDockFileTreeLayout(hostWidth);
    const editorWidth = hostWidth - layout.bounds.max - 4;

    expect(layout.bounds.max).toBe(Math.floor(hostWidth * DOCK_FILE_TREE_MAX_WIDTH_RATIO));
    expect(layout.bounds.max).toBeLessThan(FILE_TREE_WIDTH_MAX);
    expect(layout.initialWidth).toBeLessThanOrEqual(layout.bounds.max);
    expect(layout.initialWidth).toBeGreaterThanOrEqual(layout.bounds.min);
    expect(editorWidth).toBeGreaterThan(layout.bounds.max);
  });

  it('极窄停靠不让文件树归零，仍保留可读的最小宽度', () => {
    const layout = resolveDockFileTreeLayout(120);

    expect(layout.bounds.min).toBeGreaterThanOrEqual(DOCK_FILE_TREE_MIN_WIDTH_PX);
    expect(layout.bounds.max).toBeGreaterThanOrEqual(layout.bounds.min);
    expect(layout.initialWidth).toBeGreaterThanOrEqual(layout.bounds.min);
    expect(layout.initialWidth).toBeLessThanOrEqual(layout.bounds.max);
  });

  it('非有限宽度按未测量处理', () => {
    const layout = resolveDockFileTreeLayout(Number.NaN);

    expect(layout.initialWidth).toBe(FILE_TREE_WIDTH_DEFAULT);
    expect(layout.bounds).toEqual({ min: FILE_TREE_WIDTH_MIN, max: FILE_TREE_WIDTH_MAX });
  });
});
