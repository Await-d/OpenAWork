export type TargetLocatability = 'direct' | 'analysis' | 'open';
export type DecisionScope = 'none' | 'local' | 'architectural';
export type ImpactScope = 'single' | 'multi' | 'cross-system';
export type RiskLevel = 'safe' | 'moderate' | 'high';
export type RouteLevel = 'R0' | 'R1' | 'R2' | 'R3';
export type ClarificationDimension = 'goal' | 'constraint' | 'deliverable' | 'acceptance';

export interface RoutingDimensions {
  needsAction: boolean;
  targetLocatability: TargetLocatability;
  decisionScope: DecisionScope;
  impactScope: ImpactScope;
  riskLevel: RiskLevel;
}

export interface ClarificationQuestion {
  dimension: ClarificationDimension;
  question: string;
  options?: Array<{ label: string; description?: string }>;
}

export interface RoutingDecision {
  level: RouteLevel;
  dimensions: RoutingDimensions;
  clarifications?: ClarificationQuestion[];
  reason: string;
}

export interface SessionContext {
  sessionId: string;
  clarificationRound: number;
  collectedDimensions: Set<ClarificationDimension>;
  history: string[];
}

export function createSessionContext(sessionId: string): SessionContext {
  return {
    sessionId,
    clarificationRound: 0,
    collectedDimensions: new Set(),
    history: [],
  };
}

function determineRouteLevel(dims: RoutingDimensions): RouteLevel {
  if (!dims.needsAction) return 'R0';
  if (dims.riskLevel === 'high') return 'R3';
  if (
    dims.decisionScope === 'architectural' ||
    dims.impactScope === 'cross-system' ||
    dims.targetLocatability === 'open'
  )
    return 'R3';
  if (
    dims.decisionScope === 'local' ||
    dims.impactScope === 'multi' ||
    dims.targetLocatability === 'analysis'
  )
    return 'R2';
  return 'R1';
}

const CLARIFICATION_ORDER: ClarificationDimension[] = [
  'goal',
  'constraint',
  'deliverable',
  'acceptance',
];

/**
 * 澄清维度模板（中文）。每个维度的**首个选项即推荐答案**——调用方（reception / pm1 的
 * grill 运行体）统一用「首项标 recommended」策略，两者保持一致，避免推荐位漂移。
 */
const CLARIFICATION_TEMPLATES: Record<
  ClarificationDimension,
  (input: string) => ClarificationQuestion
> = {
  goal: (input) => ({
    dimension: 'goal',
    question: `为确认范围：你希望从「${input.slice(0, 60)}」得到的主要结果是什么？`,
    options: [
      {
        label: '跨多个文件的功能改动',
        description: '改动会横跨若干个模块',
      },
      { label: '具体文件/位置的改动', description: '我已经明确知道要改哪里' },
      { label: '架构级决策', description: '会影响系统设计或整体结构' },
    ],
  }),
  constraint: () => ({
    dimension: 'constraint',
    question: '有没有我必须知道的约束？（例如：不能改 X、必须保持向后兼容、截止时间）',
    options: [
      { label: '暂无额外约束', description: '按最佳实践推进即可' },
      { label: '不得修改既有接口', description: '只做增量改动' },
      { label: '必须留在现有技术栈', description: '不引入新依赖' },
    ],
  }),
  deliverable: () => ({
    dimension: 'deliverable',
    question: '交付物应该是什么形态？（例如：新文件、修改现有函数、可直接合并的改动）',
    options: [
      { label: '可直接运行的代码改动', description: '改完即可构建/运行' },
      { label: '方案 + 代码', description: '先说明思路，再实施' },
      { label: '仅方案', description: '只要提案，暂不写代码' },
    ],
  }),
  acceptance: () => ({
    dimension: 'acceptance',
    question: '你根据什么判断结果是对的？（例如：测试通过、特定行为、输出格式）',
    options: [
      { label: '既有测试通过', description: '不需要额外新增测试' },
      { label: '需要新增测试', description: '把测试作为任务的一部分' },
      { label: '人工验证', description: '我会自己检查产出' },
    ],
  }),
};

