/**
 * 智能模型分配规则引擎（纯函数，可单测）。
 *
 * 思路：用户先在「模型池」里勾选一批候选模型（来自真实 provider 配置，带能力 / 价格
 * 元数据），再选一种策略，引擎据此给每个成员槽位（按层 + specialty 画像）打分挑选
 * 最合适的模型。完全确定性、零延迟、零成本；分配后用户仍可逐槽手动微调。
 *
 * 与运行时无强耦合：引擎只产出 `{ providerId, modelId }`，写回 FixedTeamMemberSlot
 * 的可选模型字段；运行时是否消费由后端 seam 决定（见设计文档 Phase 2）。
 */

import type { TeamRuntimeLayer, TeamReasoningEffort, FixedTeamMemberSlot } from '@openAwork/shared';
import type { WorkflowTeamTemplateModelStrategy } from '@openAwork/web-client';

/**
 * 模型名称排序比较器（数字感知，降序）—— 复用 shared-ui 的全局唯一实现，
 * 保证团队模板的模型排序与聊天模型选择器、设置页模型下拉完全一致。
 */
export { compareModelsByName } from '@openAwork/shared-ui';

/** 模型池里一个候选模型的最小能力画像（取自 ChatSettingsModel）。 */
export interface ModelCandidate {
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface ModelAssignment {
  providerId: string;
  modelId: string;
  /** 是否启用思考模式（可选，未指定时不修改已有值）。 */
  thinkingEnabled?: boolean;
  /** 思考强度等级（可选，仅在 thinkingEnabled=true 时有意义）。 */
  reasoningEffort?: TeamReasoningEffort;
}

/**
 * 每层的"需求画像"权重。引擎按此对候选模型打分：
 *   - thinking：强推理需求（规划 / 评审高）
 *   - tools：工具调用 / 写代码需求（执行高）
 *   - context：长上下文需求（规划高）
 *   - speed/cost：低延迟低成本需求（接待高）
 * 权重和不必为 1，仅用于相对排序。
 */
interface LayerProfile {
  thinking: number;
  tools: number;
  context: number;
  costSensitivity: number;
}

export const LAYER_PROFILES: Record<TeamRuntimeLayer, LayerProfile> = {
  // 接待：高频短交互，便宜快，弱推理弱工具
  reception: { thinking: 0.1, tools: 0.1, context: 0.2, costSensitivity: 0.9 },
  // PM1 规划：强推理 + 长上下文
  pm1: { thinking: 0.9, tools: 0.1, context: 0.9, costSensitivity: 0.2 },
  // PM2 管控：推理 + 调度判断
  pm2: { thinking: 0.8, tools: 0.3, context: 0.6, costSensitivity: 0.3 },
  // 执行：强工具调用 + 代码
  executor: { thinking: 0.4, tools: 0.9, context: 0.5, costSensitivity: 0.4 },
  // 评审：严谨批判，强推理
  reviewer: { thinking: 0.9, tools: 0.4, context: 0.6, costSensitivity: 0.3 },
};

/** 归一化辅助：把一组数值映射到 0..1（用于上下文窗口 / 价格的相对比较）。 */
function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

/** 估算一个模型的"综合能力分"（越大越强，与价格无关）。 */
function capabilityScore(
  model: ModelCandidate,
  profile: LayerProfile,
  ctxRange: { min: number; max: number },
): number {
  const thinking = model.supportsThinking ? 1 : 0;
  const tools = model.supportsTools ? 1 : 0;
  const ctx =
    typeof model.contextWindow === 'number'
      ? normalize(model.contextWindow, ctxRange.min, ctxRange.max)
      : 0.5;
  return profile.thinking * thinking + profile.tools * tools + profile.context * ctx;
}

/** 估算一个模型的"价格分"（越大越贵）。用 input+output 均价的相对位置。 */
function priceScore(model: ModelCandidate, priceRange: { min: number; max: number }): number {
  const input = model.inputPricePerMillion ?? 0;
  const output = model.outputPricePerMillion ?? 0;
  const avg = (input + output) / 2;
  return normalize(avg, priceRange.min, priceRange.max);
}

function buildRanges(pool: ModelCandidate[]): {
  ctxRange: { min: number; max: number };
  priceRange: { min: number; max: number };
} {
  const ctxValues = pool
    .map((m) => m.contextWindow)
    .filter((v): v is number => typeof v === 'number');
  const priceValues = pool.map(
    (m) => ((m.inputPricePerMillion ?? 0) + (m.outputPricePerMillion ?? 0)) / 2,
  );
  return {
    ctxRange: {
      min: ctxValues.length ? Math.min(...ctxValues) : 0,
      max: ctxValues.length ? Math.max(...ctxValues) : 1,
    },
    priceRange: {
      min: priceValues.length ? Math.min(...priceValues) : 0,
      max: priceValues.length ? Math.max(...priceValues) : 1,
    },
  };
}

/**
 * 为单个层挑选最优模型。
 *
 * 策略含义：
 *   - quality：只看能力分，挑最强（忽略价格）
 *   - cost：能力达标的前提下挑最便宜（能力作次级排序）
 *   - balanced：能力分 - 价格惩罚（按层的 costSensitivity 加权）
 *   - single：由调用方在外层处理（全部层用同一个模型），这里不会被调用
 */
export function pickModelForLayer(
  layer: TeamRuntimeLayer,
  pool: ModelCandidate[],
  strategy: WorkflowTeamTemplateModelStrategy,
  ranges: { ctxRange: { min: number; max: number }; priceRange: { min: number; max: number } },
): ModelCandidate | null {
  if (pool.length === 0) return null;
  const profile = LAYER_PROFILES[layer];

  const scored = pool.map((model) => {
    const cap = capabilityScore(model, profile, ranges.ctxRange);
    const price = priceScore(model, ranges.priceRange);
    let score: number;
    switch (strategy) {
      case 'quality':
        score = cap;
        break;
      case 'cost':
        // 价格优先：低价高分；能力作为极小权重打破平局
        score = 1 - price + cap * 0.05;
        break;
      case 'balanced':
      default:
        // 能力 - 价格惩罚（按层成本敏感度加权）
        score = cap - price * profile.costSensitivity;
        break;
    }
    return { model, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.model ?? null;
}

/** 选取池中"最便宜"的模型（single 策略 / 兜底用）。 */
export function pickCheapest(pool: ModelCandidate[]): ModelCandidate | null {
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) =>
      (a.inputPricePerMillion ?? 0) +
      (a.outputPricePerMillion ?? 0) -
      ((b.inputPricePerMillion ?? 0) + (b.outputPricePerMillion ?? 0)),
  )[0]!;
}

/** 选取池中"综合最强"的模型（single 策略默认用最强铺满）。 */
export function pickStrongest(pool: ModelCandidate[]): ModelCandidate | null {
  if (pool.length === 0) return null;
  const ranges = buildRanges(pool);
  // 用一个通用画像（偏推理 + 上下文）评估"最强"
  const generic: LayerProfile = { thinking: 1, tools: 0.6, context: 0.8, costSensitivity: 0 };
  return [...pool]
    .map((model) => ({ model, score: capabilityScore(model, generic, ranges.ctxRange) }))
    .sort((a, b) => b.score - a.score)[0]!.model;
}

/**
 * 主入口：按策略为整份花名册分配模型，返回写入了 providerId/modelId 的新 roster。
 *
 * - single：全部层用同一个模型（池中最强）。
 * - 其它：每层独立挑选；同层多 specialty 共用该层的选择（保持一致、减少认知负担）。
 *
 * 只在 pool 非空时分配；pool 为空时原样返回（不清除已有绑定）。
 */
export function assignModelsToRoster(
  roster: FixedTeamMemberSlot[],
  pool: ModelCandidate[],
  strategy: WorkflowTeamTemplateModelStrategy,
): FixedTeamMemberSlot[] {
  if (pool.length === 0) return roster;

  if (strategy === 'single') {
    const chosen = pickStrongest(pool);
    if (!chosen) return roster;
    return roster.map((slot) => ({
      ...slot,
      toolsets: [...slot.toolsets],
      providerId: chosen.providerId,
      modelId: chosen.modelId,
    }));
  }

  const ranges = buildRanges(pool);
  // 每层只算一次，缓存到 map
  const byLayer = new Map<TeamRuntimeLayer, ModelCandidate | null>();
  return roster.map((slot) => {
    if (!byLayer.has(slot.layer)) {
      byLayer.set(slot.layer, pickModelForLayer(slot.layer, pool, strategy, ranges));
    }
    const chosen = byLayer.get(slot.layer);
    if (!chosen) {
      return { ...slot, toolsets: [...slot.toolsets] };
    }
    return {
      ...slot,
      toolsets: [...slot.toolsets],
      providerId: chosen.providerId,
      modelId: chosen.modelId,
    };
  });
}

/** 把整层统一设成某个模型（手动微调：每层"整层模型"下拉用）。 */
export function setLayerModel(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
  assignment: ModelAssignment | null,
): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    if (slot.layer !== layer) return slot;
    if (assignment === null) {
      const {
        providerId: _p,
        modelId: _m,
        variant: _v,
        thinkingEnabled: _t,
        reasoningEffort: _r,
        ...rest
      } = slot;
      return { ...rest, toolsets: [...slot.toolsets] };
    }
    return {
      ...slot,
      toolsets: [...slot.toolsets],
      providerId: assignment.providerId,
      modelId: assignment.modelId,
      ...(assignment.thinkingEnabled !== undefined
        ? { thinkingEnabled: assignment.thinkingEnabled }
        : {}),
      ...(assignment.reasoningEffort !== undefined
        ? { reasoningEffort: assignment.reasoningEffort }
        : {}),
    };
  });
}

