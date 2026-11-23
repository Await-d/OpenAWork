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

/**
 * 失败卡接管的边界：`isError` 为真时业务预览要让位，但三类输出必须**放行**给原预览，
 * 否则是功能倒退（bash 终端画面、diff 卡、提问流程提示）。
 */
describe('ToolOutputPreview · 失败卡接管边界', () => {
  const AGENTIGNORE =
    'Access denied: file "/repo/.omo/x.ts" is protected by agentignore rules. 该类路径受 agentignore 保护。请勿重复尝试读取或写入。';

  it('isError 时字符串错误渲染结构化失败卡', () => {
    const { container } = render(
      <ToolOutputPreview toolName="write" output={AGENTIGNORE} isError />,
    );
    expect(container.querySelector('.tool-failure-card')).not.toBeNull();
    expect(container.querySelector('.tool-failure-headline')?.textContent).toBe(
      'agentignore 保护路径',
    );
  });

  it('bash 失败信封不接管（保留终端卡路径）', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="bash"
        output={{ command: 'ls', cwd: '/repo', exitCode: 1, output: 'boom' }}
        isError
      />,
    );
    expect(container.querySelector('.tool-failure-card')).toBeNull();
  });

  it('question 族的 is_error 语义不是失败，不得渲染失败卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="question"
        output={'Question request "q-1" has been created. Ask the user to answer it.'}
        isError
      />,
    );
    expect(container.querySelector('.tool-failure-card')).toBeNull();
  });

  it('未传 isError 时行为与改造前一致（不渲染失败卡）', () => {
    const { container } = render(<ToolOutputPreview toolName="write" output={AGENTIGNORE} />);
    expect(container.querySelector('.tool-failure-card')).toBeNull();
  });
});

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

  it('多选答案优先按「逗号+空格」切分', () => {
    // 网关用 `, ` 拼接多选答案。优先按它切分，可以避免「选项本身含逗号」被拆碎
    // ——那种情况在界面上表现为「选了一项却显示成两三项」。
    const items = extractQuestionAnswers('地点="北京, 上海, 广州"');
    expect(items?.[0]?.answers).toEqual(['北京', '上海', '广州']);
  });

  it('含逗号但无空格时无法判定边界，保持旧行为按裸逗号切分', () => {
    // 客户端只有这一串扁平文本，拿不到题目选项表，`a,b` 既可能是一个选项、也可能是
    // 两个。这里刻意不退化成「整体不切」（那会破坏真正的多选），维持旧行为；
    // 要彻底解决需要网关改为结构化返回。
    expect(extractQuestionAnswers('命令="git commit -m a,b"')?.[0]?.answers).toEqual([
      'git commit -m a',
      'b',
    ]);
  });

  it('没有「逗号+空格」时退回按裸逗号切分（兼容旧格式）', () => {
    expect(extractQuestionAnswers('Q="A,B"')?.[0]?.answers).toEqual(['A', 'B']);
  });

  it('空白答案不产生空条目', () => {
    expect(extractQuestionAnswers('Q=""')?.[0]?.answers).toEqual([]);
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

describe('ToolOutputPreview — recovery 瘦身截断徽标', () => {
  it('bash 输出里的截断标记被剥离，并渲染「内容已截断」徽标', () => {
    const truncatedStdout = `构建完成\n…[truncated, 4096 chars omitted]`;
    const { container } = render(
      <ToolOutputPreview
        toolName="bash"
        output={{ command: 'pnpm build', exitCode: 0, stdout: truncatedStdout, stderr: '' }}
      />,
    );
    const badge = container.querySelector('.tool-output-truncated-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('内容已截断');
    expect(badge!.textContent).toContain('4096');
    // 标记本身不能作为正文出现在终端面板里。
    expect(container.textContent).not.toContain('chars omitted');
    // 结构化信息仍需保留。
    expect(container.textContent).toContain('exit 0');
  });

  it('未被截断的输出不渲染徽标', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="bash"
        output={{ command: 'ls', exitCode: 0, stdout: 'file.txt', stderr: '' }}
      />,
    );
    expect(container.querySelector('.tool-output-truncated-badge')).toBeNull();
    expect(container.textContent).not.toContain('内容已截断');
  });

  it('裸字符串输出里的截断标记同样被识别', () => {
    const { container } = render(
      <ToolOutputPreview toolName="some_tool" output={'正文…[truncated, 12 chars omitted]'} />,
    );
    expect(container.querySelector('.tool-output-truncated-badge')).not.toBeNull();
    expect(container.textContent).not.toContain('chars omitted');
    expect(container.textContent).toContain('正文');
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

describe('lsp_diagnostics 走诊断列表', () => {
  it('对象 map 输出按文件分组渲染，而不是字段表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="lsp_diagnostics"
        output={{ 'src/a.ts': [{ message: 'boom', severity: 1, line: 3, column: 1 }] }}
      />,
    );

    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('src/a.ts');
    expect(container.textContent).toContain('3:1');
    expect(container.textContent).toContain('错误');
    expect(container.querySelector('.structured-output')).toBeNull();
  });

  it('空对象给出「没有诊断信息」', () => {
    const { container } = render(<ToolOutputPreview toolName="lsp_diagnostics" output={{}} />);

    expect(container.textContent).toContain('（没有诊断信息）');
  });
});

describe('LSP 位置 / 符号 / hover 的输出视图', () => {
  it('引用位置列表解析为多行位置', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="lsp_find_references"
        output={'/repo/src/a.ts:12:4\n/repo/src/b.ts:3:0'}
      />,
    );

    expect(container.textContent).toContain('a.ts');
    expect(container.textContent).toContain('12:4');
    expect(container.textContent).toContain('3:0');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('位置解析失败时回退文本（No references found）', () => {
    const { container } = render(
      <ToolOutputPreview toolName="lsp_find_references" output="No references found" />,
    );

    expect(container.textContent).toContain('No references found');
  });

  it('符号列表用入参 filePath 补全 document 模式', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="lsp_symbols"
        input={{ filePath: '/repo/src/a.ts' }}
        output={'ChatPage (kind 12) - line 10'}
      />,
    );

    expect(container.textContent).toContain('ChatPage');
    expect(container.textContent).toContain('函数');
  });

  it('hover 按 Markdown 渲染', () => {
    const { container } = render(<ToolOutputPreview toolName="lsp_hover" output={'**bold**'} />);

    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});

describe('task_create / update / get 复用任务卡', () => {
  it('task_create 的 { task } 包装渲染为单任务卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="task_create"
        output={{ task: { id: 't1', subject: '写测试', status: 'pending' }, reused: false }}
      />,
    );

    expect(container.querySelector('.task-list-preview')).not.toBeNull();
    expect(container.textContent).toContain('写测试');
    expect(container.querySelector('.structured-output')).toBeNull();
  });

  it('task_update 的成功返回同样走任务卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="task_update"
        output={{ task: { id: 't1', subject: 'A', status: 'completed' } }}
      />,
    );

    expect(container.querySelector('.task-list-preview')).not.toBeNull();
  });

  it('错误 / 版本冲突时回退通用字段表（不吞掉 error）', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="task_update"
        output={{
          error: 'revision_conflict',
          currentRevision: 3,
          task: { id: 't1', subject: 'A' },
        }}
      />,
    );

    expect(container.querySelector('.task-list-preview')).toBeNull();
    expect(container.textContent).toContain('revision_conflict');
  });

  it('task_get 的 { task: null } 不渲染空任务卡', () => {
    const { container } = render(<ToolOutputPreview toolName="task_get" output={{ task: null }} />);

    expect(container.querySelector('.task-list-preview')).toBeNull();
  });
});