function buildClarifications(
  level: RouteLevel,
  context: SessionContext,
  input: string,
): ClarificationQuestion[] {
  if (level === 'R0' || level === 'R1') return [];
  if (context.clarificationRound >= 3) return [];

  const missing = CLARIFICATION_ORDER.filter((d) => !context.collectedDimensions.has(d));
  const next = missing[0];
  if (!next) return [];

  return [CLARIFICATION_TEMPLATES[next](input)];
}

function inferDimensions(input: string): RoutingDimensions {
  const lower = input.toLowerCase();

  const needsAction =
    /\b(add|implement|create|fix|update|refactor|delete|remove|build|write|change|move|rename|migrate)\b|(实现|修复|创建|新增|删除|移除|重构|迁移|修改|改成|部署|上线)/.test(
      lower,
    );

  const isArchitectural =
    /\b(architect|design|system|microservice|database schema|migration|restructur|restructure|overhaul|rewrite|across|all|entire|every)\b|(架构|系统设计|整体改造|重写|跨系统|数据迁移)/.test(
      lower,
    );

  const isAnalysis =
    /\b(find|search|locate|identify|detect|check|investigate|look into|figure out)\b/.test(lower);

  const isCrossSystem = /\b(all|every|entire|across|multiple|several|both|end.to.end)\b/.test(
    lower,
  );

  const isHighRisk =
    /\b(delete|drop|remove|destroy|truncate|production|prod|irreversible|breaking)\b|(删除生产|删除线上|清空|不可逆|破坏性|线上环境|生产环境)/.test(
      lower,
    );

  const isModerate = /\b(update|change|modify|alter|rename|move)\b/.test(lower);

  return {
    needsAction,
    targetLocatability: isArchitectural ? 'open' : isAnalysis ? 'analysis' : 'direct',
    decisionScope: isArchitectural ? 'architectural' : isAnalysis ? 'local' : 'none',
    impactScope: isCrossSystem ? 'cross-system' : isAnalysis ? 'multi' : 'single',
    riskLevel: isHighRisk ? 'high' : isModerate ? 'moderate' : 'safe',
  };
}

export function evaluate(input: string, context: SessionContext): RoutingDecision {
  const dims = inferDimensions(input);
  const level = determineRouteLevel(dims);
  const clarifications = buildClarifications(level, context, input);

  const reasonParts: string[] = [];
  if (!dims.needsAction) reasonParts.push('no action required');
  if (dims.riskLevel === 'high') reasonParts.push('high-risk operation detected');
  if (dims.decisionScope === 'architectural') reasonParts.push('architectural scope');
  if (dims.impactScope === 'cross-system') reasonParts.push('cross-system impact');
  if (dims.targetLocatability === 'open') reasonParts.push('open-ended target');
  if (reasonParts.length === 0)
    reasonParts.push(`direct ${dims.targetLocatability} target, ${dims.decisionScope} scope`);

  return {
    level,
    dimensions: dims,
    clarifications: clarifications.length > 0 ? clarifications : undefined,
    reason: reasonParts.join('; '),
  };
}

export function buildClarificationQuestions(input: string): ClarificationQuestion[] {
  return CLARIFICATION_ORDER.map((dimension) => CLARIFICATION_TEMPLATES[dimension](input));
}

/** @deprecated 改用 clarification-tree 的 createGrillState/applyAnswer/confirmGrill（frontier 语义）；保留仅为兼容，行为不变。 */
export function recordClarification(
  context: SessionContext,
  dimension: ClarificationDimension,
  answer: string,
): SessionContext {
  return {
    ...context,
    clarificationRound: context.clarificationRound + 1,
    collectedDimensions: new Set([...context.collectedDimensions, dimension]),
    history: [...context.history, `${dimension}: ${answer}`],
  };
}

export function canProceedWithoutClarification(decision: RoutingDecision): boolean {
  return !decision.clarifications || decision.clarifications.length === 0;
}

export const SUB_AGENT_PROMPT_PREFIX =
  '[SUB-AGENT] Execute directly. Skip routing. Return results only.';

export function isSubAgentPrompt(input: string): boolean {
  return input.startsWith(SUB_AGENT_PROMPT_PREFIX);
}

export function buildSubAgentPrompt(role: string, task: string): string {
  return `${SUB_AGENT_PROMPT_PREFIX}\n\nRole: ${role}\nTask: ${task}`;
}
