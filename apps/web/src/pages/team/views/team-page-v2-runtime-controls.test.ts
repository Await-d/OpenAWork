import { describe, expect, it } from 'vitest';
import {
  countRuntimeTreeHandoffs,
  resolveEffectiveTeamPageMode,
} from './team-page-v2-runtime-controls.js';

describe('resolveEffectiveTeamPageMode', () => {
  it('当前选中会话暂停时优先返回 paused', () => {
    expect(resolveEffectiveTeamPageMode('running', true)).toBe('paused');
    expect(resolveEffectiveTeamPageMode('idle', true)).toBe('paused');
  });

  it('忽略遗留的本地 paused 假状态，回到运行态', () => {
    expect(resolveEffectiveTeamPageMode('paused', false)).toBe('running');
  });
});

describe('countRuntimeTreeHandoffs', () => {
  it('统计当前会话子树内的活跃和待恢复 handoff', () => {
    expect(
      countRuntimeTreeHandoffs([
        { id: 'h-1', state: 'pending' },
        { id: 'h-2', state: 'claimed' },
        { id: 'h-3', state: 'running' },
        { id: 'h-4', state: 'completed' },
      ] as Array<{ id: string; state: string }> as never),
    ).toEqual({
      activeCount: 3,
      staleCount: 2,
    });
  });
});
