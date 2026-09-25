// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { extractBackgroundOutput } from '../previews/background-output-preview.js';
import { extractBackgroundTerminal } from '../previews/background-terminal-preview.js';
import { extractCodegraphResult } from '../previews/codegraph-result-preview.js';
import { extractMcpResult } from '../previews/mcp-result-preview.js';
import { extractMcpToolList } from '../previews/mcp-tool-list-preview.js';
import { extractQuestionAnswers } from '../previews/question-answer-preview.js';
import { extractSkillContent } from '../previews/skill-content-preview.js';
import { extractToolOutputRead } from '../previews/tool-output-read-preview.js';
import { ToolOutputPreview } from './tool-output-preview.js';

afterEach(cleanup);

describe('extractMcpResult', () => {
  it('解析对象形态的 MCP 结果', () => {
    const view = extractMcpResult({ content: [{ type: 'text', text: 'hello' }], isError: false });
    expect(view).not.toBeNull();
    expect(view?.text).toBe('hello');
    expect(view?.blocks).toHaveLength(1);
    expect(view?.isError).toBe(false);
  });

  it('解析 skill_mcp 的 JSON 字符串 envelope', () => {
    const payload = JSON.stringify({ content: [{ type: 'text', text: 'ok' }], isError: false });
    expect(extractMcpResult(payload)?.text).toBe('ok');
  });

  it('对非 MCP 对象返回 null', () => {
    expect(extractMcpResult({ foo: 1 })).toBeNull();
  });

  it('对字符串型 content（read 形状）返回 null', () => {
    expect(extractMcpResult({ content: 'plain text' })).toBeNull();
  });

  it('支持仅有 structuredContent 的结果', () => {
    const view = extractMcpResult({ content: [], structuredContent: { a: 1 } });
    expect(view).not.toBeNull();
    expect(view?.structuredContent).toEqual({ a: 1 });
  });

  it('空 content 且无 structuredContent 返回 null', () => {
    expect(extractMcpResult({ content: [] })).toBeNull();
  });
});

describe('extractSkillContent', () => {
  it('剥离 skill_content 包裹并取名称', () => {
    const view = extractSkillContent('<skill_content name="demo">\n# Demo\nbody\n</skill_content>');
    expect(view?.name).toBe('demo');
    expect(view?.content).toContain('body');
  });

  it('无 name 属性时仍可解析内容', () => {
    expect(extractSkillContent('<skill_content>body</skill_content>')?.content).toBe('body');
  });

  it('普通文本返回 null', () => {
    expect(extractSkillContent('hello')).toBeNull();
  });
});

describe('extractQuestionAnswers', () => {
  it('解析问答行', () => {
    const items = extractQuestionAnswers('问题一="答案A"\n问题二="答案B, 答案C"');
    expect(items).toHaveLength(2);
    expect(items?.[1]?.answers).toEqual(['答案B', '答案C']);
  });

  it('包含无法解析的行时返回 null', () => {
    expect(extractQuestionAnswers('问题一="答案A"\n随便一句')).toBeNull();
  });

  it('支持 { output } 包裹', () => {
    expect(extractQuestionAnswers({ output: 'Q="A"' })?.[0]?.question).toBe('Q');
  });
});

describe('ToolOutputPreview 路由', () => {
  it('MCP JSON 字符串走 MCP 预览而非裸 JSON', () => {
    const payload = JSON.stringify({ content: [{ type: 'text', text: '工具结果正文' }] });
    const { container } = render(<ToolOutputPreview toolName="skill_mcp" output={payload} />);
    expect(container.querySelector('.mcp-result')).not.toBeNull();
    expect(container.querySelector('.json-preview')).toBeNull();
  });

  it('skill 输出剥离 skill_content 包裹', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="skill"
        output={'<skill_content name="demo">正文</skill_content>'}
      />,
    );
    expect(container.querySelector('.skill-content-preview')).not.toBeNull();
  });

  it('question 输出渲染为问答列表', () => {
    const { container } = render(
      <ToolOutputPreview toolName="question" output={'你偏好哪种方案="方案A, 方案B"'} />,
    );
    expect(container.querySelector('.question-answers')).not.toBeNull();
  });

  it('未知对象兑底为可读键值结构', () => {
    const { container } = render(
      <ToolOutputPreview toolName="mystery_tool" output={{ alpha: 'beta', count: 2 }} />,
    );
    expect(container.querySelector('.structured-output')).not.toBeNull();
    expect(container.querySelector('.json-preview')).toBeNull();
  });

  it('数组兑底为可读列表而非裸 JSON', () => {
    const { container } = render(<ToolOutputPreview toolName="mystery_tool" output={[1, 2, 3]} />);
    expect(container.querySelector('.array-output')).not.toBeNull();
    expect(container.querySelector('.json-preview')).toBeNull();
  });
});

