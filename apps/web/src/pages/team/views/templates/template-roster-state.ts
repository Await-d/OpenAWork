/**
 * 模板编辑态：roster + 元数据。
 *
 * 设计要点：
 *   - 模板 = 一份按层分组的成员 roster + 元数据（focus / scale / recommendedFor 等）
 *   - 默认 roster 直接复用 DEFAULT_FIXED_TEAM_MEMBER_SLOTS，保证与「默认固定团队」语义一致
 *   - (layer, specialty) 组合唯一：一个层内同一 specialty 最多一名成员
 *   - editor state ↔ workflow template metadata 来回转换由 templateToEditorState / editorStateToMetadata 完成
 */

import {
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
  TEAM_RUNTIME_LAYER_ORDER,
  type FixedTeamMemberSlot,
  type TeamMemberSpecialty,
  type TeamRuntimeLayer,
} from '@openAwork/shared';
import type {
  WorkflowTemplateMetadata,
  WorkflowTemplateRecord,
  WorkflowTemplateScale,
  WorkflowTeamTemplateModelRef,
  WorkflowTeamTemplateModelStrategy,
} from '@openAwork/web-client';
import { LAYER_ALLOWED_TOOLSETS } from './template-architecture.js';

export interface TemplateEditorState {
  name: string;
  description: string;
  defaultProvider: string | null;
  scale: WorkflowTemplateScale;
  focus: string;
  recommendedFor: string;
  recommendedDefault: boolean;
  /** 模板花名册（扁平数组）。展示时按 catalog 顺序排序。 */
  memberSlots: FixedTeamMemberSlot[];
  /** 候选模型池（用户勾选的真实模型，智能分配只在此池内挑选）。 */
  modelPool: WorkflowTeamTemplateModelRef[];
  /** 上次使用的智能分配策略（回显 UI）。 */
  modelAssignStrategy: WorkflowTeamTemplateModelStrategy;
}

export function cloneDefaultRoster(): FixedTeamMemberSlot[] {
  return DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => ({
    ...slot,
    toolsets: [...slot.toolsets],
  }));
}

export function cloneRoster(roster: FixedTeamMemberSlot[]): FixedTeamMemberSlot[] {
  return roster.map((slot) => ({ ...slot, toolsets: [...slot.toolsets] }));
}

export const EMPTY_TEMPLATE_STATE: TemplateEditorState = {
  name: '',
  description: '',
  defaultProvider: null,
  scale: 'medium',
  focus: '',
  recommendedFor: '',
  recommendedDefault: false,
  memberSlots: cloneDefaultRoster(),
  modelPool: [],
  modelAssignStrategy: 'balanced',
};

/** catalog 字典：每个 (layer, specialty) 的预设。用作 toggle 时的成员来源。 */
const CATALOG_BY_KEY = new Map<string, FixedTeamMemberSlot>(
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => [`${slot.layer}:${slot.specialty}`, slot]),
);

export function slotKey(layer: TeamRuntimeLayer, specialty: TeamMemberSpecialty): string {
  return `${layer}:${specialty}`;
}

/** 某个层在 catalog 中可选的全部 specialty（按 catalog 顺序）。 */
export function specialtyOptionsForLayer(layer: TeamRuntimeLayer): TeamMemberSpecialty[] {
  const seen = new Set<TeamMemberSpecialty>();
  const result: TeamMemberSpecialty[] = [];
  for (const slot of DEFAULT_FIXED_TEAM_MEMBER_SLOTS) {
    if (slot.layer === layer && !seen.has(slot.specialty)) {
      seen.add(slot.specialty);
      result.push(slot.specialty);
    }
  }
  return result;
}

/** 取得 catalog 中某 (layer, specialty) 的预设成员（克隆）。 */
export function presetSlot(
  layer: TeamRuntimeLayer,
  specialty: TeamMemberSpecialty,
): FixedTeamMemberSlot {
  const preset = CATALOG_BY_KEY.get(slotKey(layer, specialty));
  if (preset) {
    return { ...preset, toolsets: [...preset.toolsets] };
  }
  return {
    id: `${layer}-${specialty}`,
    layer,
    specialty,
    displayName: specialty,
    personaKey: `${layer}:${specialty}`,
    toolsets: ['read'],
    required: false,
  };
}

