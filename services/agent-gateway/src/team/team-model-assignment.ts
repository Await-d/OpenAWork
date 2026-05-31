/**
 * 团队模型「智能分配」服务端逻辑。
 *
 * 真正调用用户配置的 AI 上游让模型来推荐「每层用哪个候选模型」，而不是前端凭
 * 规则瞎猜。流程：
 *   1. 前端把「候选模型池（含能力/价格元数据）+ 各层成员画像 + 策略」发上来；
 *   2. 这里拼一个结构化 prompt，要求上游 LLM 返回严格 JSON（layer -> {providerId, modelId}）；
 *   3. 解析并校验：只接受池内存在的模型，丢弃越界/非法项；
 *   4. 任何失败（上游错误 / JSON 不合法 / 全部越界）→ 回退到确定性规则引擎，
 *      保证「一键分配」始终给得出结果。
 *
 * 本模块只做纯逻辑（拼 prompt / 解析 / 兜底），上游调用由路由用
 * requestWorkflowLlmCompletion 注入，方便单测。
 */

import { TEAM_RUNTIME_LAYER_ORDER, type TeamRuntimeLayer } from '@openAwork/shared';

export type ModelAssignStrategy = 'quality' | 'cost' | 'balanced' | 'single';

/** 候选模型的能力画像（与前端 ModelCandidate 对齐）。 */
export interface AssignModelCandidate {
  providerId: string;
  providerName?: string;
  modelId: string;
  label?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

/** 一层的画像（成员 specialty 列表帮助 LLM 理解该层职责）。 */
export interface AssignLayerInput {
  layer: TeamRuntimeLayer;
  /** 该层成员的中文角色名（如「前端开发者」「代码评审员」）。 */
  memberLabels: string[];
}

export interface AssignModelsRequest {
  pool: AssignModelCandidate[];
  layers: AssignLayerInput[];
  strategy: ModelAssignStrategy;
}

export interface LayerModelAssignment {
  layer: TeamRuntimeLayer;
  providerId: string;
  modelId: string;
  /** AI 给出的简短推荐理由（规则引擎兜底时为本地生成的简述）。 */
  reason?: string;
}

export interface AssignModelsResult {
  /** 每层一个模型（仅含 pool 内合法项）。 */
  assignments: LayerModelAssignment[];
  /** 'llm' = 上游成功且至少部分有效；'fallback' = 完全回退到规则引擎。 */
  source: 'llm' | 'fallback';
  /**
   * 回退/部分回退原因（仅当未能完全使用 LLM 结果时给出）：
   *   - 'llm-error'：上游调用抛错（网络 / 鉴权 / 超时等），message 含错误详情
   *   - 'llm-empty'：上游返回但解析后无任何池内合法项（JSON 非法 / 全部越界）
   * 用于前端提示「为什么没用上 AI」。
   */
  fallbackReasonCode?: 'llm-error' | 'llm-empty';
  /** 当 fallbackReasonCode='llm-error' 时的上游错误信息（已截断）。 */
  fallbackMessage?: string;
  /** 当 fallbackReasonCode='llm-empty' 时上游返回的原始文本片段（已截断，便于排查）。 */
  llmRawSnippet?: string;
}

const LAYER_BRIEF: Record<TeamRuntimeLayer, string> = {
  reception: '接待层：高频短交互、意图路由与陪聊，偏好低延迟低成本模型。',
  pm1: 'PM1 规划层：spec/plan/tasks 多步精炼，偏好强推理 + 长上下文模型。',
  pm2: 'PM2 管控层：架构评审 / Constitution Check / 拆分派发，偏好强推理 + 判断力。',
  executor: '执行层：写代码 + 工具调用，偏好强工具调用 / 代码能力模型。',
  reviewer: '评审层：代码 / 安全 / 质量评审，偏好严谨批判 + 强推理模型。',
};

const STRATEGY_BRIEF: Record<ModelAssignStrategy, string> = {
  quality: '质量优先：每层都选池中能力最强的模型，忽略价格。',
  cost: '成本优先：在满足该层基本需求的前提下，尽量选价格最低的模型。',
  balanced: '均衡：在能力与价格间权衡，越是低职责层越倾向便宜模型。',
  single: '单一铺满：所有层统一用池中综合最强的同一个模型。',
};

function poolKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

function describeModel(model: AssignModelCandidate): string {
  const caps: string[] = [];
  if (model.supportsThinking) caps.push('推理');
  if (model.supportsTools) caps.push('工具调用');
  if (model.supportsVision) caps.push('视觉');
  if (typeof model.contextWindow === 'number') caps.push(`上下文${model.contextWindow}`);
  const price =
    typeof model.inputPricePerMillion === 'number' || typeof model.outputPricePerMillion === 'number'
      ? `价格(输入${model.inputPricePerMillion ?? '?'}/输出${model.outputPricePerMillion ?? '?'} 每百万tokens)`
      : '价格未知';
  const capText = caps.length > 0 ? caps.join('、') : '能力未知';
  return `- providerId="${model.providerId}", modelId="${model.modelId}"（${model.label ?? model.modelId}）：${capText}；${price}`;
}

/** 构建发给上游 LLM 的 prompt。要求严格 JSON 输出。 */
export function buildAssignmentPrompt(input: AssignModelsRequest): string {
  const poolLines = input.pool.map(describeModel).join('\n');
  const layerLines = input.layers
    .map(
      (l) =>
        `- layer="${l.layer}"（${LAYER_BRIEF[l.layer]}）成员：${
          l.memberLabels.length > 0 ? l.memberLabels.join('、') : '（无具体成员名）'
        }`,
    )
    .join('\n');

  return [
    '你是一个为多层 AI 团队分配运行模型的助手。',
    '下面给出「候选模型池」和「团队各层职责」，请按指定策略，为每一层挑选最合适的一个模型。',
    '',
    `【分配策略】${STRATEGY_BRIEF[input.strategy]}`,
    '',
    '【候选模型池】（只能从这里选，不得编造）：',
    poolLines,
    '',
    '【团队各层】：',
    layerLines,
    '',
    '【输出要求】：',
    '1. 只输出 JSON，不要任何解释、不要 markdown 代码块围栏。',
    '2. 顶层是对象 {"assignments": [...]}。',
    '3. assignments 是数组，每个元素形如 {"layer":"<层>","providerId":"<池内providerId>","modelId":"<池内modelId>","reason":"<一句话中文理由>"}。',
    '4. 每个给出的层只出现一次；providerId 和 modelId 必须严格来自候选池中的某一项。',
    '5. reason 用一句话（不超过 40 字）说明为什么这个模型适合该层，结合该层职责与模型能力/价格。',
    '6. 若策略为 single，则所有层使用同一个 providerId/modelId（reason 可相同）。',
    '',
    '现在直接输出 JSON：',
  ].join('\n');
}

interface ParsedAssignment {
  layer: string;
  providerId: string;
  modelId: string;
  reason?: string;
}

/** 从 LLM 文本里尽力提取 JSON 对象（容忍多余文本 / 代码块围栏）。 */
function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  // 去掉可能的 ```json ... ``` 围栏
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // 退一步：尝试抓第一个 { … } 对象，或第一个 [ … ] 数组（取更靠前者）。
    const objStart = candidate.indexOf('{');
    const objEnd = candidate.lastIndexOf('}');
    const arrStart = candidate.indexOf('[');
    const arrEnd = candidate.lastIndexOf(']');
    const tryParse = (s: number, e: number): unknown => {
      if (s < 0 || e <= s) return null;
      try {
        return JSON.parse(candidate.slice(s, e + 1));
      } catch {
        return null;
      }
    };
    // 优先按出现更早的结构解析。
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      return tryParse(arrStart, arrEnd) ?? tryParse(objStart, objEnd);
    }
    return tryParse(objStart, objEnd) ?? tryParse(arrStart, arrEnd);
  }
}

