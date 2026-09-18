import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SESSION_SCOPE_KEY,
  DEFAULT_TEAM_SESSION_VIEW_ENTRY,
  LEGACY_LEAF_BY_PRIMARY_KEY,
  LEGACY_MIDDLE_TAB_KEY,
  LEGACY_VIEW_STATE_KEY,
  TEAM_SESSION_VIEW_STATE_MAX_ENTRIES,
  TEAM_SESSION_VIEW_STATE_STORAGE_KEY,
  TEAM_TAB_STATE_MAX_KEYS,
  migrateLegacySessionViewState,
  normalizeSessionScopeKey,
  normalizeTeamSessionViewEntry,
  normalizeTeamSessionViewStateMap,
  normalizeTeamTabStateValue,
  readLegacySessionViewEntry,
  readTeamSessionViewStateMap,
  resolveTeamSessionViewEntry,
  upsertTeamSessionViewEntry,
  writeTeamSessionViewStateMap,
  type TeamSessionViewEntry,
  type TeamSessionViewStateMap,
  type TeamSessionViewStateStorage,
} from './team-session-view-state-storage.js';

/** 原始（未归一化）完整条目，便于逐字段注入非法值。 */
const FULL_ENTRY_RAW: Record<string, unknown> = {
  updatedAt: 1234,
  middleTab: 'taskboard',
  leafByPrimary: { overview: 'dashboard', tasks: 'review' },
  focusMode: true,
  officeFullscreen: true,
  editorOverlayOpen: true,
  editorPaneTab: 'browser',
  browserPreviewUrl: 'http://localhost:5173/preview',
  drawerVisible: true,
  drawerTargetSessionId: 'session-42',
  selectedAgentId: 'agent-42',
  tabs: { scrollTop: 120, collapsed: true, label: 'x', filters: ['a', 'b'] },
};

/** FULL_ENTRY_RAW 全部合法时应得到的归一化结果。 */
const FULL_ENTRY: TeamSessionViewEntry = {
  updatedAt: 1234,
  middleTab: 'taskboard',
  leafByPrimary: { overview: 'dashboard', tasks: 'review' },
  focusMode: true,
  officeFullscreen: true,
  editorOverlayOpen: true,
  editorPaneTab: 'browser',
  browserPreviewUrl: 'http://localhost:5173/preview',
  drawerVisible: true,
  drawerTargetSessionId: 'session-42',
  selectedAgentId: 'agent-42',
  tabs: { scrollTop: 120, collapsed: true, label: 'x', filters: ['a', 'b'] },
};

interface MemoryStorage extends TeamSessionViewStateStorage {
  read(key: string): string | null;
  writeCount(): number;
}

function createMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>();
  let writes = 0;
  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    read(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      writes += 1;
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    writeCount(): number {
      return writes;
    },
  };
}

/** 预置旧版三个键：纯字符串 middleTab + JSON 视图状态 + JSON 映射。 */
function seedLegacyStorage(storage: MemoryStorage): void {
  storage.setItem(LEGACY_MIDDLE_TAB_KEY, 'taskboard');
  storage.setItem(LEGACY_VIEW_STATE_KEY, JSON.stringify({ focusMode: true }));
  storage.setItem(LEGACY_LEAF_BY_PRIMARY_KEY, JSON.stringify({ tasks: 'review' }));
}

describe('normalizeSessionScopeKey', () => {
  it('合法会话 id 原样返回', () => {
    expect(normalizeSessionScopeKey('session-42')).toBe('session-42');
  });

  it('去除首尾空白后返回非空值', () => {
    expect(normalizeSessionScopeKey('  session-42  ')).toBe('session-42');
  });

  it.each([null, undefined, '', '   ', '\t\n'])('空值（%j）回退默认作用域', (raw) => {
    expect(normalizeSessionScopeKey(raw)).toBe(DEFAULT_SESSION_SCOPE_KEY);
  });
});