/** catalog 中每个成员的稳定排序索引，用于把 roster 按 catalog 顺序展示。 */
const CATALOG_ORDER = new Map<string, number>(
  DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot, index) => [`${slot.layer}:${slot.specialty}`, index]),
);

export function sortRosterByCatalog(roster: FixedTeamMemberSlot[]): FixedTeamMemberSlot[] {
  return [...roster].sort((a, b) => {
    const ai = CATALOG_ORDER.get(slotKey(a.layer, a.specialty)) ?? Number.MAX_SAFE_INTEGER;
    const bi = CATALOG_ORDER.get(slotKey(b.layer, b.specialty)) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    // 自定义成员（同一 (layer, specialty='custom')）按 personaKey 稳定排序。
    return a.personaKey.localeCompare(b.personaKey);
  });
}

export function groupRosterByLayer(
  roster: FixedTeamMemberSlot[],
): Map<TeamRuntimeLayer, FixedTeamMemberSlot[]> {
  const map = new Map<TeamRuntimeLayer, FixedTeamMemberSlot[]>();
  for (const layer of TEAM_RUNTIME_LAYER_ORDER) {
    map.set(layer, []);
  }
  for (const slot of roster) {
    map.get(slot.layer)?.push(slot);
  }
  return map;
}

/** 切换某 (layer, specialty) 是否在 roster 中（含=>移除，不含=>加入预设）。 */
export function toggleSpecialty(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
  specialty: TeamMemberSpecialty,
): FixedTeamMemberSlot[] {
  const key = slotKey(layer, specialty);
  const exists = roster.some((slot) => slotKey(slot.layer, slot.specialty) === key);
  if (exists) {
    return roster.filter((slot) => slotKey(slot.layer, slot.specialty) !== key);
  }
  return [...roster, presetSlot(layer, specialty)];
}

/** 该层全选（catalog 所有 specialty），保留已有成员的自定义。 */
export function selectAllInLayer(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
): FixedTeamMemberSlot[] {
  const existingKeys = new Set(roster.map((slot) => slotKey(slot.layer, slot.specialty)));
  const additions = specialtyOptionsForLayer(layer)
    .filter((specialty) => !existingKeys.has(slotKey(layer, specialty)))
    .map((specialty) => presetSlot(layer, specialty));
  return [...roster, ...additions];
}

/* ── 自定义角色（specialty === 'custom'）─────────────────────────────────
 * 自定义成员不走 (layer, specialty) 唯一约束（同层可有多个），用唯一 id /
 * personaKey 区分。下面是它们的增删改助手。
 */

/** 取某层的自定义成员（按加入顺序）。 */
export function customSlotsForLayer(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
): FixedTeamMemberSlot[] {
  return roster.filter((slot) => slot.layer === layer && slot.specialty === 'custom');
}

export interface CustomSlotInput {
  displayName: string;
  systemPrompt: string;
  toolsets: string[];
  required?: boolean;
  providerId?: string;
  modelId?: string;
  variant?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
  routingKeywords?: string[];
  dispatchPriority?: 'high' | 'normal' | 'low';
}

/** 新增一个自定义角色到指定层，返回新 roster。 */
export function addCustomSlot(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
  input: CustomSlotInput,
): FixedTeamMemberSlot[] {
  const uid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const id = `${layer}-custom-${uid}`;
  const slot: FixedTeamMemberSlot = {
    id,
    layer,
    specialty: 'custom',
    displayName: input.displayName.trim() || '自定义角色',
    personaKey: `${layer}:custom:${uid}`,
    toolsets: [...input.toolsets],
    required: input.required ?? false,
    custom: true,
    systemPrompt: input.systemPrompt.trim(),
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.skillIds && input.skillIds.length > 0 ? { skillIds: [...input.skillIds] } : {}),
    ...(input.mcpServerIds && input.mcpServerIds.length > 0
      ? { mcpServerIds: [...input.mcpServerIds] }
      : {}),
    ...(input.routingKeywords && input.routingKeywords.length > 0
      ? { routingKeywords: [...input.routingKeywords] }
      : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.dispatchPriority ? { dispatchPriority: input.dispatchPriority } : {}),
  };
  return [...roster, slot];
}

