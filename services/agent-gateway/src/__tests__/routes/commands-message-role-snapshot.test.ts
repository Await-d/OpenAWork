import { describe, expect, it } from 'vitest';
import { __testing } from '../../routes/commands.js';

const baseSnapshot = {
  id: 'message-snapshot-1',
  content: [{ type: 'text', text: '子代理已完成任务。' }],
  createdAt: 1_700_000_000_000,
} as const;

describe('commands message snapshot role boundary', () => {
  it('接受网关注入的 synthetic 角色', () => {
    const parsed = __testing.messageSnapshotSchema.safeParse({
      ...baseSnapshot,
      role: 'synthetic',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(`synthetic 快照应通过校验：${parsed.error.message}`);
    }
    expect(parsed.data.role).toBe('synthetic');
  });

  it('拒绝非法 role', () => {
    const parsed = __testing.messageSnapshotSchema.safeParse({
      ...baseSnapshot,
      role: 'bogus',
    });

    expect(parsed.success).toBe(false);
  });
});
