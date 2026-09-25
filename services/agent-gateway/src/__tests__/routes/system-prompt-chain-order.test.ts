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
  buildWebSearchRoutingSystemPrompt,
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
  toolCatalogPrompt: '<<TOOL_CATALOG>>',
  capabilityCatalogPrompt: '<<CAPABILITY_CATALOG>>',
};

function orderOf(haystack: string, ...needles: string[]): number[] {
  return needles.map((n) => haystack.indexOf(n));
}

describe('buildSystemPromptChain · 槽位顺序', () => {
  it('route → workspace → dynamicAgent → startWork → command → lsp → dialogue → yolo → thinking → pinnedSkills → teamStack → toolCatalog → capabilityCatalog 固定顺序', () => {
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
      '<<TOOL_CATALOG>>',
      '<<CAPABILITY_CATALOG>>',
    );
    // 全部出现
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    // 严格递增（即顺序锁定）
    for (let k = 1; k < idx.length; k++) {
      expect(idx[k]!).toBeGreaterThan(idx[k - 1]!);
    }
  });

  it('能力目录位于链末尾（工具折叠目录之后）', () => {
    const chain = buildSystemPromptChain(INPUT);
    const joined = chain.join('\n');
    const capabilityIdx = joined.indexOf('<<CAPABILITY_CATALOG>>');
    for (const marker of [
      '<<ROUTE>>',
      '<<WORKSPACE>>',
      '<<LSP>>',
      '<<PINNED_SKILLS>>',
      '<<TEAM_STACK>>',
      '<<TOOL_CATALOG>>',
    ]) {
      expect(joined.indexOf(marker)).toBeLessThan(capabilityIdx);
    }
  });
});

describe('buildTwoPartSystemPrompts · stable / dynamic 分段', () => {
  it('team 指令栈、工具目录与能力目录进 stable 段（prompt-cache 友好），能力目录收尾', () => {
    const { stable, dynamic } = buildTwoPartSystemPrompts(INPUT);
    expect(stable).toContain('<<TEAM_STACK>>');
    expect(stable).toContain('<<TOOL_CATALOG>>');
    expect(stable).toContain('<<CAPABILITY_CATALOG>>');
    expect(dynamic).not.toContain('<<TEAM_STACK>>');
    expect(dynamic).not.toContain('<<TOOL_CATALOG>>');
    expect(dynamic).not.toContain('<<CAPABILITY_CATALOG>>');
    // stable 段内：pinnedSkills → teamStack → toolCatalog → capabilityCatalog
    expect(stable.indexOf('<<PINNED_SKILLS>>')).toBeLessThan(stable.indexOf('<<TEAM_STACK>>'));
    expect(stable.indexOf('<<TEAM_STACK>>')).toBeLessThan(stable.indexOf('<<TOOL_CATALOG>>'));
    expect(stable.indexOf('<<TOOL_CATALOG>>')).toBeLessThan(
      stable.indexOf('<<CAPABILITY_CATALOG>>'),
    );
  });

  it('stable 段包含并行调用纪律（对齐参考库 Prefer parallelizing independent tool calls）', () => {
    const { stable } = buildTwoPartSystemPrompts(INPUT);
    expect(stable).toContain('同一条回复里一起发出');
    expect(stable).toContain('batch');
    expect(stable).toContain('tool_search');
  });

  it('dynamicAgent / startWork / command 进 dynamic 段（每轮可变）', () => {
    const { stable, dynamic } = buildTwoPartSystemPrompts(INPUT);
    expect(dynamic).toContain('<<DYNAMIC_AGENT>>');
    expect(dynamic).toContain('<<START_WORK>>');
    expect(dynamic).toContain('<<COMMAND>>');
    expect(stable).not.toContain('<<DYNAMIC_AGENT>>');
  });

  it('stable 段固定顺序：route → workspace → lsp → dialogue → yolo → thinking → pinnedSkills → teamStack → toolCatalog → capabilityCatalog', () => {
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
      '<<TOOL_CATALOG>>',
      '<<CAPABILITY_CATALOG>>',
    );
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    for (let k = 1; k < idx.length; k++) {
      expect(idx[k]!).toBeGreaterThan(idx[k - 1]!);
    }
  });
});

describe('buildWebSearchRoutingSystemPrompt · MCP 工具面一致性', () => {
  it('flat MCP 模式不提示模型调用隐藏的 legacy 包装工具', () => {
    const prompt = buildWebSearchRoutingSystemPrompt({ flatMcpToolsEnabled: true });

    expect(prompt).toContain('mcp__open_websearch__search');
    expect(prompt).toContain('mcp__websearch__web_search_exa');
    expect(prompt).toContain('mcp__grep_app__');
    expect(prompt).not.toContain('mcp_call({');
    expect(prompt).not.toContain('mcp_list_tools');
  });

  it('legacy MCP 模式才提示 mcp_call 包装工具', () => {
    const prompt = buildWebSearchRoutingSystemPrompt({ flatMcpToolsEnabled: false });

    expect(prompt).toContain('mcp_call({ serverId: "open_websearch"');
    expect(prompt).toContain('mcp_call({ serverId: "websearch"');
    expect(prompt).toContain('mcp_call({ serverId: "grep_app"');
    expect(prompt).not.toContain('mcp__open_websearch__search');
  });

  it('明确区分抓取已有网络图片与生成新图片', () => {
    const prompt = buildWebSearchRoutingSystemPrompt({ flatMcpToolsEnabled: true });

    expect(prompt).toContain('抓取、查找、获取、展示互联网上已经存在的图片');
    expect(prompt).toContain('webfetch');
    expect(prompt).toContain('generate_image');
    expect(prompt).toContain('不要把“抓取网络图片 / 展示已有图片”误路由到图片生成工具');
  });

  it('system prompt chain 会透传 flat MCP 开关，确保文案与真实工具面一致', () => {
    const { stable: flatStable } = buildTwoPartSystemPrompts({
      ...INPUT,
      flatMcpToolsEnabled: true,
    });
    const { stable: legacyStable } = buildTwoPartSystemPrompts({
      ...INPUT,
      flatMcpToolsEnabled: false,
    });

    expect(flatStable).toContain('mcp__websearch__web_search_exa');
    expect(flatStable).not.toContain('mcp_call({ serverId: "websearch"');
    expect(legacyStable).toContain('mcp_call({ serverId: "websearch"');
    expect(legacyStable).not.toContain('mcp__websearch__web_search_exa');
  });
});
