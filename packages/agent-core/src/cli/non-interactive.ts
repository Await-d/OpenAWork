import { writeFile } from 'node:fs/promises';

export type NonInteractiveOutputFormat = 'text' | 'json' | 'stream-json';
export type ApprovalPolicy = 'auto' | 'prompt' | 'deny';

export interface ApprovalPromptContext {
  toolName: string;
  turn: number;
  prompt: string;
}

export type ApprovalPromptResult = 'approve' | 'deny';

export interface NonInteractiveOptions {
  prompt: string;
  format?: NonInteractiveOutputFormat;
  quiet?: boolean;
  maxTurns?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  outputFile?: string;
  approvalPolicy?: ApprovalPolicy;
  approvalPrompter?: (context: ApprovalPromptContext) => Promise<ApprovalPromptResult>;
}

export interface NonInteractiveResult {
  success: boolean;
  output: string;
  messages: Array<{ role: string; content: string }>;
  toolCallCount: number;
  durationMs: number;
  error?: string;
}

export interface NonInteractiveRunner {
  run(options: NonInteractiveOptions): Promise<NonInteractiveResult>;
  formatOutput(result: NonInteractiveResult, format: NonInteractiveOutputFormat): string;
}

const DEFAULT_MAX_TURNS = 10;

function toPositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export class NonInteractiveRunnerImpl implements NonInteractiveRunner {
  public async run(options: NonInteractiveOptions): Promise<NonInteractiveResult> {
    const startTime = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    let toolCallCount = 0;

    try {
      const maxTurns = toPositiveInteger(options.maxTurns, DEFAULT_MAX_TURNS);
      const allowedTools = options.allowedTools ?? [];
      const approvalPolicy = options.approvalPolicy ?? 'auto';

      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }

      messages.push({ role: 'user', content: options.prompt });

      if (!options.quiet) {
        process.stdout.write(`[non-interactive] start, maxTurns=${maxTurns}\n`);
      }

      for (let turn = 1; turn <= maxTurns; turn += 1) {
        if (!options.quiet) {
          process.stdout.write(`[non-interactive] turn ${turn}/${maxTurns}\n`);
        }

        const toolName =
          allowedTools.length > 0 ? allowedTools[(turn - 1) % allowedTools.length] : undefined;
        const isFinalTurn = turn === maxTurns;

        if (toolName && !isFinalTurn) {
          const approval = await this.resolveApproval({
            policy: approvalPolicy,
            prompter: options.approvalPrompter,
            toolName,
            turn,
            prompt: options.prompt,
          });

          if (approval === 'deny') {
            const error = `approval policy ${approvalPolicy} denied tool call: ${toolName}`;
            messages.push({ role: 'assistant', content: `[审批拒绝] ${toolName}` });
            return {
              success: false,
              output: '',
              messages,
              toolCallCount,
              durationMs: Date.now() - startTime,
              error,
            };
          }

          messages.push({ role: 'assistant', content: `[模拟] 准备调用工具: ${toolName}` });
          messages.push({ role: 'tool', content: `[模拟工具结果] ${toolName}: ok` });
          toolCallCount += 1;
          continue;
        }

        const finalOutput = `模拟执行完成：${options.prompt}`;
        messages.push({ role: 'assistant', content: finalOutput });
        break;
      }

      const finalAssistantMessage = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      const output = finalAssistantMessage?.content ?? '';
      const durationMs = Date.now() - startTime;

      const result: NonInteractiveResult = {
        success: true,
        output,
        messages,
        toolCallCount,
        durationMs,
      };

      if (options.outputFile) {
        const outputFormat = options.format ?? 'text';
        await writeFile(options.outputFile, this.formatOutput(result, outputFormat), 'utf8');
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        output: '',
        messages,
        toolCallCount,
        durationMs,
        error: message,
      };
    }
  }

  public formatOutput(result: NonInteractiveResult, format: NonInteractiveOutputFormat): string {
    if (format === 'text') {
      return result.output;
    }

    if (format === 'json') {
      return JSON.stringify(
        {
          success: result.success,
          output: result.output,
          toolCallCount: result.toolCallCount,
          durationMs: result.durationMs,
          error: result.error,
        },
        null,
        2,
      );
    }

    const events: string[] = [];
    events.push(JSON.stringify({ type: 'start' }));

    for (const token of result.output.split(/\s+/).filter((part) => part.length > 0)) {
      events.push(
        JSON.stringify({
          type: 'token',
          content: token,
        }),
      );
    }

    events.push(
      JSON.stringify({
        type: 'end',
        result,
      }),
    );

    return events.join('\n');
  }

  private async resolveApproval({
    policy,
    prompter,
    toolName,
    turn,
    prompt,
  }: {
    policy: ApprovalPolicy;
    prompter?: (context: ApprovalPromptContext) => Promise<ApprovalPromptResult>;
    toolName: string;
    turn: number;
    prompt: string;
  }): Promise<ApprovalPromptResult> {
    if (policy === 'auto') {
      return 'approve';
    }

    if (policy === 'deny') {
      return 'deny';
    }

    if (!prompter) {
      return 'deny';
    }

    return prompter({ toolName, turn, prompt });
  }
}
