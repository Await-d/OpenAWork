/**
 * 内容区右键菜单命令段的纯构建契约：ids / 顺序 / 分隔线 / 禁用原因复用，
 * 以及 ⋯ 菜单仍依赖的 `buildSplitDirectionItems` 缺省字面量。
 */

import { describe, expect, it, vi } from 'vitest';
import { paneLimitMessage } from './terminal-panel-shortcuts.js';
import {
  buildSplitDirectionItems,
  buildTerminalCommandItems,
  SPLIT_DIRECTION_HINTS,
  type TerminalCommandItemsInput,
} from './terminal-pane-menu.js';

function makeInput(overrides: Partial<TerminalCommandItemsInput> = {}): TerminalCommandItemsInput {
  return {
    terminalCount: 2,
    totalTerminalCount: 2,
    sessionReady: true,
    creating: false,
    splitDirections: ['row', 'column'],
    onRequestCreate: vi.fn(),
    onRequestSplit: vi.fn(),
    onRequestKill: vi.fn(),
    onRequestRename: vi.fn(),
    onRequestCloseOthers: vi.fn(),
    onRequestCloseAll: vi.fn(),
    ...overrides,
  };
}

/** 只暴露契约关心的三列，避免把 onSelect 等不稳定引用写进快照式比较。 */
function shape(items: ReturnType<typeof buildTerminalCommandItems>) {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    disabled: item.disabled ?? false,
    separatorBefore: item.separatorBefore ?? false,
    title: item.title,
  }));
}

