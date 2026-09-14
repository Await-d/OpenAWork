import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sqliteRun: vi.fn() }));

vi.mock('../../infra/db.js', () => ({ sqliteRun: mocks.sqliteRun }));

import {
  assertSubstateAllowed,
  LAYER_CAPABILITIES,
  LayerCapabilityViolationError,
} from '../../handoff/capability/layer-capabilities.js';

beforeEach(() => {
  mocks.sqliteRun.mockClear();
});

describe('layer-capabilities substate 白名单（grill 增强）', () => {
  it('reception 允许 grilling 与 awaiting_confirmation', () => {
    const substates = LAYER_CAPABILITIES.reception.allowedSubstates;
    expect(substates).toContain('grilling');
    expect(substates).toContain('awaiting_confirmation');
  });

  it('pm1 允许 clarifying 与 awaiting_confirmation', () => {
    const substates = LAYER_CAPABILITIES.pm1.allowedSubstates;
    expect(substates).toContain('clarifying');
    expect(substates).toContain('awaiting_confirmation');
  });

  it('放行合法 substate', () => {
    expect(() =>
      assertSubstateAllowed({ roleLayer: 'reception', substate: 'grilling' }),
    ).not.toThrow();
    expect(() =>
      assertSubstateAllowed({ roleLayer: 'reception', substate: 'awaiting_confirmation' }),
    ).not.toThrow();
    expect(() => assertSubstateAllowed({ roleLayer: 'pm1', substate: 'clarifying' })).not.toThrow();
    expect(() =>
      assertSubstateAllowed({ roleLayer: 'pm1', substate: 'awaiting_confirmation' }),
    ).not.toThrow();
  });

  it('拒绝层内未声明的 substate', () => {
    expect(() => assertSubstateAllowed({ roleLayer: 'reception', substate: 'reviewing' })).toThrow(
      LayerCapabilityViolationError,
    );
  });

  it('拒绝把 paused 当作 substate（paused 是 session 级列，非 substate）', () => {
    for (const roleLayer of ['reception', 'pm1', 'pm2', 'executor', 'reviewer'] as const) {
      expect(() => assertSubstateAllowed({ roleLayer, substate: 'paused' })).toThrow(
        LayerCapabilityViolationError,
      );
    }
  });

  it('substate 为 null（清空）时不校验、不抛错', () => {
    expect(() => assertSubstateAllowed({ roleLayer: 'reception', substate: null })).not.toThrow();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('roleLayer 缺省时跳过校验（向后兼容）', () => {
    expect(() =>
      assertSubstateAllowed({ roleLayer: undefined, substate: 'whatever' }),
    ).not.toThrow();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });
});