describe('normalizeTeamTabStateValue', () => {
  it.each(['text', '', '  spaced  '])('字符串（%j）原样返回', (value) => {
    expect(normalizeTeamTabStateValue(value)).toBe(value);
  });

  it.each([true, false])('布尔值（%s）原样返回', (value) => {
    expect(normalizeTeamTabStateValue(value)).toBe(value);
  });

  it.each([0, 1.5, -3])('有限数字（%s）原样返回', (value) => {
    expect(normalizeTeamTabStateValue(value)).toBe(value);
  });

  it('字符串数组返回拷贝', () => {
    const input = ['a', 'b'];
    const result = normalizeTeamTabStateValue(input);

    expect(result).toEqual(['a', 'b']);
    expect(result).not.toBe(input);
  });

  it.each([{}, { key: 'a' }, ['a', 1], ['a', null], null, undefined, Number.NaN])(
    '非法值（%s）返回 null',
    (value) => {
      expect(normalizeTeamTabStateValue(value)).toBeNull();
    },
  );

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '非有限数字（%s）返回 null',
    (value) => {
      expect(normalizeTeamTabStateValue(value)).toBeNull();
    },
  );
});

describe('normalizeTeamSessionViewEntry', () => {
  it.each([null, undefined, 42, 'text', true, [], [{ focusMode: true }]])(
    '非普通对象输入（%s）回落默认条目',
    (raw) => {
      expect(normalizeTeamSessionViewEntry(raw)).toEqual(DEFAULT_TEAM_SESSION_VIEW_ENTRY);
    },
  );

  it('完整合法条目原样归一化', () => {
    expect(normalizeTeamSessionViewEntry(FULL_ENTRY_RAW)).toEqual(FULL_ENTRY);
  });

  it.each<[string, unknown, unknown]>([
    ['focusMode', 'yes', false],
    ['officeFullscreen', 1, false],
    ['editorOverlayOpen', null, false],
    ['editorPaneTab', 'bogus', 'code'],
    ['browserPreviewUrl', 42, null],
    ['drawerVisible', 'true', false],
    ['drawerTargetSessionId', { id: 'session-42' }, null],
    ['selectedAgentId', ['agent-42'], null],
  ])('字段 %s 类型非法时仅该字段回落，合法兄弟字段保留', (field, badValue, fallback) => {
    const raw = { ...FULL_ENTRY_RAW, [field]: badValue };

    expect(normalizeTeamSessionViewEntry(raw)).toEqual({ ...FULL_ENTRY, [field]: fallback });
  });

  it.each(['bogus', 'OFFICE', 'Taskboard', '', 42, null, undefined])(
    'middleTab 非法值（%j）回落 conversation',
    (badTab) => {
      const entry = normalizeTeamSessionViewEntry({ ...FULL_ENTRY_RAW, middleTab: badTab });

      expect(entry.middleTab).toBe('conversation');
    },
  );

  it('middleTab 为合法 office 时原样保留', () => {
    expect(normalizeTeamSessionViewEntry({ middleTab: 'office' }).middleTab).toBe('office');
  });

  it('leafByPrimary 仅保留合法配对，丢弃错配 / 非法键值', () => {
    const entry = normalizeTeamSessionViewEntry({
      leafByPrimary: {
        overview: 'dashboard',
        tasks: 'review',
        conversation: 'not-a-leaf',
        metrics: 'dashboard',
        ' bogus ': 'dashboard',
        governance: 'office',
        files: 42,
        '  overview  ': 'health',
      },
    });

    expect(entry.leafByPrimary).toEqual({ overview: 'health', tasks: 'review' });
  });

  it('tabs 仅保留合法值并丢弃非法值', () => {
    const entry = normalizeTeamSessionViewEntry({
      tabs: {
        scrollTop: 120,
        collapsed: true,
        label: 'x',
        filters: ['a', 'b'],
        badObject: { a: 1 },
        badNull: null,
        badNumber: Number.NaN,
        badMixedArray: ['a', 1],
        '  padded  ': 'ok',
        '   ': 'blank-key',
      },
    });

    expect(entry.tabs).toEqual({
      scrollTop: 120,
      collapsed: true,
      label: 'x',
      filters: ['a', 'b'],
      padded: 'ok',
    });
  });

  it('tabs 最多保留 64 个合法键，后续键被截断', () => {
    const rawTabs: Record<string, unknown> = {};
    for (let index = 0; index < 70; index += 1) {
      rawTabs[`key-${index}`] = index;
    }

    const entry = normalizeTeamSessionViewEntry({ tabs: rawTabs });

    expect(Object.keys(entry.tabs)).toHaveLength(TEAM_TAB_STATE_MAX_KEYS);
    expect(entry.tabs['key-63']).toBe(63);
    expect(entry.tabs['key-64']).toBeUndefined();
  });

  it('tabs 非法值不占用 64 个名额', () => {
    const rawTabs: Record<string, unknown> = {};
    for (let index = 0; index < 10; index += 1) {
      rawTabs[`bad-${index}`] = { not: 'allowed' };
    }
    for (let index = 0; index < 64; index += 1) {
      rawTabs[`good-${index}`] = index;
    }

    const entry = normalizeTeamSessionViewEntry({ tabs: rawTabs });

    expect(Object.keys(entry.tabs)).toHaveLength(TEAM_TAB_STATE_MAX_KEYS);
    expect(entry.tabs['good-63']).toBe(63);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    0,
    '123',
    null,
    undefined,
  ])('updatedAt 非法值（%s）回落 0', (badValue) => {
    expect(normalizeTeamSessionViewEntry({ updatedAt: badValue }).updatedAt).toBe(0);
  });

  it('updatedAt 为有限正数时原样保留', () => {
    expect(normalizeTeamSessionViewEntry({ updatedAt: 1234 }).updatedAt).toBe(1234);
  });

  it('未知多余字段被忽略，不影响合法字段', () => {
    const entry = normalizeTeamSessionViewEntry({
      ...FULL_ENTRY_RAW,
      unknownField: 'whatever',
      leftSidebarCollapsed: true,
    });

    expect(entry).toEqual(FULL_ENTRY);
    expect(Object.keys(entry).sort()).toEqual(Object.keys(FULL_ENTRY).sort());
  });
});