describe('extractBackgroundTerminal', () => {
  it('解析 spawn 形态', () => {
    const view = extractBackgroundTerminal({
      terminalId: 'term_abc',
      status: 'running',
      command: 'pnpm dev',
      cwd: '/repo',
      startedAtMs: 1,
    });
    expect(view?.terminalId).toBe('term_abc');
    expect(view?.command).toBe('pnpm dev');
  });

  it('解析 poll 形态的 outputTail', () => {
    const view = extractBackgroundTerminal({
      terminalId: 'term_abc',
      status: 'exited',
      exitCode: 0,
      outputTail: 'done',
      outputBytesTotal: 2048,
    });
    expect(view?.outputTail).toBe('done');
    expect(view?.exitCode).toBe(0);
    expect(view?.outputBytesTotal).toBe(2048);
  });

  it('解析 kill 形态', () => {
    const view = extractBackgroundTerminal({
      terminalId: 'term_abc',
      found: true,
      alreadyClosed: false,
      killed: true,
    });
    expect(view?.kill).toEqual({ found: true, alreadyClosed: false, killed: true });
  });

  it('无 terminalId 返回 null', () => {
    expect(extractBackgroundTerminal({ status: 'running' })).toBeNull();
  });
});

describe('extractToolOutputRead', () => {
  it('解析行窗口', () => {
    const view = extractToolOutputRead({
      toolCallId: 't1',
      fullOutputPreserved: true,
      outputType: 'string',
      isError: false,
      sizeBytes: 100,
      totalLines: 500,
      selection: { mode: 'lines', lineStart: 1, lineCount: 200 },
      output: 'hello',
    });
    expect(view?.selectionLabel).toContain('第 1-200 行');
    expect(view?.output).toBe('hello');
  });

  it('解析顶层键模式', () => {
    const view = extractToolOutputRead({
      fullOutputPreserved: true,
      outputType: 'object',
      isError: false,
      sizeBytes: 10,
      selection: { mode: 'keys', jsonPath: 'data.items' },
      topLevelKeys: ['a', 'b'],
    });
    expect(view?.selectionLabel).toContain('data.items');
    expect(view?.topLevelKeys).toEqual(['a', 'b']);
  });

  it('非 read_tool_output 形状返回 null', () => {
    expect(extractToolOutputRead({ foo: 1 })).toBeNull();
  });
});

describe('extractMcpToolList', () => {
  it('解析服务器与工具列表', () => {
    const servers = extractMcpToolList([
      {
        serverId: 's1',
        serverName: 'Codegraph',
        status: 'connected',
        enabled: true,
        tools: [{ name: 'codegraph_search', description: 'search' }],
      },
    ]);
    expect(servers).toHaveLength(1);
    expect(servers?.[0]?.tools[0]?.name).toBe('codegraph_search');
  });

  it('无 serverId 的项被忽略', () => {
    expect(extractMcpToolList([{ foo: 1 }])).toBeNull();
  });
});

describe('ToolOutputPreview 路由（新增族）', () => {
  it('后台 bash 走终端预览', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="run_bash_in_background"
        output={{ terminalId: 'term_x', status: 'running', command: 'pnpm dev' }}
      />,
    );
    expect(container.querySelector('.bg-term')).not.toBeNull();
  });

  it('read_tool_output 走选择视图', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="read_tool_output"
        output={{
          fullOutputPreserved: true,
          outputType: 'string',
          isError: false,
          sizeBytes: 12,
          selection: { mode: 'full' },
          output: 'body',
        }}
      />,
    );
    expect(container.querySelector('.tool-read')).not.toBeNull();
  });

  it('mcp_list_tools 走服务器列表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp_list_tools"
        output={[
          {
            serverId: 's1',
            serverName: 'Codegraph',
            status: 'connected',
            enabled: true,
            tools: [],
          },
        ]}
      />,
    );
    expect(container.querySelector('.mcp-tools')).not.toBeNull();
  });
});