describe('MCP LSP 工具复用 LSP 专用视图', () => {
  it('mcp__lsp__find_references 的文本块解析为位置列表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__find_references"
        output={{
          content: [{ type: 'text', text: '/repo/src/a.ts:12:4\n/repo/src/b.ts:3:0' }],
        }}
      />,
    );

    expect(container.textContent).toContain('a.ts');
    expect(container.textContent).toContain('12:4');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('mcp__lsp__diagnostics 的 JSON 文本还原为按文件分组诊断', () => {
    const payload = JSON.stringify({
      'src/a.ts': [{ message: 'boom', severity: 1, line: 3, column: 1 }],
    });

    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__diagnostics"
        output={{ content: [{ type: 'text', text: payload }] }}
      />,
    );

    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('3:1');
    expect(container.querySelector('.structured-output')).toBeNull();
  });

  it('legacy mcp_call + serverId=lsp 的 symbols 复用符号列表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp_call"
        input={{
          serverId: 'lsp',
          toolName: 'symbols',
          arguments: { filePath: '/repo/src/a.ts' },
        }}
        output={{ content: [{ type: 'text', text: 'ChatPage (kind 12) - line 10' }] }}
      />,
    );

    expect(container.textContent).toContain('ChatPage');
    expect(container.textContent).toContain('函数');
    expect(container.textContent).toContain('line 10');
  });

  it('非 lsp 的 MCP 工具仍走通用 MCP 预览', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__github__create_issue"
        output={{ content: [{ type: 'text', text: 'created #1' }] }}
      />,
    );

    expect(container.textContent).toContain('created #1');
    expect(container.querySelector('.task-list-preview')).toBeNull();
  });
});

