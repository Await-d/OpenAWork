import { describe, expect, it } from 'vitest';
import { buildMemoryInjectionBlock } from './injector.js';
import type { MemoryEntry, MemoryInjectionConfig, MemoryRoleLayer } from './types.js';

/**
 * 注入白名单的 **fail-closed 默认值** 回归（261101-记忆确认写入与周期整理）。
 *
 * `allowedScopes` 是渠道隔离的唯一执行点：渠道会话只列 `channel_chat`（+ 可选 team），
 * 从而把 owner 的私人记忆挡在上下文之外。因此「**调用方没传白名单时会发生什么**」
 * 必须是保守的——漏传只能导致少注入，绝不能导致越权注入。
 *
 * 历史实现把 `undefined` 当成「不过滤」＝把该用户**所有作用域**的记忆都注入，等于漏传
 * 一次就静默恢复越权面。本文件把这个默认值钉成「只给调用方自己的 user 作用域」。
 */

function entry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  const base: MemoryEntry = {
    id: overrides.id,
    userId: 'u-1',
    type: 'fact',
    key: `key-${overrides.id}`,
    value: `value-${overrides.id}`,
    source: 'manual',
    confidence: 1,
    priority: 50,
    workspaceRoot: null,
    teamWorkspaceId: null,
    roleLayers: null as MemoryRoleLayer[] | null,
    enabled: true,
    scope: { type: 'user', id: 'u-1' },
    lifecycle: 'active',
    revision: 1,
    confirmationKind: 'manual',
    confirmedAt: '2026-11-01T00:00:00.000Z',
    changeSeq: 1,
    validUntil: null,
    supersededBy: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  return { ...base, ...overrides };
}

function config(overrides: Partial<MemoryInjectionConfig> = {}): MemoryInjectionConfig {
  return {
    enabled: true,
    maxTokenBudget: 2000,
    minConfidence: 0,
    workspaceRoot: null,
    userId: 'u-1',
    ...overrides,
  };
}

const USER_MEMORY = entry({ id: 'm-user', scope: { type: 'user', id: 'u-1' } });
const WORKSPACE_MEMORY = entry({
  id: 'm-workspace',
  scope: { type: 'workspace', id: '/tmp/proj' },
  workspaceRoot: '/tmp/proj',
});
const TEAM_MEMORY = entry({
  id: 'm-team',
  scope: { type: 'team', id: 'tw-1' },
  teamWorkspaceId: 'tw-1',
});
const CHANNEL_MEMORY = entry({
  id: 'm-channel',
  scope: { type: 'channel_chat', id: 'channel:telegram:inst-1:chat:grp-1' },
});

describe('记忆注入的作用域白名单', () => {
  it('未传白名单时只注入调用方自己的 user 作用域（fail-closed，不越权注入）', () => {
    const block = buildMemoryInjectionBlock(
      [USER_MEMORY, WORKSPACE_MEMORY, TEAM_MEMORY, CHANNEL_MEMORY],
      config({
        allowedScopes: undefined,
        // 刻意把 workspace / team 维度也放开，让「作用域」成为唯一决定因素：
        // 若实现漏传即不过滤，这些条目就会出现在结果里。
        workspaceRoot: '/tmp/proj',
        teamWorkspaceId: 'tw-1',
      }),
    );

    expect(block).toContain('key-m-user');
    expect(block).not.toContain('key-m-workspace');
    expect(block).not.toContain('key-m-team');
    expect(block).not.toContain('key-m-channel');
  });

  it('空白名单不注入任何记忆（空集就是「不注入」，不是「不过滤」）', () => {
    const block = buildMemoryInjectionBlock(
      [USER_MEMORY, WORKSPACE_MEMORY],
      config({ allowedScopes: [], workspaceRoot: '/tmp/proj' }),
    );
    expect(block).toBeNull();
  });

  it('白名单命中才注入，未命中的作用域一律不可见', () => {
    const block = buildMemoryInjectionBlock(
      [USER_MEMORY, WORKSPACE_MEMORY, TEAM_MEMORY, CHANNEL_MEMORY],
      config({
        allowedScopes: ['workspace:/tmp/proj', 'channel_chat:channel:telegram:inst-1:chat:grp-1'],
        workspaceRoot: '/tmp/proj',
        teamWorkspaceId: 'tw-1',
      }),
    );

    expect(block).toContain('key-m-workspace');
    expect(block).toContain('key-m-channel');
    // 渠道会话的场景：即使 team 维度放开，未列入白名单的 team / user 作用域也不可见。
    expect(block).not.toContain('key-m-team');
    expect(block).not.toContain('key-m-user');
  });
});
