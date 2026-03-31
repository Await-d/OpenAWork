import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolCallCard } from '@openAwork/shared-ui';

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
    expect(html).not.toContain(
      'data-tool-card-meta-label="warning" style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px',
    );
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
    expect(html).not.toContain(
      'data-tool-card-meta-label="danger" style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px',
    );
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
});
