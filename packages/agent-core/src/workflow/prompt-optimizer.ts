import { z } from 'zod';

export interface PromptOptimizerOptions {
  originalPrompt: string;
  context?: string;
  targetAudience?: string;
  candidateCount?: number;
}

export interface PromptCandidate {
  id: string;
  text: string;
  improvements: string[];
  score?: number;
}

export interface PromptOptimizerResult {
  requestId: string;
  originalPrompt: string;
  candidates: PromptCandidate[];
  recommended: string;
  rationale: string;
  completedAt: number;
}

export interface PromptOptimizer {
  optimize(options: PromptOptimizerOptions): Promise<PromptOptimizerResult>;
}

export type PromptOptimizerErrorKind = 'invalid_response' | 'upstream_unavailable';

export class PromptOptimizerError extends Error {
  readonly kind: PromptOptimizerErrorKind;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(input: {
    cause?: unknown;
    kind: PromptOptimizerErrorKind;
    message: string;
    retryable: boolean;
  }) {
    super(input.message);
    this.name = 'PromptOptimizerError';
    this.kind = input.kind;
    this.retryable = input.retryable;
    this.cause = input.cause;
  }
}

export class PromptOptimizerResultParseError extends PromptOptimizerError {
  constructor(cause?: unknown) {
    super({
      cause,
      kind: 'invalid_response',
      message: '模型返回结果格式无效，请重试。',
      retryable: false,
    });
    this.name = 'PromptOptimizerResultParseError';
  }
}

export class PromptOptimizerUpstreamError extends PromptOptimizerError {
  constructor(cause?: unknown) {
    super({
      cause,
      kind: 'upstream_unavailable',
      message: '上游模型暂时不可用，请稍后重试。',
      retryable: true,
    });
    this.name = 'PromptOptimizerUpstreamError';
  }
}

const optionalNonEmptyStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const promptCandidatePayloadSchema = z.object({
  id: optionalNonEmptyStringSchema,
  text: z.string().trim().min(1),
  improvements: z.array(z.string().trim().min(1)).optional().default([]),
  score: z.number().finite().optional(),
});

const promptOptimizerPayloadSchema = z.object({
  candidates: z.array(promptCandidatePayloadSchema).min(1),
  recommended: optionalNonEmptyStringSchema,
  rationale: z.string().trim().optional().default(''),
});

function extractJsonCodeBlocks(raw: string): string[] {
  const matches = raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu);
  return Array.from(matches, (match) => match[1]?.trim() ?? '').filter((value) => value.length > 0);
}

function extractBalancedJsonObjects(raw: string): string[] {
  const payloads: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === undefined) {
      continue;
    }

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        payloads.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return payloads;
}

