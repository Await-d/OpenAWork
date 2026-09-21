import { describe, expect, it } from 'vitest';
import { isHandoffDismissable } from './team-handoff-dismissability.js';

describe('isHandoffDismissable', () => {
  it('服务端 dismissableFailure=false 优先于本地规则（pm1 也不可关闭）', () => {
    expect(isHandoffDismissable({ dismissableFailure: false, toRoleLayer: 'pm1' })).toBe(false);
  });

  it('服务端 dismissableFailure=true 优先于本地禁令（orphaned executor / reviewer 可关闭）', () => {
    expect(isHandoffDismissable({ dismissableFailure: true, toRoleLayer: 'executor' })).toBe(true);
    expect(isHandoffDismissable({ dismissableFailure: true, toRoleLayer: 'reviewer' })).toBe(true);
  });

  it('标记缺失时回落本地规则：executor / reviewer 不可关闭', () => {
    expect(isHandoffDismissable({ toRoleLayer: 'executor' })).toBe(false);
    expect(isHandoffDismissable({ toRoleLayer: 'reviewer' })).toBe(false);
  });

  it('标记缺失时回落本地规则：其余层级可关闭', () => {
    expect(isHandoffDismissable({ toRoleLayer: 'pm1' })).toBe(true);
    expect(isHandoffDismissable({ toRoleLayer: 'tester' })).toBe(true);
  });

  it('标记缺失且 recoverableFailure=true 时不可关闭', () => {
    expect(isHandoffDismissable({ recoverableFailure: true, toRoleLayer: 'pm2' })).toBe(false);
  });
});