/** 从解析后的 JSON 值里取出 assignments 列表（容忍顶层就是数组）。 */
function extractAssignmentList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const list = (parsed as { assignments?: unknown }).assignments;
    if (Array.isArray(list)) return list;
  }
  return [];
}

function isLayer(value: string): value is TeamRuntimeLayer {
  return (TEAM_RUNTIME_LAYER_ORDER as readonly string[]).includes(value);
}

/**
 * 抢救式解析：当整体 JSON 解析失败（截断 / 尾逗号 / 多余文本）时，
 * 从原文里逐个扫描「平衡的 {...} 片段」并单独 JSON.parse，尽量救回 assignment 对象。
 * 只保留能 parse 成且像 assignment（含 layer + modelId）的对象。
 */
function salvageAssignmentObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  const startStack: number[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      startStack.push(i);
    } else if (ch === '}') {
      const start = startStack.pop();
      if (start === undefined) continue;
      // 记录每一个「平衡的 {...}」（含任意嵌套层级），逐个尝试当作 assignment。
      const slice = text.slice(start, i + 1);
      try {
        const obj = JSON.parse(slice) as Record<string, unknown>;
        if (
          obj &&
          typeof obj === 'object' &&
          typeof obj['layer'] === 'string' &&
          typeof obj['modelId'] === 'string'
        ) {
          objects.push(obj);
        }
      } catch {
        // 该片段不完整 / 非法：跳过。
      }
    }
  }
  return objects;
}