describe('normalizeTeamSessionViewStateMap', () => {
  it.each([null, undefined, 42, 'text', true, [], [{}]])(
    '非普通对象输入（%s）返回空集合',
    (raw) => {
      expect(normalizeTeamSessionViewStateMap(raw)).toEqual({});
    },
  );

  it('丢弃会 trim 成空串的键，其余键去空白后保留', () => {
    const result = normalizeTeamSessionViewStateMap({
      '   ': { middleTab: 'dashboard' },
      '  session-42  ': { middleTab: 'conversation' },
    });

    expect(Object.keys(result)).toEqual(['session-42']);
  });

  it('丢弃非对象值，保留合法条目', () => {
    const result = normalizeTeamSessionViewStateMap({
      good: { middleTab: 'taskboard', focusMode: true },
      badScalar: 42,
      badNull: null,
      badArray: [],
      badString: 'nope',
    });

    expect(Object.keys(result)).toEqual(['good']);
    expect(result['good']?.middleTab).toBe('taskboard');
    expect(result['good']?.focusMode).toBe(true);
  });

  it('集合内条目值按条目归一化规则处理', () => {
    const result = normalizeTeamSessionViewStateMap({
      'session-42': { ...FULL_ENTRY_RAW, editorPaneTab: 'bogus' },
    });

    expect(result['session-42']).toEqual({ ...FULL_ENTRY, editorPaneTab: 'code' });
  });
});

