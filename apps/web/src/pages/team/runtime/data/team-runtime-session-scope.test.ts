import { describe, expect, it } from 'vitest';
import {
  collectSessionScope,
  isHandoffInSessionScope,
  isRuntimeTaskInSessionScope,
  isSessionInScope,
} from './team-runtime-session-scope.js';

describe('collectSessionScope', () => {
  it('会收集根会话及其所有子孙会话', () => {
    const scope = collectSessionScope('root', [
      { id: 'root', parentSessionId: null },
      { id: 'child-a', parentSessionId: 'root' },
      { id: 'child-b', parentSessionId: 'root' },
      { id: 'grandchild', parentSessionId: 'child-a' },
      { id: 'other', parentSessionId: null },
    ]);

    expect(Array.from(scope).sort()).toEqual(['child-a', 'child-b', 'grandchild', 'root']);
  });

  it('根会话不在 nodes 中时仍保留根本身', () => {
    const scope = collectSessionScope('external-root', [
      { id: 'child', parentSessionId: 'external-root' },
    ]);

    expect(Array.from(scope).sort()).toEqual(['child', 'external-root']);
  });

  it('未选中会话时返回空集合', () => {
    expect(collectSessionScope(null, [{ id: 'root', parentSessionId: null }])).toEqual(new Set());
  });
});

describe('session scope matchers', () => {
  const scope = new Set(['root', 'child']);

  it('isSessionInScope 只命中 scope 内 session', () => {
    expect(isSessionInScope('root', scope)).toBe(true);
    expect(isSessionInScope('other', scope)).toBe(false);
    expect(isSessionInScope(null, scope)).toBe(false);
  });

  it('isHandoffInSessionScope 支持 from / to / sessionId 任一命中', () => {
    expect(
      isHandoffInSessionScope(
        {
          fromSessionId: 'root',
          toSessionId: 'other',
          sessionId: 'other',
        },
        scope,
      ),
    ).toBe(true);
    expect(
      isHandoffInSessionScope(
        {
          fromSessionId: 'other',
          toSessionId: 'child',
          sessionId: 'other',
        },
        scope,
      ),
    ).toBe(true);
    expect(
      isHandoffInSessionScope(
        {
          fromSessionId: 'other',
          toSessionId: null,
          sessionId: 'child',
        },
        scope,
      ),
    ).toBe(true);
    expect(
      isHandoffInSessionScope(
        {
          fromSessionId: 'other',
          toSessionId: 'another',
          sessionId: 'another',
        },
        scope,
      ),
    ).toBe(false);
  });

  it('isRuntimeTaskInSessionScope 只命中具备 sessionId 的任务', () => {
    expect(isRuntimeTaskInSessionScope({ sessionId: 'child' }, scope)).toBe(true);
    expect(isRuntimeTaskInSessionScope({ sessionId: 'other' }, scope)).toBe(false);
    expect(isRuntimeTaskInSessionScope({ sessionId: undefined }, scope)).toBe(false);
  });
});
