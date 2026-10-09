import { describe, expect, it } from 'vitest';
import {
  normalizeAgentState,
  normalizeGatewayHealth,
  presentIslandStatus,
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