describe('readTeamSessionViewStateMap / writeTeamSessionViewStateMap', () => {
  it('write 后 read 能按同一键还原集合', () => {
    const storage = createMemoryStorage();
    const map = { 'session-42': FULL_ENTRY };

    writeTeamSessionViewStateMap(map, storage);

    expect(storage.read(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).not.toBeNull();
    expect(readTeamSessionViewStateMap(storage)).toEqual(map);
  });

  it('存储中没有记录时返回空集合', () => {
    expect(readTeamSessionViewStateMap(createMemoryStorage())).toEqual({});
  });

  it.each(['{not-json', '42', 'null', 'true', '"hello"', '[]', '[1,2]'])(
    '非法 JSON（%s）返回空集合',
    (raw) => {
      const storage = createMemoryStorage();
      storage.setItem(TEAM_SESSION_VIEW_STATE_STORAGE_KEY, raw);

      expect(readTeamSessionViewStateMap(storage)).toEqual({});
    },
  );

  it('getItem 抛错（隐私模式）时返回空集合', () => {
    const storage: TeamSessionViewStateStorage = {
      getItem: () => {
        throw new Error('localStorage 不可用');
      },
      setItem: vi.fn(),
    };

    expect(readTeamSessionViewStateMap(storage)).toEqual({});
  });

  it('setItem 抛错时静默忽略，不向外抛异常', () => {
    const storage: TeamSessionViewStateStorage = {
      getItem: vi.fn(() => null),
      setItem: () => {
        throw new Error('配额超限');
      },
    };

    expect(() => writeTeamSessionViewStateMap({ 'session-42': FULL_ENTRY }, storage)).not.toThrow();
  });
});

describe('resolveTeamSessionViewEntry', () => {
  it('缺失作用域时返回默认条目', () => {
    expect(resolveTeamSessionViewEntry({}, 'session-42')).toBe(DEFAULT_TEAM_SESSION_VIEW_ENTRY);
  });

  it('存在作用域时返回对应条目', () => {
    expect(resolveTeamSessionViewEntry({ 'session-42': FULL_ENTRY }, 'session-42')).toBe(
      FULL_ENTRY,
    );
  });
});

describe('upsertTeamSessionViewEntry', () => {
  it('返回新对象且不修改入参', () => {
    const map: TeamSessionViewStateMap = {};

    const next = upsertTeamSessionViewEntry(map, 'session-42', DEFAULT_TEAM_SESSION_VIEW_ENTRY);

    expect(next).not.toBe(map);
    expect(map).toEqual({});
    expect(Object.keys(next)).toEqual(['session-42']);
  });

  it('即使传入 updatedAt 为 0 也会打上当前时间戳', () => {
    const next = upsertTeamSessionViewEntry({}, 'session-42', {
      ...DEFAULT_TEAM_SESSION_VIEW_ENTRY,
      updatedAt: 0,
    });

    expect(next['session-42']?.updatedAt).toBeGreaterThan(0);
  });

  it('作用域键先 trim 归一化后写入', () => {
    const next = upsertTeamSessionViewEntry({}, '  session-42  ', DEFAULT_TEAM_SESSION_VIEW_ENTRY);

    expect(Object.keys(next)).toEqual(['session-42']);
  });

  it('覆盖已有作用域时保留其他条目', () => {
    const map: TeamSessionViewStateMap = { 'session-1': FULL_ENTRY };

    const next = upsertTeamSessionViewEntry(map, 'session-2', DEFAULT_TEAM_SESSION_VIEW_ENTRY);

    expect(map).toEqual({ 'session-1': FULL_ENTRY });
    expect(Object.keys(next).sort()).toEqual(['session-1', 'session-2']);
  });

  it('超出 50 条时淘汰 updatedAt 最小的条目并保持 50 条', () => {
    let map: TeamSessionViewStateMap = {};
    for (let index = 1; index <= TEAM_SESSION_VIEW_STATE_MAX_ENTRIES; index += 1) {
      map = {
        ...map,
        [`seed-${index}`]: { ...DEFAULT_TEAM_SESSION_VIEW_ENTRY, updatedAt: index },
      };
    }

    const next = upsertTeamSessionViewEntry(map, 'fresh', DEFAULT_TEAM_SESSION_VIEW_ENTRY);
    const keys = Object.keys(next);

    expect(keys).toHaveLength(TEAM_SESSION_VIEW_STATE_MAX_ENTRIES);
    expect(keys).toContain('fresh');
    expect(keys).not.toContain('seed-1');
    expect(keys).toContain('seed-2');
  });
});

describe('readLegacySessionViewEntry', () => {
  it('三个旧键都缺失时返回 null', () => {
    expect(readLegacySessionViewEntry(createMemoryStorage())).toBeNull();
  });

  it('由纯字符串 middleTab + JSON 视图状态 + JSON 映射组装条目', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_MIDDLE_TAB_KEY, 'taskboard');
    storage.setItem(
      LEGACY_VIEW_STATE_KEY,
      JSON.stringify({
        focusMode: true,
        editorPaneTab: 'browser',
        selectedAgentId: 'agent-42',
      }),
    );
    storage.setItem(
      LEGACY_LEAF_BY_PRIMARY_KEY,
      JSON.stringify({ overview: 'dashboard', metrics: 'dashboard' }),
    );

    const entry = readLegacySessionViewEntry(storage);

    expect(entry).not.toBeNull();
    expect(entry?.middleTab).toBe('taskboard');
    expect(entry?.focusMode).toBe(true);
    expect(entry?.editorPaneTab).toBe('browser');
    expect(entry?.selectedAgentId).toBe('agent-42');
    expect(entry?.officeFullscreen).toBe(false);
    expect(entry?.leafByPrimary).toEqual({ overview: 'dashboard' });
    expect(entry?.tabs).toEqual({});
    expect(entry?.updatedAt).toBeGreaterThan(0);
  });

  it('middleTab 为垃圾字符串时回落 conversation，其余字段仍生效', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_MIDDLE_TAB_KEY, 'not-a-tab');
    storage.setItem(LEGACY_VIEW_STATE_KEY, JSON.stringify({ focusMode: true }));

    const entry = readLegacySessionViewEntry(storage);

    expect(entry?.middleTab).toBe('conversation');
    expect(entry?.focusMode).toBe(true);
  });

  it('仅存在合法纯字符串 middleTab 时也能组装条目', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_MIDDLE_TAB_KEY, 'office');

    const entry = readLegacySessionViewEntry(storage);

    expect(entry?.middleTab).toBe('office');
    expect(entry?.focusMode).toBe(false);
  });

  it('三个键都存在但全部不可用时返回 null', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_MIDDLE_TAB_KEY, 'not-a-tab');
    storage.setItem(LEGACY_VIEW_STATE_KEY, '{not-json');
    storage.setItem(LEGACY_LEAF_BY_PRIMARY_KEY, 'also-not-json');

    expect(readLegacySessionViewEntry(storage)).toBeNull();
  });

  it('viewState 为非对象 JSON 且无其他可用旧值时返回 null', () => {
    const storage = createMemoryStorage();
    storage.setItem(LEGACY_VIEW_STATE_KEY, '42');

    expect(readLegacySessionViewEntry(storage)).toBeNull();
  });

  it('getItem 抛错时返回 null', () => {
    const storage: TeamSessionViewStateStorage = {
      getItem: () => {
        throw new Error('localStorage 不可用');
      },
      setItem: vi.fn(),
    };

    expect(readLegacySessionViewEntry(storage)).toBeNull();
  });
});

