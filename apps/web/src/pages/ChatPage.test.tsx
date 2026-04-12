// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import type { Message } from '@openAwork/shared';
import { resetReasoningOpenStateCacheForTests } from '../components/chat/assistant-reasoning-block.js';
import { useAuthStore } from '../stores/auth.js';
import { useChatQueueStore } from '../stores/chat-queue.js';
import { useUIStateStore } from '../stores/uiState.js';
import { logger } from '../utils/logger.js';
import { requestCurrentSessionRefresh } from '../utils/session-list-events.js';

const jsonResponse = (body: unknown) =>
  ({
    ok: true,
    json: async () => body,
  }) as Response;

const providerFetchUrls: string[] = [];
const writeClipboardMock = vi.fn(async () => undefined);
let artifactUploadCounter = 0;
const uploadArtifactMock = vi.fn(
  async (payload: {
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    contentBase64: string;
  }) => ({
    artifact: {
      id: `artifact-${++artifactUploadCounter}`,
      name: payload.name,
    },
  }),
);

const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const rawUrl =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, 'http://localhost:3000');
  providerFetchUrls.push(url.toString());

  if (url.pathname.endsWith('/settings/providers')) {
    return jsonResponse({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          enabled: true,
          defaultModels: [
            {
              id: 'gpt-5',
              label: 'GPT-5',
              enabled: true,
              contextWindow: 200_000,
              supportsThinking: true,
            },
          ],
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          enabled: true,
          defaultModels: [
            {
              id: 'claude-sonnet-4',
              label: 'Claude Sonnet 4',
              enabled: true,
              contextWindow: 200_000,
            },
          ],
        },
      ],
      activeSelection: {
        chat: { providerId: 'openai', modelId: 'gpt-5' },
        fast: { providerId: 'openai', modelId: 'gpt-5' },
      },
      defaultThinking: {
        chat: { enabled: true, effort: 'high' },
        fast: { enabled: false, effort: 'medium' },
      },
    });
  }

  if (url.pathname.endsWith('/settings/model-prices')) {
    return jsonResponse({
      models: [
        { modelName: 'gpt-4o', inputPer1m: 2.5, outputPer1m: 10 },
        { modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 },
        { modelName: 'claude-sonnet-4', inputPer1m: 3, outputPer1m: 15 },
      ],
    });
  }

  if (url.pathname.endsWith('/messages/truncate')) {
    const authHeader =
      init?.headers && 'Authorization' in (init.headers as Record<string, string>)
        ? (init.headers as Record<string, string>)['Authorization']
        : undefined;
    const token = authHeader?.replace(/^Bearer\s+/u, '') ?? '';
    const requestBody = init?.body
      ? (JSON.parse(String(init.body)) as { messageId?: string; inclusive?: boolean })
      : {};
    const messages = await truncateMessagesMock(
      token,
      url.pathname.split('/')[2] ?? '',
      requestBody.messageId ?? '',
      { inclusive: requestBody.inclusive === true },
    );
    return jsonResponse({ messages });
  }

  if (url.pathname.endsWith('/artifacts') && init?.method === 'POST') {
    const requestBody = init?.body
      ? (JSON.parse(String(init.body)) as {
          name: string;
          mimeType?: string;
          sizeBytes?: number;
          contentBase64: string;
        })
      : { name: '', contentBase64: '' };
    return jsonResponse(await uploadArtifactMock(requestBody));
  }

  if (url.pathname.endsWith('/artifacts')) {
    return jsonResponse({ artifacts: [] });
  }

  throw new Error(`Unhandled fetch path: ${url.pathname}${url.search}`);
});

const workspaceMock = {
  workingDirectory: null as string | null,
  loading: false,
  error: null as string | null,
  setWorkspace: vi.fn(async (_path: string) => undefined),
  clearWorkspace: vi.fn(async () => undefined),
  validatePath: vi.fn(async (_path: string) => ({ valid: true })),
  fetchRootPath: vi.fn(async () => '/workspace'),
  fetchWorkspaceRoots: vi.fn(async () => ['/workspace', '/workspace-b']),
  fetchTree: vi.fn(async (path: string) => {
    if (path === '/workspace') {
      return [
        { path: '/workspace/src', name: 'src', type: 'directory' },
        { path: '/workspace/README.md', name: 'README.md', type: 'file' },
        {
          path: '/workspace/src/main.ts',
          name: 'main.ts',
          type: 'file',
        },
      ];
    }
    return [];
  }),
  fetchFile: vi.fn(),
  searchFiles: vi.fn(),
};

type MockSessionPayload = Record<string, unknown> & {
  messages?: unknown[];
  metadata_json?: string;
};

type MockSessionTodo = {
  content: string;
  lane?: 'main' | 'temp';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
};

type MockSessionTodoLanes = {
  main: MockSessionTodo[];
  temp: MockSessionTodo[];
};

const streamMock = vi.fn();
type MockAttachStreamCallbacks = {
  onDelta: (delta: string) => void;
  onDone: (stopReason?: string) => void;
  onEvent?: (event: unknown) => void;
};
const attachToActiveStreamMock = vi.fn(
  async (_sessionId: string, _callbacks: MockAttachStreamCallbacks) => false,
);
const activeStreamSessionIdRef: { current: string | null } = { current: null };
const getActiveStreamSessionIdMock = vi.fn(() => activeStreamSessionIdRef.current);
const stopStreamMock = vi.fn(async () => true);
const stopActiveStreamMock = vi.fn(async () => true);
const queuedAttachmentBlobStore = new Map<string, File[]>();
const cancelTaskMock = vi.fn(async () => ({ cancelled: true, stopped: true }));
const createSessionMock = vi.fn(async () => ({ id: 'session-1' }));
const truncateMessagesMock = vi.fn(
  async (
    _token: string,
    _sessionId: string,
    _messageId: string,
    _options?: { inclusive?: boolean },
  ): Promise<Message[]> => [],
);
const importSessionMock = vi.fn<
  (
    _token: string,
    _payload: { messages?: Array<Record<string, unknown>> },
  ) => Promise<{ sessionId: string }>
>(async () => ({ sessionId: 'session-branch' }));
const getSessionMock = vi.fn<(_token: string, _sessionId: string) => Promise<MockSessionPayload>>(
  async (_token: string, _sessionId: string) => ({ messages: [] }),
);
const getRecoveryMock = vi.fn(async (_token: string, _sessionId: string) => {
  const [children, pendingPermissions, ratings, session, tasks, todoLanes] = await Promise.all([
    getChildrenMock(_token, _sessionId),
    listPendingPermissionsMock(_token, _sessionId),
    listMessageRatingsMock(),
    getSessionMock(_token, _sessionId),
    getTasksMock(_token, _sessionId),
    getTodoLanesMock(_token, _sessionId),
  ]);

  return {
    activeStream: null,
    children,
    pendingPermissions,
    pendingQuestions: [],
    ratings,
    session,
    tasks,
    todoLanes,
  };
});
const getChildrenMock = vi.fn<(_token: string, _sessionId: string) => Promise<Session[]>>(
  async () => [],
);
const getTodosMock = vi.fn<(_token: string, _sessionId: string) => Promise<MockSessionTodo[]>>(
  async () => [],
);
const getTodoLanesMock = vi.fn<
  (_token: string, _sessionId: string) => Promise<MockSessionTodoLanes>
>(async () => ({ main: [], temp: [] }));
const getTasksMock = vi.fn<(_token: string, _sessionId: string) => Promise<SessionTask[]>>(
  async () => [],
);
const getCurrentAgentProfileMock = vi.fn(async () => null);
const createAgentProfileMock = vi.fn(async (_token: string, input: Record<string, unknown>) => ({
  id: 'profile-1',
  label: String(input['label'] ?? '项目配置'),
  workspacePath: String(input['workspacePath'] ?? '/repo/alpha'),
  agentId: (input['agentId'] as string | undefined) ?? null,
  providerId: (input['providerId'] as string | undefined) ?? null,
  modelId: (input['modelId'] as string | undefined) ?? null,
  toolSurfaceProfile:
    (input['toolSurfaceProfile'] as 'openawork' | 'claude_code_default' | 'claude_code_simple') ??
    'openawork',
  note: null,
  createdAt: '2026-04-05T00:00:00.000Z',
  updatedAt: '2026-04-05T00:00:00.000Z',
}));
const updateAgentProfileMock = vi.fn(
  async (_token: string, _profileId: string, input: Record<string, unknown>) => ({
    id: 'profile-1',
    label: String(input['label'] ?? '项目配置'),
    workspacePath: String(input['workspacePath'] ?? '/repo/alpha'),
    agentId: (input['agentId'] as string | undefined) ?? null,
    providerId: (input['providerId'] as string | undefined) ?? null,
    modelId: (input['modelId'] as string | undefined) ?? null,
    toolSurfaceProfile:
      (input['toolSurfaceProfile'] as 'openawork' | 'claude_code_default' | 'claude_code_simple') ??
      'openawork',
    note: null,
    createdAt: '2026-04-05T00:00:00.000Z',
    updatedAt: '2026-04-05T00:00:00.000Z',
  }),
);
const updateMetadataMock = vi.fn(async () => undefined);
const listPendingPermissionsMock = vi.fn<
  (_token: string, _sessionId: string) => Promise<PendingPermissionRequest[]>
>(async () => []);
const listMessageRatingsMock = vi.fn(async () => []);
const setMessageRatingMock = vi.fn<
  (
    _token: string,
    _sessionId: string,
    messageId: string,
    input: { rating: 'up' | 'down' },
  ) => Promise<{
    messageId: string;
    rating: 'up' | 'down';
    reason: null;
    notes: null;
    updatedAt: string;
  }>
>(
  async (
    _token: string,
    _sessionId: string,
    messageId: string,
    input: { rating: 'up' | 'down' },
  ) => ({
    messageId,
    rating: input.rating,
    reason: null,
    notes: null,
    updatedAt: '2026-04-05T00:00:00.000Z',
  }),
);
const deleteMessageRatingMock = vi.fn(async () => undefined);
const listCommandsMock = vi.fn(async () => [
  {
    id: 'slash-compact',
    label: '/compact',
    description: '压缩当前会话上下文（别名：/summarize）',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'compact_session' },
  },
  {
    id: 'slash-summarize',
    label: '/summarize',
    description: '压缩当前会话上下文（/compact 的别名）',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'compact_session' },
  },
  {
    id: 'slash-handoff',
    label: '/handoff',
    description: '生成结构化交接文档',
    contexts: ['composer'],
    execution: 'server',
    action: { kind: 'generate_handoff' },
  },
]);
const listCapabilitiesMock = vi.fn<() => Promise<Array<Record<string, unknown>>>>(async () => []);
const listSessionsMock = vi.fn(async () => [
  { id: 'session-a', title: '设计讨论', updated_at: '2026-03-21T10:00:00.000Z' },
  { id: 'session-b', title: 'Bug 修复', updated_at: '2026-03-21T09:00:00.000Z' },
]);

vi.mock('../hooks/useWorkspace.js', () => ({
  useWorkspace: vi.fn(() => workspaceMock),
}));

vi.mock('../hooks/useGatewayClient.js', () => ({
  useGatewayClient: vi.fn(() => ({
    attachToActiveStream: attachToActiveStreamMock,
    getActiveStreamSessionId: getActiveStreamSessionIdMock,
    stream: streamMock,
    stopStream: stopStreamMock,
  })),
}));

vi.mock('../utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('./chat-page/queued-composer-file-store.js', () => ({
  persistQueuedComposerFiles: vi.fn(
    async ({
      files,
      queueId,
      scope,
    }: {
      attachmentItems: Array<{ id: string }>;
      files: File[];
      queueId: string;
      scope: string;
    }) => {
      queuedAttachmentBlobStore.set(`${scope}:${queueId}`, [...files]);
      return true;
    },
  ),
  restoreQueuedComposerFiles: vi.fn(
    async ({
      attachmentItems,
      queueId,
      scope,
    }: {
      attachmentItems: Array<{ id: string }>;
      queueId: string;
      scope: string;
    }) => {
      const files = queuedAttachmentBlobStore.get(`${scope}:${queueId}`) ?? [];
      return {
        files,
        restored: files.length > 0 && files.length === attachmentItems.length,
      };
    },
  ),
  deleteQueuedComposerFiles: vi.fn(
    async ({ queueId, scope }: { queueId: string; scope: string }) => {
      queuedAttachmentBlobStore.delete(`${scope}:${queueId}`);
    },
  ),
}));

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: vi.fn(() => ({
    list: listSessionsMock,
    create: createSessionMock,
    get: getSessionMock,
    getRecovery: getRecoveryMock,
    getChildren: getChildrenMock,
    getTodoLanes: getTodoLanesMock,
    getTodos: getTodosMock,
    getTasks: getTasksMock,
    listMessageRatings: listMessageRatingsMock,
    setMessageRating: setMessageRatingMock,
    deleteMessageRating: deleteMessageRatingMock,
    cancelTask: cancelTaskMock,
    stopActiveStream: stopActiveStreamMock,
    truncateMessages: truncateMessagesMock,
    importSession: importSessionMock,
    updateMetadata: updateMetadataMock,
  })),
  createPermissionsClient: vi.fn(() => ({
    listPending: listPendingPermissionsMock,
  })),
  createCommandsClient: vi.fn(() => ({
    list: listCommandsMock,
  })),
  createCapabilitiesClient: vi.fn(() => ({
    list: listCapabilitiesMock,
  })),
  createAgentProfilesClient: vi.fn(() => ({
    create: createAgentProfileMock,
    getCurrent: getCurrentAgentProfileMock,
    update: updateAgentProfileMock,
  })),
}));

vi.mock('@openAwork/shared-ui', async () => {
  const React = await import('react');

  function toDiffSummary(filePath: string | undefined, before: string, after: string) {
    const beforeLines = before.split(/\r?\n/);
    const afterLines = after.split(/\r?\n/);
    let additions = 0;
    let deletions = 0;
    let beforeIndex = 0;
    let afterIndex = 0;

    while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
      const beforeLine = beforeLines[beforeIndex];
      const afterLine = afterLines[afterIndex];
      if (beforeLine === afterLine && beforeLine !== undefined) {
        beforeIndex += 1;
        afterIndex += 1;
        continue;
      }
      if (beforeLine !== undefined) {
        deletions += 1;
        beforeIndex += 1;
      }
      if (afterLine !== undefined) {
        additions += 1;
        afterIndex += 1;
      }
    }

    return `${filePath ?? '代码变更'} · +${additions} / -${deletions}`;
  }

  function buildDiffFile(item: Record<string, unknown>) {
    const filePath =
      (typeof item['relativePath'] === 'string' && item['relativePath']) ||
      (typeof item['file'] === 'string' && item['file']) ||
      (typeof item['filePath'] === 'string' && item['filePath']) ||
      (typeof item['path'] === 'string' && item['path']) ||
      (typeof item['filename'] === 'string' && item['filename']) ||
      undefined;
    const before = typeof item['before'] === 'string' ? item['before'] : '';
    const after = typeof item['after'] === 'string' ? item['after'] : '';
    if (!filePath || (!before && !after)) {
      return null;
    }
    const action = typeof item['action'] === 'string' ? item['action'] : undefined;
    const status =
      item['status'] === 'added' || item['status'] === 'deleted' || item['status'] === 'modified'
        ? item['status']
        : action === 'add'
          ? 'added'
          : action === 'delete'
            ? 'deleted'
            : action === 'update' || action === 'move'
              ? 'modified'
              : undefined;

    return {
      filePath,
      beforeText: before,
      afterText: after,
      status,
      summary: toDiffSummary(filePath, before, after),
    };
  }

  function resolveMockDiffView(output: unknown) {
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      return { diffView: undefined };
    }

    const record = output as Record<string, unknown>;
    const multiSource = Array.isArray(record['files'])
      ? record['files']
      : Array.isArray(record['diffs'])
        ? record['diffs']
        : undefined;
    const files = multiSource
      ?.map((item) =>
        item && typeof item === 'object' ? buildDiffFile(item as Record<string, unknown>) : null,
      )
      .filter((item): item is NonNullable<ReturnType<typeof buildDiffFile>> => Boolean(item));

    if (files && files.length > 1) {
      return {
        diffView: {
          files,
          summary: `${files.length} 个文件 · ${files.map((item) => item.summary).join(' · ')}`,
        },
      };
    }

    const filediff =
      record['filediff'] && typeof record['filediff'] === 'object'
        ? buildDiffFile(record['filediff'] as Record<string, unknown>)
        : null;
    if (filediff) {
      return {
        diffView: {
          filePath: filediff.filePath,
          beforeText: filediff.beforeText,
          afterText: filediff.afterText,
          summary: filediff.summary,
        },
      };
    }

    if (files && files.length === 1) {
      const only = files[0];
      if (only) {
        return {
          diffView: {
            filePath: only.filePath,
            beforeText: only.beforeText,
            afterText: only.afterText,
            summary: only.summary,
          },
        };
      }
    }

    if (typeof record['before'] === 'string' || typeof record['after'] === 'string') {
      const filePath =
        (typeof record['path'] === 'string' && record['path']) ||
        (typeof record['filePath'] === 'string' && record['filePath']) ||
        undefined;
      const before = typeof record['before'] === 'string' ? record['before'] : '';
      const after = typeof record['after'] === 'string' ? record['after'] : '';
      return {
        diffView: {
          filePath,
          beforeText: before,
          afterText: after,
          summary: toDiffSummary(filePath, before, after),
        },
      };
    }

    return { diffView: undefined };
  }

  function MockToolCallRenderer({
    toolName,
    input,
    output,
  }: {
    input?: Record<string, unknown>;
    output?: unknown;
    toolName: string;
  }) {
    const [open, setOpen] = React.useState(false);
    const summary =
      typeof input?.query === 'string'
        ? input.query
        : typeof input?.status === 'string'
          ? input.status
          : toolName;

    return React.createElement(
      'div',
      { 'data-tool-card-root': 'true' },
      React.createElement(
        'button',
        {
          'data-tool-card-toggle': 'true',
          type: 'button',
          onClick: () => setOpen((previous) => !previous),
        },
        `${toolName} ${summary}`,
      ),
      open
        ? React.createElement(
            'pre',
            null,
            JSON.stringify(
              {
                input,
                output,
              },
              null,
              2,
            ),
          )
        : null,
    );
  }

  return {
    PlanPanel: () => null,
    ContextPanel: ({
      items,
      totalTokens,
      tokenLimit,
    }: {
      items?: Array<{ label: string }>;
      tokenLimit?: number;
      totalTokens?: number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-context-panel' },
        `context:${(items ?? []).map((item) => item.label).join('|')}|${totalTokens ?? 0}|${tokenLimit ?? 0}`,
      ),
    AgentVizPanel: ({ events }: { events?: Array<{ label: string }> }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-agent-viz-panel' },
        (events ?? []).map((event) => event.label).join('|'),
      ),
    canConfigureThinkingForModel: () => true,
    StatusPill: ({ label }: { label: string }) => React.createElement('span', null, label),
    ToolKindIcon: ({ kind }: { kind?: string }) =>
      React.createElement('span', { 'data-testid': 'mock-tool-kind-icon' }, kind ?? 'tool'),
    tokens: {
      color: {
        danger: '#ef4444',
        info: '#60a5fa',
        success: '#34d399',
        warning: '#f59e0b',
      },
    },
    resolveToolCallCardDisplayData: ({ output }: { output?: unknown }) =>
      resolveMockDiffView(output),
    GenerativeUIRenderer: ({ message }: { message: unknown }) => {
      const payload =
        message && typeof message === 'object' && 'payload' in message
          ? (message as { payload?: Record<string, unknown>; type?: string })
          : null;

      if (payload?.type === 'tool_call') {
        return React.createElement(MockToolCallRenderer, {
          toolName:
            typeof payload.payload?.toolName === 'string' ? payload.payload.toolName : 'tool',
          input:
            payload.payload?.input &&
            typeof payload.payload.input === 'object' &&
            !Array.isArray(payload.payload.input)
              ? (payload.payload.input as Record<string, unknown>)
              : undefined,
          output: payload.payload?.output,
        });
      }

      return React.createElement(
        'pre',
        { 'data-testid': 'mock-generative-ui' },
        JSON.stringify(message),
      );
    },
    AttachmentBar: ({ attachments }: { attachments: Array<{ name: string }> }) =>
      React.createElement(
        'div',
        { 'data-testid': 'attachment-bar' },
        attachments.map((item) => item.name).join('|'),
      ),
    VoiceRecorder: () => null,
    ImagePreview: ({ alt }: { alt?: string }) =>
      React.createElement('div', { 'data-testid': 'image-preview' }, alt ?? 'image'),
    ToolCallCard: ({
      toolName,
      input,
      output,
    }: {
      input?: Record<string, unknown>;
      output?: unknown;
      toolName: string;
    }) => React.createElement(MockToolCallRenderer, { toolName, input, output }),
    ToolDiffCollection: ({
      files,
      activePath,
      viewMode,
    }: {
      activePath?: string;
      files: Array<{ filePath: string; beforeText?: string; afterText?: string }>;
      viewMode?: 'split' | 'unified';
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-tool-diff-collection' },
        [
          '文件切换',
          activePath ?? files[0]?.filePath ?? '',
          `view:${viewMode ?? 'split'}`,
          ...files.map((file) => file.filePath),
          files[0]?.beforeText ?? '',
          files[0]?.afterText ?? '',
        ].join('|'),
      ),
    StreamRenderer: () => null,
    PlanHistoryPanel: () => null,
    AgentDAGGraph: ({
      edges,
      nodes,
    }: {
      edges?: Array<{ id: string }>;
      nodes?: Array<{ id: string; label: string }>;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-agent-dag-graph' },
        `nodes:${nodes?.length ?? 0}|edges:${edges?.length ?? 0}|labels:${(nodes ?? []).map((node) => node.label).join('|')}`,
      ),
    MCPServerList: ({ servers }: { servers: Array<{ name: string; status: string }> }) =>
      React.createElement(
        'div',
        { 'data-testid': 'mock-mcp-server-list' },
        servers.map((server) => `${server.name}:${server.status}`).join('|'),
      ),
    RootCausePanel: () => null,
    WorkspaceSelector: () =>
      React.createElement(
        'div',
        { 'data-testid': 'inline-workspace-selector' },
        'INLINE_WORKSPACE_SELECTOR',
      ),
  };
});

import ChatPage from './ChatPage.js';

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForChatText(text: string, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (container?.textContent?.includes(text)) {
      return;
    }

    await flushEffects();
  }

  throw new Error(`Timed out waiting for chat text: ${text}`);
}