describe('extractCodegraphResult', () => {
  it('解析 search 结果', () => {
    const view = extractCodegraphResult({
      workspaceRoot: '/ws',
      results: [
        { id: 1, name: 'foo', kind: 'function', relativePath: 'a.ts', range: { startLine: 3 } },
      ],
    });
    expect(view?.kind).toBe('search');
    expect(view?.symbols?.[0]?.name).toBe('foo');
    expect(view?.symbols?.[0]?.startLine).toBe(3);
  });

  it('解析 callers 为边列表', () => {
    const view = extractCodegraphResult({
      callers: [{ id: 1, kind: 'calls', from: { name: 'a' }, to: { name: 'b' } }],
    });
    expect(view?.kind).toBe('callers');
    expect(view?.edges?.[0]?.from).toBe('a');
  });

  it('解析 impact', () => {
    const view = extractCodegraphResult({
      nodes: [{ name: 'x', kind: 'class', relativePath: 'x.ts' }],
      edges: [{ kind: 'imports' }],
      truncated: true,
    });
    expect(view?.kind).toBe('impact');
    expect(view?.truncated).toBe(true);
  });

  it('解析 status 统计', () => {
    const view = extractCodegraphResult({ fileCount: 12, schemaVersion: 3 });
    expect(view?.kind).toBe('status');
    expect(view?.status?.some((row) => row.label === '文件数')).toBe(true);
  });

  it('非 codegraph 形状返回 null', () => {
    expect(extractCodegraphResult({ foo: 1 })).toBeNull();
  });
});

describe('extractBackgroundOutput', () => {
  it('解析 full_session 形态并展开消息', () => {
    const view = extractBackgroundOutput({
      taskId: 't1',
      status: 'done',
      assignedAgent: 'explore',
      messages: [{ id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(view?.taskId).toBe('t1');
    expect(view?.assignedAgent).toBe('explore');
    expect(view?.messages[0]?.text).toBe('hi');
  });

  it('无 taskId/status 返回 null', () => {
    expect(extractBackgroundOutput({ message: 'hi' })).toBeNull();
  });
});

describe('ToolOutputPreview 路由（codegraph / background_output）', () => {
  it('codegraph_* 走符号列表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="codegraph_search"
        output={{ results: [{ name: 'foo', kind: 'function', relativePath: 'a.ts' }] }}
      />,
    );
    expect(container.querySelector('.cg-result')).not.toBeNull();
  });

  it('background_output(full_session) 走任务视图', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="background_output"
        output={{ taskId: 't1', status: 'running', messages: [] }}
      />,
    );
    expect(container.querySelector('.bg-task')).not.toBeNull();
  });
});

describe('ToolOutputPreview — 存储形态（JSON 字符串）还原', () => {
  it('list 的 JSON 字符串输出仍渲染目录树，而不是 JSON 文本', () => {
    const payload = JSON.stringify({
      path: '/workspace/apps/web',
      depth: 1,
      visitedEntries: 3,
      nodes: [
        { path: '/workspace/apps/web/src', name: 'src', type: 'directory' },
        { path: '/workspace/apps/web/package.json', name: 'package.json', type: 'file' },
        { path: '/workspace/apps/web/vite.config.ts', name: 'vite.config.ts', type: 'file' },
      ],
    });

    const { container } = render(<ToolOutputPreview toolName="list" output={payload} />);

    expect(container.querySelectorAll('.tool-call-tree-row').length).toBe(3);
    expect(container.querySelector('.tool-call-tree-name')?.textContent).toBe('src');
    expect(container.textContent).not.toContain('"nodes"');
  });

  it('read 的 JSON 字符串输出仍渲染文件内容预览', () => {
    const payload = JSON.stringify({
      path: 'src/a.ts',
      content: 'const a = 1;',
      lineStart: 1,
      lineEnd: 1,
      totalLines: 1,
    });

    const { container } = render(<ToolOutputPreview toolName="read" output={payload} />);

    expect(container.querySelector('.file-content-path')?.textContent).toBe('src/a.ts');
    expect(container.querySelectorAll('.file-content-line').length).toBe(1);
  });

  it('普通文本（非 JSON）保持原样，不误解析', () => {
    const { container } = render(<ToolOutputPreview toolName="bash" output={'{not json\nline'} />);

    expect(container.textContent).toContain('{not json');
  });
});
