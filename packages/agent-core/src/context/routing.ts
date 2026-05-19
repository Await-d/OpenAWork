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

const CLARIFICATION_TEMPLATES: Record<
  ClarificationDimension,
  (input: string) => ClarificationQuestion
> = {
  goal: (input) => ({
    dimension: 'goal',
    question: `To clarify the scope: what is the primary outcome you want from "${input.slice(0, 60)}"?`,
    options: [
      {
        label: 'Specific file/location change',
        description: 'I know exactly where the change should be',
      },
      { label: 'Feature across multiple files', description: 'Changes span several modules' },
      { label: 'Architecture-level decision', description: 'Affects system design or structure' },
    ],
  }),
  constraint: () => ({
    dimension: 'constraint',
    question:
      'Are there any constraints I should be aware of? (e.g. must not change X, must stay backward-compatible, deadline)',
    options: [
      { label: 'No constraints', description: 'Proceed with best approach' },
      { label: 'Must not modify existing interfaces', description: 'Additive changes only' },
      { label: 'Must stay in current tech stack', description: 'No new dependencies' },
    ],
  }),
  deliverable: () => ({
    dimension: 'deliverable',
    question:
      'What should the deliverable look like? (e.g. new file, updated function, PR-ready change)',
    options: [
      { label: 'Working code change', description: 'Ready to run/build' },
      { label: 'Plan + code', description: 'Explain approach, then implement' },
      { label: 'Plan only', description: 'Just the proposal, no code yet' },
    ],
  }),
  acceptance: () => ({
    dimension: 'acceptance',
    question:
      'How will you know the result is correct? (e.g. tests pass, specific behavior, output format)',
    options: [
      { label: 'Existing tests pass', description: 'No new tests needed' },
      { label: 'New tests required', description: 'Write tests as part of the task' },
      { label: 'Manual verification', description: 'I will check the output myself' },
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
    /\b(add|implement|create|fix|update|refactor|delete|remove|build|write|change|move|rename|migrate)\b/.test(
      lower,
    );

  const isArchitectural =
    /\b(architect|design|system|microservice|database schema|migration|restructur|restructure|overhaul|rewrite|across|all|entire|every)\b/.test(
      lower,
    );

  const isAnalysis =
    /\b(find|search|locate|identify|detect|check|investigate|look into|figure out)\b/.test(lower);

  const isCrossSystem = /\b(all|every|entire|across|multiple|several|both|end.to.end)\b/.test(
    lower,
  );

  const isHighRisk =
    /\b(delete|drop|remove|destroy|truncate|production|prod|irreversible|breaking)\b/.test(lower);

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
