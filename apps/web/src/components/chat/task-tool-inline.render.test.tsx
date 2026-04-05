// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  renderChatMessageContent,
  renderChatMessageContentWithOptions,
  renderStreamingChatMessageContent,
} from './ChatPageSections.js';
import { TaskToolInline } from './task-tool-inline.js';
import { createAssistantTraceContent, type ChatMessage } from '../../pages/chat-page/support.js';
import { buildTaskToolRuntimeLookup } from '../../pages/chat-page/task-tool-runtime.js';

describe('chat task tool rendering', () => {
  it('renders task tool calls as inline subagent rows instead of shared tool cards', () => {
    const message: ChatMessage = {
      id: 'msg-task-inline',
      role: 'assistant',
      content: JSON.stringify({
        type: 'tool_call',
        payload: {
          toolName: 'task',
          input: {
            description: '创建一个子代理会话，执行只读检查并返回结果',
            prompt: '你是一个只读子代理。请仅做检查，不要修改工作区。',
            subagent_type: 'general',
          },
          output: {
            taskId: 'task-render-check',
            sessionId: 'session-render-1',
            status: 'pending',
          },
          status: 'completed',
        },
      }),
    };

    const html = renderToStaticMarkup(<>{renderChatMessageContent(message)}</>);

    expect(html).toContain('data-chat-task-inline="true"');
    expect(html).toContain('data-chat-task-inline-detail="true"');
    expect(html).toContain('data-clickable="false"');
    expect(html).toContain('data-chat-task-inline-kind-icon="agent"');
    expect(html).toContain('data-chat-task-inline-meta-label="info"');
    expect(html).not.toContain('border-radius:999px');
    expect(html).toContain('aria-label="子代理工具"');
    expect(html).toContain('子任务待执行');
    expect(html).toContain('创建一个子代理会话，执行只读检查并返回结果');
    expect(html).toContain('会话 session-render-1');
    expect(html).not.toContain('data-tool-card-root');
    expect(html).not.toContain('工具状态');
    expect(html).not.toContain('复制');
  });

  it('renders task tool calls inside assistant_trace with the same inline style', () => {
    const html = renderToStaticMarkup(
      <>
        {renderStreamingChatMessageContent(
          createAssistantTraceContent({
            text: '',
            toolCalls: [
              {
                toolName: 'task',
                input: {
                  prompt: 'inspect workspace',
                  subagent_type: 'explore',
                },
                output: {
                  taskId: 'task-trace-check',
                  sessionId: 'session-trace-1',
                  status: 'failed',
                },
                status: 'failed',
              },
            ],
          }),
        )}
      </>,
    );

    expect(html).toContain('data-chat-task-inline="true"');
    expect(html).toContain('data-chat-task-inline-kind-icon="agent"');
    expect(html).toContain('data-chat-task-inline-meta-label="info"');
    expect(html).not.toContain('border-radius:999px');
    expect(html).toContain('explore');
    expect(html).toContain('子任务失败');
    expect(html).not.toContain('data-tool-card-root');
  });

  it('opens the dedicated child-session inspector when clicking an inline task row', async () => {
    const calls: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    flushSync(() => {
      root.render(
        <TaskToolInline
          toolName="task"
          input={{
            prompt: 'inspect workspace',
            subagent_type: 'general',
          }}
          output={{
            taskId: 'task-click-check',
            sessionId: 'session-click-1',
            status: 'completed',
          }}
          status="completed"
          onOpenChildSession={(sessionId) => {
            calls.push(sessionId);
          }}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('[data-chat-task-inline="true"]');
    const detail = container.querySelector('[data-chat-task-inline-detail="true"]');
    expect(trigger).not.toBeNull();
    expect(detail).not.toBeNull();
    expect(trigger?.getAttribute('data-clickable')).toBe('true');
    expect(container.textContent).toContain('点击查看');

    trigger?.click();

    expect(calls).toEqual(['session-click-1']);

    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps non-task tool calls on the shared ToolCallCard path', () => {
    const message: ChatMessage = {
      id: 'msg-bash-card',
      role: 'assistant',
      content: JSON.stringify({
        type: 'tool_call',
        payload: {
          toolName: 'bash',
          input: { command: 'pnpm test' },
          output: 'ok',
          status: 'completed',
        },
      }),
    };

    const html = renderToStaticMarkup(<>{renderChatMessageContent(message)}</>);

    expect(html).toContain('data-tool-card-root="true"');
    expect(html).not.toContain('data-chat-task-inline="true"');
    expect(html).toContain('bash');
  });

  it('renders copied tool card text as a tool card instead of raw markdown', () => {
    const message: ChatMessage = {
      id: 'msg-copied-todowrite',
      role: 'assistant',
      content: `工具：todowrite
类型：TOOL
状态：完成
摘要：2 项主待办

输入
{
  "todos": [
    {
      "content": "Inspect repository architecture using child agent(s)",
      "priority": "high",
      "status": "in_progress"
    }
  ]
}

输出
{
  "title": "2 main todos"
}`,
    };

    const html = renderToStaticMarkup(<>{renderChatMessageContent(message)}</>);

    expect(html).toContain('data-tool-card-root="true"');
    expect(html).toContain('todowrite');
    expect(html).toContain('1 项主待办');
    expect(html).toContain('完成');
    expect(html).not.toContain('摘要：2 项主待办');
  });

  it('renders copied temporary todo cards with temporary-lane summaries', () => {
    const message: ChatMessage = {
      id: 'msg-copied-subtodowrite',
      role: 'assistant',
      content: `工具：subtodowrite
类型：TOOL
状态：完成
摘要：1 项临时待办

输入
{
  "todos": [
    {
      "content": "Record a follow-up for the temporary lane",
      "priority": "low",
      "status": "pending"
    }
  ]
}

输出
{
  "title": "1 temporary todo"
}`,
    };

    const html = renderToStaticMarkup(<>{renderChatMessageContent(message)}</>);

    expect(html).toContain('data-tool-card-root="true"');
    expect(html).toContain('subtodowrite');
    expect(html).toContain('1 项临时待办');
    expect(html).toContain('完成');
    expect(html).not.toContain('摘要：1 项临时待办');
  });

  it('renders copied todo cards when the output title is localized in chinese', () => {
    const message: ChatMessage = {
      id: 'msg-copied-todowrite-zh-title',
      role: 'assistant',
      content: `工具：todowrite
类型：TOOL
状态：完成
摘要：1 项主待办

输入
{
  "todos": [
    {
      "content": "整理主计划",
      "priority": "high",
      "status": "in_progress"
    }
  ]
}

输出
{
  "title": "1 项主待办"
}`,
    };

    const html = renderToStaticMarkup(<>{renderChatMessageContent(message)}</>);

    expect(html).toContain('data-tool-card-root="true"');
    expect(html).toContain('todowrite');
    expect(html).toContain('1 项主待办');
    expect(html).toContain('完成');
    expect(html).not.toContain('摘要：1 项主待办');
  });

  it('renders mixed assistant_trace payloads with both inline task and normal tool card branches', () => {
    const html = renderToStaticMarkup(
      <>
        {renderStreamingChatMessageContent(
          createAssistantTraceContent({
            text: '',
            toolCalls: [
              {
                toolName: 'task',
                input: {
                  prompt: 'inspect workspace',
                  subagent_type: 'explore',
                },
                output: {
                  taskId: 'task-mixed-check',
                  sessionId: 'session-mixed-1',
                  status: 'pending',
                },
                status: 'running',
              },
              {
                toolName: 'bash',
                input: {
                  command: 'pnpm test',
                },
                output: 'done',
                status: 'completed',
              },
            ],
          }),
        )}
      </>,
    );

    expect(html).toContain('data-chat-task-inline="true"');
    expect(html).toContain('data-tool-card-root="true"');
    expect(html).toContain('data-chat-task-inline-meta-label="info"');
    expect(html).toContain('工具执行中');
    expect(html).toContain('explore');
    expect(html).toContain('pnpm test');
  });

  it('renders modified file summaries embedded in assistant_trace payloads', () => {
    const html = renderToStaticMarkup(
      <>
        {renderStreamingChatMessageContent(
          createAssistantTraceContent({
            text: '已经完成本轮修改。',
            modifiedFilesSummary: {
              type: 'modified_files_summary',
              title: '本轮共更新 2 个文件',
              summary: '新增客户端接口，并把聊天里的文件摘要真正展示出来。',
              files: [
                {
                  file: 'packages/web-client/src/sessions.ts',
                  before: 'old',
                  after: 'new',
                  additions: 12,
                  deletions: 2,
                  status: 'modified',
                  sourceKind: 'structured_tool_diff',
                  guaranteeLevel: 'strong',
                },
                {
                  file: 'apps/web/src/components/chat/ChatPageSections.tsx',
                  before: 'old',
                  after: 'new',
                  additions: 4,
                  deletions: 0,
                  status: 'modified',
                  sourceKind: 'workspace_reconcile',
                  guaranteeLevel: 'weak',
                },
              ],
            },
            toolCalls: [],
          }),
        )}
      </>,
    );

    expect(html).toContain('data-chat-modified-summary="true"');
    expect(html).toContain('本轮共更新 2 个文件');
    expect(html).toContain('packages/web-client/src/sessions.ts');
    expect(html).toContain('新增客户端接口，并把聊天里的文件摘要真正展示出来。');
    expect(html).toContain('+16');
    expect(html).toContain('-2');
  });

  it('overlays runtime task state and summary onto task tool rows', () => {
    const message: ChatMessage = {
      id: 'msg-task-runtime',
      role: 'assistant',
      content: JSON.stringify({
        type: 'tool_call',
        payload: {
          toolName: 'task',
          input: {
            description: 'MCP 文档检索',
            prompt: '检查 MCP 文档并给出结论',
            subagent_type: 'librarian',
          },
          output: {
            taskId: 'task-runtime-check',
            sessionId: 'session-runtime-1',
            status: 'running',
          },
          status: 'completed',
        },
      }),
    };

    const html = renderToStaticMarkup(
      <>
        {renderChatMessageContentWithOptions(message, {
          taskRuntimeLookup: buildTaskToolRuntimeLookup(
            [{ id: 'session-runtime-1', title: 'MCP 文档检索', state_status: 'paused' }],
            [
              {
                id: 'task-runtime-check',
                title: 'MCP 文档检索',
                status: 'running',
                blockedBy: [],
                completedSubtaskCount: 0,
                readySubtaskCount: 0,
                sessionId: 'session-runtime-1',
                assignedAgent: 'librarian',
                priority: 'medium',
                tags: [],
                createdAt: 1,
                updatedAt: 2,
                depth: 0,
                subtaskCount: 0,
                unmetDependencyCount: 0,
                result: '已抓取 3 份 MCP 文档。',
              },
            ],
          ),
        })}
      </>,
    );

    expect(html).toContain('等待处理');
    expect(html).toContain('会话 session-runtime-1');
    expect(html).toContain('✓ 已抓取 3 份 MCP 文档。');
  });
});
