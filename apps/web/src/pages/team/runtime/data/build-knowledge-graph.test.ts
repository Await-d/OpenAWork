import { describe, expect, it } from 'vitest';
import { buildKnowledgeGraph } from './build-knowledge-graph.js';
import type { InstructionStackSegment } from './parse-instruction-stack.js';

function segment(partial: Partial<InstructionStackSegment>): InstructionStackSegment {
  return {
    body: '',
    kind: 'raw',
    layer: 'raw',
    ...partial,
  };
}

describe('buildKnowledgeGraph', () => {
  it('从指令栈片段生成工作区知识节点，而不是 session 节点', () => {
    const graph = buildKnowledgeGraph({
      workspace: {
        id: 'workspace-1',
        name: '产品工作区',
        description: '客服系统重构',
      },
      instructionSegments: [
        segment({
          body: '# 分层架构\n前端只通过 web-client 调用网关。',
          kind: 'architecture-md',
          layer: 'architecture-md',
        }),
        segment({
          body: '# 团队宪法\n所有变更必须保留可验证依据。',
          kind: 'constitution',
          layer: 'constitution',
        }),
        segment({
          body: '用户偏好中文回复。',
          kind: 'user-memory',
          layer: 'user-memory',
        }),
      ],
    });

    expect(graph.nodes.map((node) => node.kind)).toEqual([
      'workspace',
      'category',
      'architecture',
      'category',
      'constitution',
      'category',
      'memory',
    ]);
    expect(graph.nodes.some((node) => node.kind === 'artifact')).toBe(false);
    expect(
      graph.nodes.some((node) => node.kind === 'workspace' && node.label === '产品工作区'),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.kind === 'architecture' && node.detail === '分层架构'),
    ).toBe(true);
  });

  it('过滤角色 SOUL、工作区知识汇总、缓存标记和空片段，避免把运行时提示词噪声放进知识图谱', () => {
    const graph = buildKnowledgeGraph({
      instructionSegments: [
        segment({ body: '# 执行 SOUL', kind: 'soul', layer: 'soul:executor:default' }),
        segment({
          body: '以下是当前团队工作区知识库中允许 executor 层读取和使用的长期知识。',
          kind: 'workspace-knowledge',
          layer: 'workspace-knowledge:executor',
        }),
        segment({ body: '', kind: 'cache-breaker', layer: 'cache-breaker' }),
        segment({ body: '项目记忆正文', kind: 'project-memory', layer: 'project-memory' }),
      ],
    });

    expect(graph.nodes.map((node) => node.label)).toEqual(['当前工作区', '记忆与经验', '项目记忆']);
  });

  it('把 artifact 作为工作区知识产物，并用 parentArtifactId 建立派生关系', () => {
    const graph = buildKnowledgeGraph({
      artifacts: [
        {
          content: '# Spec\n目标用户与约束。',
          id: 'spec-1',
          phase: 'spec',
          title: '需求规格',
        },
        {
          content: '# Plan\n按模块拆分。',
          id: 'plan-1',
          parentArtifactId: 'spec-1',
          phase: 'plan',
          title: '实施计划',
        },
        {
          content: '# Tasks\n任务列表。',
          id: 'tasks-1',
          parentArtifactId: 'plan-1',
          phase: 'tasks',
          title: '任务拆解',
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'workspace:current',
      'category:knowledge',
      'artifact:spec-1',
      'artifact:plan-1',
      'artifact:tasks-1',
    ]);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'artifact:spec-1',
          kind: 'derives',
          to: 'artifact:plan-1',
        }),
        expect.objectContaining({
          from: 'artifact:plan-1',
          kind: 'derives',
          to: 'artifact:tasks-1',
        }),
      ]),
    );
  });

  it('artifact 节点和派生边按 phase、title、id 稳定排序，避免接口顺序影响布局', () => {
    const artifacts = [
      {
        content: '# Plan\n后端知识查询。',
        id: 'plan-b',
        parentArtifactId: 'spec-b',
        phase: 'plan',
        title: '实施计划',
      },
      {
        content: '# Spec\n知识图谱。',
        id: 'spec-b',
        phase: 'spec',
        title: '知识资产',
      },
      {
        content: '# Plan\n前端画布。',
        id: 'plan-a',
        parentArtifactId: 'spec-a',
        phase: 'plan',
        title: '实施计划',
      },
      {
        content: '# Spec\n工作区记忆。',
        id: 'spec-a',
        phase: 'spec',
        title: '知识资产',
      },
    ];
    const graph = buildKnowledgeGraph({ artifacts });
    const reversedGraph = buildKnowledgeGraph({ artifacts: [...artifacts].reverse() });
    const expectedNodeIds = [
      'workspace:current',
      'category:knowledge',
      'artifact:spec-a',
      'artifact:spec-b',
      'artifact:plan-a',
      'artifact:plan-b',
    ];
    const expectedDerivesEdges = [
      {
        id: 'derives:artifact:spec-a->artifact:plan-a',
        from: 'artifact:spec-a',
        to: 'artifact:plan-a',
      },
      {
        id: 'derives:artifact:spec-b->artifact:plan-b',
        from: 'artifact:spec-b',
        to: 'artifact:plan-b',
      },
    ];

    expect(graph.nodes.map((node) => node.id)).toEqual(expectedNodeIds);
    expect(reversedGraph.nodes.map((node) => node.id)).toEqual(expectedNodeIds);
    expect(
      graph.edges
        .filter((edge) => edge.kind === 'derives')
        .map(({ from, id, to }) => ({ from, id, to })),
    ).toEqual(expectedDerivesEdges);
    expect(
      reversedGraph.edges
        .filter((edge) => edge.kind === 'derives')
        .map(({ from, id, to }) => ({ from, id, to })),
    ).toEqual(expectedDerivesEdges);
  });

  it('父 artifact 未出现在当前列表中时不补占位，避免展示不可解释的孤儿节点', () => {
    const graph = buildKnowledgeGraph({
      artifacts: [
        {
          id: 'plan-1',
          parentArtifactId: 'missing-spec',
          phase: 'plan',
          title: '实施计划',
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'workspace:current',
      'category:knowledge',
      'artifact:plan-1',
    ]);
    expect(graph.edges.filter((edge) => edge.kind === 'derives')).toHaveLength(0);
  });

  it('用已入库知识 key 标记对应图谱节点', () => {
    const graph = buildKnowledgeGraph({
      artifacts: [
        {
          content: '# Spec\n目标用户与约束。',
          id: 'spec-1',
          phase: 'spec',
          title: '需求规格',
        },
      ],
      storedKnowledge: [
        {
          id: 'memory-1',
          key: 'artifact:spec-1',
          roleLayers: ['executor'],
          type: 'project_context',
          value: '目标用户与约束。',
        },
      ],
    });

    const artifactNode = graph.nodes.find((node) => node.id === 'artifact:spec-1');
    expect(artifactNode?.persistedMemoryId).toBe('memory-1');
    expect(artifactNode?.roleLayers).toEqual(['executor']);
    expect(artifactNode?.sourceRef).toBe('artifact:spec-1');
  });

  it('用全量入库状态标记当前层不可读的已有图谱节点', () => {
    const graph = buildKnowledgeGraph({
      artifacts: [
        {
          content: '# Spec\n目标用户与约束。',
          id: 'spec-1',
          phase: 'spec',
          title: '需求规格',
        },
      ],
      persistedKnowledge: [
        {
          id: 'memory-pm1',
          key: 'artifact:spec-1',
          roleLayers: ['pm1'],
          type: 'project_context',
          value: 'PM1 私有入库正文。',
        },
      ],
      storedKnowledge: [],
    });

    const artifactNode = graph.nodes.find((node) => node.id === 'artifact:spec-1');
    expect(artifactNode?.persistedMemoryId).toBe('memory-pm1');
    expect(artifactNode?.persistedValue).toBe('PM1 私有入库正文。');
    expect(artifactNode?.roleLayers).toEqual(['pm1']);
    expect(artifactNode?.searchText).not.toContain('PM1 私有入库正文');
  });

  it('忽略被过滤片段后仍用稳定 sourceRef 匹配已入库指令知识', () => {
    const graph = buildKnowledgeGraph({
      instructionSegments: [
        segment({ body: '# 执行 SOUL', kind: 'soul', layer: 'soul:executor:default' }),
        segment({ body: '', kind: 'cache-breaker', layer: 'cache-breaker' }),
        segment({
          body: '# 团队宪法\n所有变更必须保留可验证依据。',
          kind: 'constitution',
          layer: 'constitution',
        }),
      ],
      storedKnowledge: [
        {
          id: 'memory-1',
          key: 'instruction-stack:constitution:constitution',
          roleLayers: ['executor'],
          type: 'instruction',
          value: '已入库团队规则。',
        },
      ],
    });

    const constitutionNodes = graph.nodes.filter((node) => node.kind === 'constitution');
    expect(constitutionNodes).toHaveLength(1);
    expect(constitutionNodes[0]).toMatchObject({
      id: 'knowledge:constitution:constitution:0',
      persistedMemoryId: 'memory-1',
      roleLayers: ['executor'],
      sourceRef: 'instruction-stack:constitution:constitution',
    });
  });

  it('把仅存在于后端知识库的普通记录展示为已入库知识节点', () => {
    const graph = buildKnowledgeGraph({
      storedKnowledge: [
        {
          id: 'memory-1',
          key: 'manual:product-boundary',
          type: 'project_context',
          value: '网关请求必须通过 web-client 封装。',
        },
      ],
    });

    expect(graph.nodes.map((node) => node.kind)).toEqual(['workspace', 'category', 'knowledge']);
    expect(graph.nodes[2]).toMatchObject({
      id: 'stored-knowledge:memory-1',
      persistedMemoryId: 'memory-1',
      sourceRef: 'manual:product-boundary',
    });
  });

  it.each(['manual:architecture-boundary', 'architecture:module-boundary', 'manual:架构边界'])(
    '把仅存在于后端知识库的架构记录归入架构上下文：%s',
    (key) => {
      const graph = buildKnowledgeGraph({
        storedKnowledge: [
          {
            id: 'memory-architecture',
            key,
            type: 'project_context',
            value: '网关请求必须通过 web-client 封装。',
          },
        ],
      });

      expect(graph.nodes.map((node) => node.id)).toEqual([
        'workspace:current',
        'category:architecture',
        'stored-knowledge:memory-architecture',
      ]);
      expect(graph.nodes[2]).toMatchObject({
        group: 'architecture',
        kind: 'architecture',
        memoryType: 'project_context',
        sourceRef: key,
      });
    },
  );

  it('不会把 archive 等相近 key 误归入架构上下文', () => {
    const graph = buildKnowledgeGraph({
      storedKnowledge: [
        {
          id: 'memory-archive',
          key: 'manual:archive-policy',
          type: 'project_context',
          value: '归档策略说明。',
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'workspace:current',
      'category:knowledge',
      'stored-knowledge:memory-archive',
    ]);
    expect(graph.nodes[2]).toMatchObject({
      group: 'knowledge',
      kind: 'knowledge',
      sourceRef: 'manual:archive-policy',
    });
  });

  it.each(['manual:artifact-plan', 'workspace:artifact-plan', 'workspace:artifact_plan'])(
    '把仅存在于后端知识库的产物别名记录归入知识产物：%s',
    (key) => {
      const graph = buildKnowledgeGraph({
        storedKnowledge: [
          {
            id: 'memory-artifact-alias',
            key,
            type: 'learned_pattern',
            value: '实施计划沉淀。',
          },
        ],
      });

      expect(graph.nodes.map((node) => node.id)).toEqual([
        'workspace:current',
        'category:knowledge',
        'stored-knowledge:memory-artifact-alias',
      ]);
      expect(graph.nodes[2]).toMatchObject({
        group: 'knowledge',
        kind: 'knowledge',
        memoryType: 'learned_pattern',
        sourceRef: key,
      });
    },
  );

  it.each([
    ['项目记忆', 'instruction-stack:project-memory:project-memory', 'project_context'],
    ['经验沉淀', 'instruction-stack:lessons-learned:lessons-learned', 'learned_pattern'],
    ['用户记忆', 'instruction-stack:user-memory:user-memory', 'preference'],
  ] as const)('仅存在于后端知识库的指令栈%s仍归入记忆分组', (_label, key, type) => {
    const graph = buildKnowledgeGraph({
      storedKnowledge: [
        {
          id: 'memory-from-instruction-stack',
          key,
          type,
          value: '指令栈记忆应归入记忆与经验，而不是知识产物。',
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'workspace:current',
      'category:memory',
      'stored-knowledge:memory-from-instruction-stack',
    ]);
    expect(graph.nodes[2]).toMatchObject({
      group: 'memory',
      kind: 'memory',
      memoryType: type,
      sourceRef: key,
    });
  });

  it('仅存在于后端知识库的节点按分类和 key 稳定排序，避免接口顺序影响布局', () => {
    const storedKnowledge = [
      {
        id: 'memory-beta',
        key: 'manual:beta',
        type: 'project_context' as const,
        value: 'beta 项目上下文。',
      },
      {
        id: 'memory-preference',
        key: 'manual:user-language',
        type: 'preference' as const,
        value: '默认使用中文回复。',
      },
      {
        id: 'memory-architecture',
        key: 'manual:architecture-boundary',
        type: 'project_context' as const,
        value: '网关统一出入口。',
      },
      {
        id: 'memory-alpha',
        key: 'manual:alpha',
        type: 'project_context' as const,
        value: 'alpha 项目上下文。',
      },
    ];
    const graph = buildKnowledgeGraph({ storedKnowledge });
    const reversedGraph = buildKnowledgeGraph({ storedKnowledge: [...storedKnowledge].reverse() });
    const expectedNodeIds = [
      'workspace:current',
      'category:architecture',
      'stored-knowledge:memory-architecture',
      'category:memory',
      'stored-knowledge:memory-preference',
      'category:knowledge',
      'stored-knowledge:memory-alpha',
      'stored-knowledge:memory-beta',
    ];

    expect(graph.nodes.map((node) => node.id)).toEqual(expectedNodeIds);
    expect(reversedGraph.nodes.map((node) => node.id)).toEqual(expectedNodeIds);
  });

  it('空输入返回空图', () => {
    const graph = buildKnowledgeGraph({});
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });
});
