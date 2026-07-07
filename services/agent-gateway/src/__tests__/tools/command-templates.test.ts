import { describe, expect, it } from 'vitest';

import {
  REFACTOR_INSTRUCTION,
  REMOVE_DEADCODE_INSTRUCTION,
  START_WORK_INSTRUCTION,
} from '../../tools/command-templates.js';

describe('command templates decision policy', () => {
  it('开放式 refactor 默认选择低风险目标而不是立即追问用户', () => {
    expect(REFACTOR_INSTRUCTION).toContain('默认选择可逆、低风险、局部化的最小改善目标');
    expect(REFACTOR_INSTRUCTION).not.toContain('必须先追问');
  });

  it('开放式 deadcode 清理默认只读发现候选，删除前才按风险收口', () => {
    expect(REMOVE_DEADCODE_INSTRUCTION).toContain('默认先做只读候选发现，不删除');
    expect(REMOVE_DEADCODE_INSTRUCTION).not.toContain('拒绝开放式表述');
  });

  it('/start-work 模板以 .agentdocs/workflow 为主计划目录', () => {
    expect(START_WORK_INSTRUCTION).toContain('`.agentdocs/workflow/`');
    expect(START_WORK_INSTRUCTION).toContain('`.omo/plans/`');
    expect(START_WORK_INSTRUCTION).toContain('旧版 `.sisyphus/plans/`');
    expect(START_WORK_INSTRUCTION).not.toContain('在 `.sisyphus/plans/` 目录下查找');
  });
});
