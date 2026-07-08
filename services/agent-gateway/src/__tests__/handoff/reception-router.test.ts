import { describe, expect, it } from 'vitest';
import {
  routeByRules,
  routeByLlm,
  type RouteLlmContext,
} from '../../handoff/runner/reception-router.js';

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

    it('极短输入（≤1字符）且无模式匹配时走 clarify', () => {
      expect(routeByRules('')).toMatchObject({
        decision: 'clarify',
        decisionSource: 'rule',
        reason: '输入为空',
        clarifyKind: 'empty',
      });
      expect(routeByRules('嗯')).toMatchObject({
        decision: 'clarify',
        decisionSource: 'rule',
        clarifyKind: 'too_short',
      });
    });

    it('2~7字符短输入不匹配直答模式时返回 null 交给 LLM 兜底', () => {
      expect(routeByRules('这个')).toBeNull();
      expect(routeByRules('看看吧')).toBeNull();
      expect(routeByRules('稍等下')).toBeNull();
    });

    it('继续/延续类短输入不由规则判断，返回 null 交给 LLM 做上下文感知判断', () => {
      // 规则引擎不再硬编码 resume 关键词——是否续接取决于历史任务上下文，
      // 必须由 LLM 结合上下文判断。
      expect(routeByRules('继续')).toBeNull();
      expect(routeByRules('继续完成')).toBeNull();
      expect(routeByRules('接着做')).toBeNull();
      expect(routeByRules('往下')).toBeNull();
    });

    it('长输入中的续接意图也不由规则判断，返回 null 交给 LLM', () => {
      expect(routeByRules('继续上次未完成的工作')).toBeNull();
      expect(routeByRules('接着把那个功能写完')).toBeNull();
      expect(routeByRules('还没做完，继续吧')).toBeNull();
      expect(routeByRules('上次的那个弄完它')).toBeNull();
    });

    it('操作指令类短输入走 orchestrate', () => {
      expect(routeByRules('执行')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '操作指令',
      });
      expect(routeByRules('运行')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '操作指令',
      });
      expect(routeByRules('重试')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '操作指令',
      });
      expect(routeByRules('停止')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '操作指令',
      });
    });

    it('确认类短输入走 orchestrate', () => {
      expect(routeByRules('对')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '确认执行',
      });
      expect(routeByRules('可以')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '确认执行',
      });
      expect(routeByRules('没问题')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '确认执行',
      });
    });

    it('否定/取消类短输入走 orchestrate', () => {
      expect(routeByRules('不对')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '否定/取消指令',
      });
      expect(routeByRules('算了')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '否定/取消指令',
      });
      expect(routeByRules('取消')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '否定/取消指令',
      });
    });

    it('撤销/回退类短输入走 orchestrate', () => {
      expect(routeByRules('撤销')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '撤销/回退指令',
      });
      expect(routeByRules('回退')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '撤销/回退指令',
      });
      expect(routeByRules('undo')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '撤销/回退指令',
      });
    });

    it('重做/redo 归入重新执行指令', () => {
      expect(routeByRules('重做')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '重新执行指令',
      });
      expect(routeByRules('redo')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '重新执行指令',
      });
    });

    it('重新/再来类短输入走 orchestrate', () => {
      expect(routeByRules('重新来')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '重新执行指令',
      });
      expect(routeByRules('再试')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '重新执行指令',
      });
    });

    it('指代+动作类短输入走 orchestrate', () => {
      expect(routeByRules('这个改一下')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '指代+动作指令',
      });
      expect(routeByRules('那个看看')).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'rule',
        reason: '指代+动作指令',
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

    it('LLM prompt 包含历史任务上下文，让 LLM 能看到上次任务状态', async () => {
      let capturedPrompt = '';
      const context: RouteLlmContext = {
        previousTaskSummary: '1. 实现 OAuth 登录（运行中 / executor）',
        incompleteTaskCount: 1,
      };
      await routeByLlm(
        '继续',
        async (prompt) => {
          capturedPrompt = prompt;
          return 'DECISION: RESUME\nREASON: 有未完成任务且用户想继续';
        },
        context,
      );

      expect(capturedPrompt).toContain('历史任务上下文');
      expect(capturedPrompt).toContain('实现 OAuth 登录');
      expect(capturedPrompt).toContain('1 个未完成任务');
    });

    it('无历史任务时 prompt 标注当前没有未完成任务', async () => {
      let capturedPrompt = '';
      const context: RouteLlmContext = {
        previousTaskSummary: null,
        incompleteTaskCount: 0,
      };
      await routeByLlm(
        '继续',
        async (prompt) => {
          capturedPrompt = prompt;
          return 'DECISION: ORCHESTRATE\nREASON: 没有可续接的任务';
        },
        context,
      );

      expect(capturedPrompt).toContain('历史任务上下文');
      expect(capturedPrompt).toContain('没有未完成');
    });

    it('不传 context 时 prompt 标注无历史任务上下文', async () => {
      let capturedPrompt = '';
      await routeByLlm('继续', async (prompt) => {
        capturedPrompt = prompt;
        return 'DECISION: ORCHESTRATE\nREASON: 无上下文';
      });

      expect(capturedPrompt).toContain('无历史任务上下文');
    });

    it('LLM 对短输入返回 CLARIFY 时正确解析', async () => {
      const result = await routeByLlm('嗯', async () => {
        return 'DECISION: CLARIFY\nREASON: 纯语气词无意图';
      });

      expect(result).toMatchObject({
        decision: 'clarify',
        decisionSource: 'llm',
        reason: '纯语气词无意图',
      });
    });

    it('LLM 返回 RESUME 时正确解析', async () => {
      const context: RouteLlmContext = {
        previousTaskSummary: '1. 修复路由 bug（待执行 / executor）',
        incompleteTaskCount: 1,
      };
      const result = await routeByLlm(
        '继续干',
        async () => {
          return 'DECISION: RESUME\nREASON: 用户想续接上次任务';
        },
        context,
      );

      expect(result).toMatchObject({
        decision: 'resume',
        decisionSource: 'llm',
        reason: '用户想续接上次任务',
      });
    });

    it('有未完成任务但用户提了新需求时 LLM 应返回 ORCHESTRATE', async () => {
      const context: RouteLlmContext = {
        previousTaskSummary: '1. 修复路由 bug（待执行 / executor）',
        incompleteTaskCount: 1,
      };
      const result = await routeByLlm(
        '帮我新增一个用户管理模块',
        async () => {
          return 'DECISION: ORCHESTRATE\nREASON: 新需求与上次任务无关';
        },
        context,
      );

      expect(result).toMatchObject({
        decision: 'orchestrate',
        decisionSource: 'llm',
        reason: '新需求与上次任务无关',
      });
    });
  });
});