/** 按 id 更新一个自定义角色。 */
export function updateCustomSlot(
  roster: FixedTeamMemberSlot[],
  slotId: string,
  patch: Partial<FixedTeamMemberSlot>,
): FixedTeamMemberSlot[] {
  return roster.map((slot) =>
    slot.id === slotId
      ? {
          ...slot,
          ...patch,
          toolsets: patch.toolsets ? [...patch.toolsets] : [...slot.toolsets],
        }
      : slot,
  );
}

/** 按 id 移除一个自定义角色。 */
/**
 * 把一个自定义角色移动到另一层。
 *
 * 同步更新 layer + 重写 id/personaKey 以反映新层（保持 `${layer}:custom:${uid}` 约定），
 * 并把超出新层工具天花板的 toolsets 裁掉（避免运行时被门控静默砍掉）。
 * 仅对 specialty==='custom' 的成员生效；目标层与原层相同时原样返回。
 */
export function moveCustomSlotToLayer(
  roster: FixedTeamMemberSlot[],
  slotId: string,
  targetLayer: TeamRuntimeLayer,
): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    if (slot.id !== slotId || slot.specialty !== 'custom' || slot.layer === targetLayer) {
      return slot;
    }
    // 从旧 personaKey 提取 uid（`${oldLayer}:custom:${uid}`），保持稳定标识。
    const uid = slot.personaKey.split(':').pop() || slot.id;
    const ceiling = LAYER_ALLOWED_TOOLSETS[targetLayer] ?? [];
    const trimmedToolsets = slot.toolsets.filter((t) => ceiling.includes(t));
    return {
      ...slot,
      layer: targetLayer,
      id: `${targetLayer}-custom-${uid}`,
      personaKey: `${targetLayer}:custom:${uid}`,
      toolsets: trimmedToolsets.length > 0 ? trimmedToolsets : ['read'],
    };
  });
}

/** 按 id 移除一个自定义角色。 */
export function removeSlotById(
  roster: FixedTeamMemberSlot[],
  slotId: string,
): FixedTeamMemberSlot[] {
  return roster.filter((slot) => slot.id !== slotId);
}

/** 清空该层所有成员。 */
export function clearLayer(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
): FixedTeamMemberSlot[] {
  return roster.filter((slot) => slot.layer !== layer);
}

/* ── 规模预设 ──────────────────────────────────────────────────────────── */

/** 每个规模对应的 catalog key 集合（layer:specialty）。 */
const SCALE_PRESETS: Record<WorkflowTemplateScale, string[]> = {
  small: [
    'reception:intake',
    'pm1:task-planning',
    'pm2:dispatch',
    'executor:frontend',
    'executor:backend',
    'reviewer:code-review',
  ],
  medium: [
    'reception:intake',
    'pm1:product-planning',
    'pm1:task-planning',
    'pm2:tech-lead',
    'pm2:dispatch',
    'executor:frontend',
    'executor:backend',
    'reviewer:code-review',
  ],
  large: [
    'reception:intake',
    'pm1:product-planning',
    'pm1:task-planning',
    'pm2:tech-lead',
    'pm2:dispatch',
    'pm2:release',
    'executor:frontend',
    'executor:backend',
    'executor:data',
    'executor:qa',
    'executor:devops',
    'reviewer:code-review',
    'reviewer:security',
    'reviewer:sre',
  ],
  full: DEFAULT_FIXED_TEAM_MEMBER_SLOTS.map((slot) => `${slot.layer}:${slot.specialty}`),
};

/** 根据规模构建一份 roster（采用 catalog 预设）。 */
export function buildRosterForScale(scale: WorkflowTemplateScale): FixedTeamMemberSlot[] {
  const keys = SCALE_PRESETS[scale] ?? SCALE_PRESETS.medium;
  return keys
    .map((key) => CATALOG_BY_KEY.get(key))
    .filter((slot): slot is FixedTeamMemberSlot => slot !== undefined)
    .map((slot) => ({ ...slot, toolsets: [...slot.toolsets] }));
}

/** 仅保留 catalog 中标记为 required 的成员。 */
export function buildRequiredOnlyRoster(): FixedTeamMemberSlot[] {
  return DEFAULT_FIXED_TEAM_MEMBER_SLOTS.filter((slot) => slot.required).map((slot) => ({
    ...slot,
    toolsets: [...slot.toolsets],
  }));
}

