/**
 * 团队角色会话的 `dialogueMode` 默认值：按角色层补齐，但**来源托管会话不补**。
 *
 * `withRoleLayerDialogueMetadataDefaults` 是最后一个会给 `dialogueMode` 赋值的写入方，
 * 且会作用于既有会话（`markSessionAsTeamRoleInstance` 对存量团队会话做 UPDATE）。
 * 来源会话（渠道 / 定时任务）没有对话模式，一旦被补上角色层默认值，澄清只读白名单
 * 就会把渠道回复工具整套过滤掉——表现为「渠道里再也回不了消息」。
 */
import { describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'team-dialogue-default-secret-1234567890';

const { withRoleLayerDialogueMetadataDefaults } =
  await import('../../handoff/bus/team-session-create.js');

function build(
  roleLayer: 'reception' | 'executor',
  metadataJson?: string,
): Record<string, unknown> {
  return JSON.parse(withRoleLayerDialogueMetadataDefaults({ metadataJson, roleLayer })) as Record<
    string,
    unknown
  >;
}

describe('withRoleLayerDialogueMetadataDefaults', () => {
  it('团队会话缺失该键时按角色层补齐（既有行为不变）', () => {
    expect(build('reception').dialogueMode).toBe('clarify');
    expect(build('executor').dialogueMode).toBe('coding');
    // defaultProvider / defaultModel 的显式 null 占位同样保留。
    expect(build('executor')).toMatchObject({ defaultProvider: null, defaultModel: null });
  });

  it('已有 dialogueMode 时不被角色层覆盖', () => {
    expect(build('reception', JSON.stringify({ dialogueMode: 'programmer' })).dialogueMode).toBe(
      'programmer',
    );
  });

  it('来源托管会话（渠道 / 定时任务）不补该键', () => {
    const channel = build('reception', JSON.stringify({ source: 'channel' }));
    expect(Object.hasOwn(channel, 'dialogueMode')).toBe(false);
    // 其它默认值照常补，来源身份逐字保留。
    expect(channel).toMatchObject({ source: 'channel', defaultProvider: null, defaultModel: null });

    const cron = build('executor', JSON.stringify({ source: 'cron' }));
    expect(Object.hasOwn(cron, 'dialogueMode')).toBe(false);
  });

  it('来源会话已有的 dirty 值不被改写（清洗交给启动期迁移，写入方不参与）', () => {
    const polluted = build('reception', JSON.stringify({ source: 'channel', dialogueMode: 'x' }));
    expect(polluted.dialogueMode).toBe('x');
  });
});
