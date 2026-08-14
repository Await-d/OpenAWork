// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InstructionStackSegment } from '../../data/parse-instruction-stack.js';
import { MAX_KNOWLEDGE_SEARCH_LENGTH } from './workspace-knowledge-graph-constants.js';

type MockRoleLayer = 'reception' | 'pm1' | 'pm2' | 'executor' | 'reviewer';

type MockKnowledgeRecord = {
  confidence: number;
  createdAt: string;
  enabled: boolean;
  id: string;
  key: string;
  priority: number;
  roleLayers: MockRoleLayer[] | null;
  source: 'manual' | 'auto_extracted' | 'api';
  teamWorkspaceId: string | null;
  type: 'preference' | 'fact' | 'instruction' | 'project_context' | 'learned_pattern';
  updatedAt: string;
  value: string;
  workspaceRoot: string | null;
};

function createKnowledgeRecord(overrides: Partial<MockKnowledgeRecord> = {}): MockKnowledgeRecord {
  return {
    confidence: 1,
    createdAt: '2026-06-08T00:00:00.000Z',
    enabled: true,
    id: 'memory-1',
    key: 'artifact:artifact-spec',
    priority: 70,
    roleLayers: null,
    source: 'manual',
    teamWorkspaceId: 'workspace-1',
    type: 'project_context',
    updatedAt: '2026-06-08T00:00:00.000Z',
    value: 'spec knowledge',
    workspaceRoot: null,
    ...overrides,
  };
}

const mockKnowledgeState = {
  artifacts: [] as Array<{
    content?: string;
    id: string;
    parentArtifactId?: string | null;
    phase: string | null;
    title: string;
    type?: string;
  }>,
  error: null as string | null,
  instructionSegments: [] as InstructionStackSegment[],
  loading: false,
  persistedKnowledge: [] as MockKnowledgeRecord[],
  persistedKnowledgeTruncated: false,
  saveKnowledge: vi.fn(),
  storedKnowledge: [] as MockKnowledgeRecord[],
};
const mockKnowledgeHookCalls: unknown[][] = [];

function filterMockStoredKnowledgeByRole(
  records: MockKnowledgeRecord[],
  roleLayer: MockRoleLayer | undefined,
): MockKnowledgeRecord[] {
  if (!roleLayer) {
    return records;
  }
  return records.filter(
    (record) => record.roleLayers === null || record.roleLayers.includes(roleLayer),
  );
}

vi.mock('../../hooks/use-team-workspace-knowledge.js', () => ({
  useTeamWorkspaceKnowledge: (...args: unknown[]) => {
    mockKnowledgeHookCalls.push(args);
    const options = args[1] as { roleLayer?: MockRoleLayer } | undefined;
    return {
      ...mockKnowledgeState,
      storedKnowledge: filterMockStoredKnowledgeByRole(
        mockKnowledgeState.storedKnowledge,
        options?.roleLayer,
      ),
    };
  },
}));

import { WorkspaceKnowledgeGraphView } from './WorkspaceKnowledgeGraphView.js';

const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  cleanup();
  vi.stubGlobal('CanvasRenderingContext2D', Object);
  const mockContext = createMockCanvasContext();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn((contextType: string) => {
      if (contextType === '2d') {
        return mockContext;
      }
      return null;
    }),
  });
  mockKnowledgeState.artifacts = [];
  mockKnowledgeState.error = null;
  mockKnowledgeState.instructionSegments = [];
  mockKnowledgeState.loading = false;
  mockKnowledgeState.persistedKnowledge = [];
  mockKnowledgeState.persistedKnowledgeTruncated = false;
  mockKnowledgeState.saveKnowledge = vi.fn();
  mockKnowledgeState.storedKnowledge = [];
  mockKnowledgeHookCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: originalCanvasGetContext,
  });
});

function getGraphNodeButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: `选择节点：${label}` });
}

function queryGraphNodeButton(label: string): HTMLElement | null {
  return screen.queryByRole('button', { name: `选择节点：${label}` });
}

function clickGraphNode(label: string): void {
  fireEvent.click(getGraphNodeButton(label));
}