/* ── metadata 互转 ─────────────────────────────────────────────────────── */

/** 模板是否可直接编辑：系统种子模板只读，用户模板可编辑。 */
export function isSeedTemplate(template: WorkflowTemplateRecord): boolean {
  return (
    template.category === 'team-playbook' &&
    template.metadata?.origin === 'seed' &&
    template.metadata?.templateKind === 'default-dev'
  );
}

/** 模板记录 → 编辑态。 */
export function templateToEditorState(template: WorkflowTemplateRecord): TemplateEditorState {
  const team = template.metadata?.teamTemplate;
  const memberSlots: FixedTeamMemberSlot[] =
    Array.isArray(team?.memberSlots) && team!.memberSlots!.length > 0
      ? team!.memberSlots!.map((slot) => ({ ...slot, toolsets: [...slot.toolsets] }))
      : cloneDefaultRoster();
  return {
    name: template.name,
    description: template.description ?? '',
    defaultProvider: team?.defaultProvider ?? null,
    scale: team?.templateScale ?? 'medium',
    focus: team?.templateFocus ?? '',
    recommendedFor: team?.recommendedFor ?? '',
    recommendedDefault: team?.recommendedDefault ?? false,
    memberSlots,
    modelPool: Array.isArray(team?.modelPool) ? team!.modelPool!.map((ref) => ({ ...ref })) : [],
    modelAssignStrategy: team?.modelAssignStrategy ?? 'balanced',
  };
}

/** 编辑态 → 后端 PATCH 用的 metadata 片段（与已有 teamTemplate 字段合并即可）。 */
export function editorStateToMetadata(state: TemplateEditorState): WorkflowTemplateMetadata {
  return {
    teamTemplate: {
      defaultProvider: state.defaultProvider,
      memberSlots: sortRosterByCatalog(state.memberSlots).map((slot) => ({
        ...slot,
        toolsets: [...slot.toolsets],
      })),
      templateScale: state.scale,
      templateFocus: state.focus.trim() || null,
      recommendedFor: state.recommendedFor.trim() || null,
      recommendedDefault: state.recommendedDefault,
      ...(state.modelPool.length > 0
        ? { modelPool: state.modelPool.map((ref) => ({ ...ref })) }
        : {}),
      modelAssignStrategy: state.modelAssignStrategy,
    },
  };
}

/** 字段一致性校验（轻量，不阻断 UI）。 */
export function validateTemplateState(
  state: TemplateEditorState,
): { valid: true } | { valid: false; reason: string } {
  if (state.name.trim().length === 0) {
    return { valid: false, reason: '请填写模板名称' };
  }
  if (state.memberSlots.length === 0) {
    return { valid: false, reason: '至少需要一名团队成员' };
  }
  const layers = new Set(state.memberSlots.map((slot) => slot.layer));
  if (!layers.has('reception')) {
    return { valid: false, reason: '接待层至少需要一名成员（接待官 / 需求澄清官）' };
  }
  return { valid: true };
}

export interface TemplateIssue {
  /** error 阻断保存；warning 仅提示。 */
  severity: 'error' | 'warning';
  message: string;
}

/**
 * 收集模板的全部问题（错误 + 警告），用于编辑器实时校验摘要。
 *
 * error（阻断保存）：缺名称 / 无成员 / 缺接待层。
 * warning（仅提示，不阻断）：缺 PM1 / PM2 / 执行层 / 评审层、模型池为空但有绑定、
 *   自定义角色没填提示词等 —— 帮助用户组建更完整可用的团队。
 */
