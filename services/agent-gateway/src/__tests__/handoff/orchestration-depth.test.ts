/**
 * T-15 编排深度判据表驱动用例
 *
 * 覆盖：改文案 / 改样式 / 单文件单函数 → L1；加接口 + 前端 / 单模块功能 → L2；
 * 改迁移脚本 / 权限 / 构建配置 / 跨包重构 → L3；以及规则不确定时的模型兜底与失败降级。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assessOrchestrationDepthByRules,
  depthForReadOnlyDecision,
  isDepthUpgradeIntent,
  parseOrchestrationDepthFromLlm,
  resolveOrchestrationDepth,
} from '../../handoff/runner/orchestration-depth.js';

describe('assessOrchestrationDepthByRules', () => {
  const table: ReadonlyArray<readonly [string, string, string]> = [
    // [期望深度, 说明, 输入]
    ['L1', '改文案', '把首页标题的文案改短一点'],
    ['L1', '改按钮提示语', '登录按钮的提示语换成「进入」'],
    ['L1', '改样式', '调整一下这个卡片的间距和颜色'],
    ['L1', '单文件单函数', '这个函数里的判断写反了，改一下'],
    ['L1', '单个组件微调', '这个组件里的图标换个位置'],
    ['L2', '加接口 + 前端', '加一个订单接口并让前端页面调用'],
    ['L2', '单模块功能', '实现购物车页面的增减与结算功能'],
    ['L2', '接口改动', '这个接口的返回需要调整'],
    ['L3', '改迁移脚本', '修改数据库迁移脚本，新增用户表索引'],
    ['L3', '触碰 schema', '给订单表加字段并更新 schema'],
    ['L3', '改权限校验', '调整权限校验，让管理员能看到全部订单'],
    ['L3', '改构建配置', '升级打包配置并调整构建脚本'],
    ['L3', '跨包重构', '跨包重构共享工具库'],
    ['L3', '架构级重写', '重写整个系统架构'],
    ['L3', '高风险优先于单点信号', '改一下这个按钮的文案，顺便把数据库迁移也做了'],
  ];

  it.each(table)('规则判据 %s（%s）：%s', (expected, _label, intent) => {
    const assessed = assessOrchestrationDepthByRules(intent);
    expect(assessed.kind).toBe('assessed');
    if (assessed.kind !== 'assessed') return;
    expect(assessed.depth).toBe(expected);
    expect(assessed.reason.length).toBeGreaterThan(0);
  });

  it.each([
    ['空输入', ''],
    ['无改动面信号', '帮我搞一下那个东西'],
    ['只读意图（应由路由判 L0，不在这里定深度）', '解释一下这个模块是怎么工作的'],
  ])('%s 时规则不确定，交由模型兜底', (_label, intent) => {
    expect(assessOrchestrationDepthByRules(intent).kind).toBe('uncertain');
  });

  it('多文件与单点信号同时命中时保守取 L2 并记录冲突', () => {
    const assessed = assessOrchestrationDepthByRules('调整订单页面的样式，并让接口返回新值');
    expect(assessed.kind).toBe('assessed');
    if (assessed.kind !== 'assessed') return;
    expect(assessed.depth).toBe('L2');
    expect(assessed.conflicts.length).toBeGreaterThan(0);
  });
});

describe('depthForReadOnlyDecision', () => {
  it.each(['light', 'direct'])('%s 直接判为 L0', (decision) => {
    expect(depthForReadOnlyDecision(decision)).toBe('L0');
  });

  it.each(['orchestrate', 'clarify', 'grill', 'resume', 'unknown'])(
    '%s 不由只读路径决定深度',
    (decision) => {
      expect(depthForReadOnlyDecision(decision)).toBeNull();
    },
  );
});

describe('parseOrchestrationDepthFromLlm', () => {
  it('解析合法深度并忽略 L0（只读请求不应降级为无编排）', () => {
    expect(parseOrchestrationDepthFromLlm('REASON: 跨包\nDEPTH: L3')).toBe('L3');
    expect(parseOrchestrationDepthFromLlm('DEPTH: l2')).toBe('L2');
    expect(parseOrchestrationDepthFromLlm('DEPTH: L0')).toBeNull();
  });

  it('缺少或非法时返回 null', () => {
    expect(parseOrchestrationDepthFromLlm('没有深度行')).toBeNull();
    expect(parseOrchestrationDepthFromLlm('DEPTH: unknown')).toBeNull();
  });
});

describe('isDepthUpgradeIntent', () => {
  it.each([
    '升级',
    '升级流程',
    '升级为完整流程',
    '完整流程',
    '走完整流程',
    '用完整流程',
    '切换到完整流程',
    '改成完整流程',
    '升到完整流程',
    '  升级为完整流程  ',
    '帮我切换到完整流程',
  ])('%j 判定为编排升级请求', (intent) => {
    expect(isDepthUpgradeIntent(intent)).toBe(true);
  });

  it.each([
    '',
    '升级依赖版本到最新',
    '升级 Node 到 22',
    '把流程文档更新一下',
    '实现订单提交接口',
    '继续',
  ])('%j 不判定为编排升级请求', (intent) => {
    expect(isDepthUpgradeIntent(intent)).toBe(false);
  });
});

describe('resolveOrchestrationDepth', () => {
  it('规则命中时不调用模型', async () => {
    const callLlm = vi.fn();
    await expect(
      resolveOrchestrationDepth({ intent: '把这段文案改一下', callLlm }),
    ).resolves.toMatchObject({ depth: 'L1', source: 'rule' });
    expect(callLlm).not.toHaveBeenCalled();
  });

  it('规则不确定时使用模型返回的深度', async () => {
    const callLlm = vi.fn(async () => 'DEPTH: L3');
    await expect(
      resolveOrchestrationDepth({ intent: '帮我搞一下那个东西', callLlm }),
    ).resolves.toMatchObject({ depth: 'L3', source: 'llm' });
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['模型缺失', undefined, '无可用判据模型'],
    ['模型输出非法', vi.fn(async () => 'DEPTH: 未知'), '模型未返回合法深度'],
    [
      '模型抛错',
      vi.fn(async () => {
        throw new Error('upstream down');
      }),
      '模型判据失败',
    ],
  ])('%s 时保守降级到 L2 且标注 degraded', async (_label, callLlm, reasonPart) => {
    const result = await resolveOrchestrationDepth({
      intent: '帮我搞一下那个东西',
      ...(callLlm ? { callLlm } : {}),
    });
    expect(result).toMatchObject({ depth: 'L2', source: 'degraded' });
    expect(result.reason).toContain(reasonPart);
  });

  it('模型超时时不无限等待，降级到 L2', async () => {
    const callLlm = vi.fn(
      (_prompt: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      resolveOrchestrationDepth({ intent: '帮我搞一下那个东西', callLlm, timeoutMs: 10 }),
    ).resolves.toMatchObject({ depth: 'L2', source: 'degraded' });
  });
});
