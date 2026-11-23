import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetScopeRecencyIndexForTesting,
  __trackedSessionCountForTesting,
  commitScopeEviction,
  noteScopeWrite,
  planScopeEviction,
} from '../../session/scope-recency-index.js';

const SESSION = 'sess-scope-recency';

beforeEach(() => {
  __resetScopeRecencyIndexForTesting();
});

describe('scope-recency-index', () => {
  it('首次判定用 DB 列表播种（新的在前），之后不再回表', () => {
    const loader = vi.fn(() => ['c', 'b', 'a']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('即使判定前已写入过（note），也必须先播种，避免 restart 后漏淘汰', () => {
    // 模拟进程刚启动：先写入一个 scope（内存里只有它），DB 里其实已有 a..e。
    noteScopeWrite(SESSION, 'f');
    const loader = vi.fn(() => ['f', 'e', 'd', 'c', 'b', 'a']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual(['a', 'b', 'c']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('超出上限时按「旧的先出」返回，未提交前可幂等重算', () => {
    const loader = vi.fn(() => ['e', 'd', 'c', 'b', 'a']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual(['a', 'b']);
    // 未 commit：同一批重算（删除失败时靠这个重试）
    expect(planScopeEviction(SESSION, 3, loader)).toEqual(['a', 'b']);
    commitScopeEviction(SESSION, ['a', 'b']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual([]);
  });

  it('被重新写入的旧 scope 视为最新，改而淘汰其他更旧的 scope', () => {
    const loader = vi.fn(() => ['e', 'd', 'c', 'b', 'a']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual(['a', 'b']);
    commitScopeEviction(SESSION, ['a', 'b']);
    // 剩下的 c,d,e 中 c 最旧；此时「续写」a（模拟续跑/重试复用同一 request id）
    noteScopeWrite(SESSION, 'a');
    // 现有 c,d,e,a 共 4 个 → 出最旧的 c，而不是刚写过的 a
    expect(planScopeEviction(SESSION, 3, loader)).toEqual(['c']);
    commitScopeEviction(SESSION, ['c']);
    expect(planScopeEviction(SESSION, 3, loader)).toEqual([]);
  });

  it('单次最多返回 200 个，剩余留给后续 prune 收敛', () => {
    const scopes: string[] = [];
    for (let i = 0; i < 300; i += 1) scopes.push(`s-${i}`);
    // loader 返回「新的在前」
    const loader = vi.fn(() => [...scopes].reverse());
    const first = planScopeEviction(SESSION, 1, loader);
    expect(first).toHaveLength(200);
    commitScopeEviction(SESSION, first);
    const second = planScopeEviction(SESSION, 1, loader);
    expect(second).toHaveLength(99);
    commitScopeEviction(SESSION, second);
    expect(planScopeEviction(SESSION, 1, loader)).toEqual([]);
  });

  it('scopeId 为空时忽略（无 client_request_id 的 legacy 行不参与裁剪）', () => {
    expect(planScopeEviction(SESSION, 1, () => [])).toEqual([]);
    noteScopeWrite(SESSION, null);
    noteScopeWrite(SESSION, undefined);
    noteScopeWrite(SESSION, '');
    expect(__trackedSessionCountForTesting()).toBe(1);
    expect(planScopeEviction(SESSION, 1, () => [])).toEqual([]);
  });

  it('maxScopes <= 0 时不做任何淘汰', () => {
    const loader = vi.fn(() => ['c', 'b', 'a']);
    expect(planScopeEviction(SESSION, 0, loader)).toEqual([]);
    expect(planScopeEviction(SESSION, Number.NaN, loader)).toEqual([]);
  });

  it('跟踪会话数受 LRU 上限约束', () => {
    for (let i = 0; i < 600; i += 1) {
      noteScopeWrite(`sess-${i}`, 'scope');
    }
    expect(__trackedSessionCountForTesting()).toBeLessThanOrEqual(512);
    // 最老的会话被挤出后重新判定需要回表（正确性不受影响，只多一次查询）。
    const loader = vi.fn(() => []);
    expect(planScopeEviction(SESSION, 1, loader)).toEqual([]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