export function collectTemplateIssues(state: TemplateEditorState): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const layers = new Set(state.memberSlots.map((slot) => slot.layer));

  if (state.name.trim().length === 0) {
    issues.push({ severity: 'error', message: '请填写模板名称' });
  }
  if (state.memberSlots.length === 0) {
    issues.push({ severity: 'error', message: '至少需要一名团队成员' });
  }
  if (state.memberSlots.length > 0 && !layers.has('reception')) {
    issues.push({ severity: 'error', message: '接待层缺少成员：用户的第一触点，必须有一名' });
  }

  // 警告：链路完整性 —— 缺中间层会让任务无法顺利流转。
  const LAYER_HINTS: Array<{ layer: TeamRuntimeLayer; label: string }> = [
    { layer: 'pm1', label: 'PM1 规划层' },
    { layer: 'pm2', label: 'PM2 管控层' },
    { layer: 'executor', label: '执行层' },
    { layer: 'reviewer', label: '评审层' },
  ];
  if (state.memberSlots.length > 0) {
    for (const { layer, label } of LAYER_HINTS) {
      if (!layers.has(layer)) {
        issues.push({ severity: 'warning', message: `${label}暂无成员，对应阶段会被跳过` });
      }
    }
  }

  // 警告：自定义角色未填提示词（运行时只能靠层 SOUL 兜底，失去自定义意义）。
  const customNoPrompt = state.memberSlots.filter(
    (s) => s.specialty === 'custom' && (!s.systemPrompt || s.systemPrompt.trim().length === 0),
  );
  if (customNoPrompt.length > 0) {
    issues.push({
      severity: 'warning',
      message: `${customNoPrompt.length} 个自定义角色未填写人物提示词`,
    });
  }

  // 警告：勾了模型池但一个都没分配（或反之），提示去配置模型。
  if (state.modelPool.length > 0) {
    const assigned = state.memberSlots.filter((s) => s.modelId).length;
    if (assigned === 0) {
      issues.push({
        severity: 'warning',
        message: '已选模型池但未分配给任何成员，可在「配置模型」里一键分配',
      });
    }
  }

  return issues;
}

/* ── 导入 / 导出 ─────────────────────────────────────────────────────────
 * 模板可导出为 JSON 备份 / 分享，再导入复用。导出只含可移植的编辑态字段
 * （不含 id / 时间戳等运行时元数据）。
 */

export interface TemplateExportPayload {
  openAworkTemplate: 1;
  name: string;
  description: string;
  scale: WorkflowTemplateScale;
  focus: string;
  recommendedFor: string;
  recommendedDefault: boolean;
  defaultProvider: string | null;
  modelAssignStrategy: WorkflowTeamTemplateModelStrategy;
  modelPool: WorkflowTeamTemplateModelRef[];
  memberSlots: FixedTeamMemberSlot[];
}

