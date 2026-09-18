import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TEAM_PAGE_VIEW_STATE,
  TEAM_PAGE_VIEW_STATE_STORAGE_KEY,
  normalizeTeamPageViewState,
  readTeamPageViewState,
  type TeamPageViewStateSnapshot,
  type TeamPageViewStateStorage,
} from './team-page-view-state-storage.js';

const FULL_SNAPSHOT: TeamPageViewStateSnapshot = {
  focusMode: true,
  officeFullscreen: true,
  editorOverlayOpen: true,
  editorPaneTab: 'browser',
  browserPreviewUrl: 'http://localhost:5173/preview',
  drawerVisible: true,
  drawerTargetSessionId: 'session-42',
  selectedAgentId: 'agent-42',
};

/** 把完整快照转成「原始 JSON 对象」，便于逐字段注入非法值。 */
function toRawSnapshot(snapshot: TeamPageViewStateSnapshot): Record<string, unknown> {
  return { ...snapshot };
}

function createMemoryStorage(): TeamPageViewStateStorage & { read(key: string): string | null } {
  const values = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    read(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
  };
}

/** 预置一条原始字符串记录的存储替身。 */
function seedStorage(raw: string): TeamPageViewStateStorage {
  const storage = createMemoryStorage();
  storage.setItem(TEAM_PAGE_VIEW_STATE_STORAGE_KEY, raw);
  return storage;
}

describe('readTeamPageViewState', () => {
  it('存储中没有记录时回落默认快照', () => {
    expect(readTeamPageViewState(createMemoryStorage())).toEqual(DEFAULT_TEAM_PAGE_VIEW_STATE);
  });

  it('垃圾 JSON 文本回落默认快照', () => {
    expect(readTeamPageViewState(seedStorage('{not-json'))).toEqual(DEFAULT_TEAM_PAGE_VIEW_STATE);
  });

  it.each(['42', 'null', 'true', '"hello"', '[]', '[1,2]'])(
    '非对象 JSON（%s）回落默认快照',
    (raw) => {
      expect(readTeamPageViewState(seedStorage(raw))).toEqual(DEFAULT_TEAM_PAGE_VIEW_STATE);
    },
  );

  it('getItem 抛错（隐私模式）时回落默认快照', () => {
    const storage: TeamPageViewStateStorage = {
      getItem: () => {
        throw new Error('localStorage 不可用');
      },
      setItem: vi.fn(),
    };

    expect(readTeamPageViewState(storage)).toEqual(DEFAULT_TEAM_PAGE_VIEW_STATE);
  });
});

describe('normalizeTeamPageViewState', () => {
  it.each([null, undefined, 42, 'text', true, [], [{ focusMode: true }]])(
    '非普通对象输入 %s 回落默认快照',
    (raw) => {
      expect(normalizeTeamPageViewState(raw)).toEqual(DEFAULT_TEAM_PAGE_VIEW_STATE);
    },
  );

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
    const raw = toRawSnapshot(FULL_SNAPSHOT);
    raw[field] = badValue;

    expect(normalizeTeamPageViewState(raw)).toEqual({ ...FULL_SNAPSHOT, [field]: fallback });
  });

  it.each(['', '   ', '\t\n'])('空白字符串字段（%j）回落为 null', (blank) => {
    const raw = toRawSnapshot(FULL_SNAPSHOT);
    raw.browserPreviewUrl = blank;
    raw.drawerTargetSessionId = blank;
    raw.selectedAgentId = blank;

    expect(normalizeTeamPageViewState(raw)).toEqual({
      ...FULL_SNAPSHOT,
      browserPreviewUrl: null,
      drawerTargetSessionId: null,
      selectedAgentId: null,
    });
  });

  it('字符串字段保留去除首尾空白后的值', () => {
    const raw = toRawSnapshot(FULL_SNAPSHOT);
    raw.browserPreviewUrl = '  http://localhost:5173/preview  ';
    raw.drawerTargetSessionId = '  session-42  ';
    raw.selectedAgentId = '  agent-42  ';

    expect(normalizeTeamPageViewState(raw)).toEqual(FULL_SNAPSHOT);
  });

  it.each(['bogus', 'BROWSER', 'Code', '', 42, null])(
    'editorPaneTab 非法值（%j）统一回落 code',
    (badTab) => {
      const raw = toRawSnapshot(FULL_SNAPSHOT);
      raw.editorPaneTab = badTab;

      expect(normalizeTeamPageViewState(raw).editorPaneTab).toBe('code');
    },
  );

  it('editorPaneTab 合法值 browser 原样保留', () => {
    expect(normalizeTeamPageViewState({ editorPaneTab: 'browser' }).editorPaneTab).toBe('browser');
  });

  it('未知多余字段被忽略，不影响合法字段', () => {
    const raw = toRawSnapshot(FULL_SNAPSHOT);
    raw.unknownField = 'whatever';
    raw.leftSidebarCollapsed = true;

    const normalized = normalizeTeamPageViewState(raw);

    expect(normalized).toEqual(FULL_SNAPSHOT);
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(FULL_SNAPSHOT).sort());
  });
});
