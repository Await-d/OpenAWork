import { describe, expect, it } from 'vitest';
import { routeByRules, routeByLlm } from '../../handoff/runner/reception-router.js';

describe('reception-router', () => {
  describe('routeByRules', () => {
    it('仅对问候、致谢、简短确认保留 direct', () => {
      expect(routeByRules('你好')).toMatchObject({
        decision: 'direct',
        decisionSource: 'rule',
        reason: '问候语',
      });
      expect(routeByRules('谢谢你')).toMatchObject({
        decision: 'direct',
        decisionSource: 'rule',
        reason: '感谢语',
      });
      expect(routeByRules('收到')).toMatchObject({
        decision: 'direct',
        decisionSource: 'rule',
        reason: '简短确认',
      });
    });

    it('知识问答和解释类提问默认走 orchestrate，而不是 direct', () => {
      expect(routeByRules('什么是 OAuth 2.0')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '需要分析/检索/解释的提问',
      });
      expect(routeByRules('为什么最近这个页面很卡？')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '需要分析/检索/解释的提问',
      });
      expect(routeByRules('帮我查一下 React Compiler 和 useMemo 的关系')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '需要分析/检索/解释的提问',
      });
    });

    it('实现/修复/设计等任务继续走 orchestrate', () => {
      expect(routeByRules('帮我实现一个 OAuth 登录')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '开发任务',
      });
      expect(routeByRules('修复一下团队会话的路由 bug')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '修复任务',
      });
      expect(routeByRules('设计一个更合理的 team 会话分层方案')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '设计任务',
      });
    });

    it('过短且没有清晰意图时走 clarify', () => {
      expect(routeByRules('')).toMatchObject({
        decision: 'clarify',
        decisionSource: 'rule',
        reason: '输入为空',
      });
      expect(routeByRules('这个')).toMatchObject({
        decision: 'clarify',
        decisionSource: 'rule',
      });
    });
  });

  describe('routeByLlm', () => {
    it('当 LLM 输出格式不匹配时默认 orchestrate', async () => {
      await expect(
        routeByLlm('解释一下这个问题', async () => 'not-a-valid-router-output'),
      ).resolves.toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'llm',
      });
    });
  });
});
