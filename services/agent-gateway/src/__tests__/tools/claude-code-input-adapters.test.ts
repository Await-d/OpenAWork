import { describe, expect, it } from 'vitest';

import {
  normalizeInputForCanonical,
  UnsupportedToolError,
} from '../../claude-code/claude-code-input-adapters.js';
import { buildGatewayToolDefinitions } from '../../tools/tool-definitions.js';

describe('Claude Code 输入适配', () => {
  it('将后台 Bash 请求路由到后台执行工具', () => {
    const normalized = normalizeInputForCanonical('Bash', {
      command: 'pnpm dev',
      description: '启动开发服务',
      run_in_background: true,
      timeout: 60_000,
      workdir: 'E:/01.Projects/OpenAWork',
    });

    expect(normalized).toEqual({
      canonicalName: 'run_bash_in_background',
      normalizedFields: {
        command: 'pnpm dev',
        description: '启动开发服务',
        timeout: 60_000,
        workdir: 'E:/01.Projects/OpenAWork',
      },
      remapped: true,
    });
  });

  it.each([
    {
      input: { url: 'https://example.com', prompt: '提取标题' },
      presentedName: 'WebFetch',
    },
    {
      input: { query: 'OpenAWork', allowed_domains: ['github.com'] },
      presentedName: 'WebSearch',
    },
    {
      input: { pattern: 'TODO', multiline: true },
      presentedName: 'Grep',
    },
    {
      input: { file_path: 'report.pdf', pages: '1-2' },
      presentedName: 'Read',
    },
    {
      input: { skill: 'programming', args: 'strict' },
      presentedName: 'Skill',
    },
    {
      input: { command: 'git status', dangerouslyDisableSandbox: true },
      presentedName: 'Bash',
    },
  ])('拒绝无法等价实现的 $presentedName 字段', ({ input, presentedName }) => {
    expect(() => normalizeInputForCanonical(presentedName, input)).toThrow(UnsupportedToolError);
  });

  it('保留 AskUserQuestion 选项预览数据', () => {
    const normalized = normalizeInputForCanonical('AskUserQuestion', {
      questions: [
        {
          question: '选择环境？',
          header: '环境',
          options: [{ label: '预览', description: '预览环境', preview: 'preview.example.com' }],
        },
      ],
    });

    expect(normalized.normalizedFields).toMatchObject({
      questions: [
        {
          options: [{ preview: 'preview.example.com' }],
        },
      ],
    });
  });

  it('拒绝缺少子代理类型的 Agent 请求', () => {
    expect(() =>
      normalizeInputForCanonical('Agent', {
        description: '检查仓库',
        prompt: '检查当前仓库的工具实现。',
      }),
    ).toThrow(UnsupportedToolError);
  });

  it('拒绝包含本网关未实现执行语义的 Agent 请求', () => {
    expect(() =>
      normalizeInputForCanonical('Agent', {
        description: '检查仓库',
        prompt: '检查当前仓库的工具实现。',
        subagent_type: 'explore',
        model: 'opus',
      }),
    ).toThrow(UnsupportedToolError);
  });

  it('向模型声明可透传的提问预览字段', () => {
    const tool = buildGatewayToolDefinitions().find(
      (definition) => definition.function.name === 'AskUserQuestion',
    );

    expect(JSON.stringify(tool?.function.parameters.properties['questions'])).toContain(
      '"preview"',
    );
  });
});