/** 设置单个槽位的模型（chip ⚙ 浮层用）。 */
export function setSlotModel(
  roster: FixedTeamMemberSlot[],
  slotId: string,
  assignment: ModelAssignment | null,
): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    if (slot.id !== slotId) return slot;
    if (assignment === null) {
      const {
        providerId: _p,
        modelId: _m,
        variant: _v,
        thinkingEnabled: _t,
        reasoningEffort: _r,
        ...rest
      } = slot;
      return { ...rest, toolsets: [...slot.toolsets] };
    }
    return {
      ...slot,
      toolsets: [...slot.toolsets],
      providerId: assignment.providerId,
      modelId: assignment.modelId,
      ...(assignment.thinkingEnabled !== undefined
        ? { thinkingEnabled: assignment.thinkingEnabled }
        : {}),
      ...(assignment.reasoningEffort !== undefined
        ? { reasoningEffort: assignment.reasoningEffort }
        : {}),
    };
  });
}

/** 清空整份花名册的模型绑定（恢复到"按默认解析"）。 */
export function clearAllModels(roster: FixedTeamMemberSlot[]): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    const {
      providerId: _p,
      modelId: _m,
      variant: _v,
      thinkingEnabled: _t,
      reasoningEffort: _r,
      ...rest
    } = slot;
    return { ...rest, toolsets: [...slot.toolsets] };
  });
}

