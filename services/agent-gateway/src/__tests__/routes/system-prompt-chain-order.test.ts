/**
 * system prompt chain 槽位顺序锁定测试。
 *
 * buildSystemPromptChain / buildTwoPartSystemPrompts 用「固定槽位 + 占位符」保证
 * prompt-cache 前缀稳定（注释明确「fixed position — no conditional concatenation」）。
 * 本测试锁定关键槽位的相对顺序，防止后续重构无意打乱顺序导致：
 *   - prompt-cache 前缀抖动（命中率下降）
 *   - team 7 层指令栈不在末尾 / 不在 stable 段
 */

import { describe, expect, it } from 'vitest';
import {
  buildSystemPromptChain,
  buildTwoPartSystemPrompts,
} from '../../routes/stream-system-prompts.js';

// 给每个可控槽位塞一个唯一标记，便于在输出里定位顺序。
const INPUT = {
  routeSystemPrompt: '<<ROUTE>>',
  workspaceCtx: '<<WORKSPACE>>',
  dynamicAgentPrompt: '<<DYNAMIC_AGENT>>',
  startWorkContext: '<<START_WORK>>',
  commandContext: '<<COMMAND>>',
  lspGuidance: '<<LSP>>',
  dialogueModePrompt: '<<DIALOGUE>>',
  yoloModePrompt: '<<YOLO>>',
  thinkingLanguagePrompt: '<<THINKING>>',
  pinnedSkillsPrompt: '<<PINNED_SKILLS>>',
  teamInstructionStack: '<<TEAM_STACK>>',
};

function orderOf(haystack: string, ...needles: string[]): number[] {
  return needles.map((n) => haystack.indexOf(n));
}

describe('buildSystemPromptChain · 槽位顺序', () => {
  it('route → workspace → dynamicAgent → startWork → command → lsp → dialogue → yolo → thinking → pinnedSkills → teamStack 固定顺序', () => {
    const chain = buildSystemPromptChain(INPUT);
    const joined = chain.join('\n');
    const idx = orderOf(
      joined,
      '<<ROUTE>>',
      '<<WORKSPACE>>',
      '<<DYNAMIC_AGENT>>',
      '<<START_WORK>>',
      '<<COMMAND>>',
      '<<LSP>>',
      '<<DIALOGUE>>',
      '<<YOLO>>',
      '<<THINKING>>',
      '<<PINNED_SKILLS>>',
      '<<TEAM_STACK>>',
    );
    // 全部出现
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    // 严格递增（即顺序锁定）
    for (let k = 1; k < idx.length; k++) {
      expect(idx[k]!).toBeGreaterThan(idx[k - 1]!);
    }
  });

  it('team 指令栈位于链末尾', () => {
    const chain = buildSystemPromptChain(INPUT);
    const joined = chain.join('\n');
    // teamStack 之后不应再有其它已知槽位标记
    const teamIdx = joined.indexOf('<<TEAM_STACK>>');
    for (const marker of ['<<ROUTE>>', '<<WORKSPACE>>', '<<LSP>>', '<<PINNED_SKILLS>>']) {
      expect(joined.indexOf(marker)).toBeLessThan(teamIdx);
    }
  });
});

describe('buildTwoPartSystemPrompts · stable / dynamic 分段', () => {
  it('team 指令栈进 stable 段（prompt-cache 友好），且是 stable 段最后一块', () => {
    const { stable, dynamic } = buildTwoPartSystemPrompts(INPUT);
    expect(stable).toContain('<<TEAM_STACK>>');
    expect(dynamic).not.toContain('<<TEAM_STACK>>');
    // stable 段内：pinnedSkills 在 teamStack 之前，teamStack 收尾
    expect(stable.indexOf('<<PINNED_SKILLS>>')).toBeLessThan(stable.indexOf('<<TEAM_STACK>>'));
  });

  it('dynamicAgent / startWork / command 进 dynamic 段（每轮可变）', () => {
    const { stable, dynamic } = buildTwoPartSystemPrompts(INPUT);
    expect(dynamic).toContain('<<DYNAMIC_AGENT>>');
    expect(dynamic).toContain('<<START_WORK>>');
    expect(dynamic).toContain('<<COMMAND>>');
    expect(stable).not.toContain('<<DYNAMIC_AGENT>>');
  });

  it('stable 段固定顺序：route → workspace → lsp → dialogue → yolo → thinking → pinnedSkills → teamStack', () => {
    const { stable } = buildTwoPartSystemPrompts(INPUT);
    const idx = orderOf(
      stable,
      '<<ROUTE>>',
      '<<WORKSPACE>>',
      '<<LSP>>',
      '<<DIALOGUE>>',
      '<<YOLO>>',
      '<<THINKING>>',
      '<<PINNED_SKILLS>>',
      '<<TEAM_STACK>>',
    );
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    for (let k = 1; k < idx.length; k++) {
      expect(idx[k]!).toBeGreaterThan(idx[k - 1]!);
    }
  });
});
