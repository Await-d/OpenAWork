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

export class PromptOptimizerImpl implements PromptOptimizer {
  private callLLM: (prompt: string) => Promise<string>;

  constructor(callLLM: (prompt: string) => Promise<string>) {
    this.callLLM = callLLM;
  }

  async optimize(options: PromptOptimizerOptions): Promise<PromptOptimizerResult> {
    const count = Math.min(Math.max(options.candidateCount ?? 3, 1), 5);
    const systemCtx = options.context ? `\nContext: ${options.context}` : '';
    const audience = options.targetAudience ? `\nTarget audience: ${options.targetAudience}` : '';
    const metaPrompt = [
      `You are a prompt engineer. Generate ${count} improved versions of the following prompt.`,
      systemCtx,
      audience,
      `\nReturn a JSON object with keys:\n- candidates: array of { id, text, improvements (string[]) }\n- recommended: id of the best candidate\n- rationale: one sentence why that candidate is best`,
      `\nOriginal prompt: ${options.originalPrompt}`,
    ].join('');

    const raw = await this.callLLM(metaPrompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM returned no JSON payload from prompt optimizer');

    const parsed = JSON.parse(jsonMatch[0]) as {
      candidates: PromptCandidate[];
      recommended: string;
      rationale: string;
    };

    return {
      requestId: crypto.randomUUID(),
      originalPrompt: options.originalPrompt,
      candidates: parsed.candidates,
      recommended: parsed.recommended,
      rationale: parsed.rationale,
      completedAt: Date.now(),
    };
  }
}