describe('session_list / session_info 的文本输出还原为卡片', () => {
  const table = [
    '| Session ID | Messages | First | Last | Status | Title |',
    '| --- | --- | --- | --- | --- | --- |',
    '| ses_a | 12 | 2026-10-01T00:00:00.000Z | 2026-10-02T00:00:00.000Z | active | 修复登录 |',
    '| ses_b | 3 | 2026-10-03T00:00:00.000Z | 2026-10-03T01:00:00.000Z | completed | 重构 diff |',
  ].join('\n');

  it('session_list 的 Markdown 表格渲染为会话卡', () => {
    const { container } = render(<ToolOutputPreview toolName="session_list" output={table} />);

    expect(container.querySelector('.session-list-preview')).not.toBeNull();
    expect(container.textContent).toContain('共 2 个会话');
    expect(container.textContent).toContain('修复登录');
    expect(container.textContent).toContain('12 条消息');
  });

  it('session_list 空表给出空态', () => {
    const { container } = render(
      <ToolOutputPreview toolName="session_list" output="No sessions found." />,
    );

    expect(container.textContent).toContain('没有会话');
  });

  it('session_info 的 Key: Value 渲染为详情卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="session_info"
        output={'Session ID: ses_a\nMessages: 12\nStatus: active\nHas Todos: Yes (3 items)'}
      />,
    );

    expect(container.querySelector('[data-testid="session-info-preview"]')).not.toBeNull();
    expect(container.textContent).toContain('消息数');
    expect(container.textContent).toContain('待办');
  });

  it('无法解析时回退原文本（不吞内容）', () => {
    const { container } = render(
      <ToolOutputPreview toolName="session_info" output="unexpected output" />,
    );

    expect(container.textContent).toContain('unexpected output');
  });
});

describe('确认型工具（会话重命名 / 移动 / LSP touch）', () => {
  it('session_rename 成功显示确认行 + 新标题', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="session_rename"
        output={{ ok: true, sessionID: 'ses_a', title: '修复登录' }}
      />,
    );

    expect(container.querySelector('.tool-call-confirm')).not.toBeNull();
    expect(container.textContent).toContain('已重命名了会话');
    expect(container.textContent).toContain('修复登录');
  });

  it('session_move 失败回退字段表（错误原因可见）', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="session_move"
        output={{ ok: false, error: '目标会话不存在。' }}
      />,
    );

    expect(container.querySelector('.tool-call-confirm')).toBeNull();
    expect(container.textContent).toContain('目标会话不存在');
  });

  it('lsp_touch 成功显示确认行', () => {
    const { container } = render(<ToolOutputPreview toolName="lsp_touch" output={{ ok: true }} />);

    expect(container.querySelector('.tool-call-confirm')).not.toBeNull();
    expect(container.textContent).toContain('已同步 LSP 文件状态');
  });
});

describe('ast_grep 结果结构化', () => {
  const output = [
    '找到 2 处匹配：',
    '',
    'src/a.ts:12:5',
    'const a = 1;',
    '',
    'src/b.ts:40:1',
    'const b = 2;',
  ].join('\n');

  it('ast_grep_search 的文本结果解析为匹配列表', () => {
    const { container } = render(<ToolOutputPreview toolName="ast_grep_search" output={output} />);

    expect(container.querySelectorAll('[data-ast-grep-match]')).toHaveLength(2);
    expect(container.textContent).toContain('12:5');
    expect(container.textContent).toContain('const a = 1;');
  });

  it('未找到匹配时给出空态而不是原始文本', () => {
    const { container } = render(
      <ToolOutputPreview toolName="ast_grep_search" output="未找到匹配。" />,
    );

    expect(container.textContent).toContain('（未找到匹配）');
  });

  it('ast_grep_replace 的空结果回退原文（保留「无任何替换被应用」）', () => {
    const { container } = render(
      <ToolOutputPreview toolName="ast_grep_replace" output="无任何替换被应用。" />,
    );

    expect(container.textContent).toContain('无任何替换被应用');
  });
});

