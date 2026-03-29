import { describe, expect, it } from 'vitest';
import { resolveToolCallCardDisplayData } from './ToolCallCard.js';

describe('resolveToolCallCardDisplayData', () => {
  it('builds enriched display data for subagent task payloads', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'task',
      input: {
        command: '对子代理能力做最小测试，不修改代码',
        description: '创建一个子代理会话，执行只读检查并返回结果',
        prompt:
          '你是一个只读子代理。请在当前工作区执行最小化测试以验证子代理可用性：1）简要确认你能访问工作区；2）列出仓库根目录下前10个条目；3）不要修改任何文件；4）返回一段简短结论，说明子代理对话与只读工具调用是否正常。',
        subagent_type: 'general',
        task_id: 'subagent-readonly-test',
      },
      output: {
        taskId: 'task-readonly-check',
        sessionId: 'session-child-1',
        status: 'pending',
      },
    });

    expect(displayData.displayToolName).toBe('子代理任务');
    expect(displayData.toolKind).toBe('agent');
    expect(displayData.summary).toContain('general');
    expect(displayData.summary).toContain('只读');
    expect(displayData.summary).toContain('待执行');
    expect(displayData.summary).toContain('对子代理能力做最小测试，不修改代码');
    expect(displayData.showInputField).toBe(false);
    expect(displayData.hasDetails).toBe(true);
    expect(displayData.taskSummary).toMatchObject({
      title: '对子代理能力做最小测试，不修改代码',
      subtitle: '创建一个子代理会话，执行只读检查并返回结果',
      footer: '任务 task-rea…heck · 会话 session-child-1',
    });
    expect(displayData.taskSummary?.preview).toContain('你是一个只读子代理');
    expect(displayData.taskMeta).toMatchObject({
      agentType: 'general',
      requestedTaskId: 'subagent-readonly-test',
      outputTaskId: 'task-readonly-check',
      outputSessionId: 'session-child-1',
      outputStatus: 'pending',
      readonly: true,
    });
  });

  it('keeps approval text as structured extra output for paused task cards', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'task',
      input: {
        prompt: 'inspect workspace',
      },
      output: 'waiting for approval',
    });

    expect(displayData.displayToolName).toBe('子代理任务');
    expect(displayData.taskMeta?.extraOutput).toBe('waiting for approval');
    expect(displayData.showInputField).toBe(false);
    expect(displayData.hasDetails).toBe(true);
    expect(displayData.taskSummary?.title).toBe('inspect workspace');
  });

  it('keeps generic tools with subagent_type from being misclassified as task cards', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'bash',
      input: {
        command: 'pnpm test',
        subagent_type: 'general',
      },
    });

    expect(displayData.displayToolName).toBe('bash');
    expect(displayData.taskMeta).toBeUndefined();
    expect(displayData.toolKind).toBe('tool');
    expect(displayData.showInputField).toBe(true);
  });

  it('keeps raw input visible when task payload contains extra fields', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'task',
      input: {
        prompt: 'inspect workspace',
        subagent_type: 'general',
        priority: 'high',
      },
      output: {
        taskId: 'task-extra-fields',
        sessionId: 'child-session-2',
        status: 'pending',
      },
    });

    expect(displayData.displayToolName).toBe('子代理任务');
    expect(displayData.taskMeta?.hasAdditionalInputFields).toBe(true);
    expect(displayData.showInputField).toBe(true);
    expect(displayData.taskSummary?.footer).toBe('任务 task-extra-fields · 会话 child-session-2');
  });

  it('falls back to the raw child-task status text when status is unknown', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'task',
      input: {
        prompt: 'inspect workspace',
      },
      output: {
        taskId: 'task-queued',
        sessionId: 'child-session-3',
        status: 'queued',
      },
    });

    expect(displayData.summary).toContain('queued');
    expect(displayData.taskMeta?.outputStatus).toBe('queued');
  });

  it('keeps generic tool summaries untouched', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'bash',
      input: {
        command: 'pnpm test',
      },
    });

    expect(displayData.displayToolName).toBe('bash');
    expect(displayData.summary).toBe('pnpm test');
    expect(displayData.taskMeta).toBeUndefined();
    expect(displayData.toolKind).toBe('tool');
  });

  it('formats read summaries with path window parameters only', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'read',
      input: {
        filePath:
          '/home/await/project/OpenAWork/apps/web/src/pages/settings/workspace-tab-content.tsx',
        offset: 340,
        limit: 30,
      },
      output: '不应该出现在折叠摘要里',
    });

    expect(displayData.summary).toBe(
      'apps/web/src/pages/settings/workspace-tab-content.tsx [offset=340, limit=30]',
    );
  });

  it('adds read_tool_output hints for large outputs with a toolCallId', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolCallId: 'call-large-ui',
      toolName: 'bash',
      input: {
        command: 'cat huge.log',
      },
      output: 'line\n'.repeat(3000),
    });

    expect(displayData.outputReadHints).toEqual([
      'read_tool_output {"useLatestReferenced":true,"lineStart":1,"lineCount":200}',
      'read_tool_output {"toolCallId":"call-large-ui","lineStart":1,"lineCount":200}',
      'read_tool_output {"toolCallId":"call-large-ui","lineStart":201,"lineCount":200}',
    ]);
  });

  it('adds latest-reference shortcut hints even without a toolCallId', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'bash',
      input: {
        command: 'cat huge.log',
      },
      output: 'line\n'.repeat(3000),
    });

    expect(displayData.outputReadHints).toEqual([
      'read_tool_output {"useLatestReferenced":true,"lineStart":1,"lineCount":200}',
      'read_tool_output {"useLatestReferenced":true,"lineStart":201,"lineCount":200}',
    ]);
  });

  it('detects unified diff outputs and exposes side-by-side diff view data', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'workspace_review_diff',
      input: {
        filePath: 'src/example.ts',
      },
      output: {
        filePath: 'src/example.ts',
        diff: '@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;',
      },
    });

    expect(displayData.diffView).toMatchObject({
      filePath: 'src/example.ts',
    });
    expect(displayData.summary).toContain('example.ts');
    expect(displayData.summary).toContain('+2 / -1');
  });

  it('detects before/after snapshot outputs for write-like tools', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'write',
      input: {
        path: 'src/example.ts',
      },
      output: {
        path: 'src/example.ts',
        before: 'const a = 1;\nconst b = 2;',
        after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
      },
    });

    expect(displayData.diffView).toMatchObject({
      filePath: 'src/example.ts',
      beforeText: 'const a = 1;\nconst b = 2;',
      afterText: 'const a = 1;\nconst b = 3;\nconst c = 4;',
    });
    expect(displayData.summary).toContain('example.ts');
    expect(displayData.summary).toContain('+2 / -1');
  });

  it('detects opencode-style filediff metadata outputs', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'edit',
      input: {
        filePath: 'src/example.ts',
      },
      output: {
        success: true,
        path: 'src/example.ts',
        filediff: {
          file: 'src/example.ts',
          before: 'const a = 1;\nconst b = 2;',
          after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
          additions: 2,
          deletions: 1,
          status: 'modified',
        },
      },
    });

    expect(displayData.diffView).toMatchObject({
      filePath: 'src/example.ts',
      beforeText: 'const a = 1;\nconst b = 2;',
      afterText: 'const a = 1;\nconst b = 3;\nconst c = 4;',
    });
    expect(displayData.summary).toContain('+2 / -1');
  });

  it('detects multi-file apply_patch outputs and builds a file switcher view', () => {
    const displayData = resolveToolCallCardDisplayData({
      toolName: 'apply_patch',
      input: {
        patchText: '*** Begin Patch',
      },
      output: {
        files: [
          {
            path: 'src/example.ts',
            before: 'const a = 1;\nconst b = 2;',
            after: 'const a = 1;\nconst b = 3;\nconst c = 4;',
            additions: 2,
            deletions: 1,
            status: 'modified',
          },
          {
            path: 'src/feature.ts',
            before: '',
            after: 'export const feature = true;',
            additions: 1,
            deletions: 0,
            status: 'added',
          },
        ],
      },
    });

    expect(displayData.diffView?.files).toHaveLength(2);
    expect(displayData.diffView?.files?.[0]).toMatchObject({
      filePath: 'src/example.ts',
      status: 'modified',
    });
    expect(displayData.diffView?.files?.[1]).toMatchObject({
      filePath: 'src/feature.ts',
      status: 'added',
    });
    expect(displayData.summary).toContain('2 个文件');
  });
});
