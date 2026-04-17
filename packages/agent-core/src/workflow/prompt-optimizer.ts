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
