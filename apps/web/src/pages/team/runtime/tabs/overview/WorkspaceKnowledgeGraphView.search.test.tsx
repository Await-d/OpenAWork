// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import type { InstructionStackSegment } from '../../data/parse-instruction-stack.js';

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

describe('WorkspaceKnowledgeGraphView search', () => {
  it('中文输入法组合态按 Enter 不会提前触发查询', () => {
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
    fireEvent.change(searchInput, {
      target: { value: '不存在的知识' },
    });
    const composingEnter = createEvent.keyDown(searchInput, { key: 'Enter' });
    Object.defineProperty(composingEnter, 'isComposing', {
      configurable: true,
      value: true,
    });
    fireEvent(searchInput, composingEnter);

    expect(screen.queryByText('未找到匹配知识')).toBeNull();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();

    fireEvent.keyDown(searchInput, { key: 'Enter' });
    expect(screen.getByText('未找到匹配知识')).toBeTruthy();
  });

  it('搜索会命中已入库知识内容，即使原 artifact 正文不包含该词', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        key: 'artifact:artifact-spec',
        roleLayers: ['executor'],
        value: '后端知识库专属词',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '专属词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索已入库状态词会命中已持久化节点', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.persistedKnowledge = [
      createKnowledgeRecord({
        key: 'artifact:artifact-spec',
        roleLayers: ['executor'],
        value: '执行层已入库知识。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '已入库' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索知识类型词会命中项目上下文节点', () => {
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
      target: { value: '项目上下文' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索架构不会泛化命中普通项目上下文产物节点', () => {
    mockKnowledgeState.instructionSegments = [
      {
        body: '# 分层架构\n前端通过 web-client 访问网关。',
        kind: 'architecture-md',
        layer: 'architecture-md',
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

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '架构' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('架构上下文')).toBeTruthy();
    expect(getGraphNodeButton('架构说明')).toBeTruthy();
    expect(queryGraphNodeButton('需求规格')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索 arch 缩写不会误命中 archive 知识节点', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-archive',
        key: 'manual:archive-policy',
        type: 'project_context',
        value: '归档策略。',
      }),
      createKnowledgeRecord({
        id: 'memory-arch',
        key: 'manual:arch-boundary',
        type: 'project_context',
        value: '模块边界。',
      }),
      createKnowledgeRecord({
        id: 'memory-architecture',
        key: 'manual:architecture-boundary',
        type: 'project_context',
        value: '网关统一出入口。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: 'arch' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:arch-boundary')).toBeTruthy();
    expect(getGraphNodeButton('manual:architecture-boundary')).toBeTruthy();
    expect(queryGraphNodeButton('manual:archive-policy')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索 fact 不会误命中 artifact 知识节点', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-fact',
        key: 'manual:release-fact',
        type: 'fact',
        value: '仓库采用 pnpm。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: 'fact' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:release-fact')).toBeTruthy();
    expect(queryGraphNodeButton('需求规格')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索层级词会同步层级预览，并保留该层可读的全层级知识', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-global',
        key: 'manual:global-scope',
        roleLayers: null,
        value: '所有层级都可读取的通用知识。',
      }),
      createKnowledgeRecord({
        id: 'memory-executor',
        key: 'manual:executor-scope',
        roleLayers: ['executor'],
        value: '该记录正文没有层级中文名。',
      }),
      createKnowledgeRecord({
        id: 'memory-reviewer',
        key: 'manual:reviewer-note',
        roleLayers: ['reviewer'],
        value: '正文提到执行，但只给评审层读取。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '执行' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:executor-scope')).toBeTruthy();
    expect(getGraphNodeButton('manual:global-scope')).toBeTruthy();
    expect(queryGraphNodeButton('manual:reviewer-note')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
    expect(screen.getByRole('button', { name: '预览执行' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect((screen.getByLabelText('查询工作区知识') as HTMLInputElement).value).toBe('');
    expect(mockKnowledgeHookCalls[mockKnowledgeHookCalls.length - 1]).toEqual([
      'workspace-1',
      expect.objectContaining({ roleLayer: 'executor', search: '' }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: '预览全部' }));

    expect(screen.getByRole('button', { name: '预览全部' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(getGraphNodeButton('manual:global-scope')).toBeTruthy();
    expect(getGraphNodeButton('manual:executor-scope')).toBeTruthy();
    expect(getGraphNodeButton('manual:reviewer-note')).toBeTruthy();
    expect(mockKnowledgeHookCalls[mockKnowledgeHookCalls.length - 1]).toEqual([
      'workspace-1',
      expect.objectContaining({ roleLayer: undefined, search: '' }),
    ]);
  });

  it('搜索个人记忆等界面词会命中偏好类已入库知识', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-preference',
        key: 'manual:user-language',
        type: 'preference',
        value: '默认使用中文回复。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '个人记忆' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:user-language')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索 memory 会命中记忆类知识并排除团队规则', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-project',
        key: 'manual:project-root',
        type: 'project_context',
        value: '模块边界说明。',
      }),
      createKnowledgeRecord({
        id: 'memory-rule',
        key: 'manual:constitution-rule',
        type: 'instruction',
        value: '所有变更需要复查。',
      }),
      createKnowledgeRecord({
        id: 'memory-fact',
        key: 'manual:release-fact',
        type: 'fact',
        value: '仓库采用 pnpm。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: 'memory' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:project-root')).toBeTruthy();
    expect(getGraphNodeButton('manual:release-fact')).toBeTruthy();
    expect(queryGraphNodeButton('manual:constitution-rule')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索 memory 不会把产物和架构 key 的项目上下文当作记忆', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-project',
        key: 'manual:project-root',
        type: 'project_context',
        value: '模块边界说明。',
      }),
      createKnowledgeRecord({
        id: 'memory-manual-artifact',
        key: 'manual:artifact-plan',
        type: 'project_context',
        value: '实施计划。',
      }),
      createKnowledgeRecord({
        id: 'memory-architecture',
        key: 'manual:architecture-boundary',
        type: 'project_context',
        value: '网关统一出入口。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: 'memory' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:project-root')).toBeTruthy();
    expect(queryGraphNodeButton('需求规格')).toBeNull();
    expect(queryGraphNodeButton('manual:artifact-plan')).toBeNull();
    expect(queryGraphNodeButton('manual:architecture-boundary')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索项目记忆只命中普通项目上下文记忆', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-project',
        key: 'manual:project-root',
        type: 'project_context',
        value: '模块边界说明。',
      }),
      createKnowledgeRecord({
        id: 'memory-fact',
        key: 'manual:release-fact',
        type: 'fact',
        value: '仓库采用 pnpm。',
      }),
      createKnowledgeRecord({
        id: 'memory-pattern',
        key: 'manual:review-pattern',
        type: 'learned_pattern',
        value: '复查时从多角度检查。',
      }),
      createKnowledgeRecord({
        id: 'memory-manual-artifact',
        key: 'manual:artifact-plan',
        type: 'project_context',
        value: '实施计划。',
      }),
      createKnowledgeRecord({
        id: 'memory-architecture',
        key: 'manual:architecture-boundary',
        type: 'project_context',
        value: '网关统一出入口。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '项目记忆' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:project-root')).toBeTruthy();
    expect(queryGraphNodeButton('manual:release-fact')).toBeNull();
    expect(queryGraphNodeButton('manual:review-pattern')).toBeNull();
    expect(queryGraphNodeButton('manual:artifact-plan')).toBeNull();
    expect(queryGraphNodeButton('manual:architecture-boundary')).toBeNull();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索知识、知识图谱或完整图谱会保留完整工作区知识图谱', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 知识。',
      }),
      createKnowledgeRecord({
        id: 'memory-beta',
        key: 'manual:beta',
        value: 'beta 知识。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '知识' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:alpha')).toBeTruthy();
    expect(getGraphNodeButton('manual:beta')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '知识图谱' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:alpha')).toBeTruthy();
    expect(getGraphNodeButton('manual:beta')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '完整图谱' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:alpha')).toBeTruthy();
    expect(getGraphNodeButton('manual:beta')).toBeTruthy();
    expect(screen.queryByText('未找到匹配知识')).toBeNull();
  });

  it('搜索分类词会展开该分类下的知识节点，避免只能按正文命中', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.instructionSegments = [
      {
        body: '用户偏好中文回复。',
        kind: 'user-memory',
        layer: 'user-memory',
      },
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '产物' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('知识产物')).toBeTruthy();
    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(queryGraphNodeButton('个人记忆')).toBeNull();
  });

  it('搜索产物不会泛化命中普通项目上下文知识节点', () => {
    mockKnowledgeState.artifacts = [
      {
        content: '# Spec\n目标用户与约束。',
        id: 'artifact-spec',
        phase: 'spec',
        title: '需求规格',
      },
    ];
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-product',
        key: 'manual:product-boundary',
        type: 'project_context',
        value: '普通项目上下文。',
      }),
      createKnowledgeRecord({
        id: 'memory-manual-artifact',
        key: 'manual:artifact-plan',
        type: 'project_context',
        value: '实施计划。',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: '产物' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('需求规格')).toBeTruthy();
    expect(getGraphNodeButton('manual:artifact-plan')).toBeTruthy();
    expect(queryGraphNodeButton('manual:product-boundary')).toBeNull();
  });

  it('筛选后底部入库计数区分当前可见图和全图状态', () => {
    const records = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 可见知识',
      }),
      createKnowledgeRecord({
        id: 'memory-beta',
        key: 'manual:beta',
        value: 'beta 其它知识',
      }),
    ];
    mockKnowledgeState.storedKnowledge = records;
    mockKnowledgeState.persistedKnowledge = records;

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(screen.getByText(/已入库 2 条/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('查询工作区知识'), {
      target: { value: 'alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    expect(getGraphNodeButton('manual:alpha')).toBeTruthy();
    expect(queryGraphNodeButton('manual:beta')).toBeNull();
    expect(screen.getByText(/已入库 1 \/ 全图 2 条/)).toBeTruthy();
  });

  it('后端过滤当前知识列表时仍使用全量入库状态显示总数', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 当前可见知识',
      }),
    ];
    mockKnowledgeState.persistedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 当前可见知识',
      }),
      createKnowledgeRecord({
        id: 'memory-beta',
        key: 'manual:beta',
        value: 'beta 已入库但不在当前过滤结果中',
      }),
    ];

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(getGraphNodeButton('manual:alpha')).toBeTruthy();
    expect(queryGraphNodeButton('manual:beta')).toBeNull();
    expect(screen.getByText(/已入库 1 \/ 全图 2 条/)).toBeTruthy();
  });

  it('入库状态超过图谱上限时底部统计显示截断标记', () => {
    mockKnowledgeState.storedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 当前可见知识',
      }),
    ];
    mockKnowledgeState.persistedKnowledge = [
      createKnowledgeRecord({
        id: 'memory-alpha',
        key: 'manual:alpha',
        value: 'alpha 当前可见知识',
      }),
      createKnowledgeRecord({
        id: 'memory-beta',
        key: 'manual:beta',
        value: 'beta 已入库但不在当前过滤结果中',
      }),
    ];
    mockKnowledgeState.persistedKnowledgeTruncated = true;

    render(
      <WorkspaceKnowledgeGraphView
        activeWorkspaceName="产品工作区"
        teamWorkspaceId="workspace-1"
      />,
    );

    expect(screen.getByText(/已入库 1 \/ 全图 2\+ 条/)).toBeTruthy();
  });
});
