import { describe, expect, it } from 'vitest';
import {
  clampAnchorRatio,
  normalizeAgentState,
  normalizeGatewayHealth,
  presentIslandStatus,
  ratioFromDrag,
  shouldSnapToCenter,
} from './island-types.js';

describe('normalizeAgentState', () => {
  it.each([
    'idle',
    'running',
    'tool-calling',
    'streaming',
    'paused',
    'completed',
    'error',
  ] as const)('保留合法值 %s', (state) => {
    expect(normalizeAgentState(state)).toBe(state);
  });

  it('未知值收敛为 idle', () => {
    expect(normalizeAgentState('weird')).toBe('idle');
    expect(normalizeAgentState(undefined)).toBe('idle');
    expect(normalizeAgentState(null)).toBe('idle');
  });
});

describe('normalizeGatewayHealth', () => {
  it.each(['stopped', 'starting', 'healthy', 'restarting', 'failed'] as const)(
    '保留合法值 %s',
    (health) => {
      expect(normalizeGatewayHealth(health)).toBe(health);
    },
  );

  it('未知值收敛为 stopped', () => {
    expect(normalizeGatewayHealth('bogus')).toBe('stopped');
    expect(normalizeGatewayHealth(42)).toBe('stopped');
  });
});

describe('presentIslandStatus', () => {
  it('网关异常优先于 Agent 态', () => {
    expect(presentIslandStatus('running', 'failed')).toEqual({
      label: '网关异常',
      tone: 'error',
    });
  });

  it('网关停止时展示网关未运行', () => {
    expect(presentIslandStatus('streaming', 'stopped')).toEqual({
      label: '网关未运行',
      tone: 'idle',
    });
  });

  it('网关启动中 / 重启中展示启动中', () => {
    expect(presentIslandStatus('idle', 'starting').label).toBe('网关启动中');
    expect(presentIslandStatus('idle', 'restarting').label).toBe('网关启动中');
  });

  it('网关健康时按 Agent 态展示', () => {
    expect(presentIslandStatus('running', 'healthy').label).toBe('思考中');
    expect(presentIslandStatus('tool-calling', 'healthy').label).toBe('调用工具');
    expect(presentIslandStatus('streaming', 'healthy').label).toBe('输出中');
    expect(presentIslandStatus('paused', 'healthy').label).toBe('等待确认');
    expect(presentIslandStatus('completed', 'healthy')).toEqual({
      label: '已完成',
      tone: 'done',
    });
    expect(presentIslandStatus('error', 'healthy')).toEqual({
      label: '出错',
      tone: 'error',
    });
    expect(presentIslandStatus('idle', 'healthy')).toEqual({
      label: '待机',
      tone: 'idle',
    });
  });
});

describe('clampAnchorRatio', () => {
  it('把越界值收敛到 [0, 1]', () => {
    expect(clampAnchorRatio(-0.4)).toBe(0);
    expect(clampAnchorRatio(1.7)).toBe(1);
    expect(clampAnchorRatio(0.25)).toBe(0.25);
  });

  it('非有限值回落到居中', () => {
    expect(clampAnchorRatio(Number.NaN)).toBe(0.5);
    expect(clampAnchorRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(clampAnchorRatio('0.2')).toBe(0.5);
    expect(clampAnchorRatio(null)).toBe(0.5);
  });
});

describe('ratioFromDrag', () => {
  it('按行程把位移换算成比例', () => {
    expect(ratioFromDrag(0.5, 100, 1000)).toBeCloseTo(0.6);
    expect(ratioFromDrag(0.5, -100, 1000)).toBeCloseTo(0.4);
  });

  it('拖出边界时被夹住', () => {
    expect(ratioFromDrag(0.5, 9000, 1000)).toBe(1);
    expect(ratioFromDrag(0.5, -9000, 1000)).toBe(0);
  });

  it('行程非正时保持起始比例', () => {
    expect(ratioFromDrag(0.3, 500, 0)).toBe(0.3);
    expect(ratioFromDrag(0.3, 500, -10)).toBe(0.3);
  });
});

describe('shouldSnapToCenter', () => {
  it('距中心小于阈值时吸附', () => {
    // 行程 1000px,阈值 36px → 比例差 < 0.036
    expect(shouldSnapToCenter(0.5, 1000)).toBe(true);
    expect(shouldSnapToCenter(0.53, 1000)).toBe(true);
  });

  it('超出阈值时不吸附', () => {
    expect(shouldSnapToCenter(0.55, 1000)).toBe(false);
    expect(shouldSnapToCenter(0, 1000)).toBe(false);
  });

  it('行程非正时不吸附', () => {
    expect(shouldSnapToCenter(0.5, 0)).toBe(false);
  });
});