/**
 * 解析 LLM 返回文本为合法 assignments。
 * 只保留：layer 合法 + 能在 pool 内定位到模型 + 每层最多一条。
 *
 * 对 (providerId, modelId) 的匹配做了容错（LLM 常见小错）：
 *   1. 精确匹配 providerId::modelId；
 *   2. providerId 缺失/对不上，但 modelId 在池内唯一 → 用池内该模型的真实 providerId；
 *   3. LLM 把 providerName（如 "Anthropic"）当成 providerId → 按 providerName 再匹配一次。
 */
export function parseAssignmentResponse(
  text: string,
  pool: AssignModelCandidate[],
  requestedLayers: TeamRuntimeLayer[],
): LayerModelAssignment[] {
  const parsed = extractJsonValue(text);
  let rawList = extractAssignmentList(parsed);
  // 严格解析失败（如 JSON 被截断 / 尾逗号）时，退化为「逐个对象抢救」：
  // 从原文里扫描每个 {...} 片段单独 JSON.parse，能救回多少算多少。
  if (rawList.length === 0) {
    rawList = salvageAssignmentObjects(text);
  }
  if (rawList.length === 0) return [];

  const poolByExact = new Map(pool.map((m) => [poolKey(m.providerId, m.modelId), m]));
  // modelId -> 候选项列表（用于「仅 modelId」匹配，唯一时才采纳）。
  const poolByModel = new Map<string, AssignModelCandidate[]>();
  for (const m of pool) {
    const arr = poolByModel.get(m.modelId) ?? [];
    arr.push(m);
    poolByModel.set(m.modelId, arr);
  }
  const norm = (v: string) => v.trim().toLowerCase();

  function resolvePoolEntry(
    providerId: string | undefined,
    modelId: string,
  ): AssignModelCandidate | null {
    // 1. 精确
    if (providerId) {
      const exact = poolByExact.get(poolKey(providerId, modelId));
      if (exact) return exact;
    }
    const byModel = poolByModel.get(modelId) ?? [];
    if (byModel.length === 0) return null;
    // 2. modelId 唯一
    if (byModel.length === 1) return byModel[0]!;
    // 3. providerId 实为 providerName / 大小写差异
    if (providerId) {
      const p = norm(providerId);
      const matched = byModel.find(
        (m) => norm(m.providerId) === p || (m.providerName ? norm(m.providerName) === p : false),
      );
      if (matched) return matched;
    }
    return null;
  }

  const requested = new Set<string>(requestedLayers);
  const seen = new Set<string>();
  const result: LayerModelAssignment[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const { layer, providerId, modelId, reason } = item as Partial<ParsedAssignment>;
    if (typeof layer !== 'string' || typeof modelId !== 'string') continue;
    if (!isLayer(layer) || !requested.has(layer) || seen.has(layer)) continue;
    const entry = resolvePoolEntry(
      typeof providerId === 'string' ? providerId : undefined,
      modelId,
    );
    if (!entry) continue;
    seen.add(layer);
    const trimmedReason =
      typeof reason === 'string' && reason.trim().length > 0 ? reason.trim().slice(0, 120) : undefined;
    result.push({
      layer,
      providerId: entry.providerId,
      modelId: entry.modelId,
      ...(trimmedReason ? { reason: trimmedReason } : {}),
    });
  }
  return result;
}

/* ── 确定性规则引擎兜底 ──────────────────────────────────────────────────
 * 与前端 model-assignment.ts 的画像保持一致：上游不可用 / 返回非法时用它，
 * 保证「一键分配」永远给得出结果。
 */

interface LayerProfile {
  thinking: number;
  tools: number;
  context: number;
  costSensitivity: number;
}

