import { z } from 'zod';
import { extractBalancedJsonObjects, extractJsonCodeBlocks } from './prompt-optimizer.js';
import {
  PromptEvaluationParseError,
  PromptEvaluationUpstreamError,
  type EvaluationDimension,
  type EvaluationStopSignals,
  type PatchOperation,
  type PromptEvaluationRequest,
  type PromptEvaluationResponse,
  type PromptEvaluationType,
} from './prompt-evaluation.js';

// ==================== 输出校验 Schema ====================

const patchOperationSchema = z.object({
  op: z.enum(['insert', 'replace', 'delete']),
  oldText: z.string().max(2000),
  newText: z.string().max(8000),
  instruction: z.string().trim().min(1).max(500),
  occurrence: z.number().int().min(1).optional(),
});

const evaluationDimensionSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  score: z.number().finite().min(0).max(100),
});

const evaluationStopSignalsSchema = z.object({
  targetVsBaseline: z.enum(['improved', 'flat', 'regressed']).optional(),
  improvementHeadroom: z.enum(['none', 'low', 'medium', 'high']).optional(),
  overfitRisk: z.enum(['low', 'medium', 'high']).optional(),
  stopRecommendation: z.enum(['continue', 'stop', 'review']).optional(),
  stopReasons: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
});

const evaluationPayloadSchema = z.object({
  score: z
    .object({
      overall: z.number().finite().min(0).max(100),
      dimensions: z.array(evaluationDimensionSchema).max(10).default([]),
    })
    .default({ overall: 0, dimensions: [] }),
  improvements: z.array(z.string().trim().min(1).max(500)).max(3).default([]),
  summary: z.string().trim().min(1).max(2000),
  patchPlan: z.array(patchOperationSchema).max(3).default([]),
  stopSignals: evaluationStopSignalsSchema.optional(),
});

// ==================== 维度定义（按评估类型裁剪） ====================

const DIMENSIONS_BY_TYPE: Record<PromptEvaluationType, Array<{ key: string; label: string }>> = {
  result: [
    { key: 'relevance', label: '任务相关性' },
    { key: 'accuracy', label: '输出准确性' },
    { key: 'completeness', label: '完成度' },
  ],
  compare: [
    { key: 'quality', label: '输出质量' },
    { key: 'instructionFollowing', label: '指令遵循' },
    { key: 'stability', label: '结果稳定性' },
  ],
  'prompt-only': [
    { key: 'clarity', label: '清晰度' },
    { key: 'specificity', label: '具体性' },
    { key: 'structure', label: '结构化程度' },
    { key: 'constraints', label: '约束完备性' },
  ],
  'prompt-iterate': [
    { key: 'requirementFit', label: '需求满足度' },
    { key: 'clarity', label: '清晰度' },
    { key: 'regression', label: '回归风险' },
  ],
};

const EVALUATION_TYPE_LABELS: Record<PromptEvaluationType, string> = {
  result: '单结果评估',
  compare: '对比评估',
  'prompt-only': '仅提示词评估',
  'prompt-iterate': '迭代需求评估',
};

// ==================== Prompt 构建 ====================

function formatContentBlock(block: { label: string; content: string; summary?: string }): string {
  const summary = block.summary ? `（${block.summary}）` : '';
  return `### ${block.label}${summary}\n${block.content}`;
}

function buildEvaluationPrompt(request: PromptEvaluationRequest): string {
  const dimensions = DIMENSIONS_BY_TYPE[request.type];
  const dimensionLines = dimensions
    .map((d, i) => `${i + 1}. **${d.label}**（${d.key}）：0-100 分`)
    .join('\n');

  const sections: string[] = [
    `You are an expert prompt evaluator. Evaluate the prompt according to the evaluation type below.`,
    ``,
    `## Evaluation Type`,
    `${EVALUATION_TYPE_LABELS[request.type]} (${request.type})`,
    ``,
    `## Scoring Dimensions`,
    dimensionLines,
    ``,
    `## Rules`,
    `- Be strict and evidence-based: every dimension score must be justified by concrete observations.`,
    `- The "improvements" array contains at most 3 directional suggestions for the next iteration.`,
    `- The "patchPlan" contains at most 3 precise string-replacement fixes (oldText → newText).`,
    `  - oldText must be an EXACT substring copied verbatim from the workspace prompt (or the anchor context for inserts).`,
    `  - Never rewrite the whole prompt; only propose surgical local fixes.`,
    `- Always respond in the same language as the workspace prompt.`,
    `- Output ONLY one JSON object, no prose outside JSON.`,
    ``,
    `## Output Format`,
    `Return a JSON object with keys:`,
    `- score: { overall: number (0-100), dimensions: [{ key, label, score }] }`,
    `- improvements: string[] (max 3, directional suggestions)`,
    `- summary: one-sentence conclusion`,
    `- patchPlan: [{ op: "insert"|"replace"|"delete", oldText, newText, instruction, occurrence? }]`,
    `- stopSignals (optional): { targetVsBaseline?: "improved"|"flat"|"regressed", improvementHeadroom?: "none"|"low"|"medium"|"high", overfitRisk?: "low"|"medium"|"high", stopRecommendation?: "continue"|"stop"|"review", stopReasons?: string[] }`,
  ];

  sections.push(``, `## Workspace Prompt (evaluation target)`, request.workspacePrompt);
  if (request.referencePrompt) {
    sections.push(``, `## Reference Prompt (baseline, e.g. original version)`, request.referencePrompt);
  }

  if (request.type === 'result') {
    sections.push(
      ``,
      `## Test Case`,
      formatContentBlock(request.testCase.input),
      ``,
      `## Execution Snapshot`,
      `Prompt executed:`,
      request.snapshot.promptText,
      ``,
      `Model output to evaluate:`,
      request.snapshot.output,
    );
  } else if (request.type === 'compare') {
    sections.push(``, `## Test Cases`);
    for (const testCase of request.testCases) {
      sections.push(formatContentBlock(testCase.input));
    }
    sections.push(``, `## Execution Snapshots`);
    for (const snapshot of request.snapshots) {
      sections.push(
        `Snapshot ${snapshot.label} (promptRef: ${snapshot.promptRef.kind}${
          snapshot.versionLabel ? `, ${snapshot.versionLabel}` : ''
        }):`,
        `--- prompt ---`,
        snapshot.promptText,
        `--- output ---`,
        snapshot.output,
        ``,
      );
    }
  } else if (request.type === 'prompt-iterate') {
    sections.push(``, `## Iteration Requirement`, request.iterateRequirement);
  }

  return sections.join('\n');
}

