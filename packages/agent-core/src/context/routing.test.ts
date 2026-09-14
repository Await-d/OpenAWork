/**
 * 特征化测试 — T-00：锁定 routing.ts 当前可观测行为，作为 T-03 改造的兼容性回归基线。
 * 断言描述的是「现状」而非「理想」；修改它们必须是有意识的兼容性决策。改造后本文件须继续全绿。
 */

import { describe, expect, it } from 'vitest';
import {
  buildSubAgentPrompt,
  canProceedWithoutClarification,
  createSessionContext,
  evaluate,
  isSubAgentPrompt,
  recordClarification,
  SUB_AGENT_PROMPT_PREFIX,
  type ClarificationDimension,
  type RoutingDimensions,
  type SessionContext,
} from './routing.js';

const R0_INPUT = 'what does the parser do';
const R1_INPUT = 'update the parser';
const R2_INPUT = 'check and update the parser';
const R3_ARCH_INPUT = 'refactor the entire system architecture';
const R3_RISK_INPUT = 'delete the production database';

describe('routing.evaluate — 路由分级（R0–R3）', () => {
  it('R0：无动作动词 → R0，且不产生澄清问题', () => {
    const decision = evaluate(R0_INPUT, createSessionContext('s-r0'));

    expect(decision.level).toBe('R0');
    expect(decision.dimensions.needsAction).toBe(false);
    expect(decision.clarifications).toBeUndefined();
    expect(canProceedWithoutClarification(decision)).toBe(true);
  });

  it('R1：有动作但无架构/分析/跨系统/高风险信号 → R1，且不产生澄清问题', () => {
    const decision = evaluate(R1_INPUT, createSessionContext('s-r1'));

    expect(decision.level).toBe('R1');
    expect(decision.dimensions).toEqual<RoutingDimensions>({
      needsAction: true,
      targetLocatability: 'direct',
      decisionScope: 'none',
      impactScope: 'single',
      riskLevel: 'moderate',
    });
    expect(decision.clarifications).toBeUndefined();
    expect(canProceedWithoutClarification(decision)).toBe(true);
  });

  it('R2：分析型动作（local/multi/analysis）→ R2，并产生第一条澄清问题', () => {
    const decision = evaluate(R2_INPUT, createSessionContext('s-r2'));

    expect(decision.level).toBe('R2');
    expect(decision.dimensions.targetLocatability).toBe('analysis');
    expect(decision.dimensions.decisionScope).toBe('local');
    expect(decision.dimensions.impactScope).toBe('multi');
    expect(decision.clarifications).toHaveLength(1);
    expect(decision.clarifications?.[0]?.dimension).toBe('goal');
  });

  it('R3（架构信号）→ R3，并产生第一条澄清问题', () => {
    const decision = evaluate(R3_ARCH_INPUT, createSessionContext('s-r3a'));

    expect(decision.level).toBe('R3');
    expect(decision.dimensions.decisionScope).toBe('architectural');
    expect(decision.dimensions.targetLocatability).toBe('open');
    expect(decision.clarifications).toHaveLength(1);
    expect(decision.clarifications?.[0]?.dimension).toBe('goal');
  });

  it('R3（高风险信号）→ R3，优先于其它维度判定', () => {
    const decision = evaluate(R3_RISK_INPUT, createSessionContext('s-r3b'));

    expect(decision.level).toBe('R3');
    expect(decision.dimensions.riskLevel).toBe('high');
    expect(decision.clarifications?.[0]?.dimension).toBe('goal');
  });
});

describe('routing.evaluate — reason 说明串', () => {
  it('无动作时 reason 为 "no action required"', () => {
    expect(evaluate(R0_INPUT, createSessionContext('s')).reason).toBe('no action required');
  });

  it('架构级 reason 含 architectural scope', () => {
    expect(evaluate(R3_ARCH_INPUT, createSessionContext('s')).reason).toContain(
      'architectural scope',
    );
  });

  it('高风险 reason 含 high-risk operation detected', () => {
    expect(evaluate(R3_RISK_INPUT, createSessionContext('s')).reason).toContain(
      'high-risk operation detected',
    );
  });

  it('R1 reason 回落到 "direct target, none scope" 描述', () => {
    expect(evaluate(R1_INPUT, createSessionContext('s')).reason).toContain('direct direct target');
  });
});