/** 把当前编辑态序列化为可导出的 JSON 字符串。 */
export function exportTemplateState(state: TemplateEditorState): string {
  const payload: TemplateExportPayload = {
    openAworkTemplate: 1,
    name: state.name,
    description: state.description,
    scale: state.scale,
    focus: state.focus,
    recommendedFor: state.recommendedFor,
    recommendedDefault: state.recommendedDefault,
    defaultProvider: state.defaultProvider,
    modelAssignStrategy: state.modelAssignStrategy,
    modelPool: state.modelPool.map((ref) => ({ ...ref })),
    memberSlots: sortRosterByCatalog(state.memberSlots).map((slot) => ({
      ...slot,
      toolsets: [...slot.toolsets],
    })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * 从导出的 JSON 解析回编辑态（容错）。
 * 校验最小结构（openAworkTemplate 标记 + memberSlots 数组）；非法时返回 error。
 * 导入只覆盖可移植字段，保留当前 name 由调用方决定（这里原样带入，调用方可再改）。
 */
export function importTemplateState(
  json: string,
): { ok: true; state: TemplateEditorState } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'JSON 解析失败，请检查内容格式' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: '不是合法的模板对象' };
  }
  const rec = raw as Record<string, unknown>;
  if (rec['openAworkTemplate'] !== 1) {
    return { ok: false, error: '不是 OpenAWork 模板导出文件（缺少标记）' };
  }
  if (!Array.isArray(rec['memberSlots'])) {
    return { ok: false, error: '缺少 memberSlots 花名册' };
  }
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const scale: WorkflowTemplateScale = (['small', 'medium', 'large', 'full'] as const).includes(
    rec['scale'] as WorkflowTemplateScale,
  )
    ? (rec['scale'] as WorkflowTemplateScale)
    : 'medium';
  // 复用 cloneRoster 的归一化（toolsets 拷贝），过滤掉结构不完整的槽位。
  const memberSlots = (rec['memberSlots'] as unknown[])
    .filter((s): s is FixedTeamMemberSlot => {
      if (typeof s !== 'object' || s === null) return false;
      const o = s as Record<string, unknown>;
      return (
        typeof o['id'] === 'string' &&
        typeof o['layer'] === 'string' &&
        typeof o['specialty'] === 'string' &&
        typeof o['personaKey'] === 'string' &&
        Array.isArray(o['toolsets'])
      );
    })
    .slice(0, 40)
    .map((slot) => ({ ...slot, toolsets: [...slot.toolsets] }));

  const modelPool: WorkflowTeamTemplateModelRef[] = Array.isArray(rec['modelPool'])
    ? (rec['modelPool'] as unknown[])
        .filter(
          (m): m is WorkflowTeamTemplateModelRef =>
            typeof m === 'object' &&
            m !== null &&
            typeof (m as Record<string, unknown>)['providerId'] === 'string' &&
            typeof (m as Record<string, unknown>)['modelId'] === 'string',
        )
        .map((ref) => ({ ...ref }))
    : [];

  const strategy = rec['modelAssignStrategy'];
  const modelAssignStrategy: WorkflowTeamTemplateModelStrategy = (
    ['quality', 'cost', 'balanced', 'single'] as const
  ).includes(strategy as WorkflowTeamTemplateModelStrategy)
    ? (strategy as WorkflowTeamTemplateModelStrategy)
    : 'balanced';

  return {
    ok: true,
    state: {
      name: str(rec['name']),
      description: str(rec['description']),
      defaultProvider: typeof rec['defaultProvider'] === 'string' ? rec['defaultProvider'] : null,
      scale,
      focus: str(rec['focus']),
      recommendedFor: str(rec['recommendedFor']),
      recommendedDefault: rec['recommendedDefault'] === true,
      memberSlots: memberSlots.length > 0 ? memberSlots : cloneDefaultRoster(),
      modelPool,
      modelAssignStrategy,
    },
  };
}

/* ── 变更对比（保存前预览改了什么）─────────────────────────────────────── */

const SCALE_LABEL: Record<WorkflowTemplateScale, string> = {
  small: '小型',
  medium: '中型',
  large: '大型',
  full: '完整',
};

const STRATEGY_LABEL: Record<WorkflowTeamTemplateModelStrategy, string> = {
  quality: '质量优先',
  cost: '成本优先',
  balanced: '均衡',
  single: '统一单模型',
};

function slotLabel(slot: FixedTeamMemberSlot): string {
  return slot.displayName?.trim() || slot.specialty;
}

/**
 * 对比「原模板」与「当前编辑态」，产出人类可读的变更清单（保存前预览改了什么）。
 *
 * 覆盖：元数据字段（名称/描述/规模/重点/适用场景/推荐/策略）+ 模型池数量 +
 * 花名册成员的新增 / 移除 / 修改（按 personaKey 配对，修改再细分模型/提示词/工具/能力）。
 * 返回空数组表示无变更。
 */
