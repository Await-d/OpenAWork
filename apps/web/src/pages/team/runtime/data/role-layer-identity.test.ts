/**
 * role-layer-identity 单测：覆盖 5 权威层 + user/tester + 未知回退 + tag 格式化。
 */

import { describe, expect, it } from 'vitest';
import {
  formatRoleLayerTag,
  getRoleLayerIdentity,
  getRoleLayerIdentityFromAgentId,
} from './role-layer-identity.js';

describe('getRoleLayerIdentity', () => {
  it('5 个权威层都映射到带代号的身份', () => {
    expect(getRoleLayerIdentity('reception').code).toBe('b');
    expect(getRoleLayerIdentity('pm1').code).toBe('c');
    expect(getRoleLayerIdentity('pm2').code).toBe('d');
    expect(getRoleLayerIdentity('executor').code).toBe('e');
    expect(getRoleLayerIdentity('reviewer').code).toBe('g');
  });

  it('每层都有非空 label / short / color / icon / initials', () => {
    for (const layer of ['reception', 'pm1', 'pm2', 'executor', 'reviewer']) {
      const id = getRoleLayerIdentity(layer);
      expect(id.label).toBeTruthy();
      expect(id.short).toBeTruthy();
      expect(id.color).toMatch(/var\(--/);
      expect(id.icon).toBeTruthy();
      expect(id.initials).toBeTruthy();
    }
  });

  it('user / tester 有独立身份', () => {
    expect(getRoleLayerIdentity('user').short).toBe('你');
    expect(getRoleLayerIdentity('tester').short).toBe('测试');
  });

  it('常见 team agentId 能反解到层级身份', () => {
    expect(getRoleLayerIdentityFromAgentId('interaction-agent').short).toBe('接待');
    expect(getRoleLayerIdentityFromAgentId('prometheus').short).toBe('规划');
    expect(getRoleLayerIdentityFromAgentId('plan').short).toBe('规划');
    expect(getRoleLayerIdentityFromAgentId('zeus').short).toBe('管控');
    expect(getRoleLayerIdentityFromAgentId('hephaestus').short).toBe('执行');
    expect(getRoleLayerIdentityFromAgentId('momus').short).toBe('评审');
    expect(getRoleLayerIdentityFromAgentId('atlas').short).toBe('评审');
    expect(getRoleLayerIdentityFromAgentId('librarian').short).toBe('接待');
    expect(getRoleLayerIdentityFromAgentId('metis').short).toBe('接待');
  });

  it('null / undefined / 未知值回退到中性「团队」身份', () => {
    expect(getRoleLayerIdentity(null).short).toBe('团队');
    expect(getRoleLayerIdentity(undefined).short).toBe('团队');
    expect(getRoleLayerIdentity('mystery').short).toBe('团队');
    expect(getRoleLayerIdentity('mystery').code).toBeNull();
  });
});

describe('formatRoleLayerTag', () => {
  it('有代号时返回「代号 · 短名」', () => {
    expect(formatRoleLayerTag('executor')).toBe('e · 执行');
    expect(formatRoleLayerTag('reception')).toBe('b · 接待');
  });

  it('无代号时只返回短名', () => {
    expect(formatRoleLayerTag('user')).toBe('你');
    expect(formatRoleLayerTag(null)).toBe('团队');
  });
});