describe('migrateLegacySessionViewState', () => {
  it('迁移到指定作用域并清除三个旧键', () => {
    const storage = createMemoryStorage();
    seedLegacyStorage(storage);

    const migrated = migrateLegacySessionViewState('session-42', storage);

    expect(Object.keys(migrated)).toEqual(['session-42']);
    expect(migrated['session-42']?.middleTab).toBe('taskboard');
    expect(migrated['session-42']?.focusMode).toBe(true);
    expect(migrated['session-42']?.leafByPrimary).toEqual({ tasks: 'review' });
    expect(storage.read(LEGACY_MIDDLE_TAB_KEY)).toBeNull();
    expect(storage.read(LEGACY_VIEW_STATE_KEY)).toBeNull();
    expect(storage.read(LEGACY_LEAF_BY_PRIMARY_KEY)).toBeNull();
    expect(readTeamSessionViewStateMap(storage)).toEqual(migrated);
  });

  it('第二次调用幂等：集合不变、无新增写入、旧键保持移除', () => {
    const storage = createMemoryStorage();
    seedLegacyStorage(storage);
    const first = migrateLegacySessionViewState('session-42', storage);
    const writesAfterFirst = storage.writeCount();

    const second = migrateLegacySessionViewState('session-42', storage);

    expect(second).toEqual(first);
    expect(storage.writeCount()).toBe(writesAfterFirst);
    expect(storage.read(LEGACY_MIDDLE_TAB_KEY)).toBeNull();
    expect(storage.read(LEGACY_VIEW_STATE_KEY)).toBeNull();
    expect(storage.read(LEGACY_LEAF_BY_PRIMARY_KEY)).toBeNull();
  });

  it('作用域为 __default__ 时不迁移、不清旧键、不写入', () => {
    const storage = createMemoryStorage();
    seedLegacyStorage(storage);

    expect(migrateLegacySessionViewState(DEFAULT_SESSION_SCOPE_KEY, storage)).toEqual({});
    expect(storage.read(LEGACY_MIDDLE_TAB_KEY)).toBe('taskboard');
    expect(storage.read(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).toBeNull();
  });

  it('空白作用域键按 __default__ 处理，不做迁移', () => {
    const storage = createMemoryStorage();
    seedLegacyStorage(storage);

    expect(migrateLegacySessionViewState('   ', storage)).toEqual({});
    expect(storage.read(LEGACY_MIDDLE_TAB_KEY)).toBe('taskboard');
  });

  it('目标作用域已存在时保持原状，不迁移也不清旧键', () => {
    const storage = createMemoryStorage();
    seedLegacyStorage(storage);
    const existing: TeamSessionViewStateMap = {
      'session-42': { ...DEFAULT_TEAM_SESSION_VIEW_ENTRY, updatedAt: 99 },
    };
    writeTeamSessionViewStateMap(existing, storage);

    const result = migrateLegacySessionViewState('session-42', storage);

    expect(result).toEqual(existing);
    expect(storage.read(LEGACY_MIDDLE_TAB_KEY)).toBe('taskboard');
    expect(storage.read(LEGACY_VIEW_STATE_KEY)).not.toBeNull();
    expect(storage.read(LEGACY_LEAF_BY_PRIMARY_KEY)).not.toBeNull();
  });

  it('无旧数据时返回当前集合且不写入', () => {
    const storage = createMemoryStorage();

    expect(migrateLegacySessionViewState('session-42', storage)).toEqual({});
    expect(storage.read(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).toBeNull();
  });

  it('存储缺少 removeItem 时旧键退化为写入空字符串', () => {
    const values = new Map<string, string>([
      [LEGACY_MIDDLE_TAB_KEY, 'taskboard'],
      [LEGACY_VIEW_STATE_KEY, JSON.stringify({ focusMode: true })],
      [LEGACY_LEAF_BY_PRIMARY_KEY, JSON.stringify({})],
    ]);
    const storage: TeamSessionViewStateStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };

    const migrated = migrateLegacySessionViewState('session-42', storage);

    expect(migrated['session-42']?.middleTab).toBe('taskboard');
    expect(values.get(TEAM_SESSION_VIEW_STATE_STORAGE_KEY)).not.toBeNull();
    expect(values.get(LEGACY_MIDDLE_TAB_KEY)).toBe('');
    expect(values.get(LEGACY_VIEW_STATE_KEY)).toBe('');
    expect(values.get(LEGACY_LEAF_BY_PRIMARY_KEY)).toBe('');
  });
});