async function flushStreamRevealFrame(frameCount = 1) {
  for (let index = 0; index < frameCount; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };
        const timeoutHandle = window.setTimeout(finish, 20);
        window.requestAnimationFrame(() => {
          window.clearTimeout(timeoutHandle);
          finish();
        });
      });
    });
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let reducedMotionMatches = false;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test-image'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  resetReasoningOpenStateCacheForTests();
  reducedMotionMatches = false;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      get matches() {
        return query === '(prefers-reduced-motion: reduce)' ? reducedMotionMatches : false;
      },
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
  workspaceMock.workingDirectory = null;
  workspaceMock.loading = false;
  workspaceMock.error = null;
  workspaceMock.setWorkspace.mockClear();
  workspaceMock.clearWorkspace.mockClear();
  workspaceMock.validatePath.mockClear();
  workspaceMock.fetchRootPath.mockClear();
  workspaceMock.fetchWorkspaceRoots.mockClear();
  workspaceMock.fetchTree.mockClear();
  streamMock.mockReset();
  attachToActiveStreamMock.mockReset();
  attachToActiveStreamMock.mockImplementation(async () => false);
  activeStreamSessionIdRef.current = null;
  getActiveStreamSessionIdMock.mockClear();
  stopStreamMock.mockReset();
  stopStreamMock.mockImplementation(async () => {
    activeStreamSessionIdRef.current = null;
    return true;
  });
  stopActiveStreamMock.mockReset();
  stopActiveStreamMock.mockImplementation(async () => true);
  queuedAttachmentBlobStore.clear();
  cancelTaskMock.mockClear();
  providerFetchUrls.length = 0;
  fetchMock.mockClear();
  listCommandsMock.mockClear();
  listCapabilitiesMock.mockClear();
  listSessionsMock.mockClear();
  listPendingPermissionsMock.mockReset();
  listPendingPermissionsMock.mockImplementation(async () => []);
  listMessageRatingsMock.mockReset();
  listMessageRatingsMock.mockImplementation(async () => []);
  setMessageRatingMock.mockClear();
  deleteMessageRatingMock.mockClear();
  createAgentProfileMock.mockClear();
  updateAgentProfileMock.mockClear();
  createSessionMock.mockClear();
  truncateMessagesMock.mockClear();
  importSessionMock.mockClear();
  getSessionMock.mockReset();
  getSessionMock.mockImplementation(async () => ({ messages: [] }));
  getRecoveryMock.mockReset();
  getRecoveryMock.mockImplementation(async (_token: string, _sessionId: string) => {
    const [children, pendingPermissions, ratings, session, tasks, todoLanes] = await Promise.all([
      getChildrenMock(_token, _sessionId),
      listPendingPermissionsMock(_token, _sessionId),
      listMessageRatingsMock(),
      getSessionMock(_token, _sessionId),
      getTasksMock(_token, _sessionId),
      getTodoLanesMock(_token, _sessionId),
    ]);

    return {
      activeStream: null,
      children,
      pendingPermissions,
      pendingQuestions: [],
      ratings,
      session,
      tasks,
      todoLanes,
    };
  });
  getChildrenMock.mockReset();
  getChildrenMock.mockImplementation(async () => []);
  getTodosMock.mockImplementation(async () => []);
  getTodoLanesMock.mockReset();
  getTodoLanesMock.mockImplementation(async () => ({ main: [], temp: [] }));
  updateMetadataMock.mockClear();
  getTasksMock.mockReset();
  getTasksMock.mockImplementation(async () => []);
  getCurrentAgentProfileMock.mockReset();
  getCurrentAgentProfileMock.mockImplementation(async () => null);
  useAuthStore.setState({ accessToken: 'token-123', gatewayUrl: 'http://localhost:3000' });
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: writeClipboardMock },
  });
  writeClipboardMock.mockClear();
  artifactUploadCounter = 0;
  uploadArtifactMock.mockReset();
  uploadArtifactMock.mockImplementation(
    async (payload: {
      name: string;
      mimeType?: string;
      sizeBytes?: number;
      contentBase64: string;
    }) => ({
      artifact: {
        id: `artifact-${++artifactUploadCounter}`,
        name: payload.name,
      },
    }),
  );
  window.sessionStorage.clear();
  useChatQueueStore.setState({ queuesByScope: {} });
  useUIStateStore.setState({
    leftSidebarOpen: true,
    sidebarTab: 'sessions',
    chatView: 'home',
    lastChatPath: null,
    pinnedSessions: [],
    expandedDirs: [],
    fileTreeRootPath: null,
    workspaceTreeVersion: 0,
    savedWorkspacePaths: [],
    selectedWorkspacePath: null,
    activeSessionWorkspace: null,
    editorMode: false,
    splitPos: 50,
    openFilePaths: [],
    activeFilePath: null,
  });
  vi.stubGlobal('fetch', fetchMock);

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
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
  await flushEffects();
  return container!;
}

function SessionNavigator() {
  const navigate = useNavigate();

  return (
    <div>
      <button
        type="button"
        data-testid="go-session-a"
        onClick={() => void navigate('/chat/session-a')}
      >
        go-session-a
      </button>
      <button
        type="button"
        data-testid="go-session-b"
        onClick={() => void navigate('/chat/session-b')}
      >
        go-session-b
      </button>
    </div>
  );
}

