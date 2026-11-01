/**
 * T-15 编排深度判据（纯函数，便于表驱动单测）
 *
 * 权威定义见 `docs/architecture/team-orchestration-depth.md`：
 *   - L0 只读/问答，不产生变更
 *   - L1 单文件/单函数且不触碰 schema·迁移·权限·构建配置
 *   - L2 2–5 文件同一模块
 *   - L3 跨包/架构级，或触碰高风险面
 *
 * 设计约束：
 *   1. 判据只看**改动面**，不看措辞长度或语气；
 *   2. 规则优先；规则不确定时交给 LLM 兜底并要求返回深度；
 *   3. LLM 缺失、超时或输出非法时**保守取更深的深度**，绝不静默降级为 L1。
 */

export const ORCHESTRATION_DEPTHS = ['L0', 'L1', 'L2', 'L3'] as const;

export type OrchestrationDepth = (typeof ORCHESTRATION_DEPTHS)[number];

/** 仅 `light` / `direct` 这类只读或前台直答决策可以直接判为 L0。 */
const READ_ONLY_DECISIONS = new Set(['light', 'direct']);

export function isOrchestrationDepth(value: unknown): value is OrchestrationDepth {
  return typeof value === 'string' && (ORCHESTRATION_DEPTHS as readonly string[]).includes(value);
}

export function depthForReadOnlyDecision(decision: string): OrchestrationDepth | null {
  return READ_ONLY_DECISIONS.has(decision) ? 'L0' : null;
}

/** 触碰高风险面 → 至少 L3（即使改动面看起来很小）。 */
const HIGH_RISK_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(数据库)?迁移|migration|schema|表结构|建表|加字段|索引变更/i, '触碰 schema / 迁移'],
  [/权限|鉴权|认证|授权|permission|acl|role\s*模型/i, '触碰权限 / 鉴权'],
  [
    /构建配置|打包配置|tsconfig|webpack|vite\s*配置|构建脚本|发布流程|依赖升级/i,
    '触碰构建 / 发布配置',
  ],
];

/** 跨包 / 架构级 → L3。 */
const ARCHITECTURE_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/跨包|跨模块|整个系统|整体架构|架构级|公共包|monorepo|多包|端到端/i, '跨包 / 架构级改动'],
  [/(重构|重写|重新设计)(整个|全部|整体|系统|架构)/i, '架构级重构'],
];

/** 多文件同模块 → L2。 */
const MULTI_FILE_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/接口|api/i, '涉及接口改动'],
  [/前端|页面|路由|store|仓库层|数据层/i, '涉及前端 / 页面层'],
  [/(加|新增|实现|接入|对接).{0,12}(功能|模块|页面|接口|字段)/i, '单模块功能改动'],
];

/** 单文件 / 单函数 → L1。 */
const SINGLE_UNIT_SIGNALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/文案|文字|标题|按钮|提示语|placeholder|label/i, '文案 / 提示语类单点改动'],
  [/样式|颜色|间距|字体大小|主题色|css/i, '样式类单点改动'],
  [/(这|该|本|此)(个|处)?(文件|函数|方法|组件)/, '明确单文件 / 单函数'],
  [/一行|一处|单个|一个小/i, '单点改动'],
];

export type DepthRuleAssessment =
  | {
      kind: 'assessed';
      depth: OrchestrationDepth;
      reason: string;
      signals: string[];
      /** 是否存在与之冲突的同类信号（用于观察，不影响结论）。 */
      conflicts: string[];
    }
  | { kind: 'uncertain'; reason: string; signals: string[] };

function collect(intent: string, table: ReadonlyArray<readonly [RegExp, string]>): string[] {
  return table.filter(([pattern]) => pattern.test(intent)).map(([, reason]) => reason);
}

/**
 * 规则判据。只判断是否属于 L1/L2/L3 三类改动面之一；L0 由路由决策决定，
 * 因此本函数不返回 L0。
 */