function createMockCanvasContext(): CanvasRenderingContext2D {
  const context: Partial<CanvasRenderingContext2D> = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillStyle: '',
    fillText: vi.fn(),
    font: '',
    globalAlpha: 1,
    lineTo: vi.fn(),
    lineWidth: 1,
    measureText: vi.fn((text: string) => ({
      width: text.length * 8,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 8,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
      alphabeticBaseline: 0,
      emHeightAscent: 12,
      emHeightDescent: 3,
      hangingBaseline: 0,
      ideographicBaseline: 0,
    })),
    moveTo: vi.fn(),
    rect: vi.fn(),
    restore: vi.fn(),
    roundRect: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    createLinearGradient: vi.fn(
      () =>
        ({
          addColorStop: vi.fn(),
        }) as unknown as CanvasGradient,
    ),
    createRadialGradient: vi.fn(
      () =>
        ({
          addColorStop: vi.fn(),
        }) as unknown as CanvasGradient,
    ),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'middle' as CanvasTextBaseline,
    translate: vi.fn(),
  };
  return context as unknown as CanvasRenderingContext2D;
}

describe('WorkspaceKnowledgeGraphView', () => {
  it('加载中且暂无节点时展示加载态', () => {
    mockKnowledgeState.loading = true;

    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('加载图谱中…')).toBeTruthy();
    expect(screen.getByText('正在拉取工作区知识、记忆、架构与产物链。')).toBeTruthy();
  });

  it('加载失败且暂无节点时展示错误态', () => {
    mockKnowledgeState.error = '读取工作区知识失败';

    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('图谱加载失败')).toBeTruthy();
    expect(screen.getByText('读取工作区知识失败')).toBeTruthy();
  });

  it('有图谱数据但刷新失败时保留图谱并提示数据可能不完整', () => {
    mockKnowledgeState.error = '刷新工作区知识失败';
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('图谱数据可能不完整：刷新工作区知识失败');
    expect(screen.queryByText('图谱加载失败')).toBeNull();
  });

  it('无数据且非加载失败时展示空态', () => {
    render(<WorkspaceKnowledgeGraphView teamWorkspaceId="workspace-1" />);

    expect(screen.getByText('暂无图谱数据')).toBeTruthy();
    expect(
      screen.getByText(
        '配置架构说明、项目记忆、团队宪法或产生工作区 artifact 后，这里会展示它们之间的知识关系。',
      ),
    ).toBeTruthy();
  });

  it('展示工作区知识、记忆、架构和产物链，而不是会话关系', () => {
    mockKnowledgeState.instructionSegments = [
      {
        body: '# 分层架构\n前端通过 web-client 访问网关。',
        kind: 'architecture-md',
        layer: 'architecture-md',
      },
      {
        body: '用户偏好中文回复。',
        kind: 'user-memory',
        layer: 'user-memory',
      },
    ];
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('产品工作区')).toBeTruthy();
    expect(getGraphNodeButton('架构说明')).toBeTruthy();
    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('实施计划')).toBeTruthy();
    expect(screen.getByText(/工作区知识资产 · 4 个知识节点/)).toBeTruthy();
    expect(screen.queryByText(/会话/)).toBeNull();
    expect(screen.queryByText(/handoff/i)).toBeNull();
  });

  it('选中知识节点后可以调用入库操作', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: true,
      knowledge: createKnowledgeRecord({
        key: (input as { key: string }).key,
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '入库' }));

    await waitFor(() => {
      expect(mockKnowledgeState.saveKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'artifact:artifact-spec',
          roleLayers: null,
          type: 'project_context',
          value: expect.stringContaining('Spec'),
        }),
      );
    });
    expect((await screen.findByRole('status')).textContent).toBe('已入库知识。');
  });

  it('入库时可以指定由某个 AI 层级读取', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: true,
      knowledge: createKnowledgeRecord({
        key: (input as { key: string }).key,
        roleLayers: (input as { roleLayers: ['executor'] }).roleLayers,
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n执行层专用约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '执行约束',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('执行约束');
    const allLayerButton = screen.getByRole('button', { name: '全部层级' });
    const executorLayerButton = screen.getByRole('button', { name: '执行' });
    expect(allLayerButton.getAttribute('aria-pressed')).toBe('true');
    expect(executorLayerButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(executorLayerButton);
    expect(allLayerButton.getAttribute('aria-pressed')).toBe('false');
    expect(executorLayerButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(executorLayerButton);
    expect(allLayerButton.getAttribute('aria-pressed')).toBe('true');
    expect(executorLayerButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(executorLayerButton);
    fireEvent.click(screen.getByRole('button', { name: '入库' }));

    await waitFor(() => {
      expect(mockKnowledgeState.saveKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'artifact:artifact-spec',
          roleLayers: ['executor'],
        }),
      );
    });
  });

  it('切换预览层级后按该层查询工作区知识', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n执行层专用约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '执行约束',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    const executorPreviewButton = screen.getByRole('button', { name: '预览执行' });
    fireEvent.click(executorPreviewButton);

    expect(mockKnowledgeHookCalls[mockKnowledgeHookCalls.length - 1]).toEqual([
      'workspace-1',
      expect.objectContaining({ roleLayer: 'executor' }),
    ]);
    expect(executorPreviewButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/当前预览 执行层/)).toBeTruthy();
  });

  it('层级预览无可读知识时保留工具栏，用户可以切回全部层级', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-pm1-only',
        key: 'manual:pm1-only',
        roleLayers: ['pm1'],
        value: 'PM1 私有工作区知识。',
      }),
    ];
    mockKnowledgeState.persistedKnowledge = [...mockKnowledgeState.storedKnowledge];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('manual:pm1-only')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '预览执行' }));

    expect(screen.getByText('未找到匹配知识')).toBeTruthy();
    expect(
      screen.getByText(
        '执行层当前没有可读取的工作区知识。可以切回全部层级，或调整知识入库读取范围。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('暂无图谱数据')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '预览全部' }));

    expect(getGraphNodeButton('manual:pm1-only')).toBeTruthy();
  });

  it('切换预览层级时保留当前节点、局部图和未入库节点默认读取范围', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '1跳' }));
    fireEvent.click(screen.getByRole('button', { name: '预览执行' }));

    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();
    expect(screen.getByText(/局部图 1 跳/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('当前预览层：执行')).toBeTruthy();
  });

  it('选中普通知识节点后自动局部图会展开同组知识，不会直接铺开其它分类', async () => {
    mockKnowledgeState.instructionSegments = [
      {
        body: '用户偏好中文回复。',
        kind: 'user-memory',
        layer: 'user-memory',
      },
      {
        body: '复查时需要主动从页面和用户角度检查。',
        kind: 'lessons-learned',
        layer: 'lessons-learned',
      },
    ];
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('需求规格')).toBeTruthy();

    clickGraphNode('个人记忆');

    await waitFor(() => {
      expect(getGraphNodeButton('经验沉淀')).toBeTruthy();
    });
    expect(queryGraphNodeButton('需求规格')).toBeNull();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
  });

  it('选中有派生关系的产物时局部图优先展示派生链，避免混入无关产物', async () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
      {
        content: '# Review\n另一条独立评审。',
        id: 'artifact-review',
        phase: 'review_report',
        title: '独立评审报告',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('独立评审报告')).toBeTruthy();

    clickGraphNode('需求规格');

    await waitFor(() => {
      expect(getGraphNodeButton('实施计划')).toBeTruthy();
    });
    expect(queryGraphNodeButton('独立评审报告')).toBeNull();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
  });

  it('重复点击当前预览层不会重置手动选择的入库读取范围', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n执行层专用约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '执行约束',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    const executorPreviewButton = screen.getByRole('button', { name: '预览执行' });
    fireEvent.click(executorPreviewButton);
    clickGraphNode('执行约束');
    fireEvent.click(screen.getByRole('button', { name: 'PM1' }));
    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'PM1' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(executorPreviewButton);

    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'PM1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('当前层级预览下入库未持久化节点时默认写入该层级范围', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: true,
      knowledge: createKnowledgeRecord({
        key: (input as { key: string }).key,
        roleLayers: (input as { roleLayers: ['executor'] }).roleLayers,
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n执行层专用约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '执行约束',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '预览执行' }));
    clickGraphNode('执行约束');
    fireEvent.click(screen.getByRole('button', { name: '入库' }));

    await waitFor(() => {
      expect(mockKnowledgeState.saveKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'artifact:artifact-spec',
          roleLayers: ['executor'],
        }),
      );
    });
  });

  it('当前层不可读但已入库的节点不会按当前层级覆盖读取范围', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: false,
      knowledge: createKnowledgeRecord({
        id: 'memory-pm1',
        key: (input as { key: string }).key,
        roleLayers: (input as { roleLayers: ['pm1'] }).roleLayers,
        value: '后端人工整理知识正文。',
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\nPM1 已入库约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.persistedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-pm1',
        key: 'artifact:artifact-spec',
        roleLayers: ['pm1'],
        value: '后端人工整理知识正文。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '预览执行' }));
    clickGraphNode('需求规格');

    expect(screen.getAllByText('已入库').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('当前层不可读 · 可读：PM1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PM1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '执行' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '更新入库范围' }));

    await waitFor(() => {
      expect(mockKnowledgeState.saveKnowledge).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'artifact:artifact-spec',
          roleLayers: ['pm1'],
          value: '后端人工整理知识正文。',
        }),
      );
    });
    const savedInput = mockKnowledgeState.saveKnowledge.mock.calls[0]?.[0] as
      { confidence?: number; priority?: number; source?: string } | undefined;
    expect(savedInput).toBeDefined();
    expect(savedInput).not.toHaveProperty('confidence');
    expect(savedInput).not.toHaveProperty('priority');
    expect(savedInput).not.toHaveProperty('source');
  });

  it('搜索无匹配时仍保留清除入口', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '不存在的知识' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(screen.getByText('未找到匹配知识')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
  });

  it('查询按钮只在查询草稿变化时启用，避免空操作误触', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    const searchInput = screen.getByLabelText('查询工作区知识');
    const queryButton = screen.getByRole('button', { name: '查询' });
    expect(searchInput.getAttribute('maxlength')).toBe(String(MAX_KNOWLEDGE_SEARCH_LENGTH));
    expect(queryButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(searchInput, {
      target: { value: '目标用户' },
    });
    expect(queryButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(queryButton);
    expect(queryButton.hasAttribute('disabled')).toBe(true);

    fireEvent.change(searchInput, {
      target: { value: '目标用户   ' },
    });
    expect(queryButton.hasAttribute('disabled')).toBe(true);
  });

  it('重复或空白 Enter 查询不会清掉当前节点详情', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    const searchInput = screen.getByLabelText('查询工作区知识');
    clickGraphNode('需求规格');
    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();

    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();

    fireEvent.change(searchInput, {
      target: { value: '目标用户' },
    });
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(screen.getByText('选择一个知识节点后，可以查看来源、摘要和入库状态。')).toBeTruthy();

    clickGraphNode('需求规格');
    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();
  });

  it('入库成功后执行新查询会清除旧选择和成功状态', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: true,
      knowledge: createKnowledgeRecord({
        key: (input as { key: string }).key,
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    expect((await screen.findByRole('status')).textContent).toBe('已入库知识。');

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '目标用户' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('选择一个知识节点后，可以查看来源、摘要和入库状态。')).toBeTruthy();
  });

  it('入库成功后清除查询会清除旧选择和成功状态', async () => {
    mockKnowledgeState.saveKnowledge = vi.fn(async (input: unknown) => ({
      created: true,
      knowledge: createKnowledgeRecord({
        key: (input as { key: string }).key,
      }),
    }));
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '目标用户' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    expect((await screen.findByRole('status')).textContent).toBe('已入库知识。');

    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('选择一个知识节点后，可以查看来源、摘要和入库状态。')).toBeTruthy();
    expect(screen.queryByText('当前查询：目标用户')).toBeNull();
  });

  it('切换标签密度不会移除可访问节点选择入口', () => {
    mockKnowledgeState.instructionSegments = [
      {
        body: '用户偏好中文回复。',
        kind: 'user-memory',
        layer: 'user-memory',
      },
    ];
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '全图' }));

    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标签全部' }));

    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
  });

  it('仅焦点标签模式隐藏视觉标签时仍保留节点选择入口', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '仅焦点' }));

    expect(getGraphNodeButton('产品工作区')).toBeTruthy();
    expect(getGraphNodeButton('知识产物')).toBeTruthy();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('实施计划')).toBeTruthy();
    clickGraphNode('需求规格');
    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '标签全部' }));
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('实施计划')).toBeTruthy();
  });
});
