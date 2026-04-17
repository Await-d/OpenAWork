// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalRoleDescriptor, CommandResultCard, RunEvent } from '@openAwork/shared';
import { useAuthStore } from '../stores/auth.js';

const oracleCanonicalRole: CanonicalRoleDescriptor = {
  coreRole: 'planner',
  preset: 'architect',
  confidence: 'medium',
};

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    json: async () => body,
  }) as Response;

const workspaceMock = {
  workingDirectory: '/workspace',
  loading: false,
  error: null as string | null,
  setWorkspace: vi.fn(async (_path: string) => undefined),
  clearWorkspace: vi.fn(async () => undefined),
  validatePath: vi.fn(async (_path: string) => ({ valid: true })),
  fetchRootPath: vi.fn(async () => '/workspace'),
  fetchWorkspaceRoots: vi.fn(async () => ['/workspace', '/workspace-b']),
  fetchTree: vi.fn(async () => [{ path: '/workspace/README.md', name: 'README.md', type: 'file' }]),
  fetchFile: vi.fn(),
  searchFiles: vi.fn(),
};

const createSessionMock = vi.fn(async () => ({ id: 'session-1' }));
const getSessionMock = vi.fn(async () => ({ messages: [] }));
const getRecoveryMock = vi.fn(async (_token: string, _sessionId: string) => ({
  activeStream: null,
  children: [],
  pendingPermissions: [],
  pendingQuestions: [],
  ratings: [],
  session: { messages: [] },
  tasks: [],
  todoLanes: { main: [], temp: [] },
}));
const getChildrenMock = vi.fn(async () => []);
const getTodoLanesMock = vi.fn(async () => ({ main: [], temp: [] }));
const getTasksMock = vi.fn(async () => []);
const updateMetadataMock = vi.fn(async () => undefined);
const listPendingPermissionsMock = vi.fn(async () => []);
const listCapabilitiesMock = vi.fn(async () => [
  {
    id: 'github:await/skill/react-best-practices',
    kind: 'skill',
    label: 'React 最佳实践',
    description: 'React / Vercel 的性能与实现建议',
    source: 'installed',
    callable: false,
  },
  {
    id: 'web_search',
    kind: 'tool',
    label: 'web_search',
    description: 'Search the web for current information',
    source: 'runtime',
    callable: true,
  },
  {
    id: 'oracle',
    kind: 'agent',
    label: 'oracle',
    description: '只读顾问 agent',
    source: 'builtin',
    callable: false,
    canonicalRole: oracleCanonicalRole,
    aliases: ['architect', 'debugger', 'code-reviewer'],
  },
  {
    id: 'context7',
    kind: 'mcp',
    label: 'context7',
    description: '文档检索 MCP server',
    source: 'reference',
    callable: true,
  },
]);
const executeCommandMock = vi.fn(
  async (
    _token: string,
    _sessionId: string,
    _commandId: string,
    _payload?: { rawInput?: string },
  ): Promise<{ card?: CommandResultCard; events: RunEvent[] }> => ({
    events: [{ type: 'compaction', summary: '来自服务端压缩命令的摘要', trigger: 'manual' }],
    card: {
      type: 'compaction',
      title: '会话已压缩',
      summary: '来自服务端压缩命令的摘要',
      trigger: 'manual',
    },
  }),
);
const listCommandsMock = vi.fn(async () => [
  {
    id: 'remote-compact',
    label: '/compact',
    description: '压缩当前会话上下文（别名：/summarize）',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'compact_session' },
  },
  {
    id: 'remote-summarize',
    label: '/summarize',
    description: '压缩当前会话上下文（/compact 的别名）',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'compact_session' },
  },
  {
    id: 'remote-handoff',
    label: '/handoff',
    description: '生成结构化交接文档',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'generate_handoff' },
  },
  {
    id: 'slash-buddy',
    label: '/buddy',
    description: '打开 Buddy 面板',
    contexts: ['composer'],
    execution: 'client',
    action: { kind: 'open_companion_panel' },
  },
]);
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');

  if (url.pathname.endsWith('/capabilities')) {
    return jsonResponse({ capabilities: await listCapabilitiesMock() });
  }

  if (url.pathname.endsWith('/settings/model-prices')) {
    return jsonResponse({
      models: [{ modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 }],
    });
  }

  throw new Error(`Unhandled fetch path: ${url.pathname}${url.search}`);
});

vi.mock('../hooks/useWorkspace.js', () => ({
  useWorkspace: vi.fn(() => workspaceMock),
}));

