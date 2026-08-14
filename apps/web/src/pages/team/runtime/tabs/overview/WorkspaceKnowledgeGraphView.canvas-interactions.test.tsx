// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InstructionStackSegment } from '../../data/parse-instruction-stack.js';
import { MAX_KNOWLEDGE_VALUE_LENGTH } from './workspace-knowledge-graph-constants.js';

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

describe('WorkspaceKnowledgeGraphView Canvas interactions', () => {
  it('使用 Canvas 与 d3-force 图谱渲染器，并提供 Obsidian 类图谱控制', () => {
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

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    expect(canvas).toBeTruthy();
    expect(canvas.getAttribute('data-renderer')).toBe('canvas-d3-force');
    expect(screen.getByRole('button', { name: '1跳' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏孤点' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按层级' })).toBeTruthy();
    fireEvent.click(screen.getByText('布局'));
    expect(screen.getByLabelText('图谱排斥')).toBeTruthy();
    expect(screen.getByText('层级预览')).toBeTruthy();
    expect(
      screen
        .getByText('层级预览')
        .closest('.workspace-knowledge-graph-toolbar-group')
        ?.classList.contains('is-primary'),
    ).toBe(true);
    expect(screen.getByText('局部图')).toBeTruthy();
    expect(screen.getAllByText('全图').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('包含')).toBeTruthy();
    expect(screen.getByText('已入库')).toBeTruthy();
  });

  it('Canvas 2D context 不可用时展示可见节点列表作为降级入口', async () => {
    vi.stubGlobal('CanvasRenderingContext2D', undefined);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => null),
    });
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

    expect(await screen.findByText('图谱画布暂不可用')).toBeTruthy();
    expect(queryGraphNodeButton('需求规格')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '需求规格' }));

    expect(screen.getByText('产物 · artifact:artifact-spec')).toBeTruthy();
  });

  it('Canvas 从可用切到不可用后不会继续调用旧绘制函数', async () => {
    let canvasContextAvailable = true;
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
      fillText: vi.fn(),
      font: '',
      globalAlpha: 1,
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'middle' as CanvasTextBaseline,
      translate: vi.fn(),
    } satisfies Partial<CanvasRenderingContext2D>;

    vi.stubGlobal('CanvasRenderingContext2D', Object);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => (canvasContextAvailable ? context : null)),
    });
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];

    const { rerender } = render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    await waitFor(() => {
      expect(context.clearRect).toHaveBeenCalled();
    });
    canvasContextAvailable = false;
    mockKnowledgeState.artifacts = [
      ...mockKnowledgeState.artifacts,
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
    ];

    rerender(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );
    await screen.findByText('图谱画布暂不可用');
    const clearCallsAfterFallback = context.clearRect.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: '标签全部' }));

    expect(context.clearRect.mock.calls.length).toBe(clearCallsAfterFallback);
  });

  it('切换标签密度不会重建 Canvas 画布节点', () => {
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

    const canvas = screen.getByLabelText('工作区知识图谱画布');
    fireEvent.click(screen.getByRole('button', { name: '标签全部' }));

    expect(screen.getByLabelText('工作区知识图谱画布')).toBe(canvas);
  });

  it('未选中节点时禁用局部图裁剪，避免误报局部状态', () => {
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

    const disabledAutoButton = screen.getByRole('button', { name: '自动局部图' });
    const fullGraphButton = screen.getByRole('button', { name: '全图' });
    const disabledLocalButton = screen.getByRole('button', { name: '1跳' });
    expect(disabledAutoButton.hasAttribute('disabled')).toBe(true);
    expect(disabledAutoButton.getAttribute('aria-pressed')).toBe('false');
    expect(disabledAutoButton.getAttribute('title')).toBe('选择节点后自动显示邻域');
    expect(fullGraphButton.hasAttribute('disabled')).toBe(false);
    expect(fullGraphButton.getAttribute('aria-pressed')).toBe('true');
    expect(disabledLocalButton.hasAttribute('disabled')).toBe(true);
    expect(disabledLocalButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fullGraphButton);
    fireEvent.click(disabledLocalButton);
    expect(screen.getByText(/局部图 关闭/)).toBeTruthy();

    clickGraphNode('需求规格');

    expect(screen.getByRole('button', { name: '全图' }).hasAttribute('disabled')).toBe(false);
    const enabledLocalButton = screen.getByRole('button', { name: '1跳' });
    expect(enabledLocalButton.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '自动局部图' }).getAttribute('title')).toBe(
      '按所选节点自动打开默认邻域',
    );
    expect(screen.getByText('自动 2跳')).toBeTruthy();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
    fireEvent.click(enabledLocalButton);
    expect(enabledLocalButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/局部图 1 跳/)).toBeTruthy();
  });

  it('手动切回全图后选择其它节点不会再次自动裁剪', () => {
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
        content: '# Tasks\n任务列表。',
        id: 'artifact-tasks',
        parentArtifactId: 'artifact-plan',
        phase: 'tasks',
        title: '任务拆解',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '全图' }));
    expect(screen.getByText(/局部图 关闭/)).toBeTruthy();

    clickGraphNode('实施计划');

    expect(screen.getByText(/局部图 关闭/)).toBeTruthy();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('任务拆解')).toBeTruthy();
  });

  it('手动关闭局部图后可以从节点详情重新启用自动邻域', () => {
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
        content: '# Tasks\n任务列表。',
        id: 'artifact-tasks',
        parentArtifactId: 'artifact-plan',
        phase: 'tasks',
        title: '任务拆解',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');
    fireEvent.click(screen.getByRole('button', { name: '全图' }));
    clickGraphNode('实施计划');

    expect(screen.getByText('当前显示全图')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '详情自动局部图' }));

    expect(screen.getByText('已自动打开 2 跳邻域')).toBeTruthy();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
  });

  it('自动局部图切换到分类节点时会保留已展开邻域，减少视图突变', () => {
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
    expect(screen.getByText('自动 2跳')).toBeTruthy();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();

    clickGraphNode('知识产物');

    expect(screen.getByText('自动 2跳')).toBeTruthy();
    expect(screen.getByText('已自动打开 2 跳邻域')).toBeTruthy();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
  });

  it('自动局部图选择工作区根节点后再选内容节点仍会恢复内容默认邻域', () => {
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

    clickGraphNode('产品工作区');

    expect(screen.getByText('工作区 · workspace')).toBeTruthy();
    expect(screen.getByRole('button', { name: '全图' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByText(/局部图 关闭/)).toBeTruthy();

    clickGraphNode('需求规格');

    expect(screen.getByText('自动 2跳')).toBeTruthy();
    expect(screen.getByText(/局部图 2 跳/)).toBeTruthy();
  });

  it('局部图深度按派生关系裁剪远端节点', () => {
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
        content: '# Tasks\n任务列表。',
        id: 'artifact-tasks',
        parentArtifactId: 'artifact-plan',
        phase: 'tasks',
        title: '任务拆解',
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

    expect(getGraphNodeButton('实施计划')).toBeTruthy();
    expect(queryGraphNodeButton('任务拆解')).toBeNull();
  });

  it('选中分类节点后局部图会保留该分类包含的知识节点', () => {
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

    clickGraphNode('知识产物');
    expect(screen.getByText('分类节点用于组织图谱，不会作为知识条目入库。')).toBeTruthy();
    expect(screen.queryByText('未入库')).toBeNull();
    expect(screen.queryByText('全部层级可读')).toBeNull();
    expect(screen.getByRole('button', { name: '入库' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '1跳' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('实施计划')).toBeTruthy();
    expect(screen.getByText(/工作区知识资产 · 2 个知识节点/)).toBeTruthy();
  });

  it('知识节点详情保留 AI 层级读取范围徽标', () => {
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

    expect(screen.getByText('未入库')).toBeTruthy();
    expect(screen.getByText('全部层级可读')).toBeTruthy();
  });

  it('已入库节点按持久化正文长度提示入库截断', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '短 artifact 正文。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.persistedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-long',
        key: 'artifact:artifact-spec',
        value: 'x'.repeat(MAX_KNOWLEDGE_VALUE_LENGTH + 1),
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    clickGraphNode('需求规格');

    expect(screen.getByText(`入库会保留前 ${MAX_KNOWLEDGE_VALUE_LENGTH} 个字符。`)).toBeTruthy();
  });

  it('隐藏孤点会移除孤立未入库产物，但保留长期记忆节点', () => {
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
      {
        content: '# Plan\n按模块拆分。',
        id: 'artifact-plan',
        parentArtifactId: 'artifact-spec',
        phase: 'plan',
        title: '实施计划',
      },
      {
        content: '# Review\n独立评审。',
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

    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
    expect(getGraphNodeButton('独立评审报告')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '隐藏孤点' }));

    expect(getGraphNodeButton('个人记忆')).toBeTruthy();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(queryGraphNodeButton('独立评审报告')).toBeNull();
  });

  it('入库成功后隐藏孤点会清除旧选择和成功状态，即使节点仍在图中', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    expect((await screen.findByRole('status')).textContent).toBe('已入库知识。');

    fireEvent.click(screen.getByRole('button', { name: '隐藏孤点' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('选择一个知识节点后，可以查看来源、摘要和入库状态。')).toBeTruthy();
  });

  it('没有派生关系时隐藏孤点会移除未入库孤立产物并展示空态', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '隐藏孤点' }));

    expect(queryGraphNodeButton('需求规格')).toBeNull();
    expect(screen.getByText('未找到匹配知识')).toBeTruthy();
    expect(
      screen.getByText('隐藏孤点后没有可展示的知识节点。可以关闭隐藏孤点查看完整工作区知识。'),
    ).toBeTruthy();
  });

  it('隐藏孤点不会移除已入库的独立知识节点', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        key: 'manual:architecture-boundary',
        value: '网关请求必须通过 web-client 封装。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('manual:architecture-boundary')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '隐藏孤点' }));

    expect(getGraphNodeButton('manual:architecture-boundary')).toBeTruthy();
  });
});