describe('buildTerminalCommandItems', () => {
  it('按 VS Code 顺序产出命令段，且分隔线只出现在拆分首项与关闭组之前', () => {
    const items = buildTerminalCommandItems(makeInput());

    expect(items.map((item) => item.id)).toEqual([
      'terminal-new',
      'terminal-split-row',
      'terminal-split-column',
      'terminal-kill',
      'terminal-rename',
      'terminal-close-others',
      'terminal-close-all',
    ]);
    expect(items.map((item) => item.label)).toEqual([
      '新建终端',
      '向右拆分',
      '向下拆分',
      '终止终端',
      '重命名',
      '关闭其他终端',
      '关闭全部终端',
    ]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual([
      'terminal-split-row',
      'terminal-close-others',
    ]);
  });

  it('窄屏（只允许 column）：不产出「向右拆分」', () => {
    const items = buildTerminalCommandItems(makeInput({ splitDirections: ['column'] }));

    expect(items.map((item) => item.id)).toEqual([
      'terminal-new',
      'terminal-split-column',
      'terminal-kill',
      'terminal-rename',
      'terminal-close-others',
      'terminal-close-all',
    ]);
  });

  it('pane 上限：两项拆分都禁用并复用 paneLimitMessage 措辞', () => {
    const items = buildTerminalCommandItems(
      makeInput({ splitDisabledReason: paneLimitMessage(4) }),
    );
    const splitItems = items.filter((item) => item.id.startsWith('terminal-split-'));

    expect(splitItems).toHaveLength(2);
    for (const item of splitItems) {
      expect(item.disabled).toBe(true);
      expect(item.title).toBe('分屏已达上限（4 个组）');
    }
  });

  it('空组：终止 / 重命名 / 关闭类都禁用并给出同一原因', () => {
    const items = buildTerminalCommandItems(makeInput({ terminalCount: 0, totalTerminalCount: 0 }));
    const shapeById = new Map(shape(items).map((item) => [item.id, item]));

    for (const id of [
      'terminal-kill',
      'terminal-rename',
      'terminal-close-others',
      'terminal-close-all',
    ]) {
      expect(shapeById.get(id)?.disabled).toBe(true);
      expect(shapeById.get(id)?.title).toBe('当前组没有终端，先新建一个');
    }
    // 新建仍可用：空组恰恰是它存在的场景。
    expect(shapeById.get('terminal-new')?.disabled).toBe(false);
  });

  it('会话未就绪 / 创建中：「新建终端」分别给出对应原因', () => {
    const notReady = buildTerminalCommandItems(makeInput({ sessionReady: false }));
    expect(notReady[0]?.disabled).toBe(true);
    expect(notReady[0]?.title).toBe('会话未就绪，无法新建终端');

    const creating = buildTerminalCommandItems(makeInput({ creating: true }));
    expect(creating[0]?.disabled).toBe(true);
    expect(creating[0]?.title).toBe('正在创建终端，请稍候');
  });

  it('缺省动作目标：终止 / 重命名 / 关闭其他的 title 与内容区菜单既有字面量逐字一致', () => {
    const items = buildTerminalCommandItems(makeInput({ terminalCount: 3, totalTerminalCount: 4 }));
    const titleById = new Map(items.map((item) => [item.id, item.title]));

    expect(titleById.get('terminal-kill')).toBe('终止当前组的活动终端');
    expect(titleById.get('terminal-rename')).toBe('重命名当前组的活动终端');
    expect(titleById.get('terminal-close-others')).toBe('关闭当前组内除活动终端外的终端');
  });

  it('自定义动作目标（tab 右键菜单口径）：终止 / 重命名用 long，关闭其他用 short', () => {
    const items = buildTerminalCommandItems(
      makeInput({
        terminalCount: 3,
        totalTerminalCount: 4,
        target: { long: '该终端', short: '该终端' },
      }),
    );
    const titleById = new Map(items.map((item) => [item.id, item.title]));

    expect(titleById.get('terminal-kill')).toBe('终止该终端');
    expect(titleById.get('terminal-rename')).toBe('重命名该终端');
    expect(titleById.get('terminal-close-others')).toBe('关闭当前组内除该终端外的终端');
  });

  it('long / short 是两个独立槽位：从句只认 short，动词项只认 long', () => {
    const items = buildTerminalCommandItems(
      makeInput({
        terminalCount: 3,
        totalTerminalCount: 4,
        target: { long: '当前组的活动终端', short: '该终端' },
      }),
    );
    const titleById = new Map(items.map((item) => [item.id, item.title]));

    expect(titleById.get('terminal-kill')).toBe('终止当前组的活动终端');
    expect(titleById.get('terminal-rename')).toBe('重命名当前组的活动终端');
    expect(titleById.get('terminal-close-others')).toBe('关闭当前组内除该终端外的终端');
  });

  it('本组只剩一个终端：关闭其他禁用，「关闭全部」仍可用', () => {
    const items = buildTerminalCommandItems(makeInput({ terminalCount: 1, totalTerminalCount: 3 }));
    const shapeById = new Map(shape(items).map((item) => [item.id, item]));

    expect(shapeById.get('terminal-close-others')?.disabled).toBe(true);
    expect(shapeById.get('terminal-close-others')?.title).toBe(
      '当前组只有一个终端，没有其他终端可关闭',
    );
    expect(shapeById.get('terminal-close-all')?.disabled).toBe(false);
    // 单个终端仍可终止 / 重命名。
    expect(shapeById.get('terminal-kill')?.disabled).toBe(false);
    expect(shapeById.get('terminal-rename')?.disabled).toBe(false);
  });

  it('可用项把 onSelect 落到对应回调（方向拆分带方向）', () => {
    const input = makeInput();
    const items = buildTerminalCommandItems(input);
    const byId = new Map(items.map((item) => [item.id, item]));

    byId.get('terminal-new')?.onSelect();
    byId.get('terminal-split-row')?.onSelect();
    byId.get('terminal-split-column')?.onSelect();
    byId.get('terminal-kill')?.onSelect();
    byId.get('terminal-rename')?.onSelect();
    byId.get('terminal-close-others')?.onSelect();
    byId.get('terminal-close-all')?.onSelect();

    expect(input.onRequestCreate).toHaveBeenCalledTimes(1);
    expect(input.onRequestSplit).toHaveBeenNthCalledWith(1, 'row');
    expect(input.onRequestSplit).toHaveBeenNthCalledWith(2, 'column');
    expect(input.onRequestKill).toHaveBeenCalledTimes(1);
    expect(input.onRequestRename).toHaveBeenCalledTimes(1);
    expect(input.onRequestCloseOthers).toHaveBeenCalledTimes(1);
    expect(input.onRequestCloseAll).toHaveBeenCalledTimes(1);
  });
});

describe('buildSplitDirectionItems（⋯ 菜单共用）', () => {
  it('缺省 id 保持 split-<direction>，首项带分隔线，title 带方向提示', () => {
    const items = buildSplitDirectionItems(['row', 'column'], {
      onRequestSplitWithDirection: vi.fn(),
    });

    expect(items.map((item) => item.id)).toEqual(['split-row', 'split-column']);
    expect(items[0]?.separatorBefore).toBe(true);
    expect(items[1]?.separatorBefore).toBe(false);
    expect(items[0]?.title).toContain(SPLIT_DIRECTION_HINTS.row);
    expect(items[1]?.title).toContain(SPLIT_DIRECTION_HINTS.column);
  });

  it('缺回调 / 有禁用原因时：禁用并把原因放进 title', () => {
    const unbound = buildSplitDirectionItems(['row'], {});
    expect(unbound[0]?.disabled).toBe(true);
    expect(unbound[0]?.title).toBe('分屏未接入');

    const limited = buildSplitDirectionItems(['row'], {
      onRequestSplitWithDirection: vi.fn(),
      splitDisabledReason: paneLimitMessage(4),
    });
    expect(limited[0]?.disabled).toBe(true);
    expect(limited[0]?.title).toBe('分屏已达上限（4 个组）');
  });

  it('idPrefix 用于区分内容区菜单与 ⋯ 菜单的同一组方向项', () => {
    const items = buildSplitDirectionItems(['row', 'column'], {
      idPrefix: 'terminal-',
      onRequestSplitWithDirection: vi.fn(),
    });

    expect(items.map((item) => item.id)).toEqual(['terminal-split-row', 'terminal-split-column']);
  });
});
