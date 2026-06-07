import { describe, expect, it } from 'vitest';
import { resolveSelectedRuntimeScopeSessionId } from './team-runtime-selection-context.js';

describe('resolveSelectedRuntimeScopeSessionId', () => {
  it('选中 runtime 会话时返回该 sessionId', () => {
    expect(
      resolveSelectedRuntimeScopeSessionId({
        selectedTeamId: 'session-root',
        sessions: [{ id: 'session-root' }, { id: 'session-child' }],
      }),
    ).toBe('session-root');
  });

  it('选中共享会话时返回 null，避免误当成 runtime 子树', () => {
    expect(
      resolveSelectedRuntimeScopeSessionId({
        selectedTeamId: 'shared-1',
        sessions: [{ id: 'session-root' }, { id: 'session-child' }],
      }),
    ).toBeNull();
  });

  it('未选中会话时返回 null', () => {
    expect(
      resolveSelectedRuntimeScopeSessionId({
        selectedTeamId: null,
        sessions: [{ id: 'session-root' }],
      }),
    ).toBeNull();
  });
});
