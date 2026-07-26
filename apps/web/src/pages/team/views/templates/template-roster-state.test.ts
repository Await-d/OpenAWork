/**
 * template-roster-state 纯函数测试：导入/导出 round-trip + 实时校验。
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowTemplateRecord } from '@openAwork/web-client';
import {
  EMPTY_TEMPLATE_STATE,
  addCustomSlot,
  cloneDefaultRoster,
  collectTemplateIssues,
  diffTemplateStates,
  exportTemplateState,
  importTemplateState,
  moveCustomSlotToLayer,
  templateToEditorState,
  type TemplateEditorState,
} from './template-roster-state.js';

function baseState(overrides: Partial<TemplateEditorState> = {}): TemplateEditorState {
  return {
    ...EMPTY_TEMPLATE_STATE,
    name: '我的模板',
    description: '一个测试模板',
    focus: '代码评审',
    recommendedFor: '快速立项',
    memberSlots: cloneDefaultRoster(),
    ...overrides,
  };
}

describe('exportTemplateState / importTemplateState round-trip', () => {
  it('导出再导入应保留核心字段', () => {
    const state = baseState({
      modelPool: [{ providerId: 'openai', modelId: 'gpt-5.4' }],
      modelAssignStrategy: 'quality',
    });
    const json = exportTemplateState(state);
    const result = importTemplateState(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.description).toBe('一个测试模板');
      expect(result.state.focus).toBe('代码评审');
      expect(result.state.modelAssignStrategy).toBe('quality');
      expect(result.state.modelPool).toEqual([{ providerId: 'openai', modelId: 'gpt-5.4' }]);
      expect(result.state.memberSlots.length).toBe(state.memberSlots.length);
    }
  });

  it('导出 JSON 带 openAworkTemplate 标记', () => {
    const json = exportTemplateState(baseState());
    expect(JSON.parse(json).openAworkTemplate).toBe(1);
  });
});

describe('importTemplateState 容错', () => {
  it('非法 JSON 返回错误', () => {
    const result = importTemplateState('{bad json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/JSON/);
  });

  it('缺少标记返回错误', () => {
    const result = importTemplateState(JSON.stringify({ name: 'x', memberSlots: [] }));
    expect(result.ok).toBe(false);
  });

  it('缺少 memberSlots 返回错误', () => {
    const result = importTemplateState(JSON.stringify({ openAworkTemplate: 1, name: 'x' }));
    expect(result.ok).toBe(false);
  });

  it('memberSlots 为空数组时回退默认花名册', () => {
    const result = importTemplateState(
      JSON.stringify({ openAworkTemplate: 1, name: 'x', memberSlots: [] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.memberSlots.length).toBeGreaterThan(0);
  });

  it('过滤结构不完整的槽位', () => {
    const result = importTemplateState(
      JSON.stringify({
        openAworkTemplate: 1,
        name: 'x',
        memberSlots: [
          {
            id: 'a',
            layer: 'executor',
            specialty: 'frontend',
            personaKey: 'k',
            toolsets: ['read'],
          },
          { id: 'broken' }, // 缺字段，应被过滤
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.memberSlots).toHaveLength(1);
  });
});

describe('collectTemplateIssues', () => {
  it('缺名称是 error', () => {
    const issues = collectTemplateIssues(baseState({ name: '' }));
    expect(issues.some((i) => i.severity === 'error' && /名称/.test(i.message))).toBe(true);
  });

  it('缺接待层是 error', () => {
    const noReception = cloneDefaultRoster().filter((s) => s.layer !== 'reception');
    const issues = collectTemplateIssues(baseState({ memberSlots: noReception }));
    expect(issues.some((i) => i.severity === 'error' && /接待层/.test(i.message))).toBe(true);
  });

  it('缺中间层是 warning（不阻断）', () => {
    const onlyReception = cloneDefaultRoster().filter((s) => s.layer === 'reception');
    const issues = collectTemplateIssues(baseState({ memberSlots: onlyReception }));
    expect(issues.some((i) => i.severity === 'warning' && /执行层/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.severity === 'warning' && /评审层/.test(i.message))).toBe(true);
  });

  it('完整默认模板无 error', () => {
    const issues = collectTemplateIssues(baseState());
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });
});

describe('diffTemplateStates', () => {
  it('无变更返回空数组', () => {
    const state = baseState();
    expect(diffTemplateStates(state, state)).toHaveLength(0);
  });

  it('改名产生一条变更', () => {
    const orig = baseState({ name: 'A' });
    const draft = baseState({ name: 'B' });
    const changes = diffTemplateStates(orig, draft);
    expect(changes.some((c) => c.includes('名称'))).toBe(true);
  });

  it('规模变化被记录', () => {
    const changes = diffTemplateStates(baseState({ scale: 'small' }), baseState({ scale: 'full' }));
    expect(changes.some((c) => /规模/.test(c))).toBe(true);
  });

  it('移除成员被记录', () => {
    const orig = baseState();
    const draft = baseState({ memberSlots: orig.memberSlots.slice(0, -1) });
    const removed = orig.memberSlots[orig.memberSlots.length - 1]!;
    const changes = diffTemplateStates(orig, draft);
    expect(changes.some((c) => c.includes('移除成员') && c.includes(removed.displayName))).toBe(
      true,
    );
  });

  it('成员模型 / 工具变化被细分记录', () => {
    const orig = baseState();
    const target = orig.memberSlots[0]!;
    const draftSlots = orig.memberSlots.map((s, i) =>
      i === 0
        ? { ...s, modelId: 'gpt-5.4', providerId: 'openai', toolsets: [...s.toolsets, 'web'] }
        : s,
    );
    const changes = diffTemplateStates(orig, baseState({ memberSlots: draftSlots }));
    const line = changes.find((c) => c.startsWith(target.displayName));
    expect(line).toBeDefined();
    expect(line).toMatch(/模型/);
    expect(line).toMatch(/工具/);
  });
});

describe('diffTemplateStates · 模型池', () => {
  it('检测模型池数量变化', () => {
    const orig = baseState({ modelPool: [] });
    const draft = baseState({ modelPool: [{ providerId: 'openai', modelId: 'gpt-5.4' }] });
    const changes = diffTemplateStates(orig, draft);
    expect(changes.some((c) => /模型池/.test(c))).toBe(true);
  });
});

describe('moveCustomSlotToLayer', () => {
  it('把自定义角色移到新层并重写 layer/id/personaKey', () => {
    const roster = addCustomSlot([], 'executor', {
      displayName: '性能专家',
      systemPrompt: '你是性能专家',
      toolsets: ['read', 'write'],
    });
    const slotId = roster[0]!.id;
    const moved = moveCustomSlotToLayer(roster, slotId, 'reviewer');
    const slot = moved[0]!;
    expect(slot.layer).toBe('reviewer');
    expect(slot.id.startsWith('reviewer-custom-')).toBe(true);
    expect(slot.personaKey.startsWith('reviewer:custom:')).toBe(true);
  });

  it('移到新层时裁掉超出新层天花板的工具', () => {
    // executor 角色带 write/shell；reviewer 天花板不含 write → 应被裁掉。
    const roster = addCustomSlot([], 'executor', {
      displayName: '工程师',
      systemPrompt: 'x',
      toolsets: ['read', 'write', 'shell'],
    });
    const moved = moveCustomSlotToLayer(roster, roster[0]!.id, 'reviewer');
    expect(moved[0]!.toolsets).not.toContain('write');
    expect(moved[0]!.toolsets).toContain('read');
  });

  it('裁剪后为空时回退到 read', () => {
    const roster = addCustomSlot([], 'executor', {
      displayName: '只写角色',
      systemPrompt: 'x',
      toolsets: ['write'], // reviewer 不含 write → 裁空 → 回退 read
    });
    const moved = moveCustomSlotToLayer(roster, roster[0]!.id, 'reviewer');
    expect(moved[0]!.toolsets).toEqual(['read']);
  });

  it('目标层与原层相同时原样返回', () => {
    const roster = addCustomSlot([], 'executor', {
      displayName: 'x',
      systemPrompt: 'x',
      toolsets: ['read'],
    });
    const moved = moveCustomSlotToLayer(roster, roster[0]!.id, 'executor');
    expect(moved[0]).toBe(roster[0]);
  });

  it('不影响非自定义成员', () => {
    const roster = cloneDefaultRoster();
    const preset = roster.find((s) => s.specialty !== 'custom')!;
    const moved = moveCustomSlotToLayer(roster, preset.id, 'pm1');
    expect(moved.find((s) => s.id === preset.id)?.layer).toBe(preset.layer);
  });
});

describe('legacy executor toolset migration', () => {
  it('模板编辑态会升级旧版内置 executor 工具集', () => {
    const legacyRoster = [
      {
        ...cloneDefaultRoster().find((slot) => slot.id === 'executor-frontend')!,
        toolsets: ['read', 'write', 'shell', 'lsp', 'test'],
      },
    ];
    const template: WorkflowTemplateRecord = {
      id: 'legacy',
      name: 'legacy',
      description: '',
      category: 'team-playbook',
      nodes: [],
      edges: [],
      metadata: { teamTemplate: { memberSlots: legacyRoster } },
    };
    const state = templateToEditorState(template);
    expect(state.memberSlots[0]?.toolsets).toContain('desktop');
  });
});

describe('moveCustomSlotToLayer', () => {
  it('把自定义角色移到另一层：layer / id / personaKey 同步更新', () => {
    const roster = addCustomSlot(cloneDefaultRoster(), 'executor', {
      displayName: '性能专家',
      systemPrompt: '你是性能专家',
      toolsets: ['read', 'write', 'shell'],
    });
    const custom = roster.find((s) => s.specialty === 'custom')!;
    const moved = moveCustomSlotToLayer(roster, custom.id, 'reviewer');
    const movedSlot = moved.find((s) => s.specialty === 'custom')!;
    expect(movedSlot.layer).toBe('reviewer');
    expect(movedSlot.id.startsWith('reviewer-custom-')).toBe(true);
    expect(movedSlot.personaKey.startsWith('reviewer:custom:')).toBe(true);
  });

  it('移层时裁掉超出新层天花板的工具', () => {
    // executor 允许 write/shell；reception 天花板只有 read/web → write/shell 被裁。
    const roster = addCustomSlot(cloneDefaultRoster(), 'executor', {
      displayName: 'X',
      systemPrompt: 'x',
      toolsets: ['read', 'write', 'shell'],
    });
    const custom = roster.find((s) => s.specialty === 'custom')!;
    const moved = moveCustomSlotToLayer(roster, custom.id, 'reception');
    const movedSlot = moved.find((s) => s.specialty === 'custom')!;
    expect(movedSlot.toolsets).not.toContain('write');
    expect(movedSlot.toolsets).not.toContain('shell');
    expect(movedSlot.toolsets).toContain('read');
  });

  it('保留人物提示词等自定义字段', () => {
    const roster = addCustomSlot(cloneDefaultRoster(), 'executor', {
      displayName: '专家',
      systemPrompt: '保留我',
      toolsets: ['read'],
    });
    const custom = roster.find((s) => s.specialty === 'custom')!;
    const moved = moveCustomSlotToLayer(roster, custom.id, 'pm1');
    const movedSlot = moved.find((s) => s.specialty === 'custom')!;
    expect(movedSlot.systemPrompt).toBe('保留我');
    expect(movedSlot.displayName).toBe('专家');
  });

  it('目标层与原层相同时原样返回', () => {
    const roster = addCustomSlot(cloneDefaultRoster(), 'executor', {
      displayName: 'X',
      systemPrompt: 'x',
      toolsets: ['read'],
    });
    const custom = roster.find((s) => s.specialty === 'custom')!;
    const moved = moveCustomSlotToLayer(roster, custom.id, 'executor');
    expect(moved.find((s) => s.specialty === 'custom')!.id).toBe(custom.id);
  });

  it('不影响预置（非 custom）成员', () => {
    const roster = cloneDefaultRoster();
    const presetExec = roster.find((s) => s.layer === 'executor' && s.specialty !== 'custom')!;
    const moved = moveCustomSlotToLayer(roster, presetExec.id, 'reviewer');
    expect(moved.find((s) => s.id === presetExec.id)!.layer).toBe('executor');
  });
});
