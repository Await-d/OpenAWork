/**
 * 对话模式提示词契约测试
 *
 * 锁定跨模式约定，防止后续改提示词时被无意移除：
 *   1. 澄清模式的方案文档必须按 agentdocs-orchestrator 工作流规范组织
 *      （`.agentdocs/workflow/` 落盘路径 + 复杂度评估 + `T-XX` 原子任务）；
 *   2. 澄清模式的共识确认门控与"确认后自动切换到编程模式"说明；
 *   3. coding / programmer 承接澄清方案时先落盘计划并登记 `.agentdocs/index.md`；
 *   4. 三个模式声明【指令优先级】（多来源提示词冲突时的裁决顺序）；
 *   5. coding / programmer 共用同一份公共工程纪律与【模式回流】片段（SSOT）。
 */

import { describe, expect, it } from 'vitest';
import {
  AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT,
  DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT,
  DIALOGUE_MODE_SYSTEM_PROMPTS,
  EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT,
  MODE_REFERRAL_SYSTEM_PROMPT,
} from '../../routes/stream-system-prompts.js';

describe('对话模式提示词：agentdocs 工作流规范', () => {
  it('澄清模式要求方案文档按 .agentdocs 工作流规范组织', () => {
    const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS.clarify;

    expect(prompt).toContain('agentdocs-orchestrator');
    expect(prompt).toContain('.agentdocs/workflow/');
    expect(prompt).toContain('复杂度评估');
    expect(prompt).toContain('T-XX');
    expect(prompt).toContain('验证策略');
  });

  it('澄清模式保留共识确认门控与自动切换说明', () => {
    const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS.clarify;

    expect(prompt).toContain('__grill_confirm__');
    expect(prompt).toContain('已自动切换到编程模式');
  });

  it('澄清模式声明只读：方案文档先在对话定稿，落盘交给编程模式', () => {
    const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS.clarify;

    expect(prompt).toContain('澄清模式只读');
    expect(prompt).toContain('.agentdocs/index.md');
  });

  it('编程模式承接澄清方案时先落盘计划并登记 index.md', () => {
    const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS.coding;

    expect(prompt).toContain('.agentdocs/workflow/');
    expect(prompt).toContain('.agentdocs/index.md');
    expect(prompt).toContain('T-XX');
    expect(prompt).toContain('done/');
  });

  it('三个模式均声明指令优先级，避免多来源提示词冲突', () => {
    for (const mode of ['clarify', 'coding', 'programmer'] as const) {
      expect(DIALOGUE_MODE_SYSTEM_PROMPTS[mode]).toContain(
        DIALOGUE_MODE_INSTRUCTION_PRIORITY_SYSTEM_PROMPT,
      );
    }
  });

  it('可执行模式共用同一份工程纪律与模式回流片段（SSOT）', () => {
    for (const mode of ['coding', 'programmer'] as const) {
      const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS[mode];

      expect(prompt).toContain(EXECUTABLE_MODE_COMMON_DISCIPLINE_SYSTEM_PROMPT);
      expect(prompt).toContain(MODE_REFERRAL_SYSTEM_PROMPT);
    }
  });

  it('程序员模式与编程模式共用 agentdocs 计划衔接段', () => {
    const codingPrompt = DIALOGUE_MODE_SYSTEM_PROMPTS.coding;
    const programmerPrompt = DIALOGUE_MODE_SYSTEM_PROMPTS.programmer;

    expect(codingPrompt).toContain(AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT);
    expect(programmerPrompt).toContain(AGENTDOCS_PLAN_HANDOFF_SYSTEM_PROMPT);
    expect(programmerPrompt).toContain('.agentdocs/workflow/done/');
  });

  it('非澄清模式提示词不携带澄清人设与 __grill_confirm__ 确认门控', () => {
    for (const mode of ['coding', 'programmer'] as const) {
      const prompt = DIALOGUE_MODE_SYSTEM_PROMPTS[mode];

      expect(prompt).not.toContain('需求澄清助手');
      expect(prompt).not.toContain('多轮提问');
      expect(prompt).not.toContain('__grill_confirm__');
    }
  });
});
