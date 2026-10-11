import { describe, expect, it } from 'vitest';
import {
  hasSubagentResultBlocks,
  isStructuredSubagentResult,
  isSubagentResultSectionVisible,
  parseSubagentResultBlocks,
  pickSubagentResultAnswer,
  summarizeSubagentResult,
  transformSubagentResultBlocks,
} from './subagent-results.js';

const EXPLORE_RESULTS = `<results>
<files>
- /abs/path/to/file1.ts — 状态机核心实现
- /abs/path/to/file2.ts — 路由入口
</files>

<answer>
状态机在 file1.ts 的 transition 函数中定义。
</answer>

<next_steps>
- 先读 file1.ts 的 transition 函数
- 再确认路由入口
</next_steps>
</results>`;

const SCOUT_RESULTS = `<results>
<findings>
- 官方推荐用法 X — https://docs.example.com/x
- 社区共识 Y — 来源冲突，未核实
</findings>

<answer>
推荐做法是 X。
</answer>

<uncertainties>
版本 2.x 的行为未确认
</uncertainties>
</results>`;

describe('parseSubagentResultBlocks', () => {
  it('explore 形态：files 条目带 detail，answer / next_steps 正文', () => {
    const sections = parseSubagentResultBlocks(EXPLORE_RESULTS);
    expect(isStructuredSubagentResult(sections)).toBe(true);

    const files = sections.find((section) => section.kind === 'files');
    expect(files?.title).toBe('相关文件');
    expect(files?.items).toEqual([
      { text: '/abs/path/to/file1.ts', detail: '状态机核心实现' },
      { text: '/abs/path/to/file2.ts', detail: '路由入口' },
    ]);

    const answer = sections.find((section) => section.kind === 'answer');
    expect(answer?.body).toContain('状态机在 file1.ts');

    const nextSteps = sections.find((section) => section.kind === 'next_steps');
    expect(nextSteps?.title).toBe('后续步骤');
    expect(nextSteps?.items?.length).toBe(2);
    expect(nextSteps?.items?.[0]?.text).toBe('先读 file1.ts 的 transition 函数');
  });

  it('scout 形态：findings / uncertainties 各成节', () => {
    const sections = parseSubagentResultBlocks(SCOUT_RESULTS);
    expect(sections.some((section) => section.kind === 'findings')).toBe(true);

    const findings = sections.find((section) => section.kind === 'findings');
    expect(findings?.items?.[0]?.text).toBe('官方推荐用法 X');
    expect(findings?.items?.[0]?.detail).toBe('https://docs.example.com/x');

    const uncertainties = sections.find((section) => section.kind === 'uncertainties');
    expect(uncertainties?.title).toBe('待确认');
    expect(uncertainties?.items?.[0]?.text).toBe('版本 2.x 的行为未确认');
  });

  it('无 <results> 块时整段作为 raw 兜底节', () => {
    const text = '子代理已完成 · 审计会话唤醒原语';
    const sections = parseSubagentResultBlocks(text);
    expect(sections).toEqual([{ kind: 'raw', body: text }]);
    expect(isStructuredSubagentResult(sections)).toBe(false);
  });

  it('空文本返回单个空 raw 节', () => {
    expect(parseSubagentResultBlocks('   ')).toEqual([{ kind: 'raw', body: '' }]);
  });

  it('results 块前后的普通文本降级为 raw 节', () => {
    const text = `前置说明
${EXPLORE_RESULTS}
[子代理结果过长，已截断]`;
    const sections = parseSubagentResultBlocks(text);
    const raws = sections.filter((section) => section.kind === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0]?.body).toBe('前置说明');
    expect(raws[1]?.body).toBe('[子代理结果过长，已截断]');
  });

  it('代码围栏内的 <results> 不作为结构化块处理', () => {
    const text = '示例如下：\n```\n<results>\n<answer>x</answer>\n</results>\n```\n真正的说明';
    expect(hasSubagentResultBlocks(text)).toBe(false);
    const sections = parseSubagentResultBlocks(text);
    expect(sections[0]?.kind).toBe('raw');
  });

  it('未知子标签归入 other 节且保留正文', () => {
    const sections = parseSubagentResultBlocks('<results>\n<whatever>内容</whatever>\n</results>');
    expect(sections[0]?.kind).toBe('other');
    expect(sections[0]?.body).toBe('内容');
  });

  it('pickSubagentResultAnswer 回退到第一个含正文节', () => {
    const sections = parseSubagentResultBlocks('纯文本总结，无 results 块');
    expect(pickSubagentResultAnswer(sections)).toBe('纯文本总结，无 results 块');
    const withAnswer = parseSubagentResultBlocks(EXPLORE_RESULTS);
    expect(pickSubagentResultAnswer(withAnswer)).toContain('状态机在 file1.ts');
  });

  it('summarizeSubagentResult 取答案首行并截断', () => {
    const sections = parseSubagentResultBlocks(EXPLORE_RESULTS);
    expect(summarizeSubagentResult(sections)).toBe('状态机在 file1.ts 的 transition 函数中定义。');

    const longText = `长总结：${'x'.repeat(200)}`;
    expect(summarizeSubagentResult(parseSubagentResultBlocks(longText), 50).length).toBeLessThan(60);
  });
});