// ==================== 解析 ====================

function parseEvaluationPayload(raw: string): z.infer<typeof evaluationPayloadSchema> {
  const payloadCandidates = [...extractJsonCodeBlocks(raw), ...extractBalancedJsonObjects(raw)];
  if (payloadCandidates.length === 0) {
    throw new PromptEvaluationParseError();
  }

  let lastError: unknown = undefined;
  for (const payload of payloadCandidates) {
    try {
      const parsedJson = JSON.parse(payload) as unknown;
      const parsed = evaluationPayloadSchema.safeParse(parsedJson);
      if (parsed.success) {
        return parsed.data;
      }
      lastError = parsed.error;
    } catch (error) {
      lastError = error;
    }
  }

  throw new PromptEvaluationParseError(lastError);
}

function normalizeStopSignals(
  raw: z.infer<typeof evaluationStopSignalsSchema> | undefined,
): EvaluationStopSignals | undefined {
  if (!raw) {
    return undefined;
  }
  const hasAny =
    raw.targetVsBaseline !== undefined ||
    raw.improvementHeadroom !== undefined ||
    raw.overfitRisk !== undefined ||
    raw.stopRecommendation !== undefined ||
    (raw.stopReasons !== undefined && raw.stopReasons.length > 0);
  if (!hasAny) {
    return undefined;
  }
  return {
    ...(raw.targetVsBaseline !== undefined ? { targetVsBaseline: raw.targetVsBaseline } : {}),
    ...(raw.improvementHeadroom !== undefined
      ? { improvementHeadroom: raw.improvementHeadroom }
      : {}),
    ...(raw.overfitRisk !== undefined ? { overfitRisk: raw.overfitRisk } : {}),
    ...(raw.stopRecommendation !== undefined ? { stopRecommendation: raw.stopRecommendation } : {}),
    ...(raw.stopReasons !== undefined && raw.stopReasons.length > 0
      ? { stopReasons: [...raw.stopReasons] }
      : {}),
  };
}

// ==================== 服务实现 ====================

export interface PromptEvaluationService {
  evaluate(request: PromptEvaluationRequest): Promise<PromptEvaluationResponse>;
}

export class PromptEvaluationServiceImpl implements PromptEvaluationService {
  private callLLM: (prompt: string) => Promise<string>;

  constructor(callLLM: (prompt: string) => Promise<string>) {
    this.callLLM = callLLM;
  }

  async evaluate(request: PromptEvaluationRequest): Promise<PromptEvaluationResponse> {
    const startedAt = Date.now();
    const metaPrompt = buildEvaluationPrompt(request);

    let raw: string;
    try {
      raw = await this.callLLM(metaPrompt);
    } catch (error) {
      throw new PromptEvaluationUpstreamError(error);
    }

    const parsed = parseEvaluationPayload(raw);
    const dimensions: EvaluationDimension[] = parsed.score.dimensions.map((d) => ({
      key: d.key,
      label: d.label,
      score: d.score,
    }));

    const response: PromptEvaluationResponse = {
      type: request.type,
      score: {
        overall: parsed.score.overall,
        dimensions,
      },
      improvements: [...parsed.improvements],
      summary: parsed.summary,
      patchPlan: parsed.patchPlan.map((op) => ({
        op: op.op,
        oldText: op.oldText,
        newText: op.newText,
        instruction: op.instruction,
        ...(op.occurrence !== undefined ? { occurrence: op.occurrence } : {}),
      })) satisfies PatchOperation[],
      metadata: {
        timestamp: startedAt,
        duration: Date.now() - startedAt,
      },
    };
    const stopSignals = normalizeStopSignals(parsed.stopSignals);
    if (stopSignals) {
      response.stopSignals = stopSignals;
    }
    return response;
  }
}