/** 统计花名册中已分配模型的槽位数。 */
export function countAssignedModels(roster: FixedTeamMemberSlot[]): number {
  return roster.filter((slot) => typeof slot.modelId === 'string' && slot.modelId.length > 0)
    .length;
}

export const MODEL_STRATEGY_OPTIONS: Array<{
  value: WorkflowTeamTemplateModelStrategy;
  label: string;
  hint: string;
}> = [
  { value: 'balanced', label: '均衡', hint: '能力与成本权衡，按层成本敏感度加权' },
  { value: 'quality', label: '质量优先', hint: '每层都挑池中最强模型（忽略价格）' },
  { value: 'cost', label: '成本优先', hint: '每层挑池中最便宜的可用模型' },
  { value: 'single', label: '单一铺满', hint: '所有层统一用池中最强的一个模型' },
];

/** 推理强度选项（与聊天端一致）。 */
export const REASONING_EFFORT_OPTIONS: Array<{
  value: TeamReasoningEffort;
  label: string;
}> = [
  { value: 'minimal', label: 'minimal · 最低' },
  { value: 'low', label: 'low · 低' },
  { value: 'medium', label: 'medium · 中' },
  { value: 'high', label: 'high · 高' },
  { value: 'xhigh', label: 'xhigh · 最高' },
];

/** 设置整层的思考配置（不改变模型绑定）。 */
export function setLayerThinking(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
  thinking: { thinkingEnabled: boolean; reasoningEffort?: TeamReasoningEffort } | null,
): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    if (slot.layer !== layer) return slot;
    if (thinking === null) {
      const { thinkingEnabled: _t, reasoningEffort: _r, ...rest } = slot;
      return { ...rest, toolsets: [...slot.toolsets] };
    }
    return {
      ...slot,
      toolsets: [...slot.toolsets],
      thinkingEnabled: thinking.thinkingEnabled,
      ...(thinking.reasoningEffort ? { reasoningEffort: thinking.reasoningEffort } : {}),
    };
  });
}

/** 设置单个槽位的思考配置（不改变模型绑定）。 */
export function setSlotThinking(
  roster: FixedTeamMemberSlot[],
  slotId: string,
  thinking: { thinkingEnabled: boolean; reasoningEffort?: TeamReasoningEffort } | null,
): FixedTeamMemberSlot[] {
  return roster.map((slot) => {
    if (slot.id !== slotId) return slot;
    if (thinking === null) {
      const { thinkingEnabled: _t, reasoningEffort: _r, ...rest } = slot;
      return { ...rest, toolsets: [...slot.toolsets] };
    }
    return {
      ...slot,
      toolsets: [...slot.toolsets],
      thinkingEnabled: thinking.thinkingEnabled,
      ...(thinking.reasoningEffort ? { reasoningEffort: thinking.reasoningEffort } : {}),
    };
  });
}

/**
 * 从 roster 某层的槽位中提取统一的思考配置。
 * 返回 null 表示该层无统一值（混合或未设置）。
 */
export function getLayerThinking(
  roster: FixedTeamMemberSlot[],
  layer: TeamRuntimeLayer,
): { thinkingEnabled: boolean; reasoningEffort?: TeamReasoningEffort } | null {
  const layerSlots = roster.filter((s) => s.layer === layer);
  if (layerSlots.length === 0) return null;
  const first = layerSlots[0];
  if (!first || typeof first.thinkingEnabled !== 'boolean') return null;
  const allSame = layerSlots.every(
    (s) =>
      s.thinkingEnabled === first.thinkingEnabled &&
      s.reasoningEffort === first.reasoningEffort,
  );
  if (!allSame) return null;
  return {
    thinkingEnabled: first.thinkingEnabled,
    ...(first.reasoningEffort ? { reasoningEffort: first.reasoningEffort } : {}),
  };
}