const LAYER_PROFILES: Record<TeamRuntimeLayer, LayerProfile> = {
  reception: { thinking: 0.1, tools: 0.1, context: 0.2, costSensitivity: 0.9 },
  pm1: { thinking: 0.9, tools: 0.1, context: 0.9, costSensitivity: 0.2 },
  pm2: { thinking: 0.8, tools: 0.3, context: 0.6, costSensitivity: 0.3 },
  executor: { thinking: 0.4, tools: 0.9, context: 0.5, costSensitivity: 0.4 },
  reviewer: { thinking: 0.9, tools: 0.4, context: 0.6, costSensitivity: 0.3 },
};

function normalize(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

function avgPrice(model: AssignModelCandidate): number {
  return ((model.inputPricePerMillion ?? 0) + (model.outputPricePerMillion ?? 0)) / 2;
}

function buildRanges(pool: AssignModelCandidate[]): {
  ctx: { min: number; max: number };
  price: { min: number; max: number };
} {
  const ctxValues = pool
    .map((m) => m.contextWindow)
    .filter((v): v is number => typeof v === 'number');
  const priceValues = pool.map(avgPrice);
  return {
    ctx: {
      min: ctxValues.length ? Math.min(...ctxValues) : 0,
      max: ctxValues.length ? Math.max(...ctxValues) : 1,
    },
    price: {
      min: priceValues.length ? Math.min(...priceValues) : 0,
      max: priceValues.length ? Math.max(...priceValues) : 1,
    },
  };
}

function capabilityScore(
  model: AssignModelCandidate,
  profile: LayerProfile,
  ctxRange: { min: number; max: number },
): number {
  const thinking = model.supportsThinking ? 1 : 0;
  const tools = model.supportsTools ? 1 : 0;
  const ctx =
    typeof model.contextWindow === 'number'
      ? normalize(model.contextWindow, ctxRange.min, ctxRange.max)
      : 0.5;
  // 名称/版本 tier 作为「能力档位」信号：能力 flag 缺失或全相等时（最常见），
  // 它提供真正有意义的强弱区分，避免「最强」沦为任意挑选。
  const tier = modelTierScore(model);
  return (
    profile.thinking * thinking +
    profile.tools * tools +
    profile.context * ctx +
    // tier 权重 0.6：足以在能力相近时拉开差距，又不会盖过明确的 thinking/tools 能力。
    0.6 * tier
  );
}

/**
 * 基于模型名 / label 推断「能力档位分」（0..1，越大越强）。
 *
 * 纯启发式，用于在能力 flag 缺失或相等时提供有意义的强弱信号：
 *   - 旗舰/大杯关键词（opus / pro / max / ultra / large / 405b…）加分
 *   - 轻量/小杯关键词（mini / nano / lite / flash / haiku / small / 8b…）减分
 *   - 版本号越大越新越强（如 v2.5 > v2，gpt-5.5 > gpt-5.4）
 * 命中越多越强；都没命中则给中性 0.5。
 */
export function modelTierScore(model: AssignModelCandidate): number {
  const text = `${model.modelId} ${model.label ?? ''}`.toLowerCase();

  // 旗舰 / 强档关键词（权重越高越强）。
  const STRONG_TIERS: Array<{ re: RegExp; w: number }> = [
    { re: /\b(opus|ultra|max)\b|opus|ultra/, w: 1 },
    { re: /\bpro\b|-pro\b|pro\b/, w: 0.7 },
    { re: /\b(large|405b|70b|huge|xl)\b|large|405b/, w: 0.7 },
    { re: /\b(plus|advanced|reasoning|thinking|r1|o[0-9])\b/, w: 0.5 },
  ];
  // 轻量 / 弱档关键词（命中则扣分）。
  const WEAK_TIERS: Array<{ re: RegExp; w: number }> = [
    { re: /mini|nano|tiny|micro/, w: 0.6 },
    { re: /lite|light|small|8b|7b|3b|1b/, w: 0.5 },
    { re: /flash|haiku|turbo|fast|instant|air/, w: 0.4 },
  ];

  let score = 0.5;
  for (const { re, w } of STRONG_TIERS) {
    if (re.test(text)) {
      score += w * 0.4;
      break; // 只取命中的最高档，避免多重叠加
    }
  }
  for (const { re, w } of WEAK_TIERS) {
    if (re.test(text)) {
      score -= w * 0.4;
      break;
    }
  }

  // 版本号信号：抓 modelId 里的「主.次」版本，越大越新越强（归一到小幅加成）。
  const version = extractVersionNumber(model.modelId);
  if (version !== null) {
    // 常见版本范围 0..10，映射到 0..0.2 的加成。
    score += Math.min(version / 10, 1) * 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

/** 从 modelId 抓第一个「主.次」版本号（如 gpt-5.4 → 5.4，mimo-v2.5 → 2.5，claude-opus-4-8 → 4.8）。 */
function extractVersionNumber(modelId: string): number | null {
  const lower = modelId.toLowerCase();
  // 优先匹配「主<分隔>次」（分隔符为 . 或 -），否则退到单独的主版本号。
  const pair = lower.match(/v?(\d+)[.-](\d+)/);
  if (pair) {
    const major = Number(pair[1]);
    const minor = Number(pair[2]);
    if (!Number.isNaN(major)) {
      return major + (Number.isNaN(minor) ? 0 : minor / 10);
    }
  }
  const single = lower.match(/v?(\d+)/);
  if (single) {
    const major = Number(single[1]);
    if (!Number.isNaN(major)) return major;
  }
  return null;
}

function pickForLayer(
  layer: TeamRuntimeLayer,
  pool: AssignModelCandidate[],
  strategy: ModelAssignStrategy,
  ranges: ReturnType<typeof buildRanges>,
): AssignModelCandidate | null {
  if (pool.length === 0) return null;
  const profile = LAYER_PROFILES[layer];
  const scored = pool.map((model) => {
    const cap = capabilityScore(model, profile, ranges.ctx);
    const price = normalize(avgPrice(model), ranges.price.min, ranges.price.max);
    let score: number;
    switch (strategy) {
      case 'quality':
        score = cap;
        break;
      case 'cost':
        score = 1 - price + cap * 0.05;
        break;
      case 'balanced':
      default:
        score = cap - price * profile.costSensitivity;
        break;
    }
    return { model, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.model ?? null;
}

function pickStrongest(pool: AssignModelCandidate[]): AssignModelCandidate | null {
  if (pool.length === 0) return null;
  const ranges = buildRanges(pool);
  const generic: LayerProfile = { thinking: 1, tools: 0.6, context: 0.8, costSensitivity: 0 };
  return [...pool]
    .map((model) => ({ model, score: capabilityScore(model, generic, ranges.ctx) }))
    .sort((a, b) => b.score - a.score)[0]!.model;
}

/**
 * 选出用来「跑分析」的模型（即拿哪个 provider 的凭证去调上游做推荐）。
 *
 * 优先用候选池里综合最强的模型 —— 用户既然把这些模型选进团队池，对应 provider 的
 * API Key 大概率有效；用它来跑分析，避免依赖另一个可能没配好的 fast/active 选择
 * （这正是 "invalid x-api-key" 的根因）。返回 { providerId, modelId } 作为
 * resolveAuxiliaryLlmConfig 的 override。
 */
export function pickAnalysisModel(
  pool: AssignModelCandidate[],
): { providerId: string; modelId: string } | null {
  const chosen = pickStrongest(pool);
  if (!chosen) return null;
  return { providerId: chosen.providerId, modelId: chosen.modelId };
}

/**
 * 选出一组「跑分析」的候选模型：每个 distinct provider 取其最强模型，按能力从高到低排序。
 *
 * 用于多 provider 容错：若最强 provider 的上游调用失败（如 "Invalid JSON response" /
 * 鉴权 / 模型不存在），路由会依次尝试下一个 provider，直到有一个成功。
 */
export function pickAnalysisModels(
  pool: AssignModelCandidate[],
): Array<{ providerId: string; modelId: string }> {
  if (pool.length === 0) return [];
  const ranges = buildRanges(pool);
  const generic: LayerProfile = { thinking: 1, tools: 0.6, context: 0.8, costSensitivity: 0 };
  // 每个 provider 选其最强模型。
  const bestByProvider = new Map<string, { model: AssignModelCandidate; score: number }>();
  for (const model of pool) {
    const score = capabilityScore(model, generic, ranges.ctx);
    const existing = bestByProvider.get(model.providerId);
    if (!existing || score > existing.score) {
      bestByProvider.set(model.providerId, { model, score });
    }
  }
  return [...bestByProvider.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ model }) => ({ providerId: model.providerId, modelId: model.modelId }));
}

/** 为规则引擎兜底生成一句简短理由（基于策略 + 该模型能力概要）。 */
function fallbackReason(
  layer: TeamRuntimeLayer,
  model: AssignModelCandidate,
  strategy: ModelAssignStrategy,
): string {
  const caps: string[] = [];
  if (model.supportsThinking) caps.push('强推理');
  if (model.supportsTools) caps.push('工具调用');
  const capText = caps.length > 0 ? caps.join('+') : '通用能力';
  const strategyText =
    strategy === 'quality'
      ? '质量优先'
      : strategy === 'cost'
        ? '成本优先'
        : strategy === 'single'
          ? '单一铺满'
          : '均衡';
  return `规则引擎（${strategyText}）：按本层画像匹配${capText}`;
}

/** 规则引擎兜底：为请求的每层挑一个模型。 */
export function fallbackAssign(input: AssignModelsRequest): LayerModelAssignment[] {
  const { pool, layers, strategy } = input;
  if (pool.length === 0) return [];

  if (strategy === 'single') {
    const chosen = pickStrongest(pool);
    if (!chosen) return [];
    return layers.map((l) => ({
      layer: l.layer,
      providerId: chosen.providerId,
      modelId: chosen.modelId,
      reason: fallbackReason(l.layer, chosen, strategy),
    }));
  }

  const ranges = buildRanges(pool);
  const result: LayerModelAssignment[] = [];
  for (const l of layers) {
    const chosen = pickForLayer(l.layer, pool, strategy, ranges);
    if (chosen) {
      result.push({
        layer: l.layer,
        providerId: chosen.providerId,
        modelId: chosen.modelId,
        reason: fallbackReason(l.layer, chosen, strategy),
      });
    }
  }
  return result;
}

/**
 * 主入口：拼 prompt → 调上游 → 解析 → 校验；缺层用规则引擎补齐；
 * 完全失败则整体回退规则引擎。
 *
 * callLlm 由路由注入（基于 requestWorkflowLlmCompletion）。可传**单个**调用器，
 * 也可传一个**有序数组**（每项对应一个候选 provider 的凭证）：数组形式下会按序
 * 尝试，直到某个 provider 调用成功且解析出至少一层——以此对「某个 provider 上游
 * 报错（如 Invalid JSON response / 鉴权失败 / 模型不存在）」做容错。
 */
export async function assignTeamModels(
  input: AssignModelsRequest,
  callLlm: ((prompt: string) => Promise<string>) | Array<(prompt: string) => Promise<string>>,
): Promise<AssignModelsResult> {
  const requestedLayers = input.layers.map((l) => l.layer);
  if (input.pool.length === 0 || requestedLayers.length === 0) {
    return { assignments: [], source: 'fallback' };
  }

  const callers = Array.isArray(callLlm) ? callLlm : [callLlm];
  const prompt = buildAssignmentPrompt(input);

  let llmAssignments: LayerModelAssignment[] = [];
  let llmError: string | null = null;
  let llmRawText: string | null = null;
  for (const caller of callers) {
    try {
      const text = await caller(prompt);
      const parsed = parseAssignmentResponse(text, input.pool, requestedLayers);
      if (parsed.length > 0) {
        // 命中：用这个 provider 的结果，清掉之前候选的错误。
        llmAssignments = parsed;
        llmError = null;
        llmRawText = text;
        break;
      }
      // 解析为空：记录原始片段，继续尝试下一个候选 provider。
      llmRawText = text;
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
      // 继续尝试下一个候选 provider。
    }
  }

  if (llmAssignments.length === 0) {
    return {
      assignments: fallbackAssign(input),
      source: 'fallback',
      ...(llmError
        ? { fallbackReasonCode: 'llm-error' as const, fallbackMessage: llmError.slice(0, 300) }
        : {
            fallbackReasonCode: 'llm-empty' as const,
            ...(llmRawText
              ? { llmRawSnippet: llmRawText.trim().slice(0, 300) }
              : {}),
          }),
    };
  }

  // LLM 部分有效：缺失的层用规则引擎补齐，整体来源标记为 llm。
  if (llmAssignments.length < requestedLayers.length) {
    const covered = new Set(llmAssignments.map((a) => a.layer));
    const missingLayers = input.layers.filter((l) => !covered.has(l.layer));
    const filled = fallbackAssign({ ...input, layers: missingLayers });
    return { assignments: [...llmAssignments, ...filled], source: 'llm' };
  }

  return { assignments: llmAssignments, source: 'llm' };
}