describe('routing — 澄清轮次（现状：固定顺序、每轮仅一个维度）', () => {
  const DIMENSION_ORDER: ClarificationDimension[] = [
    'goal',
    'constraint',
    'deliverable',
    'acceptance',
  ];

  it('每轮只返回一个维度，严格按 goal→constraint→deliverable 推进；acceptance 因轮次上限不可达', () => {
    let context: SessionContext = createSessionContext('s-order');
    // 特征化：现状最多只问 3 个维度（round>=3 上限），第 4 个 'acceptance' 永远轮不到。
    const reachable: ClarificationDimension[] = ['goal', 'constraint', 'deliverable'];

    for (const expected of reachable) {
      const decision = evaluate(R2_INPUT, context);
      expect(decision.clarifications).toHaveLength(1);
      expect(decision.clarifications?.[0]?.dimension).toBe(expected);
      context = recordClarification(context, expected, `answer-for-${expected}`);
    }

    expect(context.clarificationRound).toBe(3);
    expect(evaluate(R2_INPUT, context).clarifications).toBeUndefined();
    expect(context.collectedDimensions.has('acceptance')).toBe(false);
  });

  it('四个维度全部收集后不再产生新问题', () => {
    let context: SessionContext = createSessionContext('s-drained');
    for (const dimension of DIMENSION_ORDER) {
      context = recordClarification(context, dimension, 'x');
    }

    const decision = evaluate(R2_INPUT, context);
    expect(decision.clarifications).toBeUndefined();
    expect(canProceedWithoutClarification(decision)).toBe(true);
  });

  it('轮次达到上限（clarificationRound >= 3）后停止提问', () => {
    const context: SessionContext = {
      ...createSessionContext('s-cap'),
      clarificationRound: 3,
    };

    const decision = evaluate(R2_INPUT, context);
    expect(decision.clarifications).toBeUndefined();
  });

  it('goal 模板会把输入前 60 字符嵌入问题文本', () => {
    const longInput = `update and check ${'x'.repeat(200)}`;
    const decision = evaluate(longInput, createSessionContext('s-truncate'));
    const question = decision.clarifications?.[0]?.question ?? '';

    expect(question).toContain(longInput.slice(0, 60));
    expect(question).not.toContain(longInput.slice(0, 61));
  });

  it('每个可达模板都携带可选项（options 非空）', () => {
    let context: SessionContext = createSessionContext('s-options');
    const reachable: ClarificationDimension[] = ['goal', 'constraint', 'deliverable'];

    for (const dimension of reachable) {
      const decision = evaluate(R2_INPUT, context);
      const question = decision.clarifications?.[0];
      expect(question?.dimension).toBe(dimension);
      expect(question?.options?.length ?? 0).toBeGreaterThan(0);
      context = recordClarification(context, dimension, 'x');
    }
  });
});

describe('routing.recordClarification — 不可变累积', () => {
  it('递增轮次、记录维度、追加历史，且不修改入参对象', () => {
    const before = createSessionContext('s-immutable');
    const beforeRound = before.clarificationRound;
    const beforeSize = before.collectedDimensions.size;

    const after = recordClarification(before, 'goal', 'my answer');

    expect(after).not.toBe(before);
    expect(before.clarificationRound).toBe(beforeRound);
    expect(before.collectedDimensions.size).toBe(beforeSize);
    expect(before.history).toHaveLength(0);
    expect(after.clarificationRound).toBe(1);
    expect(after.collectedDimensions.has('goal')).toBe(true);
    expect(after.history).toEqual(['goal: my answer']);
  });

  it('重复记录同一维度会重复计数轮次（现状行为）', () => {
    const first = recordClarification(createSessionContext('s-dup'), 'goal', 'a');
    const second = recordClarification(first, 'goal', 'b');

    expect(second.clarificationRound).toBe(2);
    expect(second.collectedDimensions.size).toBe(1);
    expect(second.history).toEqual(['goal: a', 'goal: b']);
  });
});

describe('routing.canProceedWithoutClarification', () => {
  it('clarifications 缺失或为空 → true', () => {
    expect(
      canProceedWithoutClarification({
        level: 'R0',
        dimensions: {
          needsAction: false,
          targetLocatability: 'direct',
          decisionScope: 'none',
          impactScope: 'single',
          riskLevel: 'safe',
        },
        reason: '',
      }),
    ).toBe(true);
    expect(
      canProceedWithoutClarification({
        level: 'R1',
        dimensions: {
          needsAction: true,
          targetLocatability: 'direct',
          decisionScope: 'none',
          impactScope: 'single',
          riskLevel: 'safe',
        },
        clarifications: [],
        reason: '',
      }),
    ).toBe(true);
  });

  it('存在澄清问题 → false', () => {
    expect(canProceedWithoutClarification(evaluate(R2_INPUT, createSessionContext('s')))).toBe(
      false,
    );
  });
});

describe('routing.createSessionContext', () => {
  it('初始状态为空轮次、空维度、空历史', () => {
    const context = createSessionContext('s-init');
    expect(context).toEqual({
      sessionId: 's-init',
      clarificationRound: 0,
      collectedDimensions: new Set(),
      history: [],
    });
  });
});

describe('routing — 子 Agent 提示辅助', () => {
  it('isSubAgentPrompt 仅识别带前缀的提示', () => {
    expect(isSubAgentPrompt(SUB_AGENT_PROMPT_PREFIX + '\nanything')).toBe(true);
    expect(isSubAgentPrompt('normal prompt')).toBe(false);
  });

  it('buildSubAgentPrompt 组合前缀、角色与任务', () => {
    const prompt = buildSubAgentPrompt('reviewer', 'check the diff');
    expect(prompt.startsWith(SUB_AGENT_PROMPT_PREFIX)).toBe(true);
    expect(prompt).toContain('Role: reviewer');
    expect(prompt).toContain('Task: check the diff');
  });
});
