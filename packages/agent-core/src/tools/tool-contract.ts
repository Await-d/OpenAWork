import type { ZodIssue, ZodTypeAny, infer as ZodInfer } from 'zod';
import type { ToolCallContent, ToolResultContent } from '@openAwork/shared';

export interface ToolDefinition<
  TInput extends ZodTypeAny = ZodTypeAny,
  TOutput extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  execute: (input: ZodInfer<TInput>, signal: AbortSignal) => Promise<ZodInfer<TOutput>>;
  timeout?: number;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  rawInput: unknown;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
  isError: boolean;
  durationMs: number;
  pendingPermissionRequestId?: string;
}

export class ToolValidationError extends Error {
  readonly toolName: string;
  readonly issues: ZodIssue[];

  constructor(toolName: string, issues: ZodIssue[]) {
    super(`Validation failed for tool "${toolName}": ${issues.map(formatZodIssue).join(', ')}`);
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.issues = issues;
  }
}

function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : null;
  return path ? `${path}: ${issue.message}` : issue.message;
}

export class ToolNotFoundError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Tool "${toolName}" not found`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = 'ToolTimeoutError';
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
  }
}

export type { ToolCallContent, ToolResultContent };

export interface ToolDispatcher {
  dispatch(call: ToolCallContent, signal: AbortSignal): Promise<ToolResultContent>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<TInput extends ZodTypeAny, TOutput extends ZodTypeAny>(
    tool: ToolDefinition<TInput, TOutput>,
  ): void {
    this.tools.set(tool.name, tool as unknown as ToolDefinition);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async dispatch(call: ToolCallContent, signal: AbortSignal): Promise<ToolResultContent> {
    const startAt = Date.now();
    try {
      const result = await this.execute(
        { toolCallId: call.toolCallId, toolName: call.toolName, rawInput: call.input },
        signal,
      );
      return {
        type: 'tool_result',
        toolCallId: call.toolCallId,
        output: result.output,
        isError: result.isError,
      };
    } catch (err) {
      void startAt;
      return {
        type: 'tool_result',
        toolCallId: call.toolCallId,
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }

  async execute(request: ToolCallRequest, signal: AbortSignal): Promise<ToolCallResult> {
    const tool = this.tools.get(request.toolName);
    if (!tool) {
      throw new ToolNotFoundError(request.toolName);
    }

    const parsed = tool.inputSchema.safeParse(request.rawInput);
    if (!parsed.success) {
      throw new ToolValidationError(request.toolName, parsed.error.issues);
    }

    const timeoutMs = tool.timeout ?? 30000;
    const startAt = Date.now();

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

    const combinedSignal = AbortSignal.any
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const output: unknown = await tool.execute(parsed.data, combinedSignal);

      const outputParsed = tool.outputSchema.safeParse(output);
      if (!outputParsed.success) {
        throw new ToolValidationError(request.toolName, outputParsed.error.issues);
      }

      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: outputParsed.data,
        isError: false,
        durationMs: Date.now() - startAt,
      };
    } catch (error) {
      if (timeoutController.signal.aborted && !signal.aborted) {
        throw new ToolTimeoutError(request.toolName, timeoutMs);
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        output: error instanceof Error ? error.message : String(error),
        isError: true,
        durationMs: Date.now() - startAt,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
