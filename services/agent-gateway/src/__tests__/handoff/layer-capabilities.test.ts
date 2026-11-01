import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sqliteRun: vi.fn() }));

vi.mock('../../infra/db.js', () => ({ sqliteRun: mocks.sqliteRun }));

import {
  assertCanReceiveInbound,
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

/**
 * T-12 范围界定：为什么「持久投递队列 + 空闲唤醒」只做接待层。
 *
 * 用户输入只能进接待层；下游成员只接受来自接待/系统的反向消息，因此不存在
 * 「用户直接投递给空闲成员、却没人唤醒」的场景。成员的消息是在**执行期间**
 * （artifact-chain 拉取）被消费的，不需要独立的常驻队列。
 */
describe('层间接收能力界定（T-12 依据）', () => {
  it('接待层接受用户输入', () => {
    expect(() =>
      assertCanReceiveInbound({
        fromRoleLayer: 'user',
        messageType: 'user_input',
        toRoleLayer: 'reception',
      }),
    ).not.toThrow();
  });

  it.each(['pm1', 'pm2', 'executor', 'reviewer'] as const)(
    '用户不能直接把 user_input 投递给 %s',
    (toRoleLayer) => {
      expect(() =>
        assertCanReceiveInbound({ fromRoleLayer: 'user', messageType: 'user_input', toRoleLayer }),
      ).toThrow(LayerCapabilityViolationError);
    },
  );

  it('各层允许来源按配置生效（pm1 收接待层、pm2 收 pm1/executor/reviewer、executor 只收 pm2）', () => {
    expect(LAYER_CAPABILITIES.pm1.canReceiveInboundFrom).toEqual(['reception', 'system']);
    expect(LAYER_CAPABILITIES.pm2.canReceiveInboundFrom).toEqual([
      'pm1',
      'executor',
      'reviewer',
      'system',
    ]);
    expect(LAYER_CAPABILITIES.executor.canReceiveInboundFrom).toEqual(['pm2', 'system']);
    expect(LAYER_CAPABILITIES.reviewer.canReceiveInboundFrom).toEqual(['pm2', 'system']);
    // 业务反向消息只有 pm1 收；接收方不含 reception 的层不能收接待层的消息
    expect(() =>
      assertCanReceiveInbound({
        fromRoleLayer: 'reception',
        messageType: 'clarification_answer',
        toRoleLayer: 'pm1',
      }),
    ).not.toThrow();
    expect(() =>
      assertCanReceiveInbound({
        fromRoleLayer: 'reception',
        messageType: 'clarification_answer',
        toRoleLayer: 'pm2',
      }),
    ).toThrow(LayerCapabilityViolationError);
    expect(() =>
      assertCanReceiveInbound({
        fromRoleLayer: 'user',
        messageType: 'clarification_answer',
        toRoleLayer: 'pm1',
      }),
    ).toThrow(LayerCapabilityViolationError);
  });

  it('执行层与评审层只接收控制信号，不承载业务输入', () => {
    for (const roleLayer of ['executor', 'reviewer'] as const) {
      expect(LAYER_CAPABILITIES[roleLayer].allowedInboundTypes).toEqual([
        'cancel_signal',
        'pause_signal',
        'resume_signal',
      ]);
    }
  });
});