export function diffTemplateStates(
  original: TemplateEditorState,
  draft: TemplateEditorState,
): string[] {
  const changes: string[] = [];

  if (original.name !== draft.name) {
    changes.push(`名称：「${original.name || '（空）'}」→「${draft.name || '（空）'}」`);
  }
  if (original.description !== draft.description) {
    changes.push('修改了模板描述');
  }
  if (original.scale !== draft.scale) {
    changes.push(`规模：${SCALE_LABEL[original.scale]} → ${SCALE_LABEL[draft.scale]}`);
  }
  if (original.focus !== draft.focus) {
    changes.push('修改了重点方向');
  }
  if (original.recommendedFor !== draft.recommendedFor) {
    changes.push('修改了适用场景');
  }
  if (original.recommendedDefault !== draft.recommendedDefault) {
    changes.push(draft.recommendedDefault ? '标记为推荐起步' : '取消推荐起步标记');
  }
  if (original.modelAssignStrategy !== draft.modelAssignStrategy) {
    changes.push(
      `分配策略：${STRATEGY_LABEL[original.modelAssignStrategy]} → ${STRATEGY_LABEL[draft.modelAssignStrategy]}`,
    );
  }
  if (!modelPoolEquals(original.modelPool, draft.modelPool)) {
    changes.push(`模型池：${original.modelPool.length} → ${draft.modelPool.length} 个候选模型`);
  }

  // 花名册成员差异：按 personaKey 配对。
  const origByKey = new Map(original.memberSlots.map((s) => [s.personaKey, s]));
  const draftByKey = new Map(draft.memberSlots.map((s) => [s.personaKey, s]));

  const added = draft.memberSlots.filter((s) => !origByKey.has(s.personaKey));
  const removed = original.memberSlots.filter((s) => !draftByKey.has(s.personaKey));
  for (const s of added) changes.push(`新增成员：${slotLabel(s)}`);
  for (const s of removed) changes.push(`移除成员：${slotLabel(s)}`);

  // 配对存在的成员：检查关键字段是否变化。
  for (const draftSlot of draft.memberSlots) {
    const orig = origByKey.get(draftSlot.personaKey);
    if (!orig) continue;
    const detail: string[] = [];
    if (orig.modelId !== draftSlot.modelId || orig.providerId !== draftSlot.providerId) {
      detail.push('模型');
    }
    if ((orig.variant ?? '') !== (draftSlot.variant ?? '')) detail.push('推理强度');
    if ((orig.systemPrompt ?? '') !== (draftSlot.systemPrompt ?? '')) detail.push('提示词');
    if (!arrayEquals(orig.toolsets, draftSlot.toolsets)) detail.push('工具');
    if (!arrayEquals(orig.skillIds, draftSlot.skillIds)) detail.push('Skills');
    if (!arrayEquals(orig.mcpServerIds, draftSlot.mcpServerIds)) detail.push('MCP');
    if (!arrayEquals(orig.routingKeywords, draftSlot.routingKeywords)) detail.push('路由关键词');
    if ((orig.dispatchPriority ?? 'normal') !== (draftSlot.dispatchPriority ?? 'normal')) {
      detail.push('优先级');
    }
    if (orig.required !== draftSlot.required) detail.push('必选');
    if (detail.length > 0) {
      changes.push(`${slotLabel(draftSlot)}：调整了 ${detail.join(' / ')}`);
    }
  }

  return changes;
}

/** 比较两个可选字符串数组是否相等（顺序无关，undefined 视作空）。 */
function arrayEquals(a: string[] | undefined, b: string[] | undefined): boolean {
  const la = a ?? [];
  const lb = b ?? [];
  if (la.length !== lb.length) return false;
  const setA = new Set(la);
  return lb.every((x) => setA.has(x));
}

/** 比较两个 roster 是否相等（按 catalog 顺序归一化后比较）。 */
export function rosterEquals(a: FixedTeamMemberSlot[], b: FixedTeamMemberSlot[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortRosterByCatalog(a);
  const sb = sortRosterByCatalog(b);
  for (let i = 0; i < sa.length; i += 1) {
    const left = sa[i]!;
    const right = sb[i]!;
    if (
      left.layer !== right.layer ||
      left.specialty !== right.specialty ||
      left.displayName !== right.displayName ||
      left.personaKey !== right.personaKey ||
      left.required !== right.required ||
      left.providerId !== right.providerId ||
      left.modelId !== right.modelId ||
      left.variant !== right.variant ||
      left.systemPrompt !== right.systemPrompt ||
      Boolean(left.custom) !== Boolean(right.custom) ||
      !arrayEquals(left.skillIds, right.skillIds) ||
      !arrayEquals(left.mcpServerIds, right.mcpServerIds) ||
      !arrayEquals(left.routingKeywords, right.routingKeywords) ||
      left.dispatchPriority !== right.dispatchPriority ||
      left.toolsets.length !== right.toolsets.length ||
      left.toolsets.some((tool, idx) => tool !== right.toolsets[idx])
    ) {
      return false;
    }
  }
  return true;
}

/** 比较两个模型池是否相等（顺序无关）。 */
export function modelPoolEquals(
  a: WorkflowTeamTemplateModelRef[],
  b: WorkflowTeamTemplateModelRef[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (ref: WorkflowTeamTemplateModelRef) => `${ref.providerId}::${ref.modelId}`;
  const setA = new Set(a.map(key));
  return b.every((ref) => setA.has(key(ref)));
}