vi.mock('../hooks/useGatewayClient.js', () => ({
  useGatewayClient: vi.fn(() => ({
    getActiveStreamSessionId: vi.fn(() => null),
    stream: vi.fn(),
    stopStream: vi.fn(async () => true),
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('@openAwork/web-client', () => ({
  createAgentProfilesClient: vi.fn(() => ({
    getCurrent: vi.fn(async () => null),
  })),
  createSessionsClient: vi.fn(() => ({
    create: createSessionMock,
    get: getSessionMock,
    getRecovery: getRecoveryMock,
    getChildren: getChildrenMock,
    getTodoLanes: getTodoLanesMock,
    getTasks: getTasksMock,
    updateMetadata: updateMetadataMock,
  })),
  createPermissionsClient: vi.fn(() => ({
    listPending: listPendingPermissionsMock,
  })),
  createCommandsClient: vi.fn(() => ({
    list: listCommandsMock,
    execute: executeCommandMock,
  })),
  createCapabilitiesClient: vi.fn(() => ({
    list: listCapabilitiesMock,
  })),
}));

vi.mock('@openAwork/shared-ui', async () => {
  const React = await import('react');
  return {
    PlanPanel: () => null,
    AgentVizPanel: () => null,
    canConfigureThinkingForModel: () => true,
    resolveToolCallCardDisplayData: () => ({ diffView: undefined }),
    GenerativeUIRenderer: ({ message }: { message: unknown }) =>
      React.createElement('pre', null, JSON.stringify(message)),
    AttachmentBar: ({ attachments }: { attachments: Array<{ name: string }> }) =>
      React.createElement('div', null, attachments.map((item) => item.name).join('|')),
    VoiceRecorder: () => null,
    ImagePreview: () => null,
    ToolCallCard: () => null,
    StreamRenderer: () => null,
    PlanHistoryPanel: () => null,
    AgentDAGGraph: () => null,
    RootCausePanel: () => null,
    ContextPanel: () => null,
    WorkspaceSelector: () => null,
  };
});

import ChatPage from './ChatPage.js';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  globalThis.fetch = fetchMock;
  fetchMock.mockClear();
  listCommandsMock.mockClear();
  listPendingPermissionsMock.mockClear();
  getChildrenMock.mockClear();
  getTodoLanesMock.mockClear();
  getTasksMock.mockClear();
  createSessionMock.mockClear();
  executeCommandMock.mockClear();
  getSessionMock.mockClear();
  updateMetadataMock.mockClear();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

async function renderChatPage(initialEntry = '/chat') {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/chat/:sessionId?" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return container!;
}

function getTranscriptText(rendered: HTMLDivElement): string {
  return Array.from(rendered.querySelectorAll('.chat-message-row'))
    .map((row) => row.textContent ?? '')
    .join('\n');
}

describe('ChatPage service-backed commands', () => {
  it('shows slash suggestions from the server-backed command registry', async () => {
    const rendered = await renderChatPage();
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('/compact');
    expect(rendered.textContent).toContain('/summarize');
    expect(rendered.textContent).toContain('/handoff');
    expect(rendered.textContent).toContain('/buddy');
  });

  it('shows installed skills and agent tools in slash suggestions when a workspace is loaded', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('React 最佳实践');
    expect(rendered.textContent).toContain('web_search');
    expect(rendered.textContent).toContain('oracle');
    expect(rendered.textContent).toContain('context7');
    expect(rendered.textContent).toContain('技能');
    expect(rendered.textContent).toContain('工具');
    expect(rendered.textContent).toContain('内置Agent');
    expect(rendered.textContent).toContain('参考MCP');
    expect(rendered.textContent).not.toContain('lsp_diagnostics');
  });

  it('shows integrated agent and mcp capability suggestions in slash menu', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/or');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('oracle');
    expect(rendered.textContent).toContain('只读顾问 agent');
    expect(rendered.textContent).toContain('规范角色：planner/architect');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/con');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('context7');
    expect(rendered.textContent).toContain('文档检索 MCP server');
  });

  it('executes server-backed commands without appending status cards into the main transcript', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/compact ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcriptText = getTranscriptText(rendered);

    expect(executeCommandMock).toHaveBeenCalled();
    expect(executeCommandMock.mock.calls[0]?.[3]).toEqual({ rawInput: '/compact' });
    expect(transcriptText).not.toContain('会话已压缩');
    expect(transcriptText).not.toContain('COMPACT');
    expect(transcriptText).not.toContain('来自服务端压缩命令的摘要');
  });

  it('keeps server command run events out of the assistant chat list', async () => {
    const events: RunEvent[] = [
      {
        type: 'task_update',
        taskId: 'task-1',
        label: '检索 MCP 文档',
        status: 'in_progress',
        sessionId: 'session-1',
      },
      {
        type: 'session_child',
        sessionId: 'child-1',
        parentSessionId: 'session-1',
        title: 'context7 子代理',
      },
    ];
    const card: CommandResultCard = {
      type: 'status',
      title: '命令执行完成',
      message: '已整理 MCP 检索结果',
      tone: 'success',
    };

    executeCommandMock.mockResolvedValueOnce({
      events,
      card,
    });

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/compact ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcriptText = getTranscriptText(rendered);

    expect(transcriptText).not.toContain('任务进行中 · 检索 MCP 文档');
    expect(transcriptText).not.toContain('已创建子会话');
    expect(transcriptText).not.toContain('命令执行完成');
    expect(transcriptText).not.toContain('已整理 MCP 检索结果');
  });

  it('executes /summarize as a real alias of /compact', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/summarize ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcriptText = getTranscriptText(rendered);

    expect(executeCommandMock).toHaveBeenCalledWith('token-123', 'session-1', 'remote-summarize', {
      rawInput: '/summarize',
    });
    expect(transcriptText).not.toContain('会话已压缩');
    expect(transcriptText).not.toContain('COMPACT');
  });

  it('uses the selected alias name in the missing-session warning', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/summarize ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const transcriptText = getTranscriptText(rendered);

    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(transcriptText).not.toContain('需要先进入一个已有会话后再执行 /summarize。');
  });

  it('treats /buddy as a client-side companion action instead of a server command', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/buddy ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(rendered.textContent).toContain('最近会话输出');
  });
});
