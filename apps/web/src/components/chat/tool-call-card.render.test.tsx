import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallCard } from '@openAwork/shared-ui';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

describe('ToolCallCard rendering', () => {
  it('renders tool status separately from child-task status on task summary cards', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="task"
        status="completed"
        input={{
          command: '对子代理能力做最小测试，不修改代码',
          description: '创建一个子代理会话，执行只读检查并返回结果',
          prompt: '你是一个只读子代理。请仅做检查，不要修改工作区。',
          subagent_type: 'general',
        }}
        output={{
          taskId: 'task-render-check',
          sessionId: 'session-render-1',
          status: 'pending',
        }}
      />,
    );

    expect(html).toContain('工具状态');
    expect(html).toContain('完成');
    expect(html).toContain('子任务 · 待执行');
    expect(html).toContain('只读');
    expect(html).toContain('data-tool-card-meta-label="muted"');
    expect(html).toContain('data-tool-card-meta-label="success"');
    expect(html).toContain('data-tool-card-meta-label="warning"');
    expect(html).toContain('创建一个子代理会话，执行只读检查并返回结果');
    expect(html).toContain('复制');
  });

  it('renders failed child-task status with explicit task-state label', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="task"
        status="completed"
        input={{
          prompt: 'inspect workspace',
          subagent_type: 'general',
        }}
        output={{
          taskId: 'task-failed-render',
          sessionId: 'session-render-2',
          status: 'failed',
        }}
      />,
    );

    expect(html).toContain('工具状态');
    expect(html).toContain('子任务 · 失败');
    expect(html).toContain('data-tool-card-meta-label="danger"');
  });

  it('renders read_tool_output suggestions for large tool outputs', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolCallId="call-large-ui"
        toolName="bash"
        input={{ command: 'cat huge.log' }}
        output={'line\n'.repeat(3000)}
        status="completed"
      />,
    );

    expect(html).toContain('cat huge.log');
    expect(html).not.toContain('继续读取：');
    expect(html).not.toContain('输出：');
    expect(html).toContain('复制');
  });

  it('renders an inline diff view for workspace review tool outputs', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="workspace_review_diff"
        input={{ filePath: 'src/example.ts' }}
        output={{
          filePath: 'src/example.ts',
          diff: '@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;',
        }}
        status="completed"
      />,
    );

    expect(html).toContain('example.ts');
    expect(html).toContain('+2 / -1');
    expect(html).toContain('旧');
    expect(html).toContain('新');
    expect(html).not.toContain('&quot;diff&quot;');
  });

  it('renders write-style before/after outputs as side-by-side diff summaries', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="write"
        input={{ path: 'src/example.ts' }}
        output={{
          path: 'src/example.ts',
          before: 'const a = 1;\nconst b = 2;',
          after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
        }}
        status="completed"
      />,
    );

    expect(html).toContain('example.ts');
    expect(html).toContain('+2 / -1');
    expect(html).toContain('旧');
    expect(html).toContain('新');
    expect(html).not.toContain('&quot;before&quot;');
  });

  it('renders localized Claude-first tool labels and question waiting state', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="AskUserQuestion"
        status="paused"
        input={{
          questions: [
            {
              question: '请选择继续方式',
              header: '执行策略',
              options: [
                { label: '继续', description: '继续执行' },
                { label: '暂停', description: '暂停执行' },
              ],
            },
          ],
        }}
        output="waiting for answer"
      />,
    );

    expect(html).toContain('询问用户');
    expect(html).toContain('执行策略');
    expect(html).toContain('等待回答');
  });

  it('renders plan mode approval cards with localized labels', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="ExitPlanMode"
        status="paused"
        input={{
          plan: '1. 查看能力\n2. 开始实现',
          allowedPrompts: [{ tool: 'Bash', prompt: 'pnpm test' }],
        }}
        output="waiting for approval"
      />,
    );

    expect(html).toContain('退出规划模式');
    expect(html).toContain('提交计划审批');
    expect(html).toContain('等待确认');
  });

  it('renders approval-resumed failures with explicit recovery wording', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="failed"
        isError={true}
        resumedAfterApproval={true}
        input={{ command: 'find . | head -20' }}
        output={{
          stderr: 'bash command cannot contain shell chaining, piping, or redirection operators',
        }}
      />,
    );

    expect(html).toContain('审批后恢复');
    expect(html).toContain('恢复后失败');
  });

  it('renders bash results inside a terminal-styled preview block', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'pwd' }}
        output={{
          command: 'pwd',
          cwd: '/tmp/demo',
          exitCode: 0,
          stdout: '/tmp/demo\n',
          stderr: '',
        }}
      />,
    );

    expect(html).toContain('data-tool-card-bash-terminal="true"');
    expect(html).toContain('data-tool-card-terminal-header="true"');
    expect(html).toContain('data-tool-card-terminal-output-panel="true"');
    expect(html).toContain('Terminal');
    expect(html).toContain('exit 0');
    expect(html).toContain('output');
    expect(html).toContain('/tmp/demo');
    expect(html).toContain('pwd');
  });

  it('renders stdout and stderr as distinct terminal streams with truncation hints', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'cat combined.log' }}
        output={{
          command: 'cat combined.log',
          cwd: '/tmp/demo',
          exitCode: 1,
          stdout: 'stdout line\n'.repeat(24),
          stderr: 'stderr line\n'.repeat(22),
        }}
      />,
    );

    expect(html).toContain('data-tool-card-terminal-stream="stdout"');
    expect(html).toContain('data-tool-card-terminal-stream="stderr"');
    expect(html).toContain('data-tool-card-bash-copy="true"');
    expect(html).toContain('data-tool-card-terminal-truncation="stdout"');
    expect(html).toContain('data-tool-card-terminal-truncation="stderr"');
    expect(html).toContain('data-tool-card-bash-error-summary="true"');
    expect(html).toContain('命令执行失败');
    expect(html).toContain('退出码 1');
    expect(html).toContain('stderr 23 行');
    expect(html).toContain('已折叠 25 行输出');
    expect(html).toContain('已折叠 23 行输出');
  });

  it('renders ANSI-colored output and shell prompt highlighting inside terminal streams', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'npm test' }}
        output={{
          command: 'npm test',
          cwd: '/tmp/demo',
          exitCode: 1,
          stdout: '$ npm test\n\u001b[32mPASS\u001b[0m src/example.test.ts',
          stderr: '\u001b[31mFAIL\u001b[0m src/failure.test.ts',
        }}
      />,
    );

    expect(html).toContain('data-tool-card-terminal-prompt="true"');
    expect(html).toContain('data-tool-card-ansi="true"');
    expect(html).toContain('PASS');
    expect(html).toContain('FAIL');
  });

  it('renders clickable URLs and highlighted file paths inside terminal output', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'cat links.log' }}
        output={{
          command: 'cat links.log',
          cwd: '/tmp/demo',
          exitCode: 0,
          stdout:
            'Open https://example.com/docs and inspect /tmp/demo/output.log or src/example.ts for details',
          stderr: '',
        }}
      />,
    );

    expect(html).toContain('data-tool-card-terminal-url="true"');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('data-tool-card-terminal-path="true"');
    expect(html).toContain('/tmp/demo/output.log');
    expect(html).toContain('src/example.ts');
  });

  it('renders OpenCowork-style shell summary badges for structured bash results', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'pnpm test' }}
        output={{
          command: 'pnpm test',
          cwd: '/tmp/demo',
          exitCode: 0,
          processId: 'proc-123',
          stdout: 'PASS suite\n',
          summary: {
            live: true,
            totalLines: 42,
            totalChars: 2048,
            errorLikeLines: 1,
            warningLikeLines: 2,
          },
        }}
      />,
    );

    expect(html).toContain('data-tool-card-bash-shell-summary="true"');
    expect(html).toContain('pid proc-123');
    expect(html).toContain('live');
    expect(html).toContain('42 行');
    expect(html).toContain('2048 chars');
    expect(html).toContain('1 error-like');
    expect(html).toContain('2 warning-like');
  });

  it('allows expanding and collapsing long stdout output after opening the tool card', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ToolCallCard
          toolName="bash"
          status="completed"
          input={{ command: 'cat huge.log' }}
          output={{
            command: 'cat huge.log',
            cwd: '/tmp/demo',
            exitCode: 0,
            stdout: `${'line output payload '.repeat(90)}tail marker`,
            stderr: '',
          }}
        />,
      );
    });

    const toggle = container.querySelector('[data-tool-card-toggle="true"]');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const expandButton = container.querySelector('[data-tool-card-terminal-show-all="true"]');
    const copyButton = container.querySelector('[data-tool-card-bash-copy="true"]');
    expect(expandButton?.textContent).toContain('显示全部');
    expect(copyButton?.textContent).toContain('复制');
    expect(container.textContent).not.toContain('tail marker');

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('tail marker');
    expect(expandButton?.textContent).toContain('显示较少');

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('tail marker');
  });

  it('defaults stderr to expanded when the command failed', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ToolCallCard
          toolName="bash"
          status="completed"
          input={{ command: 'cat huge-error.log' }}
          output={{
            command: 'cat huge-error.log',
            cwd: '/tmp/demo',
            exitCode: 1,
            stdout: 'ok\n'.repeat(4),
            stderr: `${'error line\n'.repeat(30)}fatal marker`,
          }}
        />,
      );
    });

    const toggle = container.querySelector('[data-tool-card-toggle="true"]');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('fatal marker');
  });

  it('renders OpenCowork-style shell summary badges for structured bash results', () => {
    const html = renderToStaticMarkup(
      <ToolCallCard
        toolName="bash"
        status="completed"
        input={{ command: 'pnpm test' }}
        output={{
          command: 'pnpm test',
          cwd: '/tmp/demo',
          exitCode: 0,
          processId: 'proc-123',
          stdout: 'PASS suite\n',
          summary: {
            live: true,
            mode: 'tail',
            totalLines: 42,
            totalChars: 2048,
            errorLikeLines: 1,
            warningLikeLines: 2,
          },
        }}
      />,
    );

    expect(html).toContain('data-tool-card-bash-shell-summary="true"');
    expect(html).toContain('pid proc-123');
    expect(html).toContain('live');
    expect(html).toContain('tail');
    expect(html).toContain('42 行');
    expect(html).toContain('2048 chars');
    expect(html).toContain('1 error-like');
    expect(html).toContain('2 warning-like');
  });

  it('shows fewer and all output using the shell-level toggle', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ToolCallCard
          toolName="bash"
          status="completed"
          input={{ command: 'cat split.log' }}
          output={{
            command: 'cat split.log',
            cwd: '/tmp/demo',
            exitCode: 1,
            stdout: `${'stdout line payload '.repeat(90)}stdout marker`,
            stderr: `${'stderr line payload '.repeat(90)}stderr marker`,
          }}
        />,
      );
    });
    const host = container!;

    const toggle = host.querySelector('[data-tool-card-toggle="true"]');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).not.toContain('stdout marker');
    act(() => {
      host
        .querySelector('[data-tool-card-terminal-show-all="true"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(host.textContent).toContain('stdout marker');
    expect(host.textContent).toContain('stderr marker');
  });
});