describe('transformSubagentResultBlocks', () => {
  it('markdown 模式：子标签换成加粗段落标题，外层 <results> 剥壳', () => {
    const transformed = transformSubagentResultBlocks(EXPLORE_RESULTS, 'markdown');
    expect(transformed).not.toContain('<results>');
    expect(transformed).not.toContain('<files>');
    expect(transformed).toContain('**相关文件**');
    expect(transformed).toContain('**回答**');
    expect(transformed).toContain('**后续步骤**');
    expect(transformed).toContain('/abs/path/to/file1.ts — 状态机核心实现');
    // 幂等：结果中已无子标签，二次调用不再变化。
    expect(transformSubagentResultBlocks(transformed, 'markdown')).toBe(transformed);
  });

  it('plain 模式：子标签换成裸标题行，不引入 markdown 装饰', () => {
    const transformed = transformSubagentResultBlocks(SCOUT_RESULTS, 'plain');
    expect(transformed).not.toContain('**');
    expect(transformed).not.toContain('<findings>');
    expect(transformed).toContain('\n关键发现\n');
    expect(transformed).toContain('\n待确认\n');
  });

  it('普通消息（无 <results>）原样返回', () => {
    const plain = '子代理已完成 · 审计会话唤醒原语';
    expect(transformSubagentResultBlocks(plain, 'markdown')).toBe(plain);
  });

  it('代码围栏内的标签不动', () => {
    const content = '示例：\n```\n<results>\n<answer>x</answer>\n</results>\n```\n真正的回答';
    const transformed = transformSubagentResultBlocks(content, 'markdown');
    expect(transformed).toContain('<results>\n<answer>x</answer>\n</results>');
    expect(transformed).toContain('真正的回答');
  });

  it('流式容忍：未闭合的开标签也先剥掉开标签', () => {
    const streaming = '<results>\n<files>\n- /a/b.ts — 相关\n</files>\n<answer>';
    const transformed = transformSubagentResultBlocks(streaming, 'markdown');
    expect(transformed).not.toContain('<results>');
    expect(transformed).not.toContain('<files>');
    expect(transformed).not.toContain('<answer>');
    expect(transformed).toContain('**相关文件**');
  });
});

describe('isSubagentResultSectionVisible', () => {
  it('带可见结构化分节时返回 true', () => {
    expect(isSubagentResultSectionVisible(EXPLORE_RESULTS)).toBe(true);
    expect(isSubagentResultSectionVisible(SCOUT_RESULTS)).toBe(true);
  });

  it('results 块内只有普通正文（无结构化子标签）时仍豁免折叠', () => {
    expect(isSubagentResultSectionVisible('<results>纯文本总结</results>')).toBe(true);
  });

  it('空 results 块（剥壳后无内容）返回 false', () => {
    expect(isSubagentResultSectionVisible('<results>\n</results>')).toBe(false);
  });

  it('无 <results> 块的普通正文返回 false', () => {
    expect(isSubagentResultSectionVisible('这是一段普通长总结')).toBe(false);
    expect(isSubagentResultSectionVisible('')).toBe(false);
  });

  it('代码围栏内的 <results> 不算可见结果节', () => {
    const content = '```\n<results>\n<answer>x</answer>\n</results>\n```';
    expect(isSubagentResultSectionVisible(content)).toBe(false);
  });
});
