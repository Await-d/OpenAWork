export interface RalphLoopOptions {
  maxIterations: number;
  doneKeyword: string;
  iterationDelayMs: number;
  onIteration?: (iteration: number, output: string) => void;
}

export interface RalphLoopResult {
  completed: boolean;
  iterations: number;
  finalOutput: string;
  terminationReason: 'done_detected' | 'max_iterations' | 'error';
}

export interface RalphLoop {
  run(
    executeStep: (iteration: number, previousOutput: string) => Promise<string>,
    options?: Partial<RalphLoopOptions>,
  ): Promise<RalphLoopResult>;
  isDone(output: string, doneKeyword?: string): boolean;
  getStatus(): { running: boolean; currentIteration: number };
  stop(): void;
}

const DEFAULT_RALPH_LOOP_OPTIONS: RalphLoopOptions = {
  maxIterations: 100,
  doneKeyword: 'DONE',
  iterationDelayMs: 0,
};

export class RalphLoopImpl implements RalphLoop {
  private running = false;
  private currentIteration = 0;
  private stopRequested = false;

  async run(
    executeStep: (iteration: number, previousOutput: string) => Promise<string>,
    options: Partial<RalphLoopOptions> = {},
  ): Promise<RalphLoopResult> {
    if (this.running) {
      return {
        completed: false,
        iterations: this.currentIteration,
        finalOutput: 'Ralph loop is already running',
        terminationReason: 'error',
      };
    }

    const mergedOptions = this.normalizeOptions(options);
    let previousOutput = '';

    this.running = true;
    this.currentIteration = 0;
    this.stopRequested = false;

    try {
      for (let iteration = 1; iteration <= mergedOptions.maxIterations; iteration++) {
        if (this.stopRequested) {
          return {
            completed: false,
            iterations: this.currentIteration,
            finalOutput: previousOutput,
            terminationReason: 'error',
          };
        }

        this.currentIteration = iteration;
        const output = await executeStep(iteration, previousOutput);
        mergedOptions.onIteration?.(iteration, output);

        if (this.isDone(output, mergedOptions.doneKeyword)) {
          return {
            completed: true,
            iterations: iteration,
            finalOutput: output,
            terminationReason: 'done_detected',
          };
        }

        previousOutput = output;

        if (iteration < mergedOptions.maxIterations && mergedOptions.iterationDelayMs > 0) {
          await this.delay(mergedOptions.iterationDelayMs);
        }
      }

      return {
        completed: false,
        iterations: mergedOptions.maxIterations,
        finalOutput: previousOutput,
        terminationReason: 'max_iterations',
      };
    } catch (error) {
      return {
        completed: false,
        iterations: this.currentIteration,
        finalOutput: this.errorToString(error),
        terminationReason: 'error',
      };
    } finally {
      this.running = false;
      this.stopRequested = false;
    }
  }

  isDone(output: string, doneKeyword = DEFAULT_RALPH_LOOP_OPTIONS.doneKeyword): boolean {
    const lines = output.split('\n');
    return lines.some((line) => line.trimStart().startsWith(doneKeyword));
  }

  getStatus(): { running: boolean; currentIteration: number } {
    return {
      running: this.running,
      currentIteration: this.currentIteration,
    };
  }

  stop(): void {
    this.stopRequested = true;
  }

  private normalizeOptions(options: Partial<RalphLoopOptions>): RalphLoopOptions {
    return {
      maxIterations: Math.max(1, options.maxIterations ?? DEFAULT_RALPH_LOOP_OPTIONS.maxIterations),
      doneKeyword: options.doneKeyword ?? DEFAULT_RALPH_LOOP_OPTIONS.doneKeyword,
      iterationDelayMs: Math.max(
        0,
        options.iterationDelayMs ?? DEFAULT_RALPH_LOOP_OPTIONS.iterationDelayMs,
      ),
      onIteration: options.onIteration,
    };
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private errorToString(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
