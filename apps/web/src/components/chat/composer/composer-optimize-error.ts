export interface ComposerOptimizeError {
  readonly code?: string;
  readonly message: string;
  readonly retryable: boolean;
}