async function renderChatPageWithNavigator(initialEntry = '/chat/session-a') {
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/chat/:sessionId?"
            element={
              <>
                <SessionNavigator />
                <ChatPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  await flushEffects();
  return container!;
}

describe('ChatPage', () => {
  it('keeps the dialogue mode toggle from shrinking away in the header', async () => {
    const rendered = await renderChatPage();
    const toggle = rendered.querySelector(
      '[data-testid="dialogue-mode-toggle"]',
    ) as HTMLDivElement | null;

    expect(toggle).not.toBeNull();
    expect(toggle?.style.flexShrink).toBe('0');
    expect(rendered.textContent).toContain('澄清');
    expect(rendered.textContent).toContain('编程');
    expect(rendered.textContent).toContain('程序员');
  });

  it('fetches enabled-only provider data for the chat model picker', async () => {
    const rendered = await renderChatPage();

    expect(providerFetchUrls).toContain(
      'http://localhost:3000/settings/providers?enabledOnly=true',
    );
    expect(rendered.querySelector('button[title="当前使用模型：OpenAI / GPT-5"]')).not.toBeNull();
  });

  it('opens the workspace picker modal instead of inline selector on web', async () => {
    const rendered = await renderChatPage();
    const openButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes('打开工作区文件夹') ||
        button.textContent?.includes('工作区文件夹'),
    ) as HTMLButtonElement | undefined;

    expect(openButton).toBeDefined();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).not.toContain('INLINE_WORKSPACE_SELECTOR');
    expect(rendered.querySelector('[role="dialog"][aria-label="选择工作区文件夹"]')).not.toBeNull();
    expect(rendered.textContent).toContain('选择当前文件夹');
  });

  it('stores a selected workspace on the home screen without forcing session creation', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const openButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.textContent?.includes('打开工作区文件夹') ||
        button.textContent?.includes('工作区文件夹'),
    ) as HTMLButtonElement | undefined;

    act(() => {
      openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const selectCurrent = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '选择当前文件夹',
    );

    act(() => {
      selectCurrent?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(createSessionMock).not.toHaveBeenCalled();
    expect(workspaceMock.setWorkspace).toHaveBeenCalledWith('/workspace');
    expect(useUIStateStore.getState().savedWorkspacePaths).toEqual(['/workspace']);
    expect(useUIStateStore.getState().selectedWorkspacePath).toBe('/workspace');
    expect(useUIStateStore.getState().fileTreeRootPath).toBe('/workspace');
  });

  it('keeps dialogue mode visible on opened session screens with workspace info', async () => {
    workspaceMock.workingDirectory = '/repo/alpha';
    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();
    await flushEffects();

    expect(rendered.querySelector('[data-testid="chat-controls-bar"]')).not.toBeNull();
    expect(rendered.querySelector('[data-testid="dialogue-mode-toggle"]')).not.toBeNull();
    expect(rendered.textContent).toContain('alpha');
  });

  it('shows an estimated context usage meter in the chat header when the model has a context window', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '准备一个很长的上下文',
          tokenEstimate: 40_000,
          createdAt: 1,
          status: 'completed',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '这是当前助手的回复',
          tokenEstimate: 10_000,
          createdAt: 2,
          status: 'completed',
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    await flushEffects();

    const meter = rendered.querySelector(
      '[data-testid="chat-context-usage-meter"]',
    ) as HTMLDivElement | null;

    expect(meter).not.toBeNull();
    expect(meter?.textContent).toContain('25%');
    expect(meter?.getAttribute('title')).toContain('上下文估算已用 50k / 200k（25%）');
  });

  it('switches the header context meter to precise gateway usage when a usage event arrives', async () => {
    let callbacks:
      | {
          onDone: (stopReason?: string) => void;
          onEvent: (event: { type: string } & Record<string, unknown>) => void;
        }
      | undefined;

    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '准备一个很长的上下文',
          tokenEstimate: 40_000,
          createdAt: 1,
          status: 'completed',
        },
      ],
    }));
    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        nextCallbacks: {
          onDone: (stopReason?: string) => void;
          onEvent: (event: { type: string } & Record<string, unknown>) => void;
        },
      ) => {
        callbacks = nextCallbacks;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续回答');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    expect(callbacks).toBeDefined();

    await act(async () => {
      callbacks?.onEvent({
        type: 'usage',
        inputTokens: 60_000,
        outputTokens: 5_000,
        totalTokens: 65_000,
        round: 1,
      });
      callbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    const meter = rendered.querySelector(
      '[data-testid="chat-context-usage-meter"]',
    ) as HTMLDivElement | null;

    expect(meter).not.toBeNull();
    expect(meter?.textContent).toContain('33%');
    expect(meter?.textContent).not.toContain('≈');
    expect(meter?.getAttribute('title')).toContain('上下文已用 65k / 200k（33%）');
    expect(meter?.getAttribute('title')).not.toContain('估算');
  });

  it('falls back to estimated context usage when the gateway reports zero tokens', async () => {
    let callbacks:
      | {
          onDone: (stopReason?: string) => void;
          onEvent: (event: { type: string } & Record<string, unknown>) => void;
        }
      | undefined;

    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '准备一个很长的上下文',
          tokenEstimate: 40_000,
          createdAt: 1,
          status: 'completed',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '这是当前助手的回复',
          tokenEstimate: 10_000,
          createdAt: 2,
          status: 'completed',
        },
      ],
    }));
    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        nextCallbacks: {
          onDone: (stopReason?: string) => void;
          onEvent: (event: { type: string } & Record<string, unknown>) => void;
        },
      ) => {
        callbacks = nextCallbacks;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续回答');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    expect(callbacks).toBeDefined();

    await act(async () => {
      callbacks?.onEvent({
        type: 'usage',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        round: 1,
      });
      callbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    const meter = rendered.querySelector(
      '[data-testid="chat-context-usage-meter"]',
    ) as HTMLDivElement | null;

    expect(meter).not.toBeNull();
    expect(meter?.textContent).toContain('25%');
    expect(meter?.textContent).toContain('≈');
    expect(meter?.getAttribute('title')).toContain('上下文估算已用 50k / 200k（25%）');
  });

  it('shows an inline todo bar in the chat view for session todos', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [],
      todos: [
        {
          content: '整理 provider 映射',
          status: 'in_progress',
          priority: 'high',
        },
      ],
    }));
    getTodoLanesMock.mockResolvedValue({
      main: [
        {
          content: '整理 provider 映射',
          status: 'in_progress',
          priority: 'high',
        },
      ],
      temp: [
        {
          content: '补齐聊天面板展示',
          status: 'pending',
          priority: 'medium',
        },
      ],
    });

    const rendered = await renderChatPage('/chat/session-1');

    await flushEffects();

    const todoBar = rendered.querySelector('[data-testid="chat-todo-bar"]');
    expect(todoBar).not.toBeNull();
    expect(todoBar?.textContent).toContain('待办清单');
    expect(todoBar?.textContent).toContain('正在进行：整理 provider 映射');
    expect(todoBar?.textContent).toContain('主待办');
    expect(todoBar?.textContent).toContain('临时待办');

    const todoToggle = rendered.querySelector(
      '[data-testid="chat-todo-toggle"]',
    ) as HTMLButtonElement | null;
    act(() => {
      todoToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(todoBar?.textContent).toContain('补齐聊天面板展示');

    const openPanelButton = rendered.querySelector('button[title="展开面板"]');
    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const historyButton = rendered.querySelector(
      '#chat-right-tab-history',
    ) as HTMLButtonElement | null;
    act(() => {
      historyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.textContent).toContain('高优先级');
    expect(rendered.textContent).toContain('补齐聊天面板展示');
    expect(rendered.textContent).toContain('临时待办');
  });

  it('keeps the inline todo bar visible when the right panel is opened', async () => {
    const todos: MockSessionTodo[] = [
      {
        content: '整理 provider 映射',
        lane: 'main',
        status: 'in_progress',
        priority: 'high',
      },
    ];

    getSessionMock.mockImplementation(async () => ({
      messages: [],
      todos: [
        {
          content: '整理 provider 映射',
          status: 'in_progress',
          priority: 'high',
        },
      ],
    }));
    getTodoLanesMock.mockResolvedValue({
      main: todos.map(({ content, priority, status }) => ({ content, priority, status })),
      temp: [],
    });

    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    await flushEffects();
    expect(rendered.querySelector('[data-testid="chat-todo-bar"]')).not.toBeNull();

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    expect(rendered.querySelector('[data-testid="chat-todo-bar"]')).not.toBeNull();
    expect(rendered.textContent).toContain('待办清单');
  });

  it('renders the right panel switcher as a left-side vertical tab rail', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const tabList = rendered.querySelector(
      '[role="tablist"][aria-label="右侧面板切换"]',
    ) as HTMLDivElement | null;
    const navRail = rendered.querySelector(
      '[data-testid="chat-right-nav-rail"]',
    ) as HTMLDivElement | null;
    const overviewTab = rendered.querySelector(
      '#chat-right-tab-overview',
    ) as HTMLButtonElement | null;
    const overviewPanel = rendered.querySelector(
      '#chat-right-panel-overview',
    ) as HTMLDivElement | null;
    const overviewHeader = rendered.querySelector(
      '[data-testid="chat-right-panel-header-overview"]',
    ) as HTMLDivElement | null;
    const overviewBody = rendered.querySelector(
      '[data-testid="chat-right-panel-body-overview"]',
    ) as HTMLDivElement | null;
    const panelShell = navRail?.parentElement as HTMLDivElement | null;

    expect(tabList).not.toBeNull();
    expect(navRail).not.toBeNull();
    expect(tabList?.getAttribute('aria-orientation')).toBe('vertical');
    expect(panelShell?.style.flexDirection).toBe('row');
    expect(navRail?.style.width).toBe('52px');
    expect(tabList?.style.flexDirection).toBe('column');
    expect(overviewTab?.getAttribute('role')).toBe('tab');
    expect(overviewTab?.getAttribute('aria-label')).toBe('概览');
    expect(overviewTab?.getAttribute('aria-selected')).toBe('true');
    expect(overviewTab?.getAttribute('title')).toBe('概览');
    expect(overviewTab?.style.width).toBe('100%');
    expect(overviewTab?.style.justifyContent).toBe('center');
    expect(overviewPanel?.getAttribute('role')).toBe('tabpanel');
    expect(overviewHeader?.textContent).toContain('会话概览');
    expect(overviewBody?.style.padding).toBe('8px 10px 10px');
  });

  it('syncs the sidebar file tree root with the current session workspace', async () => {
    workspaceMock.workingDirectory = '/repo/alpha';

    await renderChatPage('/chat/session-1');

    expect(useUIStateStore.getState().fileTreeRootPath).toBe('/repo/alpha');
  });

  it('stores the current chat route for later restoration', async () => {
    await renderChatPage('/chat/session-1');

    expect(useUIStateStore.getState().lastChatPath).toBe('/chat/session-1');
  });

  it('ignores stale session payloads after switching to another session', async () => {
    let resolveSessionA: ((value: MockSessionPayload) => void) | null = null;
    let resolveSessionB: ((value: MockSessionPayload) => void) | null = null;

    getSessionMock.mockImplementation((_token: string, requestedSessionId: string) => {
      return new Promise<MockSessionPayload>((resolve) => {
        if (requestedSessionId === 'session-a') {
          resolveSessionA = resolve;
          return;
        }

        if (requestedSessionId === 'session-b') {
          resolveSessionB = resolve;
          return;
        }

        resolve({ messages: [] });
      });
    });

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      resolveSessionB?.({
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            content: '来自 B 会话的消息',
            createdAt: 2,
            status: 'completed',
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('来自 B 会话的消息');

    await act(async () => {
      resolveSessionA?.({
        messages: [
          {
            id: 'assistant-a',
            role: 'assistant',
            content: '来自 A 会话的旧消息',
            createdAt: 1,
            status: 'completed',
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('来自 B 会话的消息');
    expect(rendered.textContent).not.toContain('来自 A 会话的旧消息');
  });

  it('ignores stale stream callbacks after switching to another session', async () => {
    let callbacks:
      | {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
        }
      | undefined;

    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => ({
      messages:
        requestedSessionId === 'session-b'
          ? [
              {
                id: 'assistant-b',
                role: 'assistant',
                content: 'B 会话初始消息',
                createdAt: 2,
                status: 'completed',
              },
            ]
          : [],
    }));
    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        nextCallbacks: { onDelta: (delta: string) => void; onDone: (stopReason?: string) => void },
      ) => {
        callbacks = nextCallbacks;
      },
    );

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    expect(textarea).not.toBeNull();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请继续');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    expect(callbacks).toBeDefined();

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      callbacks?.onDelta('A 会话的旧流式输出');
      callbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('B 会话初始消息');
    expect(rendered.textContent).not.toContain('A 会话的旧流式输出');
  });

  it('ignores stale attach callbacks after switching away and back to the same running session', async () => {
    let firstAttachCallbacks: MockAttachStreamCallbacks | undefined;
    let secondAttachCallbacks: MockAttachStreamCallbacks | undefined;
    let sessionAReadCount = 0;

    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => {
      if (requestedSessionId === 'session-a') {
        sessionAReadCount += 1;
        return sessionAReadCount >= 3
          ? {
              messages: [
                {
                  id: 'user-a',
                  role: 'user',
                  content: '继续恢复 A 会话',
                  createdAt: 1,
                  status: 'completed',
                },
                {
                  id: 'assistant-a-final',
                  role: 'assistant',
                  content: '新的 attach 输出',
                  createdAt: 2,
                  status: 'completed',
                },
              ],
              state_status: 'idle',
            }
          : {
              messages: [
                {
                  id: 'user-a',
                  role: 'user',
                  content: '继续恢复 A 会话',
                  createdAt: 1,
                  status: 'completed',
                },
              ],
              runEvents: [
                {
                  type: 'text_delta',
                  delta: '已恢复',
                  runId: 'run-attach-a',
                  occurredAt: 10,
                },
              ],
              state_status: 'running',
            };
      }

      return {
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            content: 'B 会话空闲中',
            createdAt: 2,
            status: 'completed',
          },
        ],
        state_status: 'idle',
      };
    });
    attachToActiveStreamMock
      .mockImplementationOnce(async (_sid: string, callbacks: MockAttachStreamCallbacks) => {
        firstAttachCallbacks = callbacks;
        return true;
      })
      .mockImplementationOnce(async (_sid: string, callbacks: MockAttachStreamCallbacks) => {
        secondAttachCallbacks = callbacks;
        return true;
      });

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const goSessionA = rendered.querySelector('[data-testid="go-session-a"]');
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    await flushEffects();

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      goSessionA?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(attachToActiveStreamMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      secondAttachCallbacks?.onDelta('新的 attach 输出');
      secondAttachCallbacks?.onDone('end_turn');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
      firstAttachCallbacks?.onDelta('旧 attach 输出');
      firstAttachCallbacks?.onDone('end_turn');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForChatText('新的 attach 输出');

    expect(sessionAReadCount).toBe(3);
    expect(rendered.textContent).toContain('新的 attach 输出');
    expect(rendered.textContent).not.toContain('旧 attach 输出');
  });

  it('allows stopping a still-controlled running session after switching away and back', async () => {
    let callbacks:
      | {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
        }
      | undefined;
    let sessionALoadCount = 0;

    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => ({
      messages:
        requestedSessionId === 'session-a'
          ? [
              {
                id: 'assistant-a',
                role: 'assistant',
                content: 'A 会话仍在运行',
                createdAt: 1,
                status: 'completed',
              },
            ]
          : [
              {
                id: 'assistant-b',
                role: 'assistant',
                content: 'B 会话空闲中',
                createdAt: 2,
                status: 'completed',
              },
            ],
      state_status:
        requestedSessionId === 'session-a'
          ? sessionALoadCount++ === 0
            ? 'idle'
            : 'running'
          : 'idle',
    }));
    streamMock.mockImplementationOnce(
      (
        sid: string,
        _message: string,
        nextCallbacks: {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
        },
      ) => {
        activeStreamSessionIdRef.current = sid;
        callbacks = nextCallbacks;
      },
    );

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;
    const goSessionA = rendered.querySelector('[data-testid="go-session-a"]');
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续执行');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      goSessionA?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('A 会话仍在运行');

    const stopButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('停止') === true,
    ) as HTMLButtonElement | undefined;

    expect(stopButton).toBeDefined();
    expect(stopButton?.disabled).toBe(false);

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      callbacks?.onDelta('不应继续补显');
    });

    await flushStreamRevealFrame(4);

    expect(stopStreamMock).toHaveBeenCalledTimes(1);
    expect(rendered.textContent).not.toContain('不应继续补显');

    await act(async () => {
      callbacks?.onDone('cancelled');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('已停止');
  });

  it('queues a follow-up message when Enter is pressed while the session can still be stopped', async () => {
    let sessionALoadCount = 0;

    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => ({
      messages:
        requestedSessionId === 'session-a'
          ? [
              {
                id: 'assistant-a',
                role: 'assistant',
                content: 'A 会话仍在运行',
                createdAt: 1,
                status: 'completed',
              },
            ]
          : [],
      state_status:
        requestedSessionId === 'session-a'
          ? sessionALoadCount++ === 0
            ? 'idle'
            : 'running'
          : 'idle',
    }));
    streamMock.mockImplementationOnce((sid: string) => {
      activeStreamSessionIdRef.current = sid;
    });

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');
    const goSessionA = rendered.querySelector('[data-testid="go-session-a"]');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '不要再发第二条');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      goSessionA?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '不要再发第二条');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(streamMock).toHaveBeenCalledTimes(1);

    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    await flushEffects();

    expect(streamMock).toHaveBeenCalledTimes(1);
    const queuedRemoveButton = rendered.querySelector(
      '[title="移出队列"]',
    ) as HTMLButtonElement | null;
    expect(queuedRemoveButton).not.toBeNull();
    expect(queuedRemoveButton?.parentElement?.textContent).toContain('下一条：不要再发第二条');
  });

  it('automatically sends the first queued message after the current response stops', async () => {
    let firstCallbacks:
      | {
          onDone: (stopReason?: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (_sid: string, _message: string, callbacks: { onDone: (stopReason?: string) => void }) => {
        firstCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '第一条消息');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '排队的第二条');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const queueButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '追加',
    ) as HTMLButtonElement | undefined;

    expect(queueButton).toBeDefined();

    act(() => {
      queueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const queuedRemoveButton = rendered.querySelector(
      '[title="移出队列"]',
    ) as HTMLButtonElement | null;
    expect(queuedRemoveButton).not.toBeNull();
    expect(queuedRemoveButton?.parentElement?.textContent).toContain('下一条：排队的第二条');

    const stopButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('停止') === true,
    ) as HTMLButtonElement | undefined;

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stopStreamMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstCallbacks?.onDone('cancelled');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(String(streamMock.mock.calls[1]?.[1] ?? '')).toContain('排队的第二条');
  });

  it('persists queued messages across a refresh and restores best-effort session controls', async () => {
    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => ({
      messages:
        requestedSessionId === 'session-1'
          ? [
              {
                id: 'assistant-running',
                role: 'assistant',
                content: '会话仍在运行中',
                createdAt: 1,
                status: 'completed',
              },
            ]
          : [],
      state_status: requestedSessionId === 'session-1' ? 'running' : 'idle',
    }));

    useChatQueueStore.setState({
      queuesByScope: {
        'anonymous:session-1': [
          {
            attachmentItems: [],
            enqueuedAt: Date.now(),
            id: 'queued-1',
            requiresAttachmentRebind: false,
            text: '刷新后仍应保留',
          },
        ],
      },
    });
    activeStreamSessionIdRef.current = null;

    const refreshed = await renderChatPage('/chat/session-1');
    expect(refreshed.textContent).toContain('下一条：刷新后仍应保留');
    expect(refreshed.textContent).toContain('可尝试停止');
    const attemptStopButton = Array.from(refreshed.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('尝试停止') === true,
    ) as HTMLButtonElement | undefined;
    expect(attemptStopButton).toBeDefined();
  });

  it('restores queued attachments after refresh when binary blobs are available locally', async () => {
    const restoredFile = new File(['恢复后的附件内容'], 'notes.txt', { type: 'text/plain' });
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'assistant-running',
          role: 'assistant',
          content: '会话仍在运行中',
          createdAt: 1,
          status: 'completed',
        },
      ],
      state_status: 'running',
    }));
    useChatQueueStore.setState({
      queuesByScope: {
        'anonymous:session-1': [
          {
            attachmentItems: [
              {
                id: 'attachment-1',
                name: 'notes.txt',
                sizeBytes: restoredFile.size,
                type: 'file',
              },
            ],
            enqueuedAt: Date.now(),
            id: 'queued-with-file',
            requiresAttachmentRebind: false,
            text: '把附件一起继续发出去',
          },
        ],
      },
    });
    queuedAttachmentBlobStore.set('anonymous:session-1:queued-with-file', [restoredFile]);

    const rendered = await renderChatPage('/chat/session-1');
    expect(rendered.textContent).toContain('1 个附件');
    expect(rendered.textContent).not.toContain('需重新选择附件');

    const restoreButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '恢复',
    ) as HTMLButtonElement | undefined;
    expect(restoreButton).toBeDefined();

    act(() => {
      restoreButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const attachmentBar = rendered.querySelector(
      '[data-testid="attachment-bar"]',
    ) as HTMLDivElement | null;
    expect(attachmentBar?.textContent).toContain('notes.txt');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.value).toContain('把附件一起继续发出去');
    expect(rendered.textContent).not.toContain('需要重新选择附件');
  });

  it('marks queued attachments as requiring rebind when binary blobs cannot be restored after refresh', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'assistant-running',
          role: 'assistant',
          content: '会话仍在运行中',
          createdAt: 1,
          status: 'completed',
        },
      ],
      state_status: 'running',
    }));
    useChatQueueStore.setState({
      queuesByScope: {
        'anonymous:session-1': [
          {
            attachmentItems: [
              {
                id: 'attachment-missing',
                name: 'missing.txt',
                sizeBytes: 9,
                type: 'file',
              },
            ],
            enqueuedAt: Date.now(),
            id: 'queued-missing-file',
            requiresAttachmentRebind: false,
            text: '这个附件需要重新选择',
          },
        ],
      },
    });

    const rendered = await renderChatPage('/chat/session-1');
    expect(rendered.textContent).toContain('需重新选择附件');

    const restoreButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '恢复',
    ) as HTMLButtonElement | undefined;
    expect(restoreButton).toBeDefined();

    act(() => {
      restoreButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.textContent).toContain('原有 1 个附件需要重新选择后再发送');
    const attachmentBar = rendered.querySelector(
      '[data-testid="attachment-bar"]',
    ) as HTMLDivElement | null;
    expect(attachmentBar?.textContent ?? '').toBe('');
  });

  it('uses best-effort stop for refreshed running sessions without local stream control', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'assistant-running',
          role: 'assistant',
          content: '会话仍在运行中',
          createdAt: 1,
          status: 'completed',
        },
      ],
      state_status: 'running',
    }));
    activeStreamSessionIdRef.current = null;

    const rendered = await renderChatPage('/chat/session-1');
    const stopButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('尝试停止') === true,
    ) as HTMLButtonElement | undefined;

    expect(stopButton).toBeDefined();
    expect(stopButton?.disabled).toBe(false);

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(stopActiveStreamMock).toHaveBeenCalledWith('token-123', 'session-1');
    expect(stopStreamMock).not.toHaveBeenCalled();
  });

  it('attaches to the active stream after refresh and keeps the recovered snapshot visible', async () => {
    let attachCallbacks: MockAttachStreamCallbacks | undefined;

    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '继续生成',
          createdAt: 1,
          status: 'completed',
        },
      ],
      runEvents: [
        {
          type: 'text_delta',
          delta: '已恢复',
          runId: 'run-attach-1',
          occurredAt: 10,
        },
      ],
      state_status: 'running',
    }));
    attachToActiveStreamMock.mockImplementationOnce(
      async (_sid: string, callbacks: MockAttachStreamCallbacks) => {
        attachCallbacks = callbacks;
        return true;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    await flushEffects();

    expect(attachToActiveStreamMock).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        onDelta: expect.any(Function),
        onDone: expect.any(Function),
      }),
    );

    await act(async () => {
      attachCallbacks?.onDelta('继续输出');
      attachCallbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).not.toHaveBeenCalled();
    expect(rendered.textContent).toContain('已恢复');
  }, 15_000);

  it('keeps recovery guidance visible after attach completion until the backend snapshot catches up', async () => {
    let attachCallbacks: MockAttachStreamCallbacks | undefined;

    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '请继续输出当前分析',
          createdAt: 1,
          status: 'completed',
        },
      ],
      runEvents: [
        {
          type: 'text_delta',
          delta: '已恢复',
          runId: 'run-attach-final',
          occurredAt: 10,
        },
      ],
      state_status: 'running',
    }));
    attachToActiveStreamMock.mockImplementationOnce(
      async (_sid: string, callbacks: MockAttachStreamCallbacks) => {
        attachCallbacks = callbacks;
        return true;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    await flushEffects();

    await act(async () => {
      attachCallbacks?.onDelta('继续输出');
      attachCallbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).not.toHaveBeenCalled();
    expect(rendered.textContent).toContain('已恢复');
    expect(rendered.textContent).toContain('会话持续运行中');
  }, 15_000);

  it('keeps attach recovery events out of the transcript message list', async () => {
    let attachCallbacks: MockAttachStreamCallbacks | undefined;
    let sessionReadCount = 0;

    getSessionMock.mockImplementation(async () => {
      sessionReadCount += 1;
      return sessionReadCount >= 2
        ? {
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: '继续恢复当前输出',
                createdAt: 1,
                status: 'completed',
              },
              {
                id: 'assistant-1',
                role: 'assistant',
                content: '继续输出',
                createdAt: 2,
                status: 'completed',
              },
            ],
            state_status: 'idle',
          }
        : {
            messages: [
              {
                id: 'user-1',
                role: 'user',
                content: '继续恢复当前输出',
                createdAt: 1,
                status: 'completed',
              },
            ],
            runEvents: [
              {
                type: 'text_delta',
                delta: '已恢复',
                runId: 'run-attach-audit',
                occurredAt: 10,
              },
            ],
            state_status: 'running',
          };
    });
    attachToActiveStreamMock.mockImplementationOnce(
      async (_sid: string, callbacks: MockAttachStreamCallbacks) => {
        attachCallbacks = callbacks;
        return true;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    await flushEffects();

    await act(async () => {
      attachCallbacks?.onEvent?.({
        type: 'audit_ref',
        auditLogId: 'audit-attach-1',
        toolName: 'web_search',
        runId: 'run-attach-audit',
        occurredAt: 11,
      });
      attachCallbacks?.onDelta('继续输出');
      attachCallbacks?.onDone('end_turn');
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForChatText('继续输出');

    expect(sessionReadCount).toBeGreaterThanOrEqual(2);
    expect(rendered.textContent).toContain('继续输出');
    expect(rendered.textContent).not.toContain('已恢复');
    expect(rendered.textContent).not.toContain('已记录审计引用');
    expect(rendered.textContent).not.toContain('audit-attach-1');
  });

  it('keeps queued messages visible when the refreshed session snapshot cannot be loaded', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('network unavailable'));
    useChatQueueStore.setState({
      queuesByScope: {
        'anonymous:session-1': [
          {
            attachmentItems: [],
            enqueuedAt: Date.now(),
            id: 'queued-network-1',
            requiresAttachmentRebind: false,
            text: '快照失败时不要误发送',
          },
        ],
      },
    });

    const rendered = await renderChatPage('/chat/session-1');
    await flushEffects();

    expect(rendered.textContent).toContain('下一条：快照失败时不要误发送');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('switches the primary action to stop during streaming and calls the stop handler', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sid: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '先开始生成');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('发送') === true,
    ) as HTMLButtonElement | undefined;

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const stopButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('停止') === true,
    ) as HTMLButtonElement | undefined;

    expect(pendingCallbacks).not.toBeNull();
    expect(stopButton).toBeDefined();

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stopStreamMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('cancelled');
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('已停止');
  });

  it('shows an assistant pending placeholder before the first stream chunk arrives', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sid: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '先给我一点反馈');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('发送') === true,
    ) as HTMLButtonElement | undefined;

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(pendingCallbacks).not.toBeNull();
    expect(rendered.querySelector('[data-testid="chat-streaming-placeholder"]')).not.toBeNull();
    expect(rendered.textContent).toContain('正在对话');

    await act(async () => {
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('收到首个分片');
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushStreamRevealFrame(6);

    expect(rendered.querySelector('[data-testid="chat-streaming-placeholder"]')).toBeNull();
    expect(rendered.textContent).toContain('收到首个分片');
  });

  it('reveals streaming text immediately when reduced motion is enabled', async () => {
    reducedMotionMatches = true;
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('发送') === true,
    ) as HTMLButtonElement | undefined;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '减少动效');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
        'reduce motion 下应该立即显示完整文本',
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('reduce motion 下应该立即显示完整文本');
  });

  it('renders streamed thinking content expanded by default after completion', async () => {
    let pendingCallbacks:
      | {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        callbacks: {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        },
      ) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请给出结论');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('先比较方案，再下结论。');
      pendingCallbacks?.onDelta('最终结论。');
      pendingCallbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    const thinkingToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingToggle).not.toBeNull();
    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('Thinking:');
    expect(rendered.textContent).not.toContain('非最终答复');
    expect(rendered.textContent).toContain('先比较方案，再下结论。');
    expect(rendered.textContent).toContain('收起 ·');
    expect(rendered.textContent).toContain('最终结论。');
  });

  it('shows streamed thinking content before the assistant finishes', async () => {
    let pendingCallbacks:
      | {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        callbacks: {
          onDelta: (delta: string) => void;
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        },
      ) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续思考');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('## 先比较方案\n再给出结论');
      await Promise.resolve();
      await Promise.resolve();
    });

    const thinkingToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingToggle).not.toBeNull();
    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('Thinking:');
    expect(rendered.textContent).toContain('先比较方案');
    expect(rendered.textContent).toContain('持续更新中');
  });

  it('ignores late thinking deltas after stopping the stream', async () => {
    let pendingCallbacks:
      | {
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        callbacks: {
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        },
      ) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请停止当前生成');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const stopButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('停止') === true,
    ) as HTMLButtonElement | null;

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stopStreamMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('停止后不应出现的思考');
      pendingCallbacks?.onDone('cancelled');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('已停止');
    expect(rendered.textContent).not.toContain('停止后不应出现的思考');
  });

  it('keeps an expanded reasoning block open while streaming updates continue', async () => {
    let pendingCallbacks:
      | {
          onThinkingDelta?: (delta: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        callbacks: {
          onThinkingDelta?: (delta: string) => void;
        },
      ) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '持续输出思考');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('## 第');
      await Promise.resolve();
      await Promise.resolve();
    });

    const thinkingToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingToggle).not.toBeNull();

    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('第');

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('一步\n先比较约束');
      await Promise.resolve();
      await Promise.resolve();
    });

    const updatedToggleAfterHeading = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(updatedToggleAfterHeading?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('先比较约束');

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('\n再检查边界条件');
      await Promise.resolve();
      await Promise.resolve();
    });

    const updatedToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(updatedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('再检查边界条件');
  });

  it('preserves a collapsed reasoning block when streaming completes', async () => {
    let pendingCallbacks:
      | {
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        }
      | undefined;

    streamMock.mockImplementationOnce(
      (
        _sid: string,
        _message: string,
        callbacks: {
          onDone: (stopReason?: string) => void;
          onThinkingDelta?: (delta: string) => void;
        },
      ) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '完成前先收起思考');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    await act(async () => {
      pendingCallbacks?.onThinkingDelta?.('先比较约束\n再检查边界');
      await Promise.resolve();
      await Promise.resolve();
    });

    const thinkingToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      thinkingToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      pendingCallbacks?.onDone('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushEffects();

    const completedToggle = Array.from(
      rendered.querySelectorAll('[data-testid="chat-markdown-thinking-summary"]'),
    ).at(-1) as HTMLButtonElement | null;

    expect(completedToggle).not.toBeNull();
    expect(
      rendered.querySelectorAll('[data-testid="chat-markdown-thinking-summary"]'),
    ).toHaveLength(1);

    expect(completedToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(rendered.textContent).toContain('已显示摘要');
    expect(rendered.textContent).toContain('再检查边界');
  });

  it('renders legacy fenced thinking markdown in historical chat messages', async () => {
    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => ({
      messages:
        requestedSessionId === 'session-legacy'
          ? [
              {
                id: 'assistant-legacy-thinking',
                role: 'assistant',
                content: '```thinking\n这里是旧格式思考\n```\n\n这是旧格式正文。',
                createdAt: 1,
                status: 'completed',
              },
            ]
          : [],
    }));

    const rendered = await renderChatPage('/chat/session-legacy');
    const thinkingToggle = rendered.querySelector(
      '[data-testid="chat-markdown-thinking-summary"]',
    ) as HTMLButtonElement | null;

    expect(thinkingToggle).not.toBeNull();
    expect(rendered.textContent).toContain('Thinking:');
    expect(rendered.textContent).not.toContain('非最终答复');
    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rendered.textContent).toContain('这里是旧格式思考');
    expect(rendered.textContent).toContain('这是旧格式正文。');
  });

  it('shows a chat skeleton while the target session is still loading', async () => {
    let resolveSessionB: ((value: MockSessionPayload) => void) | null = null;

    getSessionMock.mockImplementation((_token: string, requestedSessionId: string) => {
      if (requestedSessionId === 'session-a') {
        return Promise.resolve({
          messages: [
            {
              id: 'assistant-a',
              role: 'assistant',
              content: 'A 会话已加载',
              createdAt: 1,
              status: 'completed',
            },
          ],
        });
      }

      if (requestedSessionId === 'session-b') {
        return new Promise<MockSessionPayload>((resolve) => {
          resolveSessionB = resolve;
        });
      }

      return Promise.resolve({ messages: [] });
    });

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    expect(rendered.textContent).toContain('A 会话已加载');

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.querySelector('[data-testid="chat-session-skeleton"]')).not.toBeNull();

    await act(async () => {
      resolveSessionB?.({
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            content: 'B 会话已加载',
            createdAt: 2,
            status: 'completed',
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.querySelector('[data-testid="chat-session-skeleton"]')).toBeNull();
    expect(rendered.textContent).toContain('B 会话已加载');
  });

  it('virtualizes large chat histories and reveals later groups after scrolling', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: Array.from({ length: 80 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `第 ${index + 1} 条消息`,
        createdAt: index + 1,
        status: 'completed',
      })),
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const scrollRegion = rendered.querySelector(
      '[data-testid="chat-scroll-region"]',
    ) as HTMLDivElement;

    expect(rendered.querySelector('[data-testid="chat-virtualized-group-list"]')).not.toBeNull();
    expect(rendered.textContent).toContain('第 1 条消息');
    expect(rendered.textContent).not.toContain('第 80 条消息');

    Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 640 });
    Object.defineProperty(scrollRegion, 'scrollTop', { configurable: true, value: 50000 });

    act(() => {
      scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.textContent).toContain('第 80 条消息');
  });

  it('sends programmer mode messages with the programmer dialogue instruction', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const programmerMode = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '程序员',
    );
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    expect(programmerMode).toBeDefined();
    expect(textarea).not.toBeNull();

    act(() => {
      programmerMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '帮我修复这个 bug');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls[0]?.[1]).toBe('帮我修复这个 bug');
    expect(streamMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ agentId: 'hephaestus', dialogueMode: 'programmer' }),
    );
  });

  it('lets manual agent override the mode default and clears back to the mode default', async () => {
    streamMock.mockImplementation(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        (callbacks['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      },
    );
    listCapabilitiesMock.mockImplementation(
      async () =>
        [
          {
            id: 'hephaestus',
            kind: 'agent',
            label: 'Hephaestus',
            description: '程序员执行代理',
            source: 'builtin',
            callable: false,
          },
          {
            id: 'sisyphus-junior',
            kind: 'agent',
            label: 'Sisyphus Junior',
            description: '编程执行代理',
            source: 'builtin',
            callable: false,
          },
        ] as Array<Record<string, unknown>>,
    );

    const rendered = await renderChatPage('/chat/session-1');
    const programmerMode = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '程序员',
    );
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
    const agentSelect = rendered.querySelector(
      'select[aria-label="聊天代理"]',
    ) as HTMLSelectElement | null;

    expect(programmerMode).toBeDefined();
    expect(textarea).not.toBeNull();
    expect(agentSelect).not.toBeNull();

    const textareaValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

    act(() => {
      programmerMode?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      textareaValueSetter?.call(textarea, '按模式默认发送');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(streamMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ agentId: 'hephaestus' }),
    );

    act(() => {
      agentSelect!.value = 'sisyphus-junior';
      agentSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    act(() => {
      textareaValueSetter?.call(textarea, '按手动覆盖发送');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(streamMock.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ agentId: 'sisyphus-junior' }),
    );

    const clearButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '恢复默认',
    );
    expect(clearButton).toBeDefined();

    act(() => {
      clearButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    act(() => {
      textareaValueSetter?.call(textarea, '清除覆盖后发送');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await flushEffects();

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(streamMock.mock.calls[2]?.[2]).toEqual(
      expect.objectContaining({ agentId: 'hephaestus' }),
    );
  });

  it('restores dialogueMode, yoloMode, toolSurfaceProfile, and manual agent from session metadata on opened sessions', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [],
      metadata_json: JSON.stringify({
        agentId: 'sisyphus-junior',
        dialogueMode: 'coding',
        yoloMode: true,
        toolSurfaceProfile: 'claude_code_default',
      }),
    }));

    const rendered = await renderChatPage('/chat/session-1');

    const activeButtons = Array.from(rendered.querySelectorAll('button')).filter(
      (button) => button.getAttribute('aria-pressed') === 'true',
    );
    const toolSurfaceSelect = rendered.querySelector(
      'select[aria-label="工具配置档"]',
    ) as HTMLSelectElement | null;
    const agentSelect = rendered.querySelector(
      'select[aria-label="聊天代理"]',
    ) as HTMLSelectElement | null;

    expect(activeButtons.some((button) => button.textContent?.trim() === '编程')).toBe(true);
    expect(activeButtons.some((button) => button.textContent?.trim() === 'YOLO')).toBe(true);
    expect(toolSurfaceSelect?.value).toBe('claude_code_default');
    expect(agentSelect?.value).toBe('sisyphus-junior');
  });

  it('hydrates shared message payloads returned by the session API', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '第一条用户消息' }],
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一条助手回复' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    expect(rendered.textContent).toContain('第一条用户消息');
    expect(rendered.textContent).toContain('第一条助手回复');
  });

  it('uses the active conversation provider icon and model name for assistant messages without metadata', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-plain',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '使用当前会话模型显示' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    expect(rendered.textContent).toContain('GPT-5');
    expect(rendered.querySelector('img[alt="openai"]')).not.toBeNull();
  });

  it('resolves OpenAI icons from provider type when the provider id is a custom alias', async () => {
    const baseFetchImplementation = fetchMock.getMockImplementation();

    try {
      fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(rawUrl, 'http://localhost:3000');

        if (url.pathname.endsWith('/settings/providers')) {
          return jsonResponse({
            providers: [
              {
                id: 'primary-llm',
                name: 'OpenAI',
                type: 'openai',
                enabled: true,
                defaultModels: [
                  {
                    id: 'gpt-5',
                    label: 'GPT-5',
                    enabled: true,
                    contextWindow: 200_000,
                    supportsThinking: true,
                  },
                ],
              },
            ],
            activeSelection: {
              chat: { providerId: 'primary-llm', modelId: 'gpt-5' },
              fast: { providerId: 'primary-llm', modelId: 'gpt-5' },
            },
            defaultThinking: {
              chat: { enabled: true, effort: 'high' },
              fast: { enabled: false, effort: 'medium' },
            },
          });
        }

        if (!baseFetchImplementation) {
          throw new Error('Missing base fetch implementation');
        }

        return baseFetchImplementation(input, init);
      });

      getSessionMock.mockImplementationOnce(async () => ({
        messages: [
          {
            id: 'assistant-alias-provider',
            role: 'assistant',
            createdAt: 2,
            content: [{ type: 'text', text: '别名 provider 也应展示 OpenAI 图标' }],
          },
        ],
      }));

      const rendered = await renderChatPage('/chat/session-1');

      expect(rendered.textContent).toContain('GPT-5');
      expect(
        rendered.querySelector('button[title="当前使用模型：OpenAI / GPT-5"] img[alt="openai"]'),
      ).not.toBeNull();
      expect(rendered.querySelectorAll('img[alt="openai"]').length).toBeGreaterThanOrEqual(2);
    } finally {
      if (baseFetchImplementation) {
        fetchMock.mockImplementation(baseFetchImplementation);
      }
    }
  });

  it('prefers provider and model metadata carried on assistant messages', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-meta',
          role: 'assistant',
          createdAt: 2,
          model: 'Claude Sonnet 4',
          providerId: 'anthropic',
          content: [{ type: 'text', text: '使用消息自带元数据展示' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    await waitForChatText('Claude Sonnet 4');
    expect(rendered.textContent).toContain('Anthropic');
    expect(rendered.querySelector('img[alt="anthropic"]')).not.toBeNull();
  }, 15_000);

  it('falls back to the active conversation provider and model when assistant metadata is empty strings', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-empty-meta',
          role: 'assistant',
          createdAt: 2,
          model: '   ',
          providerId: '',
          content: [{ type: 'text', text: '空元数据时也要回退' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    await waitForChatText('GPT-5');
    expect(rendered.querySelector('img[alt="openai"]')).not.toBeNull();
  }, 15_000);

  it('keeps session-level provider selection from being overwritten by global defaults', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-session-meta',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '会话级模型优先' }],
        },
      ],
      metadata_json: JSON.stringify({
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
      }),
    }));

    const rendered = await renderChatPage('/chat/session-1');

    await waitForChatText('Claude Sonnet 4');
    expect(rendered.querySelector('img[alt="anthropic"]')).not.toBeNull();
  });

  it('restores the default model after switching away from a bound session', async () => {
    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => {
      if (requestedSessionId === 'session-a') {
        return {
          messages: [
            {
              id: 'assistant-a',
              role: 'assistant',
              createdAt: 1,
              content: [{ type: 'text', text: 'A 会话使用绑定模型' }],
            },
          ],
          metadata_json: JSON.stringify({
            providerId: 'anthropic',
            modelId: 'claude-sonnet-4',
          }),
        };
      }

      return {
        messages: [
          {
            id: 'assistant-b',
            role: 'assistant',
            createdAt: 2,
            content: [{ type: 'text', text: 'B 会话回到默认模型' }],
          },
        ],
      };
    });

    const rendered = await renderChatPageWithNavigator('/chat/session-a');
    const goSessionB = rendered.querySelector('[data-testid="go-session-b"]');

    expect(rendered.textContent).toContain('Claude Sonnet 4');

    act(() => {
      goSessionB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.textContent).toContain('B 会话回到默认模型');
    await waitForChatText('GPT-5');
    expect(rendered.querySelector('img[alt="openai"]')).not.toBeNull();
  }, 15_000);

  it('does not persist metadata again immediately after hydrating an existing session', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [],
      metadata_json: JSON.stringify({
        dialogueMode: 'coding',
        yoloMode: true,
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
      }),
    }));

    await renderChatPage('/chat/session-1');

    expect(updateMetadataMock).not.toHaveBeenCalled();
  });

  it('renders detailed assistant usage stats inspired by the reference chat layout', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-long',
          role: 'user',
          createdAt: 1,
          tokenEstimate: 2_100_000,
          content: [{ type: 'text', text: '大型上下文消息' }],
        },
        {
          id: 'assistant-detailed',
          role: 'assistant',
          createdAt: 2,
          tokenEstimate: 11_000,
          durationMs: 85_000,
          firstTokenLatencyMs: 84_000,
          model: 'gpt-4o',
          providerId: 'openai',
          content: [{ type: 'text', text: '展示细粒度 usage 统计' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');

    expect(rendered.textContent).toContain('请求 1');
    expect(rendered.textContent).toContain('2.11M tokens (2.10M↓ 11.0k↑)');
    expect(rendered.textContent).toContain('$5.36');
    expect(rendered.textContent).toContain('85s');
    expect(rendered.textContent).toContain('首 token 84s');
    expect(rendered.textContent).toContain('TPS 129.4');
  });

  it('shows a scroll-to-bottom button when the user scrolls away from the latest message', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-scroll',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '第一条' }],
        },
        {
          id: 'assistant-scroll',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第二条' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const scrollRegion = rendered.querySelector(
      '[data-testid="chat-scroll-region"]',
    ) as HTMLDivElement;

    Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scrollRegion, 'scrollTop', { configurable: true, value: 100 });

    act(() => {
      scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(rendered.querySelector('[data-testid="chat-scroll-bottom"]')).not.toBeNull();
  });

  it('shows the scroll-to-bottom button once the latest assistant reply drifts away from the center focus band', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-center-scroll',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '第一条' }],
        },
        {
          id: 'assistant-center-scroll',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第二条' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const scrollRegion = rendered.querySelector(
      '[data-testid="chat-scroll-region"]',
    ) as HTMLDivElement;
    const latestAssistantGroup = rendered.querySelector(
      '[data-chat-group-root="true"][data-role="assistant"]',
    ) as HTMLDivElement | null;

    Object.defineProperty(scrollRegion, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, bottom: 400, height: 400, left: 0, right: 600, width: 600 }),
    });
    Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, value: 1600 });
    Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(scrollRegion, 'scrollTop', { configurable: true, value: 200 });
    Object.defineProperty(latestAssistantGroup, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 300, bottom: 380, height: 80, left: 0, right: 600, width: 600 }),
    });

    act(() => {
      scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(rendered.querySelector('[data-testid="chat-scroll-bottom"]')).not.toBeNull();
  });

  it('restores a refreshed session to the latest edge instead of centering the newest reply', async () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });

    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-refresh-scroll',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '第一条' }],
        },
        {
          id: 'assistant-refresh-scroll',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第二条' }],
        },
      ],
    }));

    try {
      const rendered = await renderChatPage('/chat/session-1');
      const scrollRegion = rendered.querySelector(
        '[data-testid="chat-scroll-region"]',
      ) as HTMLDivElement;
      const scrollToMock = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;
      let currentScrollTop = 0;

      Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, value: 1600 });
      Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 400 });
      Object.defineProperty(scrollRegion, 'scrollTop', {
        configurable: true,
        get: () => currentScrollTop,
      });

      act(() => {
        requestAnimationFrameCallbacks.forEach((callback) => {
          callback(0);
        });
      });

      expect(
        scrollToMock.mock.calls.some(
          (call) => call[0]?.behavior === 'auto' && call[0]?.top === 1200,
        ),
      ).toBe(true);

      currentScrollTop = 1200;
      act(() => {
        scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      expect(rendered.querySelector('[data-testid="chat-scroll-bottom"]')).toBeNull();
    } finally {
      requestAnimationFrameMock.mockRestore();
    }
  });

  it('centers the latest assistant reply instead of snapping it to the bottom edge', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    try {
      streamMock.mockImplementationOnce(
        (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
          pendingCallbacks = callbacks;
        },
      );

      const rendered = await renderChatPage('/chat');
      const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
      const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
      const scrollRegion = rendered.querySelector(
        '[data-testid="chat-scroll-region"]',
      ) as HTMLDivElement;
      const scrollToMock = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;

      Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, value: 2000 });
      Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 400 });
      Object.defineProperty(scrollRegion, 'scrollTop', {
        configurable: true,
        get: () => 0,
      });
      Object.defineProperty(scrollRegion, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 400, height: 400, left: 0, right: 600, width: 600 }),
      });

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(textarea, '请把最新消息聚焦到中间');
        textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
          '最新回答已经开始输出',
        );
        await Promise.resolve();
      });

      const latestAssistantGroup = rendered.querySelector(
        '[data-chat-group-root="true"][data-role="assistant"]',
      ) as HTMLDivElement | null;
      Object.defineProperty(latestAssistantGroup, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 260, bottom: 420, height: 160, left: 0, right: 600, width: 600 }),
      });
      scrollToMock.mockClear();

      act(() => {
        (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('，继续生成');
      });

      await flushStreamRevealFrame(3);
      await flushEffects();
      expect(
        scrollToMock.mock.calls.some(
          (call) => call[0]?.behavior === 'auto' && call[0]?.top === 1600,
        ),
      ).toBe(false);
    } finally {
      requestAnimationFrameMock.mockRestore();
    }
  });

  it('pauses auto-follow when the user scrolls up during streaming and offers resume follow', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    try {
      streamMock.mockImplementationOnce(
        (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
          pendingCallbacks = callbacks;
        },
      );

      const rendered = await renderChatPage('/chat');
      const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
      const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
      const scrollRegion = rendered.querySelector(
        '[data-testid="chat-scroll-region"]',
      ) as HTMLDivElement;
      const scrollToMock = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(textarea, '持续输出内容');
        textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第一段');
        await Promise.resolve();
      });

      expect(scrollToMock.mock.calls.some((call) => call[0]?.behavior === 'auto')).toBe(true);

      Object.defineProperty(scrollRegion, 'scrollHeight', { configurable: true, value: 1200 });
      Object.defineProperty(scrollRegion, 'clientHeight', { configurable: true, value: 300 });
      Object.defineProperty(scrollRegion, 'scrollTop', { configurable: true, value: 100 });
      Object.defineProperty(scrollRegion, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 300, height: 300, left: 0, right: 600, width: 600 }),
      });
      const latestAssistantGroup = rendered.querySelector(
        '[data-chat-group-root="true"][data-role="assistant"]',
      ) as HTMLDivElement | null;
      Object.defineProperty(latestAssistantGroup, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 500, bottom: 640, height: 140, left: 0, right: 600, width: 600 }),
      });

      act(() => {
        scrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      const callsBeforePause = scrollToMock.mock.calls.length;
      let resumeButton = rendered.querySelector(
        '[data-testid="chat-scroll-bottom"]',
      ) as HTMLButtonElement | null;
      expect(resumeButton?.textContent).toContain('恢复最新对话');

      await act(async () => {
        (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第二段');
        await Promise.resolve();
      });

      expect(scrollToMock.mock.calls.length).toBe(callsBeforePause);
      resumeButton = rendered.querySelector(
        '[data-testid="chat-scroll-bottom"]',
      ) as HTMLButtonElement | null;
      expect(resumeButton?.textContent).toContain('有新内容');

      const callsBeforeResume = scrollToMock.mock.calls.length;
      act(() => {
        resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(scrollToMock.mock.calls.length).toBeGreaterThan(callsBeforeResume);
      const resumeScrollCall = scrollToMock.mock.calls
        .slice(callsBeforeResume)
        .find((call) => call[0]?.behavior === 'smooth');
      expect(resumeScrollCall?.[0]?.top).toBe(900);
    } finally {
      requestAnimationFrameMock.mockRestore();
    }
  });

  it('renders tool calls and tool results from session history inside the main conversation', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-tool',
          role: 'assistant',
          createdAt: 1,
          content: [
            {
              type: 'tool_call',
              toolCallId: 'call-1',
              toolName: 'web_search',
              input: { query: '上海天气' },
            },
          ],
        },
        {
          id: 'tool-result',
          role: 'tool',
          createdAt: 2,
          content: [
            {
              type: 'tool_result',
              toolCallId: 'call-1',
              output: { city: '上海', weather: '晴' },
              isError: false,
            },
          ],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const getMessageRows = () => Array.from(rendered.querySelectorAll('.chat-message-row'));

    expect(getMessageRows()).toHaveLength(1);
    expect(rendered.textContent).toContain('web_search');
    expect(rendered.textContent).toContain('上海天气');
    expect(rendered.textContent).not.toContain('晴');

    const toolRows = getMessageRows().filter((row) => row.textContent?.includes('web_search'));
    const resultToggle = Array.from(toolRows.at(-1)?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent?.includes('web_search'),
    ) as HTMLButtonElement | undefined;

    act(() => {
      resultToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(rendered.textContent).toContain('晴');
  });

  it('renders multi-file apply_patch history without the turn summary card', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-apply-patch',
          role: 'assistant',
          createdAt: 1,
          content: [
            {
              type: 'tool_call',
              toolCallId: 'call-patch-1',
              toolName: 'apply_patch',
              input: { patchText: '*** Begin Patch' },
            },
          ],
        },
        {
          id: 'tool-apply-patch',
          role: 'tool',
          createdAt: 2,
          content: [
            {
              type: 'tool_result',
              toolCallId: 'call-patch-1',
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
              isError: false,
            },
          ],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    expect(rendered.textContent).not.toContain('Turn review');
    expect(rendered.textContent).not.toContain('本轮修改了 2 个文件');
    expect(rendered.textContent).not.toContain('查看全部文件');
    expect(rendered.textContent).not.toContain('复制变更摘要');
    expect(rendered.textContent).toContain('apply_patch apply_patch');
    expect(writeClipboardMock).not.toHaveBeenCalled();
  });

  it('merges legacy tool_call string messages into the previous assistant bubble', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-text',
          role: 'assistant',
          createdAt: 1,
          content: '先检查一下工作区。',
        },
        {
          id: 'assistant-tool-legacy',
          role: 'assistant',
          createdAt: 2,
          content: JSON.stringify({
            type: 'tool_call',
            payload: {
              toolName: 'web_search',
              input: { query: '工作区状态' },
              output: { summary: '已完成检查' },
              status: 'completed',
            },
          }),
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const messageRows = Array.from(rendered.querySelectorAll('.chat-message-row'));

    expect(messageRows).toHaveLength(1);
    expect(rendered.textContent).toContain('先检查一下工作区。');
    expect(rendered.textContent).toContain('web_search');
  });

  it('shows only one visible assistant avatar for consecutive assistant rows', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: '帮我拆解这个问题',
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          createdAt: 2,
          content: '先看第一部分。',
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          createdAt: 3,
          content: '再补第二部分。',
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const assistantAvatarFrames = Array.from(
      rendered.querySelectorAll('.chat-message-avatar-frame[data-role="assistant"]'),
    );
    const visibleAssistantAvatars = assistantAvatarFrames.filter(
      (element) => element.getAttribute('data-grouped') === 'false',
    );
    const groupedAssistantAvatars = assistantAvatarFrames.filter(
      (element) => element.getAttribute('data-grouped') === 'true',
    );

    expect(assistantAvatarFrames).toHaveLength(2);
    expect(visibleAssistantAvatars).toHaveLength(1);
    expect(groupedAssistantAvatars).toHaveLength(1);
    expect(rendered.textContent).toContain('先看第一部分。');
    expect(rendered.textContent).toContain('再补第二部分。');
  });

  it('groups consecutive assistant cards even when they are status or compaction payloads', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: '整理一下当前进展',
        },
        {
          id: 'assistant-status',
          role: 'assistant',
          createdAt: 2,
          content: JSON.stringify({
            type: 'status',
            payload: {
              title: '子代理执行中',
              message: 'MCP 检索已开始',
              tone: 'info',
            },
          }),
        },
        {
          id: 'assistant-compaction',
          role: 'assistant',
          createdAt: 3,
          content: JSON.stringify({
            type: 'compaction',
            payload: {
              title: '上下文压缩完成',
              summary: '已保留 MCP 线索与工具调用摘要',
              trigger: 'automatic',
            },
          }),
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const assistantAvatarFrames = Array.from(
      rendered.querySelectorAll('.chat-message-avatar-frame[data-role="assistant"]'),
    );
    const visibleAssistantAvatars = assistantAvatarFrames.filter(
      (element) => element.getAttribute('data-grouped') === 'false',
    );

    expect(assistantAvatarFrames).toHaveLength(2);
    expect(visibleAssistantAvatars).toHaveLength(1);
    expect(rendered.textContent).toContain('子代理执行中');
    expect(rendered.textContent).toContain('上下文压缩完成');
  });

  it('mirrors permission, task and child-session events into the assistant chat group while keeping compaction out of the transcript', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '开始一次复杂执行');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const events = [
        {
          type: 'permission_asked',
          requestId: 'perm-1',
          toolName: 'bash',
          scope: 'workspace-write',
          reason: '需要写入工作区文件',
          riskLevel: 'medium',
          previewAction: '创建配置文件',
        },
        {
          type: 'task_update',
          taskId: 'task-1',
          label: '调用子代理整理上下文',
          status: 'in_progress',
          sessionId: 'session-1',
        },
        {
          type: 'session_child',
          sessionId: 'child-1',
          parentSessionId: 'session-1',
          title: 'MCP 文档检索',
        },
        {
          type: 'compaction',
          summary: '已保留工具调用与 MCP 结果摘要',
          trigger: 'automatic',
        },
      ];

      for (const event of events) {
        (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.(event);
      }
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
        '全部调用已进入聊天列表',
      );
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      await Promise.resolve();
    });

    await flushEffects();

    expect(rendered.textContent).toContain('等待权限 · bash');
    expect(rendered.textContent).toContain('任务进行中 · 调用子代理整理上下文');
    expect(rendered.textContent).toContain('已创建子会话');
    expect(rendered.textContent).toContain('MCP 文档检索');
    expect(rendered.textContent).toContain('PERMIT');
    expect(rendered.textContent).toContain('AGENT');
    expect(rendered.textContent).toContain('MCP');
    expect(rendered.textContent).toContain('暂停');
    expect(rendered.textContent).toContain('运行中');
    expect(rendered.textContent).toContain('成功');
    expect(rendered.textContent).toContain('全部调用已进入聊天列表');
    expect(rendered.textContent).not.toContain('会话已压缩');
    expect(rendered.textContent).not.toContain('已保留工具调用与 MCP 结果摘要');
  });

  it('renders a subagent run list above the composer and opens the child session panel on selection', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );
    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId === 'child-1') {
        return {
          title: 'MCP 文档检索',
          messages: [
            {
              id: 'child-user-1',
              role: 'user',
              createdAt: 1,
              content: [{ type: 'text', text: '先检查 API 文档' }],
            },
            {
              id: 'child-assistant-1',
              role: 'assistant',
              createdAt: 2,
              content: [{ type: 'text', text: '子代理已开始抓取文档。' }],
            },
          ],
        };
      }

      return {
        messages: [],
        todos: [
          {
            content: '整理 provider 映射',
            status: 'in_progress',
            priority: 'high',
          },
        ],
      };
    });
    getTodoLanesMock.mockResolvedValue({
      main: [{ content: '整理 provider 映射', status: 'in_progress', priority: 'high' }],
      temp: [],
    });

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '开始一次多代理执行');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'task_update',
        taskId: 'task-child-1',
        label: 'MCP 文档检索',
        status: 'in_progress',
        assignedAgent: 'librarian',
        sessionId: 'child-1',
      });
      (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'session_child',
        sessionId: 'child-1',
        parentSessionId: 'session-1',
        title: 'MCP 文档检索',
      });
      await Promise.resolve();
    });

    await flushEffects();

    await waitForChatText('MCP 文档检索');
    const subagentSection = rendered.querySelector('[aria-label="子代理运行列表"]');
    const todoBar = rendered.querySelector('[data-testid="chat-todo-bar"]');
    expect(subagentSection).not.toBeNull();
    expect(todoBar).not.toBeNull();
    expect(
      (subagentSection?.compareDocumentPosition(todoBar as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(rendered.textContent).toContain('librarian');
    const runButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.closest('[aria-label="子代理运行列表"]') &&
        button.textContent?.includes('MCP 文档检索'),
    ) as HTMLButtonElement | undefined;
    expect(runButton).toBeDefined();

    act(() => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await flushEffects();
    await waitForChatText('子代理已开始抓取文档。');

    expect(rendered.textContent).toContain('打开完整会话');
    expect(rendered.textContent).toContain('子代理已开始抓取文档。');
    expect(rendered.textContent).toContain('干预子代理');
  }, 15_000);

  it('shows paused child sessions as waiting in the subagent run list', async () => {
    getSessionMock.mockImplementation(async () => ({ messages: [] }));
    getChildrenMock.mockImplementation(async () => [
      {
        id: 'child-1',
        title: 'MCP 文档检索',
        state_status: 'paused',
      },
    ]);
    getTasksMock.mockImplementation(async () => [
      {
        id: 'task-child-1',
        title: 'MCP 文档检索',
        status: 'running',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        sessionId: 'child-1',
        assignedAgent: 'librarian',
        priority: 'medium',
        tags: [],
        createdAt: 1,
        updatedAt: 1,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
      } satisfies SessionTask,
    ]);

    const rendered = await renderChatPage('/chat/session-1');

    await flushEffects();
    await flushEffects();

    const subagentSection = rendered.querySelector('[aria-label="子代理运行列表"]');
    expect(subagentSection).not.toBeNull();
    expect(subagentSection?.textContent).toContain('等待处理');
    expect(subagentSection?.textContent).toContain('librarian');
  });

  it('cancels the active child task from the sub-session detail panel', async () => {
    let parentCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        parentCallbacks = callbacks;
      },
    );

    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId === 'child-1') {
        return {
          title: 'MCP 文档检索',
          state_status: 'running',
          metadata_json: JSON.stringify({
            modelId: 'gpt-4o-mini',
            parentSessionId: 'session-1',
            providerId: 'openai',
          }),
          messages: [
            {
              id: 'child-user-1',
              role: 'user',
              createdAt: 1,
              content: [{ type: 'text', text: '先检查 API 文档' }],
            },
          ],
        };
      }

      return { messages: [] };
    });
    getTasksMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId === 'child-1') {
        return [
          {
            id: 'task-child-1',
            title: 'MCP 文档检索',
            status: 'running',
            blockedBy: [],
            completedSubtaskCount: 0,
            readySubtaskCount: 0,
            sessionId: 'child-1',
            assignedAgent: 'librarian',
            priority: 'medium',
            tags: ['task-tool', 'librarian'],
            createdAt: 1,
            updatedAt: 2,
            depth: 0,
            subtaskCount: 0,
            unmetDependencyCount: 0,
          } as SessionTask,
        ];
      }

      return [];
    });

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '启动一个子代理');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (parentCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'task_update',
        taskId: 'task-child-1',
        label: 'MCP 文档检索',
        status: 'in_progress',
        assignedAgent: 'librarian',
        sessionId: 'child-1',
      });
      (parentCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'session_child',
        sessionId: 'child-1',
        parentSessionId: 'session-1',
        title: 'MCP 文档检索',
      });
      await Promise.resolve();
    });

    await flushEffects();
    await flushEffects();

    const runButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) =>
        button.closest('[aria-label="子代理运行列表"]') &&
        button.textContent?.includes('MCP 文档检索'),
    ) as HTMLButtonElement | undefined;

    act(() => {
      runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await flushEffects();

    const cancelButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '停止子任务',
    ) as HTMLButtonElement | undefined;
    expect(cancelButton).toBeDefined();
    expect(rendered.textContent).toContain('等待子任务停止');

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelTaskMock).toHaveBeenCalledWith('token-123', 'child-1', 'task-child-1');
  });

  it('restores an opened child-session panel to the latest edge on initial render', async () => {
    const requestAnimationFrameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        requestAnimationFrameCallbacks.push(callback);
        return requestAnimationFrameCallbacks.length;
      });

    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId === 'child-1') {
        return {
          title: 'MCP 文档检索',
          messages: [
            {
              id: 'child-user-1',
              role: 'user',
              createdAt: 1,
              content: [{ type: 'text', text: '先检查 API 文档' }],
            },
            {
              id: 'child-assistant-1',
              role: 'assistant',
              createdAt: 2,
              content: [{ type: 'text', text: '子代理已开始抓取文档。' }],
            },
          ],
        };
      }

      return { messages: [] };
    });
    getChildrenMock.mockResolvedValue([{ id: 'child-1', title: 'MCP 文档检索' } as Session]);
    getTasksMock.mockResolvedValue([
      {
        id: 'task-child-1',
        title: 'MCP 文档检索',
        status: 'running',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        sessionId: 'child-1',
        assignedAgent: 'librarian',
        priority: 'medium',
        tags: ['task-tool', 'librarian'],
        createdAt: 1,
        updatedAt: 1,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
      } as SessionTask,
    ]);

    try {
      const rendered = await renderChatPage('/chat/session-1');
      await flushEffects();
      await flushEffects();

      const runButton = Array.from(rendered.querySelectorAll('button')).find(
        (button) =>
          button.closest('[aria-label="子代理运行列表"]') &&
          button.textContent?.includes('MCP 文档检索'),
      ) as HTMLButtonElement | undefined;

      act(() => {
        runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await flushEffects();
      await flushEffects();

      const childScrollRegion = rendered.querySelector(
        '[data-testid="sub-session-scroll-region"]',
      ) as HTMLDivElement;
      const scrollToMock = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;
      scrollToMock.mockClear();
      let childScrollTop = 0;

      Object.defineProperty(childScrollRegion, 'scrollHeight', { configurable: true, value: 1800 });
      Object.defineProperty(childScrollRegion, 'clientHeight', { configurable: true, value: 360 });
      Object.defineProperty(childScrollRegion, 'scrollTop', {
        configurable: true,
        get: () => childScrollTop,
      });

      act(() => {
        requestAnimationFrameCallbacks.forEach((callback) => {
          callback(0);
        });
      });

      expect(
        scrollToMock.mock.calls.some(
          (call) => call[0]?.behavior === 'auto' && call[0]?.top === 1440,
        ),
      ).toBe(true);

      childScrollTop = 1440;
      act(() => {
        childScrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      expect(rendered.querySelector('[data-testid="sub-session-scroll-bottom"]')).toBeNull();
    } finally {
      requestAnimationFrameMock.mockRestore();
    }
  });

  it('auto-focuses and pauses follow correctly inside the child session detail panel', async () => {
    let parentCallbacks: Record<string, unknown> | null = null;
    let childCallbacks: Record<string, unknown> | null = null;
    const requestAnimationFrameMock = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    streamMock
      .mockImplementationOnce(
        (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
          parentCallbacks = callbacks;
        },
      )
      .mockImplementationOnce(
        (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
          childCallbacks = callbacks;
        },
      );

    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId === 'child-1') {
        return {
          title: 'MCP 文档检索',
          messages: [
            {
              id: 'child-user-1',
              role: 'user',
              createdAt: 1,
              content: [{ type: 'text', text: '先检查 API 文档' }],
            },
            {
              id: 'child-assistant-1',
              role: 'assistant',
              createdAt: 2,
              content: [{ type: 'text', text: '子代理已开始抓取文档。' }],
            },
          ],
        };
      }

      return { messages: [] };
    });

    try {
      const rendered = await renderChatPage('/chat');
      const mainTextarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
      const mainSendButton = rendered.querySelector(
        'button.btn-accent',
      ) as HTMLButtonElement | null;

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(mainTextarea, '启动一个子代理');
        mainTextarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      act(() => {
        mainSendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (parentCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'task_update',
          taskId: 'task-child-1',
          label: 'MCP 文档检索',
          status: 'in_progress',
          assignedAgent: 'librarian',
          sessionId: 'child-1',
        });
        (parentCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'session_child',
          sessionId: 'child-1',
          parentSessionId: 'session-1',
          title: 'MCP 文档检索',
        });
        await Promise.resolve();
      });

      await flushEffects();
      await flushEffects();

      const runButton = Array.from(rendered.querySelectorAll('button')).find(
        (button) =>
          button.closest('[aria-label="子代理运行列表"]') &&
          button.textContent?.includes('MCP 文档检索'),
      ) as HTMLButtonElement | undefined;

      act(() => {
        runButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await flushEffects();
      await flushEffects();

      const childDetailPanel = rendered.querySelector(
        '[data-testid="sub-session-detail-panel"]',
      ) as HTMLDivElement | null;
      const childTextarea = rendered.querySelector(
        'textarea[placeholder="向这个子代理追加一条消息…"]',
      ) as HTMLTextAreaElement | null;
      expect(childDetailPanel).not.toBeNull();
      expect(childDetailPanel?.textContent).toContain('代理摘要');
      expect(childDetailPanel?.textContent).toContain('子代理对话');
      expect(childTextarea?.getAttribute('aria-label')).toBe('向子代理追加消息');

      const childSendButton = Array.from(rendered.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === '发送干预',
      ) as HTMLButtonElement | undefined;
      const childScrollRegion = rendered.querySelector(
        '[data-testid="sub-session-scroll-region"]',
      ) as HTMLDivElement;
      const scrollToMock = Element.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;
      scrollToMock.mockClear();

      let childScrollTop = 0;
      Object.defineProperty(childScrollRegion, 'scrollHeight', { configurable: true, value: 1800 });
      Object.defineProperty(childScrollRegion, 'clientHeight', { configurable: true, value: 360 });
      Object.defineProperty(childScrollRegion, 'scrollTop', {
        configurable: true,
        get: () => childScrollTop,
      });
      Object.defineProperty(childScrollRegion, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 0, bottom: 360, height: 360, left: 0, right: 420, width: 420 }),
      });

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(childTextarea, '继续抓取剩余文档');
        childTextarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      act(() => {
        childSendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (childCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第一段');
        await Promise.resolve();
      });

      const childAssistantGroups = childScrollRegion.querySelectorAll<HTMLElement>(
        '[data-chat-group-root="true"][data-role="assistant"]',
      );
      const latestAssistantGroup = childAssistantGroups[childAssistantGroups.length - 1] ?? null;
      Object.defineProperty(latestAssistantGroup, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 250, bottom: 390, height: 140, left: 0, right: 420, width: 420 }),
      });

      act(() => {
        (childCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第二段');
      });

      expect(
        scrollToMock.mock.calls.some(
          (call) => call[0]?.behavior === 'auto' && call[0]?.top === 140,
        ),
      ).toBe(true);

      childScrollTop = 80;
      Object.defineProperty(latestAssistantGroup, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: 500, bottom: 640, height: 140, left: 0, right: 420, width: 420 }),
      });
      act(() => {
        childScrollRegion.dispatchEvent(new Event('scroll', { bubbles: true }));
      });

      const callsBeforePause = scrollToMock.mock.calls.length;
      let resumeButton = rendered.querySelector(
        '[data-testid="sub-session-scroll-bottom"]',
      ) as HTMLButtonElement | null;
      expect(resumeButton).not.toBeNull();
      expect(resumeButton?.textContent).toContain('恢复最新对话');

      await act(async () => {
        (childCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第三段');
        await Promise.resolve();
      });

      expect(scrollToMock.mock.calls.length).toBe(callsBeforePause);
      resumeButton = rendered.querySelector(
        '[data-testid="sub-session-scroll-bottom"]',
      ) as HTMLButtonElement | null;
      expect(resumeButton?.textContent).toContain('有新内容');

      const callsBeforeResume = scrollToMock.mock.calls.length;
      act(() => {
        resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(scrollToMock.mock.calls.length).toBeGreaterThan(callsBeforeResume);
      const resumeScrollCall = scrollToMock.mock.calls
        .slice(callsBeforeResume)
        .find((call) => call[0]?.behavior === 'smooth');
      expect(resumeScrollCall?.[0]?.top).toBe(1440);
    } finally {
      requestAnimationFrameMock.mockRestore();
    }
  });

  it('keeps child-session terminal status after polling returns no matching tasks', async () => {
    vi.useFakeTimers();
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );
    getChildrenMock.mockResolvedValue([{ id: 'child-1', title: 'MCP 文档检索' } as Session]);
    getTasksMock.mockResolvedValue([]);

    try {
      const rendered = await renderChatPage('/chat/session-1');
      const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
      const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(textarea, '跟踪子代理完成态');
        textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      act(() => {
        sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'task_update',
          taskId: 'task-child-finished',
          label: 'MCP 文档检索',
          status: 'done',
          assignedAgent: 'librarian',
          result: '子代理已完成文档抓取。',
          sessionId: 'child-1',
          occurredAt: 123,
        });
        (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'session_child',
          sessionId: 'child-1',
          parentSessionId: 'session-1',
          title: 'MCP 文档检索',
          occurredAt: 123,
        });
        await Promise.resolve();
      });

      await flushEffects();

      expect(rendered.textContent).toContain('已完成');
      expect(rendered.textContent).toContain('子代理已完成文档抓取');

      await act(async () => {
        vi.advanceTimersByTime(3500);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(rendered.textContent).toContain('已完成');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates child-session terminal status from polling when the done event was missed', async () => {
    vi.useFakeTimers();
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );
    const completedChildTask = {
      id: 'task-child-finished',
      title: 'MCP 文档检索',
      status: 'completed',
      blockedBy: [],
      completedSubtaskCount: 0,
      depth: 0,
      readySubtaskCount: 0,
      sessionId: 'child-1',
      assignedAgent: 'librarian',
      priority: 'medium',
      tags: ['task-tool', 'librarian'],
      createdAt: 100,
      updatedAt: 200,
      subtaskCount: 0,
      unmetDependencyCount: 0,
      result: '轮询已补回最终摘要。',
    } as SessionTask;
    getChildrenMock.mockResolvedValue([{ id: 'child-1', title: 'MCP 文档检索' } as Session]);
    getTasksMock
      .mockImplementationOnce(async () => [])
      .mockImplementation(async () => [completedChildTask]);

    try {
      const rendered = await renderChatPage('/chat/session-1');
      const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
      const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

      act(() => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(textarea, '等待轮询补回子代理终态');
        textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      });

      act(() => {
        sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'task_update',
          taskId: 'task-child-finished',
          label: 'MCP 文档检索',
          status: 'in_progress',
          assignedAgent: 'librarian',
          sessionId: 'child-1',
          occurredAt: 123,
        });
        (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
          type: 'session_child',
          sessionId: 'child-1',
          parentSessionId: 'session-1',
          title: 'MCP 文档检索',
          occurredAt: 123,
        });
        (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
        await Promise.resolve();
      });

      await flushEffects();

      await act(async () => {
        vi.advanceTimersByTime(3500);
        await Promise.resolve();
        await Promise.resolve();
      });
      await flushEffects();

      expect(rendered.textContent).toContain('已完成');
      expect(rendered.textContent).toContain('轮询已补回最终摘要');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the main conversation task card after polling observes a terminal child task', async () => {
    vi.useFakeTimers();
    let sessionReadCount = 0;
    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId !== 'session-1') {
        return { messages: [] };
      }

      sessionReadCount += 1;
      return {
        messages:
          sessionReadCount === 1
            ? [
                {
                  id: 'assistant-task-inline',
                  role: 'assistant',
                  createdAt: 1,
                  content: [
                    {
                      type: 'tool_call',
                      toolCallId: 'task-call-inline',
                      toolName: 'task',
                      input: {
                        description: 'MCP 文档检索',
                        prompt: '检查 MCP 文档并给出结论',
                        subagent_type: 'librarian',
                      },
                    },
                  ],
                },
                {
                  id: 'tool-task-inline',
                  role: 'tool',
                  createdAt: 2,
                  content: [
                    {
                      type: 'tool_result',
                      toolCallId: 'task-call-inline',
                      output: {
                        taskId: 'task-child-inline',
                        sessionId: 'child-1',
                        status: 'running',
                      },
                      isError: false,
                    },
                  ],
                },
              ]
            : [
                {
                  id: 'assistant-task-inline',
                  role: 'assistant',
                  createdAt: 1,
                  content: [
                    {
                      type: 'tool_call',
                      toolCallId: 'task-call-inline',
                      toolName: 'task',
                      input: {
                        description: 'MCP 文档检索',
                        prompt: '检查 MCP 文档并给出结论',
                        subagent_type: 'librarian',
                      },
                    },
                  ],
                },
                {
                  id: 'tool-task-inline',
                  role: 'tool',
                  createdAt: 3,
                  content: [
                    {
                      type: 'tool_result',
                      toolCallId: 'task-call-inline',
                      output: {
                        taskId: 'task-child-inline',
                        sessionId: 'child-1',
                        status: 'done',
                        result: '子代理已经执行完成。',
                      },
                      isError: false,
                    },
                  ],
                },
              ],
        state_status: sessionReadCount === 1 ? 'running' : 'idle',
      };
    });
    getChildrenMock.mockImplementation(async () => [{ id: 'child-1', title: 'MCP 文档检索' }]);
    getTasksMock.mockImplementation(async () => [
      {
        id: 'task-child-inline',
        title: 'MCP 文档检索',
        status: 'completed',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        sessionId: 'child-1',
        assignedAgent: 'librarian',
        priority: 'medium',
        tags: [],
        createdAt: 1,
        updatedAt: 2,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
        result: '子代理已经执行完成。',
      },
    ]);

    try {
      const rendered = await renderChatPage('/chat/session-1');

      await flushEffects();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.resolve();
        await Promise.resolve();
      });

      await flushEffects();

      expect(sessionReadCount).toBeGreaterThanOrEqual(2);
      expect(rendered.textContent).toContain('子代理已经执行完成。');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows persisted running session state after switching back and keeps polling session payloads', async () => {
    vi.useFakeTimers();
    let sessionReadCount = 0;
    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId !== 'session-1') {
        return { messages: [] };
      }

      sessionReadCount += 1;
      return sessionReadCount === 1
        ? {
            messages: [],
            state_status: 'running',
          }
        : {
            messages: [
              {
                id: 'assistant-running-finished',
                role: 'assistant',
                content: '后台消息已同步。',
                createdAt: 1,
                status: 'completed',
              },
            ],
            state_status: 'idle',
          };
    });

    try {
      const rendered = await renderChatPage('/chat/session-1');

      await flushEffects();

      expect(rendered.querySelector('[data-testid="chat-session-runtime-status"]')).not.toBeNull();
      expect(
        rendered.querySelector('[data-testid="chat-remote-session-placeholder"]'),
      ).not.toBeNull();
      expect(rendered.textContent).toContain('会话持续运行中');
      const runningButton = Array.from(rendered.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('尝试停止') === true,
      ) as HTMLButtonElement | undefined;
      expect(runningButton?.disabled).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.resolve();
        await Promise.resolve();
      });

      await flushEffects();

      expect(sessionReadCount).toBeGreaterThanOrEqual(2);
      expect(rendered.textContent).toContain('后台消息已同步。');
      expect(rendered.querySelector('[data-testid="chat-session-runtime-status"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps locally appended messages visible during same-session refresh when the server snapshot is stale', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    let sessionReadCount = 0;

    getSessionMock.mockImplementation(async (_token: string, currentSessionId: string) => {
      if (currentSessionId !== 'session-1') {
        return { messages: [] };
      }

      sessionReadCount += 1;
      return {
        messages: [
          {
            id: 'assistant-seed',
            role: 'assistant',
            content: '最初的历史消息',
            createdAt: 1,
            status: 'completed',
          },
        ],
        state_status: 'idle',
      };
    });
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请继续保留这条新问题');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
        '这是本地刚完成的新回答',
      );
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('最初的历史消息');
    expect(rendered.textContent).toContain('请继续保留这条新问题');
    expect(rendered.textContent).toContain('这是本地刚完成的新回答');

    act(() => {
      requestCurrentSessionRefresh('session-1');
    });

    await flushEffects();
    await flushEffects();

    expect(sessionReadCount).toBeGreaterThanOrEqual(2);
    expect(rendered.textContent).toContain('最初的历史消息');
    expect(rendered.textContent).toContain('请继续保留这条新问题');
    expect(rendered.textContent).toContain('这是本地刚完成的新回答');
    expect(rendered.querySelector('[data-testid="chat-session-skeleton"]')).toBeNull();
  });

  it('reconstructs in-progress assistant output from persisted run events after a refresh', async () => {
    activeStreamSessionIdRef.current = null;
    getSessionMock.mockImplementation(async (_token: string, requestedSessionId: string) => {
      if (requestedSessionId !== 'session-1') {
        return { messages: [] };
      }

      return {
        messages: [
          {
            id: 'user-1',
            role: 'user',
            content: '请继续输出当前分析',
            createdAt: 1,
            status: 'completed',
          },
        ],
        runEvents: [
          {
            type: 'thinking_delta',
            delta: '先恢复思考',
            runId: 'run-refresh-1',
            occurredAt: 10,
          },
          {
            type: 'text_delta',
            delta: '正在恢复',
            runId: 'run-refresh-1',
            occurredAt: 11,
          },
          {
            type: 'text_delta',
            delta: '中的回复',
            runId: 'run-refresh-1',
            occurredAt: 12,
          },
          {
            type: 'usage',
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
            round: 1,
            runId: 'run-refresh-1',
            occurredAt: 13,
          },
        ],
        state_status: 'running',
      };
    });

    const rendered = await renderChatPage('/chat/session-1');

    await flushEffects();

    expect(streamMock).not.toHaveBeenCalled();
    expect(rendered.textContent).toContain('正在恢复中的回复');
    expect(rendered.textContent).toContain('请继续输出当前分析');
    expect(rendered.textContent).toContain('可尝试停止');
    expect(rendered.textContent).toContain('会话持续运行中');
    expect(rendered.querySelector('[data-testid="chat-session-runtime-status"]')).not.toBeNull();

    const meter = rendered.querySelector(
      '[data-testid="chat-context-usage-meter"]',
    ) as HTMLDivElement | null;
    expect(meter).not.toBeNull();
    expect(meter?.textContent).not.toContain('≈');
    expect(meter?.getAttribute('title')).toContain('上下文已用 150 / 200k');
  });

  it('opens the overview panel when the recovery strategy button is pressed from the runtime bar', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        { id: 'assistant-recovery', role: 'assistant', content: '等待恢复', createdAt: 1 },
      ],
      runEvents: [
        {
          type: 'permission_asked',
          requestId: 'perm-1',
          toolName: 'bash',
          scope: 'session',
          riskLevel: 'medium',
          reason: '需要执行命令',
          previewAction: '运行验证命令',
          sessionId: 'session-1',
          occurredAt: 10,
        },
      ],
      state_status: 'paused',
    }));

    const rendered = await renderChatPage('/chat/session-1');

    await flushEffects();

    const recoveryButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('查看恢复策略'),
    );
    expect(recoveryButton).toBeTruthy();

    act(() => {
      recoveryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    const overviewTab = rendered.querySelector('#chat-right-tab-overview');
    expect(overviewTab?.getAttribute('aria-selected')).toBe('true');
    expect(rendered.textContent).toContain('恢复策略');
    expect(rendered.textContent).toContain('等待处理中的会话');
  });

  it('does not append a stream error message after a permission pause', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '触发权限审批');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'tool_result',
        toolCallId: 'call-perm',
        toolName: 'task',
        output:
          'Tool "task" requires approval before it can modify the workspace. Permission request perm-1 has been created.',
        isError: false,
        pendingPermissionRequestId: 'perm-1',
      });
      (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'permission_asked',
        requestId: 'perm-1',
        toolName: 'task',
        scope: 'workspace-write',
        reason: '需要创建子任务',
        riskLevel: 'high',
        previewAction: '创建子任务和子会话',
      });
      (pendingCallbacks?.['onError'] as ((code: string, message?: string) => void) | undefined)?.(
        'SSE_ERROR',
        'SSE connection error',
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await flushEffects();
    await flushEffects();

    expect(rendered.textContent).not.toContain('[错误: SSE_ERROR] SSE connection error');
  });

  it('keeps runtime polling alive after permission_asked pauses the stream', async () => {
    vi.useFakeTimers();
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '等待权限请求');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const listPendingCountBeforePermission = listPendingPermissionsMock.mock.calls.length;

    await act(async () => {
      (pendingCallbacks?.['onEvent'] as ((value: unknown) => void) | undefined)?.({
        type: 'permission_asked',
        requestId: 'perm-live',
        toolName: 'bash',
        scope: 'workspace-write',
        reason: '需要创建配置文件',
        riskLevel: 'medium',
        previewAction: '创建配置文件',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listPendingPermissionsMock.mock.calls.length).toBe(listPendingCountBeforePermission);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(listPendingPermissionsMock.mock.calls.length).toBeGreaterThan(
      listPendingCountBeforePermission,
    );
  });

  it('copies a user message with the quick copy action', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-copy',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '复制这条消息' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const copyButton = rendered.querySelector(
      '[data-testid="chat-message-action-copy-user-copy"]',
    ) as HTMLButtonElement | null;

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeClipboardMock).toHaveBeenCalledWith('复制这条消息');
  });

  it('copies the full assistant answer when one reply spans multiple grouped messages', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-group-copy',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请输出完整文档' }],
        },
        {
          id: 'assistant-group-copy-1',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '# 第一部分' }],
        },
        {
          id: 'assistant-group-copy-2',
          role: 'assistant',
          createdAt: 3,
          content: [{ type: 'text', text: '第二部分正文' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    writeClipboardMock.mockClear();
    const copyButton = rendered.querySelector(
      '[data-testid="chat-message-action-copy-assistant-group-copy-1"]',
    ) as HTMLButtonElement | null;

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeClipboardMock).toHaveBeenCalledWith('# 第一部分\n\n第二部分正文');
  });

  it('uses the header copy action for markdown answers', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'assistant-doc-copy',
          role: 'assistant',
          createdAt: 1,
          content: [{ type: 'text', text: '# 文档标题\n\n- 第一项\n- 第二项' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const copyButton = rendered.querySelector(
      '[data-testid="chat-message-action-copy-assistant-doc-copy"]',
    ) as HTMLButtonElement | null;
    writeClipboardMock.mockClear();
    const inlineCopyButton = rendered.querySelector('[data-testid="assistant-rich-content-copy"]');

    expect(copyButton).not.toBeNull();
    expect(inlineCopyButton).toBeNull();

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeClipboardMock).toHaveBeenCalledWith('# 文档标题\n\n- 第一项\n- 第二项');
  });

  it('puts a user message back into the composer for edit-retry', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-edit',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '把这条消息重新编辑' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const editRetryButton = rendered.querySelector(
      '[data-testid="chat-message-action-edit-retry-user-edit"]',
    ) as HTMLButtonElement | null;

    act(() => {
      editRetryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(textarea?.value).toBe('把这条消息重新编辑');
  });

  it('prompts before editing a historical user message and warns when code markers are present', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-history',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '```ts\nconsole.log(1)\n```' }],
        },
        {
          id: 'assistant-history',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const editRetryButton = rendered.querySelector(
      '[data-testid="chat-message-action-edit-retry-user-history"]',
    ) as HTMLButtonElement | null;

    act(() => {
      editRetryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(rendered.textContent).toContain('编辑历史消息');
    expect(rendered.textContent).toContain('检测到这条历史消息带有代码标识');
    expect(textarea?.value).toBe('');

    const dialogTextarea = rendered.querySelector(
      '[data-testid="history-edit-dialog-textarea"]',
    ) as HTMLTextAreaElement | null;
    expect(dialogTextarea?.value).toContain('console.log(1)');

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(dialogTextarea, '```ts\nconsole.log(2)\n```');
      dialogTextarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const continueButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '继续当前会话',
    );

    act(() => {
      continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(textarea?.value).toBe('```ts\nconsole.log(2)\n```');
  });

  it('creates a child session when choosing to branch from a historical edit', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-branch',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '历史消息分叉' }],
        },
        {
          id: 'assistant-branch',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'prefix-user',
          role: 'user',
          createdAt: 0,
          content: [{ type: 'text', text: '前置历史' }],
        },
        {
          id: 'user-branch',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '历史消息分叉' }],
        },
        {
          id: 'assistant-branch',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const editRetryButton = rendered.querySelector(
      '[data-testid="chat-message-action-edit-retry-user-branch"]',
    ) as HTMLButtonElement | null;

    act(() => {
      editRetryButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const branchButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '从这里新建会话',
    );

    const dialogTextarea = rendered.querySelector(
      '[data-testid="history-edit-dialog-textarea"]',
    ) as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(dialogTextarea, '历史消息分叉（已编辑）');
      dialogTextarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      branchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(importSessionMock).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            id: expect.not.stringMatching(/^prefix-user$/),
            role: 'user',
            content: expect.any(Array),
          }),
        ],
      }),
    );
    expect(updateMetadataMock).toHaveBeenCalledWith(
      'token-123',
      'session-branch',
      expect.objectContaining({
        parentSessionId: 'session-1',
        editSourceMessageId: 'user-branch',
      }),
    );
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe('历史消息分叉（已编辑）');
  });

  it('retries an assistant message by resending the nearest user message', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-retry',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请重新生成这条回复' }],
        },
        {
          id: 'assistant-retry',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'prefix-user',
          role: 'user',
          createdAt: 0,
          content: [{ type: 'text', text: '前置历史' }],
        },
        {
          id: 'user-retry',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请重新生成这条回复' }],
        },
        {
          id: 'assistant-retry',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));
    streamMock.mockImplementationOnce(() => undefined);
    truncateMessagesMock.mockImplementationOnce(async () => {
      const messages: Message[] = [
        {
          id: 'prefix-user-after-truncate',
          role: 'user',
          createdAt: 0,
          content: [{ type: 'text', text: '前置历史' }],
        },
        {
          id: 'user-retry-after-truncate',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请重新生成这条回复' }],
        },
      ];
      return messages;
    });

    const rendered = await renderChatPage('/chat/session-1');
    const retryButton = rendered.querySelector(
      '[data-testid="chat-message-action-retry-assistant-retry"]',
    ) as HTMLButtonElement | null;
    expect(retryButton).toBeTruthy();

    act(() => {
      retryButton?.click();
    });

    expect(rendered.textContent).toContain('选择重试方式');
    const currentButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '清空本轮回答并重试',
    );

    await act(async () => {
      currentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    expect(truncateMessagesMock).toHaveBeenCalledWith('token-123', 'session-1', 'user-retry', {
      inclusive: true,
    });
    expect(importSessionMock).not.toHaveBeenCalled();
    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls.at(-1)?.[1]).toContain('请重新生成这条回复');
  });

  it('clears the whole user turn before retrying in the current session', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'prefix-user',
          role: 'user',
          createdAt: 0,
          content: [{ type: 'text', text: '前置历史' }],
        },
        {
          id: 'user-retry-turn',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '这一轮需要整体重试' }],
        },
        {
          id: 'assistant-success',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '上游先成功了一部分' }],
        },
        {
          id: 'assistant-failure',
          role: 'assistant',
          createdAt: 3,
          content: [{ type: 'text', text: '[错误: MODEL_ERROR] 后续步骤失败' }],
          status: 'error',
        },
      ],
    }));
    streamMock.mockImplementationOnce(() => undefined);
    truncateMessagesMock.mockImplementationOnce(async () => [
      {
        id: 'prefix-user-after-truncate',
        role: 'user',
        createdAt: 0,
        content: [{ type: 'text', text: '前置历史' }],
      },
      {
        id: 'user-retry-turn',
        role: 'user',
        createdAt: 1,
        content: [{ type: 'text', text: '这一轮需要整体重试' }],
      },
      {
        id: 'assistant-success-should-be-cleared',
        role: 'assistant',
        createdAt: 2,
        content: [{ type: 'text', text: '上游先成功了一部分' }],
      },
    ]);

    const rendered = await renderChatPage('/chat/session-1');
    const retryButton = rendered.querySelector(
      '[data-testid^="chat-message-action-retry-"]',
    ) as HTMLButtonElement | null;

    act(() => {
      retryButton?.click();
    });

    const currentButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '清空本轮回答并重试',
    );

    await act(async () => {
      currentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushEffects();
    });

    expect(truncateMessagesMock).toHaveBeenCalledWith('token-123', 'session-1', 'user-retry-turn', {
      inclusive: true,
    });
    expect(rendered.textContent).toContain('前置历史');
    expect(rendered.textContent).toContain('这一轮需要整体重试');
    expect(rendered.textContent).not.toContain('上游先成功了一部分');
    expect(rendered.textContent).not.toContain('后续步骤失败');
    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls.at(-1)?.[1]).toContain('这一轮需要整体重试');
  });

  it('can retry an assistant message in a new session branch', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'prefix-user',
          role: 'user',
          createdAt: 0,
          content: [{ type: 'text', text: '前置历史' }],
        },
        {
          id: 'user-retry',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '请重新生成这条回复（分叉）' }],
        },
        {
          id: 'assistant-retry',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '第一次回答' }],
        },
      ],
    }));
    streamMock.mockImplementationOnce(() => undefined);

    const rendered = await renderChatPage('/chat/session-1');
    const retryButton = rendered.querySelector(
      '[data-testid="chat-message-action-retry-assistant-retry"]',
    ) as HTMLButtonElement | null;
    expect(retryButton).toBeTruthy();

    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('选择重试方式');

    const branchButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '新建会话重试',
    );
    expect(branchButton).toBeTruthy();

    await act(async () => {
      branchButton?.click();
      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    expect(importSessionMock).toHaveBeenCalled();
    const importedPayload = importSessionMock.mock.calls[0]?.[1] as {
      messages?: Array<Record<string, unknown>>;
    };
    expect(importedPayload.messages).toHaveLength(1);
    expect(importedPayload.messages?.[0]).toEqual(
      expect.objectContaining({ role: 'user', content: expect.any(Array) }),
    );
    expect(updateMetadataMock).toHaveBeenCalledWith(
      'token-123',
      'session-branch',
      expect.objectContaining({
        parentSessionId: 'session-1',
        editSourceMessageId: 'user-retry',
      }),
    );
    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls.at(-1)?.[1]).toContain('请重新生成这条回复');
  });

  it('persists thumbs up/down feedback for assistant messages', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [
        {
          id: 'user-feedback',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '这条回答怎么样？' }],
        },
        {
          id: 'assistant-feedback',
          role: 'assistant',
          createdAt: 2,
          content: [{ type: 'text', text: '这是一条可评价的回答。' }],
        },
      ],
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const thumbsUpButton = rendered.querySelector(
      '[data-testid="chat-message-action-rate-up-assistant-feedback"]',
    ) as HTMLButtonElement | null;
    const thumbsDownButton = rendered.querySelector(
      '[data-testid="chat-message-action-rate-down-assistant-feedback"]',
    ) as HTMLButtonElement | null;

    expect(thumbsUpButton?.textContent).toContain('👍');
    expect(thumbsDownButton?.textContent).toContain('👎');

    await act(async () => {
      thumbsUpButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setMessageRatingMock).toHaveBeenCalledWith(
      'token-123',
      'session-1',
      'assistant-feedback',
      { rating: 'up' },
    );

    await act(async () => {
      thumbsUpButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(deleteMessageRatingMock).toHaveBeenCalledWith(
      'token-123',
      'session-1',
      'assistant-feedback',
    );
  });

  it('saves the current chat configuration as a workspace agent profile', async () => {
    workspaceMock.workingDirectory = '/repo/alpha';
    listCapabilitiesMock.mockImplementationOnce(
      async () =>
        [
          {
            id: 'hephaestus',
            kind: 'agent',
            label: 'Hephaestus',
            description: '程序员执行代理',
            source: 'builtin',
            callable: false,
          },
        ] as Array<Record<string, unknown>>,
    );

    const rendered = await renderChatPage('/chat/session-1');
    const toolSurfaceSelect = rendered.querySelector(
      'select[aria-label="工具配置档"]',
    ) as HTMLSelectElement | null;
    const saveProfileButton = Array.from(rendered.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('保存为项目配置'),
    );

    expect(saveProfileButton).toBeTruthy();

    act(() => {
      if (toolSurfaceSelect) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(toolSurfaceSelect, 'claude_code_simple');
        toolSurfaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      saveProfileButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(createAgentProfileMock).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        workspacePath: '/repo/alpha',
        toolSurfaceProfile: 'claude_code_simple',
      }),
    );
  });

  it('shows pending permissions in the right panel runtime sections', async () => {
    listPendingPermissionsMock.mockImplementation(async () => [
      {
        requestId: 'perm-1',
        sessionId: 'session-1',
        toolName: 'bash',
        scope: 'workspace',
        reason: '需要运行命令',
        riskLevel: 'medium',
        previewAction: 'pnpm test',
        status: 'pending',
        createdAt: '2026-03-24T00:00:00.000Z',
      },
    ]);

    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    const historyButton = rendered.querySelector(
      '#chat-right-tab-history',
    ) as HTMLButtonElement | null;

    act(() => {
      historyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await flushEffects();

    expect(rendered.textContent).toContain('待处理审批');
    expect(rendered.textContent).toContain('需要运行命令');
    expect(rendered.textContent).toContain('workspace · medium · pnpm test');
  });

  it('only loads runtime endpoints once for idle sessions', async () => {
    vi.useFakeTimers();

    await renderChatPage('/chat/session-1');

    expect(getTodoLanesMock).toHaveBeenCalledTimes(1);
    expect(getChildrenMock).toHaveBeenCalledTimes(1);
    expect(getTasksMock).toHaveBeenCalledTimes(1);
    expect(listPendingPermissionsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });

    expect(getTodoLanesMock).toHaveBeenCalledTimes(1);
    expect(getChildrenMock).toHaveBeenCalledTimes(1);
    expect(getTasksMock).toHaveBeenCalledTimes(1);
    expect(listPendingPermissionsMock).toHaveBeenCalledTimes(1);
  });

  it('keeps runtime polling active even before the right panel is opened while the session is running', async () => {
    vi.useFakeTimers();
    getSessionMock.mockImplementation(async () => ({ messages: [], state_status: 'running' }));

    await renderChatPage('/chat/session-1');

    expect(getTodoLanesMock).toHaveBeenCalledTimes(1);
    expect(getChildrenMock).toHaveBeenCalled();
    expect(getTasksMock).toHaveBeenCalled();
    expect(listPendingPermissionsMock).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(getTodoLanesMock).toHaveBeenCalledTimes(4);
    expect(getChildrenMock).toHaveBeenCalledTimes(4);
    expect(getTasksMock).toHaveBeenCalledTimes(4);
    expect(listPendingPermissionsMock).toHaveBeenCalledTimes(4);
  });

  it('waits for the current recovery poll to settle before scheduling the next poll', async () => {
    vi.useFakeTimers();
    const recoveryPayload = {
      activeStream: null,
      children: [],
      pendingPermissions: [],
      pendingQuestions: [],
      ratings: [],
      session: { messages: [], state_status: 'running' },
      tasks: [],
      todoLanes: { main: [], temp: [] },
    };

    let resolveRecovery: ((value: typeof recoveryPayload) => void) | null = null;

    getRecoveryMock.mockReset();
    getRecoveryMock
      .mockImplementationOnce(
        async () =>
          new Promise<typeof recoveryPayload>((resolve) => {
            resolveRecovery = resolve;
          }),
      )
      .mockImplementation(async () => recoveryPayload);

    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(getRecoveryMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(getRecoveryMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRecovery?.(recoveryPayload);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    await flushEffects();

    expect(getRecoveryMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not refetch MCP status while the MCP tab is hidden', async () => {
    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    const mcpButton = rendered.querySelector('#chat-right-tab-mcp') as HTMLButtonElement | null;
    act(() => {
      mcpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(providerFetchUrls.some((url) => url.endsWith('/settings/mcp-status'))).toBe(true);

    providerFetchUrls.length = 0;
    fetchMock.mockClear();

    const closePanelButton = rendered.querySelector('button[title="收起面板"]');
    act(() => {
      closePanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    act(() => {
      useAuthStore.setState({ gatewayUrl: 'http://localhost:4001' });
    });
    await flushEffects();

    expect(providerFetchUrls.some((url) => url.endsWith('/settings/mcp-status'))).toBe(false);
  });

  it('falls back to an enabled chat model when session metadata points to a disabled selection', async () => {
    getSessionMock.mockImplementationOnce(async () => ({
      messages: [],
      metadata_json: JSON.stringify({
        providerId: 'disabled-provider',
        modelId: 'disabled-model',
      }),
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '检查模型回退');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls[0]?.[2]?.model).toBe('gpt-5');
  });

  it('writes providerId and modelId into newly created session metadata before streaming', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '检查新会话模型选择');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createSessionMock).toHaveBeenCalledWith('token-123', {
      metadata: expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-5',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    });
    expect(streamMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        providerId: 'openai',
        model: 'gpt-5',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    );
  });

  it('keeps the composer focused after sending a message', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      textarea?.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续下一步');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(textarea);

    await act(async () => {
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(textarea);
  });

  it('shows the detailed upstream error message instead of only the error code', async () => {
    vi.mocked(logger.error).mockClear();
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        (callbacks['onError'] as (code: string, message?: string) => void)(
          'MODEL_ERROR',
          'Upstream request failed (404): The model `gpt-5.1-nano` does not exist',
        );
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '介绍你自己');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain(
      'MODEL_ERROR: Upstream request failed (404): The model `gpt-5.1-nano` does not exist',
    );
    expect(rendered.querySelector('[data-testid="chat-message-error-banner"]')).not.toBeNull();
    expect(rendered.textContent).toContain('MODEL_ERROR');
    expect(rendered.textContent).toContain('Upstream request failed (404)');
    expect(rendered.textContent).toContain('The model `gpt-5.1-nano` does not exist');
    expect(logger.error).toHaveBeenCalledWith(
      'stream error',
      'MODEL_ERROR: Upstream request failed (404): The model `gpt-5.1-nano` does not exist',
    );
  });

  it('shows a user-facing quota exceeded message instead of raw upstream limit details', async () => {
    vi.mocked(logger.error).mockClear();
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        (callbacks['onError'] as (code: string, message?: string) => void)(
          'QUOTA_EXCEEDED',
          '当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
        );
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '继续对话');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain(
      'QUOTA_EXCEEDED: 当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
    );
    expect(rendered.querySelector('[data-testid="chat-message-error-banner"]')).not.toBeNull();
    expect(rendered.textContent).toContain('QUOTA_EXCEEDED');
    expect(rendered.textContent).not.toContain('DAILY_LIMIT_EXCEEDED');
    expect(logger.error).toHaveBeenCalledWith(
      'stream error',
      'QUOTA_EXCEEDED: 当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
    );
  });

  it('renders streaming text deltas before the final assistant message is committed', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请流式回答');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第一段');
      await Promise.resolve();
    });

    await flushStreamRevealFrame(4);
    await flushEffects();

    expect(rendered.textContent).toContain('第一段');
    expect(rendered.textContent).not.toContain('第二段');

    await act(async () => {
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('第二段');
      await Promise.resolve();
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('第一段第二段');
  });

  it('renders streaming markdown content with document formatting before completion', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请输出一个文档');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
        '# 文档标题\n\n第一段\n\n- 第一项',
      );
      await Promise.resolve();
    });

    await flushStreamRevealFrame(12);
    await flushEffects();

    expect(rendered.querySelector('.chat-markdown-h1')?.textContent).toBe('文档标题');
    expect(rendered.querySelector('.chat-markdown-ul')).not.toBeNull();
  });

  it('renders streaming structured cards before the assistant message completes', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请返回结构化状态');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.(
        JSON.stringify({
          type: 'status',
          payload: {
            title: '结构化状态',
            message: '流式阶段已按卡片渲染',
            tone: 'info',
          },
        }),
      );
      await Promise.resolve();
    });

    await flushStreamRevealFrame(16);

    expect(rendered.querySelector('[data-testid="mock-generative-ui"]')).not.toBeNull();
    expect(rendered.textContent).toContain('结构化状态');
  });

  it('renders streamed tool calls inline and auto-opens the tools panel on first use', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
    const getMessageRows = () => Array.from(rendered.querySelectorAll('.chat-message-row'));

    expect(rendered.querySelector('button[title="收起面板"]')).toBeNull();
    expect(getMessageRows()).toHaveLength(0);

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '帮我检查工作区状态');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getMessageRows()).toHaveLength(2);
    expect(rendered.querySelector('[data-testid="chat-streaming-placeholder"]')).not.toBeNull();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const toolChunk = {
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '{"query":"工作区状态"}',
      };
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.(toolChunk);
      (pendingCallbacks?.['onToolCall'] as ((chunk: unknown) => void) | undefined)?.(toolChunk);
      await Promise.resolve();
    });

    await act(async () => {
      const toolResultEvent = {
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'web_search',
        output: { summary: '工作区状态已读取' },
        isError: false,
      };
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.(toolResultEvent);
      await Promise.resolve();
    });

    expect(rendered.querySelector('button[title="收起面板"]')).not.toBeNull();
    const toolsTab = rendered.querySelector('#chat-right-tab-tools') as HTMLButtonElement | null;
    expect(toolsTab?.getAttribute('aria-selected')).toBe('true');
    expect(getMessageRows()).toHaveLength(2);
    const toolRow = getMessageRows().find((row) => row.textContent?.includes('web_search'));
    expect(toolRow?.querySelectorAll('.assistant-rich-content')).toHaveLength(1);
    expect(toolRow?.textContent).toContain('工作区状态');
    expect(toolRow?.textContent).not.toContain('工作区状态已读取');

    const toolToggle = Array.from(toolRow?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('web_search'),
    ) as HTMLButtonElement | undefined;
    act(() => {
      toolToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(toolRow?.textContent).toContain('工作区状态已读取');
  });

  it('uses task runtime overlays inside the tools panel for child-task records', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );
    getChildrenMock.mockResolvedValue([{ id: 'child-1', title: 'MCP 文档检索' } as Session]);
    getTasksMock.mockResolvedValue([
      {
        id: 'task-child-tools',
        title: 'MCP 文档检索',
        status: 'completed',
        blockedBy: [],
        completedSubtaskCount: 0,
        readySubtaskCount: 0,
        sessionId: 'child-1',
        assignedAgent: 'librarian',
        priority: 'medium',
        tags: ['task-tool', 'librarian'],
        createdAt: 1,
        updatedAt: 2,
        depth: 0,
        subtaskCount: 0,
        unmetDependencyCount: 0,
        result: '子代理已经执行完成。',
      } as SessionTask,
    ]);

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '帮我委派一个子代理');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const toolChunk = {
        type: 'tool_call_delta',
        toolCallId: 'task_call_1',
        toolName: 'task',
        inputDelta:
          '{"description":"MCP 文档检索","prompt":"检查 MCP 文档并给出结论","subagent_type":"librarian"}',
      };
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.(toolChunk);
      (pendingCallbacks?.['onToolCall'] as ((chunk: unknown) => void) | undefined)?.(toolChunk);
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.({
        type: 'tool_result',
        toolCallId: 'task_call_1',
        toolName: 'task',
        output: {
          taskId: 'task-child-tools',
          sessionId: 'child-1',
          status: 'running',
        },
        isError: false,
      });
      await Promise.resolve();
    });
    await flushEffects();

    const toolsTab = rendered.querySelector('#chat-right-tab-tools') as HTMLButtonElement | null;
    expect(toolsTab?.getAttribute('aria-selected')).toBe('true');
    expect(rendered.textContent).toContain('子代理已经执行完成。');
  });

  it('rebuilds tools panel state from persisted session run events after reload', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          createdAt: 1,
          content: [{ type: 'text', text: '帮我检查工作区状态' }],
        },
      ],
      runEvents: [
        {
          type: 'tool_call_delta',
          toolCallId: 'call_1',
          toolName: 'web_search',
          inputDelta: '{"query":"工作区状态"}',
        },
        {
          type: 'tool_result',
          toolCallId: 'call_1',
          toolName: 'web_search',
          output: { summary: '工作区状态已读取' },
          isError: false,
        },
      ],
      state_status: 'idle',
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    const toolsTab = rendered.querySelector('#chat-right-tab-tools') as HTMLButtonElement | null;
    act(() => {
      toolsTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    const restoredToolCard = rendered.querySelector(
      '[data-tool-card-root="true"]',
    ) as HTMLDivElement | null;
    expect(restoredToolCard).not.toBeNull();
    expect(rendered.textContent).toContain('帮我检查工作区状态');
    expect(restoredToolCard?.textContent).toContain('web_search');

    act(() => {
      restoredToolCard
        ?.querySelector('[data-tool-card-toggle="true"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(restoredToolCard?.textContent).toContain('工作区状态已读取');
  });

  it('renders the viz tab from persisted run events after reload', async () => {
    getSessionMock.mockImplementation(async () => ({
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '帮我执行多步骤任务',
          createdAt: 1,
          status: 'completed',
        },
      ],
      runEvents: [
        {
          type: 'task_update',
          taskId: 'task-1',
          label: '拆解任务',
          status: 'running',
          assignedAgent: 'explore',
          occurredAt: 10,
        },
        {
          type: 'permission_asked',
          requestId: 'perm-1',
          toolName: 'bash',
          scope: 'session',
          riskLevel: 'medium',
          reason: '需要执行命令',
          previewAction: '运行验证命令',
          sessionId: 'session-1',
          occurredAt: 11,
        },
      ],
      state_status: 'running',
    }));

    const rendered = await renderChatPage('/chat/session-1');
    const openPanelButton = rendered.querySelector('button[title="展开面板"]');

    act(() => {
      openPanelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    const vizTab = rendered.querySelector('#chat-right-tab-viz') as HTMLButtonElement | null;
    act(() => {
      vizTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushEffects();

    expect(rendered.querySelector('[data-testid="mock-agent-dag-graph"]')?.textContent).toContain(
      '当前对话',
    );
    expect(rendered.querySelector('[data-testid="mock-agent-viz-panel"]')?.textContent).toContain(
      '开始处理用户请求',
    );
    expect(rendered.querySelector('[data-testid="mock-agent-viz-panel"]')?.textContent).toContain(
      '等待权限：bash · 运行验证命令',
    );
  });

  it('keeps one assistant bubble after tool calls finish streaming', async () => {
    let pendingCallbacks: Record<string, unknown> | null = null;
    streamMock.mockImplementationOnce(
      (_sessionId: string, _message: string, callbacks: Record<string, unknown>) => {
        pendingCallbacks = callbacks;
      },
    );

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
    const getMessageRows = () => Array.from(rendered.querySelectorAll('.chat-message-row'));

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '帮我检查工作区状态');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      const toolChunk = {
        type: 'tool_call_delta',
        toolCallId: 'call_1',
        toolName: 'web_search',
        inputDelta: '{"query":"工作区状态"}',
      };
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.(toolChunk);
      (pendingCallbacks?.['onToolCall'] as ((chunk: unknown) => void) | undefined)?.(toolChunk);
      const toolResultEvent = {
        type: 'tool_result',
        toolCallId: 'call_1',
        toolName: 'web_search',
        output: { summary: '工作区状态已读取' },
        isError: false,
      };
      (pendingCallbacks?.['onEvent'] as ((event: unknown) => void) | undefined)?.(toolResultEvent);
      (pendingCallbacks?.['onDelta'] as ((delta: string) => void) | undefined)?.('检查完成');
      (pendingCallbacks?.['onDone'] as ((stopReason?: string) => void) | undefined)?.('end_turn');
      await Promise.resolve();
    });

    expect(getMessageRows()).toHaveLength(2);
    const assistantRows = getMessageRows().filter(
      (row) => row.getAttribute('data-role') === 'assistant',
    );
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.querySelectorAll('.assistant-rich-content')).toHaveLength(1);
    expect(assistantRows[0]?.textContent).toContain('web_search');
    expect(assistantRows[0]?.textContent).toContain('检查完成');
  });

  it('persists dialogueMode, yoloMode, toolSurfaceProfile, and manual agent changes to the current session metadata', async () => {
    getSessionMock.mockImplementationOnce(async () => ({ messages: [] }));
    listCapabilitiesMock.mockImplementationOnce(
      async () =>
        [
          {
            id: 'hephaestus',
            kind: 'agent',
            label: 'Hephaestus',
            description: '程序员执行代理',
            source: 'builtin',
            callable: false,
          },
          {
            id: 'sisyphus-junior',
            kind: 'agent',
            label: 'Sisyphus Junior',
            description: '编程执行代理',
            source: 'builtin',
            callable: false,
          },
        ] as Array<Record<string, unknown>>,
    );
    const rendered = await renderChatPage('/chat/session-1');

    const codingButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '编程',
    );
    const yoloButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'YOLO',
    );
    const toolSurfaceSelect = rendered.querySelector(
      'select[aria-label="工具配置档"]',
    ) as HTMLSelectElement | null;
    const agentSelect = rendered.querySelector(
      'select[aria-label="聊天代理"]',
    ) as HTMLSelectElement | null;
    expect(toolSurfaceSelect).toBeTruthy();
    expect(agentSelect).toBeTruthy();

    await flushEffects();
    expect(
      Array.from(agentSelect?.querySelectorAll('option') ?? []).some(
        (option) => option.getAttribute('value') === 'sisyphus-junior',
      ),
    ).toBe(true);

    act(() => {
      codingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      yoloButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (toolSurfaceSelect) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(toolSurfaceSelect, 'claude_code_simple');
        toolSurfaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (agentSelect) {
        const agentValueSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set;
        agentValueSetter?.call(agentSelect, 'sisyphus-junior');
        agentSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateMetadataMock).toHaveBeenCalledWith(
      'token-123',
      'session-1',
      expect.objectContaining({
        agentId: 'sisyphus-junior',
        dialogueMode: 'coding',
        yoloMode: true,
        toolSurfaceProfile: 'claude_code_simple',
      }),
    );
  });

  it('does not send agentId after switching back to clarify mode', async () => {
    streamMock.mockImplementationOnce(() => undefined);

    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const sendButton = rendered.querySelector('button.btn-accent') as HTMLButtonElement | null;
    const codingButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '编程',
    );
    const clarifyButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '澄清',
    );

    act(() => {
      codingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      clarifyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '先帮我厘清需求');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(streamMock).toHaveBeenCalled();
    expect(streamMock.mock.calls[0]?.[2]?.agentId).toBeUndefined();
  });

  it('shows slash command suggestions when input starts with slash', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '/');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('/compact');
    expect(rendered.textContent).toContain('/handoff');
  });

  it('does not preload workspace file suggestions before a workspace is selected', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    expect(workspaceMock.fetchTree).not.toHaveBeenCalled();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '@');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(workspaceMock.fetchTree).not.toHaveBeenCalled();
    expect(rendered.textContent).not.toContain('README.md');
  });

  it('shows workspace file suggestions when input contains @ trigger', async () => {
    useUIStateStore.setState({
      selectedWorkspacePath: '/workspace',
      fileTreeRootPath: '/workspace',
    });
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '@');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await flushEffects();

    expect(rendered.textContent).toContain('README.md');
    expect(rendered.textContent).toContain('main.ts');
  });

  it('adds pasted images into attachments and preview flow', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const file = new File(['img'], 'pasted-image.png', { type: 'image/png' });

    act(() => {
      const event = new Event('paste', { bubbles: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: vi.fn(() => ''),
          items: [
            {
              type: 'image/png',
              getAsFile: () => file,
            },
          ],
        },
      });
      textarea!.dispatchEvent(event);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(rendered.textContent).toContain('pasted-image.png');
    expect(rendered.querySelector('[data-testid="image-preview"]')).not.toBeNull();
  });

  it('strips bracketed paste host noise before text lands in the composer', async () => {
    const rendered = await renderChatPage('/chat');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const event = new Event('paste', { bubbles: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: vi.fn(() => '\u001b[200~[Pasted ~4 会话已压缩\u001b[201~'),
          items: [],
        },
      });
      textarea!.dispatchEvent(event);
    });

    await flushEffects();

    expect(textarea?.value).toBe('会话已压缩');
  });

  it('uploads pasted screenshots as artifacts before sending the chat request', async () => {
    streamMock.mockImplementationOnce(() => undefined);

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;
    const pastedFile = new File(['png-binary'], 'pasted-image.png', { type: 'image/png' });

    act(() => {
      const event = new Event('paste', { bubbles: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          getData: vi.fn(() => ''),
          items: [
            {
              type: 'image/png',
              getAsFile: () => pastedFile,
            },
          ],
        },
      });
      textarea!.dispatchEvent(event);
    });

    await flushEffects();

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '请分析这张截图');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | undefined;

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await flushEffects();

    expect(uploadArtifactMock).toHaveBeenCalledTimes(1);
    expect(uploadArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'pasted-image.png',
        mimeType: 'image/png',
        sizeBytes: pastedFile.size,
        contentBase64: expect.any(String),
      }),
    );
    expect(String(streamMock.mock.calls[0]?.[1] ?? '')).toContain('请分析这张截图');
    expect(String(streamMock.mock.calls[0]?.[1] ?? '')).toContain(
      '[附件]\n- pasted-image.png (artifact:artifact-1)',
    );
  });

  it('sanitizes pasted host noise again before sending the chat request', async () => {
    streamMock.mockImplementationOnce(() => undefined);

    const rendered = await renderChatPage('/chat/session-1');
    const textarea = rendered.querySelector('textarea') as HTMLTextAreaElement | null;

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(textarea, '\u001b[200~[Pasted ~4 继续总结今天的改动\u001b[201~');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = Array.from(rendered.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '发送',
    ) as HTMLButtonElement | undefined;

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();
    await flushEffects();

    expect(String(streamMock.mock.calls[0]?.[1] ?? '')).toBe('继续总结今天的改动');
  });
});