function normalizeCandidateId(
  rawId: string | undefined,
  index: number,
  seenIds: Set<string>,
): string {
  const baseId = rawId?.trim() || `candidate-${index + 1}`;
  let nextId = baseId;
  let suffix = 2;
  while (seenIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(nextId);
  return nextId;
}

function parsePromptOptimizerPayload(raw: string): z.infer<typeof promptOptimizerPayloadSchema> {
  const payloadCandidates = [...extractJsonCodeBlocks(raw), ...extractBalancedJsonObjects(raw)];
  if (payloadCandidates.length === 0) {
    throw new PromptOptimizerResultParseError();
  }

  let lastError: unknown = undefined;
  for (const payload of payloadCandidates) {
    try {
      const parsedJson = JSON.parse(payload) as unknown;
      const parsedPayload = promptOptimizerPayloadSchema.safeParse(parsedJson);
      if (parsedPayload.success) {
        return parsedPayload.data;
      }
      lastError = parsedPayload.error;
    } catch (error) {
      lastError = error;
    }
  }

  throw new PromptOptimizerResultParseError(lastError);
}

export class PromptOptimizerImpl implements PromptOptimizer {
  private callLLM: (prompt: string) => Promise<string>;

  constructor(callLLM: (prompt: string) => Promise<string>) {
    this.callLLM = callLLM;
  }

  async optimize(options: PromptOptimizerOptions): Promise<PromptOptimizerResult> {
    const count = Math.min(Math.max(options.candidateCount ?? 3, 1), 5);
    const systemCtx = options.context ? `\nOptimization context: ${options.context}` : '';
    const audience = options.targetAudience ? `\nTarget audience: ${options.targetAudience}` : '';
    const metaPrompt = [
      `You are an expert prompt engineer specializing in optimizing prompts for large language models. Your task is to generate ${count} improved versions of the given prompt by applying the following optimization dimensions:`,
      ``,
      `## Optimization Dimensions`,
      `1. **Specificity & Clarity**: Eliminate ambiguity. Replace vague words with precise, measurable instructions. Clearly articulate the desired outcome.`,
      `2. **Professional Terminology**: Convert colloquial or informal expressions into domain-specific professional terms. Use industry-standard vocabulary that LLMs understand precisely.`,
      `3. **Structured Format**: Apply structured prompt patterns (similar to LangGPT). When appropriate, organize the prompt with clear sections: Role/角色, Skills/技能, Constraints/约束, Output Format/输出格式, Workflow/工作流程.`,
      `4. **Task Decomposition**: Break complex requests into sequential steps or subtasks. Use numbered steps or bullet points for clarity.`,
      `5. **Constraints & Guardrails**: Add explicit constraints (what NOT to do), output format requirements, and quality criteria.`,
      `6. **Chain-of-Thought Triggering**: When the task involves reasoning, analysis, or multi-step logic, add "think step-by-step" or "reason through this systematically" cues.`,
      ``,
      `## Optimization Strategy`,
      `- Candidate 1: Focus on **clarity + professional terminology** — make the prompt precise and domain-appropriate while keeping its original intent.`,
      `- Candidate 2: Focus on **structured format + task decomposition** — restructure the prompt with clear sections and step-by-step instructions.`,
      `- Candidate 3 (if count ≥ 3): Apply **all dimensions** comprehensively — the most thorough optimization combining clarity, structure, constraints, and reasoning cues.`,
      `- Additional candidates: Vary the balance of dimensions to offer alternative optimization styles.`,
      ``,
      `## Rules`,
      `- Preserve the user's original intent completely. Do NOT change what the user is asking for.`,
      `- The optimized prompt should be in the SAME language as the original (Chinese→Chinese, English→English, etc.).`,
      `- Each candidate must include a list of specific improvements made (the "improvements" array).`,
      `- improvements should be short descriptive labels like "专业术语替换", "添加步骤分解", "增加输出格式约束", "消除歧义", etc.`,
      systemCtx,
      audience,
      ``,
      `## Output Format`,
      `Return a JSON object with keys:`,
      `- candidates: array of { id: string, text: string, improvements: string[] }`,
      `- recommended: id of the best candidate (the one that most effectively improves the prompt while preserving intent)`,
      `- rationale: one sentence explaining why the recommended candidate is best`,
      ``,
      `## Original Prompt to Optimize`,
      `${options.originalPrompt}`,
    ].join('\n');

    let raw: string;
    try {
      raw = await this.callLLM(metaPrompt);
    } catch (error) {
      throw new PromptOptimizerUpstreamError(error);
    }

    const parsed = parsePromptOptimizerPayload(raw);
    const seenIds = new Set<string>();
    const candidates = parsed.candidates.map((candidate, index) => ({
      ...candidate,
      id: normalizeCandidateId(candidate.id, index, seenIds),
      improvements: candidate.improvements,
    }));
    const firstCandidate = candidates[0];
    if (!firstCandidate) {
      throw new PromptOptimizerResultParseError();
    }
    const recommended =
      candidates.find((candidate) => candidate.id === parsed.recommended)?.id ?? firstCandidate.id;

    return {
      requestId: crypto.randomUUID(),
      originalPrompt: options.originalPrompt,
      candidates,
      recommended,
      rationale: parsed.rationale,
      completedAt: Date.now(),
    };
  }
}
