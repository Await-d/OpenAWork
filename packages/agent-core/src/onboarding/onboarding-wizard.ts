export type OnboardingMode = 'host' | 'client' | 'cloud';

export type OnboardingStep = 'welcome' | 'mode-select' | 'workspace' | 'pairing' | 'complete';

export interface OnboardingState {
  mode: OnboardingMode;
  step: OnboardingStep;
  completed: boolean;
  workspacePath?: string;
  pairingToken?: string;
}

const STEP_ORDER: OnboardingStep[] = ['welcome', 'mode-select', 'workspace', 'pairing', 'complete'];

/** Steps that are skipped for 'cloud' mode (no local workspace needed). */
const CLOUD_SKIP: Set<OnboardingStep> = new Set(['workspace']);

/** Steps that are skipped for 'host' mode (no pairing needed). */
const HOST_SKIP: Set<OnboardingStep> = new Set(['pairing']);

export class OnboardingWizard {
  private state: OnboardingState;

  constructor(initialMode: OnboardingMode = 'host') {
    this.state = {
      mode: initialMode,
      step: 'welcome',
      completed: false,
    };
  }

  getState(): Readonly<OnboardingState> {
    return { ...this.state };
  }

  getCurrentStep(): OnboardingStep {
    return this.state.step;
  }

  setMode(mode: OnboardingMode): void {
    this.state.mode = mode;
  }

  setWorkspacePath(path: string): void {
    this.state.workspacePath = path;
  }

  setPairingToken(token: string): void {
    this.state.pairingToken = token;
  }

  next(): OnboardingStep {
    const skipped = this.skippedSteps();
    const currentIndex = STEP_ORDER.indexOf(this.state.step);

    let nextIndex = currentIndex + 1;
    while (nextIndex < STEP_ORDER.length && skipped.has(STEP_ORDER[nextIndex] as OnboardingStep)) {
      nextIndex++;
    }

    if (nextIndex >= STEP_ORDER.length) {
      this.state.step = 'complete';
      this.state.completed = true;
      return 'complete';
    }

    this.state.step = STEP_ORDER[nextIndex] as OnboardingStep;
    if (this.state.step === 'complete') {
      this.state.completed = true;
    }
    return this.state.step;
  }

  back(): OnboardingStep {
    const skipped = this.skippedSteps();
    const currentIndex = STEP_ORDER.indexOf(this.state.step);

    let prevIndex = currentIndex - 1;
    while (prevIndex >= 0 && skipped.has(STEP_ORDER[prevIndex] as OnboardingStep)) {
      prevIndex--;
    }

    if (prevIndex < 0) {
      return this.state.step;
    }

    this.state.step = STEP_ORDER[prevIndex] as OnboardingStep;
    this.state.completed = false;
    return this.state.step;
  }

  reset(): void {
    this.state = {
      mode: this.state.mode,
      step: 'welcome',
      completed: false,
    };
  }

  private skippedSteps(): Set<OnboardingStep> {
    switch (this.state.mode) {
      case 'cloud':
        return CLOUD_SKIP;
      case 'host':
        return HOST_SKIP;
      default:
        return new Set();
    }
  }
}