export function assessOrchestrationDepthByRules(intent: string): DepthRuleAssessment {
  const trimmed = intent.trim();
  if (trimmed.length === 0) {
    return { kind: 'uncertain', reason: '输入为空，无法判断改动面', signals: [] };
  }

  const highRisk = collect(trimmed, HIGH_RISK_SIGNALS);
  const architecture = collect(trimmed, ARCHITECTURE_SIGNALS);
  const multiFile = collect(trimmed, MULTI_FILE_SIGNALS);
  const singleUnit = collect(trimmed, SINGLE_UNIT_SIGNALS);

  // 高风险面与架构级一律 L3：即使同时出现「文案」这类小改动信号也不降级。
  if (highRisk.length > 0) {
    return {
      kind: 'assessed',
      depth: 'L3',
      reason: highRisk[0]!,
      signals: [...highRisk, ...architecture],
      conflicts: singleUnit,
    };
  }
  if (architecture.length > 0) {
    return {
      kind: 'assessed',
      depth: 'L3',
      reason: architecture[0]!,
      signals: architecture,
      conflicts: singleUnit,
    };
  }

  // 只要出现多文件/同模块信号就取 L2，即使同时还匹配了「文案」这类单点信号：
  // 判据不确定时保守取更深，避免把多文件改动误放进 L1 快车道。
  if (multiFile.length > 0) {
    return {
      kind: 'assessed',
      depth: 'L2',
      reason: multiFile.join('；'),
      signals: multiFile,
      conflicts: singleUnit,
    };
  }

  if (singleUnit.length > 0) {
    return {
      kind: 'assessed',
      depth: 'L1',
      reason: singleUnit.join('；'),
      signals: singleUnit,
      conflicts: multiFile,
    };
  }

  return {
    kind: 'uncertain',
    reason: '规则未命中明确的改动面信号',
    signals: [],
  };
}

/** 完整的升级短句：用户只说了这一句，语义明确无歧义。 */
const EXACT_DEPTH_UPGRADE_INTENTS = new Set([
  '升级',
  '升级流程',
  '升级为完整流程',
  '完整流程',
  '走完整流程',
  '用完整流程',
  '切换到完整流程',
  '改成完整流程',
  '升到完整流程',
]);

/**
 * T-17：用户是否要求把小任务的浅编排**升级为完整流程**。
 *
 * 判定刻意保守——只有「整句就是升级短句」或「升级动词 + 完整流程」同时出现才算，
 * 避免把「升级依赖版本」「升级 Node」这类真实开发任务误判成编排升级。
 */
export function isDepthUpgradeIntent(intent: string): boolean {
  const trimmed = intent.trim();
  if (trimmed.length === 0) return false;
  if (EXACT_DEPTH_UPGRADE_INTENTS.has(trimmed)) return true;
  return /(升级|升到|切换到|改成)/.test(trimmed) && /(完整流程|完整编排|全流程)/.test(trimmed);
}

/** 要求路由 / 判据模型在输出中附加深度行。 */
export const DEPTH_OUTPUT_INSTRUCTION = `另外按改动面判断编排深度并输出一行：
DEPTH: L1|L2|L3
- L1：单文件或单函数的小改动，且不涉及 schema、数据库迁移、权限/鉴权、构建或发布配置
- L2：2–5 个文件、同一模块内的功能改动
- L3：跨包/跨模块/架构级改动，或涉及 schema、迁移、权限、构建配置
无法判断时按更深的深度输出。`;

export function parseOrchestrationDepthFromLlm(raw: string): OrchestrationDepth | null {
  const match = /DEPTH:\s*(L[0-3])/i.exec(raw);
  if (!match?.[1]) return null;
  const normalized = match[1].toUpperCase() as OrchestrationDepth;
  // L0 不由判据模型给出（只读请求不会走到这里），忽略以免把任务误降级为空编排。
  return normalized === 'L0' ? null : normalized;
}

export interface ResolvedOrchestrationDepth {
  depth: OrchestrationDepth;
  source: 'rule' | 'llm' | 'degraded';
  reason: string;
}

/**
 * 解析编排深度：规则优先，规则不确定时用模型兜底并要求返回深度；
 * 模型不可用 / 超时 / 输出非法时保守降级到 L2 并标注 `degraded`，
 * 让调用方可以记录可观测事件，而不是静默把任务当成小改动。
 */
export async function resolveOrchestrationDepth(input: {
  intent: string;
  callLlm?: (prompt: string, signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
}): Promise<ResolvedOrchestrationDepth> {
  const ruled = assessOrchestrationDepthByRules(input.intent);
  if (ruled.kind === 'assessed') {
    return { depth: ruled.depth, source: 'rule', reason: ruled.reason };
  }

  if (!input.callLlm) {
    return { depth: 'L2', source: 'degraded', reason: `${ruled.reason}；无可用判据模型` };
  }

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 8_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const output = await Promise.race([
      input.callLlm(
        `判断以下需求的改动面属于哪个编排深度。\n需求：${input.intent}\n\n${DEPTH_OUTPUT_INSTRUCTION}`,
        controller.signal,
      ),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`depth LLM timeout (${timeoutMs}ms)`)),
        );
      }),
    ]);
    const parsed = parseOrchestrationDepthFromLlm(output);
    if (parsed) {
      return { depth: parsed, source: 'llm', reason: '模型判据' };
    }
    return { depth: 'L2', source: 'degraded', reason: `${ruled.reason}；模型未返回合法深度` };
  } catch (err) {
    return {
      depth: 'L2',
      source: 'degraded',
      reason: `${ruled.reason}；模型判据失败（${err instanceof Error ? err.message : 'unknown'}）`,
    };
  } finally {
    clearTimeout(timer);
  }
}
