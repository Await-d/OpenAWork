import type { ToolCallDisplayProps } from '../src/components/chat/tool-call/display/tool-call-display.js';

export const resourcePath = `/workspace/${'long-resource-directory/'.repeat(12)}guide.md`;
export const markdown = `# 验收技能指南

**检查布局**，使用 \`bun run test\`。

- 第一项
- 第二项

[官方文档](https://example.com/guide)

\`\`\`ts
export const accepted = true;
\`\`\`

| 项目 | 结果 |
| --- | --- |
| Markdown | 正常 |
`;
export const envelope = `<skill_content name="frontend">${markdown}<skill_files><file>scripts/check.ts</file><file>${resourcePath}</file></skill_files></skill_content>`;
export const longOutput = `<skill_content name="long-skill">${markdown}\n${'正文段落：检查响应式与可访问性。\n\n'.repeat(400)}\nLONG_CONTENT_END</skill_content>`;
export const malformed =
  '<skill_content name="frontend"># 不完整技能\n<skill_files><file>broken.md';
export const truncated =
  '<skill_content name="frontend"># 截断技能\n…[truncated, 120 chars omitted]</skill_content>';
export const skillCases: { id: string; props: ToolCallDisplayProps }[] = [
  {
    id: 'success-name',
    props: {
      toolName: 'Skill',
      input: { name: 'frontend' },
      status: 'completed',
      output: envelope,
    },
  },
  {
    id: 'success-skill',
    props: {
      toolName: 'Skill',
      input: { skill: 'frontend' },
      status: 'completed',
      output: envelope,
    },
  },
  { id: 'loading', props: { toolName: 'Skill', input: { name: 'frontend' }, status: 'running' } },
  {
    id: 'failure',
    props: { toolName: 'Skill', input: { skill: 'frontend' }, status: 'failed', output: envelope },
  },
  // wire 状态已被 resolver 支持，公共卡片类型尚未同步（与现有真实链路单测一致）。
  {
    id: 'cancelled',
    props: {
      toolName: 'Skill',
      input: { name: 'frontend' },
      status: 'cancelled' as ToolCallDisplayProps['status'],
      output: envelope,
    },
  },
  {
    id: 'error-override',
    props: {
      toolName: 'Skill',
      input: { skill: 'frontend' },
      status: 'completed',
      isError: true,
      output: 'Error: 技能不存在',
    },
  },
  {
    id: 'long',
    props: {
      toolName: 'Skill',
      input: { name: 'long-skill' },
      status: 'completed',
      output: longOutput,
    },
  },
  {
    id: 'malformed',
    props: {
      toolName: 'Skill',
      input: { name: 'frontend' },
      status: 'completed',
      output: malformed,
    },
  },
  {
    id: 'plain',
    props: {
      toolName: 'Skill',
      input: { name: 'frontend' },
      status: 'completed',
      output: '旧版原始输出：frontend',
    },
  },
  {
    id: 'truncated',
    props: {
      toolName: 'Skill',
      input: { name: 'frontend' },
      status: 'completed',
      output: truncated,
    },
  },
];
const files = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `entry-${String(i).padStart(4, '0')}.ts`,
    type: 'file',
  }));
export const listCases = [
  { id: 'list-401', nodes: files(401) },
  {
    id: 'list-801',
    nodes: [
      { name: 'nested', type: 'directory', children: files(799) },
      { name: 'final-tail.ts', type: 'file' },
    ],
  },
  {
    id: 'list-empty',
    nodes: [
      { name: 'known-empty', type: 'directory', children: [] },
      { name: 'not-read', type: 'directory' },
    ],
  },
];