describe('lsp_call_hierarchy 走层次视图', () => {
  const output = [
    'Symbol: run - /repo/src/a.ts:12:4',
    '',
    'Incoming calls:',
    '  caller - /repo/src/b.ts:8:2',
    '',
    'Outgoing calls:',
    'No outgoing calls found',
  ].join('\n');

  it('内置 lsp_call_hierarchy 渲染为两组列表', () => {
    const { container } = render(
      <ToolOutputPreview toolName="lsp_call_hierarchy" output={output} />,
    );

    expect(container.textContent).toContain('↑ 调用方（1）');
    expect(container.textContent).toContain('caller');
    expect(container.textContent).toContain('没有调用其它符号');
  });

  it('MCP 通道的 call_hierarchy 复用同一视图', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__call_hierarchy"
        output={{ content: [{ type: 'text', text: output }] }}
      />,
    );

    expect(container.textContent).toContain('↑ 调用方（1）');
    // 仍应是层次视图，而不是把 MCP 文本原样铺开。
    expect(container.textContent).not.toContain('Incoming calls:');
  });

  it('无法解析时回退原文本', () => {
    const { container } = render(
      <ToolOutputPreview toolName="lsp_call_hierarchy" output="No call hierarchy found" />,
    );

    expect(container.textContent).toContain('No call hierarchy found');
  });
});

describe('extract_media_info / codesearch 专用渲染', () => {
  it('媒体信息 JSON 渲染为信息卡（不再是字段表）', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="extract_media_info"
        output={JSON.stringify({
          success: true,
          type: 'video',
          duration: 754,
          width: 1920,
          height: 1080,
          videoCodec: 'h264',
        })}
      />,
    );

    expect(container.textContent).toContain('12:34');
    expect(container.textContent).toContain('1920×1080');
    expect(container.textContent).toContain('h264');
    expect(container.querySelector('.structured-output')).toBeNull();
  });

  it('媒体信息失败时回退字段表（错误可见）', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="extract_media_info"
        output={{ success: false, error: 'ffprobe not found' }}
      />,
    );

    expect(container.textContent).toContain('ffprobe not found');
    expect(container.querySelector('.structured-output')).not.toBeNull();
  });

  it('codesearch 的 Markdown 片段按 Markdown 渲染', () => {
    const { container } = render(
      <ToolOutputPreview toolName="codesearch" output={'```ts\nconst a = 1;\n```'} />,
    );

    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1;');
  });
});

describe('session_search / prepare_rename / MCP touch 的专用渲染', () => {
  it('session_search 渲染为匹配列表', () => {
    const output = [
      'Found 1 matches:',
      '',
      '[ses_a] Message msg_1 (user)',
      '包含 build pipeline 的片段',
    ].join('\n');

    const { container } = render(<ToolOutputPreview toolName="session_search" output={output} />);

    expect(container.textContent).toContain('找到 1 条匹配');
    expect(container.textContent).toContain('包含 build pipeline 的片段');
  });

  it('lsp_prepare_rename 渲染为可重命名判定', () => {
    const { container } = render(
      <ToolOutputPreview toolName="lsp_prepare_rename" output="Rename available at 12:5-12:9" />,
    );

    expect(container.textContent).toContain('可重命名');
    expect(container.textContent).toContain('12:5-12:9');
  });

  it('MCP 通道的 touch 成功显示确认行', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__touch"
        output={{ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }}
      />,
    );

    expect(container.querySelector('.tool-call-confirm')).not.toBeNull();
    expect(container.textContent).toContain('已同步 LSP 文件状态');
  });

  it('MCP 通道的 prepare_rename 复用同一判定视图', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__prepare_rename"
        output={{ content: [{ type: 'text', text: 'Cannot rename at this position' }] }}
      />,
    );

    expect(container.textContent).toContain('不可重命名');
  });
});
