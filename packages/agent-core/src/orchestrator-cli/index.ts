export type CLICommand = 'start' | 'run' | 'status' | 'cancel';

export interface CLICommandResult {
  command: CLICommand;
  success: boolean;
  output: string;
  timestamp: number;
}

export interface OrchestratorCLI {
  start(sessionId: string, goal: string): Promise<CLICommandResult>;
  run(task: string, options?: { async?: boolean }): Promise<CLICommandResult>;
  status(sessionId?: string): Promise<CLICommandResult>;
  cancel(sessionId: string): Promise<CLICommandResult>;
}

interface SessionRecord {
  id: string;
  goal: string;
  state: 'running' | 'cancelled';
  startedAt: number;
}

export class OrchestratorCLIImpl implements OrchestratorCLI {
  private sessions = new Map<string, SessionRecord>();

  async start(sessionId: string, goal: string): Promise<CLICommandResult> {
    this.sessions.set(sessionId, {
      id: sessionId,
      goal,
      state: 'running',
      startedAt: Date.now(),
    });
    return {
      command: 'start',
      success: true,
      output: `Started session ${sessionId}`,
      timestamp: Date.now(),
    };
  }

  async run(task: string, options?: { async?: boolean }): Promise<CLICommandResult> {
    const mode = options?.async ? 'async' : 'sync';
    return {
      command: 'run',
      success: true,
      output: `Running task (${mode}): ${task}`,
      timestamp: Date.now(),
    };
  }

  async status(sessionId?: string): Promise<CLICommandResult> {
    if (sessionId) {
      const record = this.sessions.get(sessionId);
      if (!record) {
        return {
          command: 'status',
          success: false,
          output: `Session not found: ${sessionId}`,
          timestamp: Date.now(),
        };
      }
      return {
        command: 'status',
        success: true,
        output: `Session ${sessionId} is ${record.state}`,
        timestamp: Date.now(),
      };
    }

    return {
      command: 'status',
      success: true,
      output: `Total sessions: ${this.sessions.size}`,
      timestamp: Date.now(),
    };
  }

  async cancel(sessionId: string): Promise<CLICommandResult> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return {
        command: 'cancel',
        success: false,
        output: `Session not found: ${sessionId}`,
        timestamp: Date.now(),
      };
    }
    record.state = 'cancelled';
    return {
      command: 'cancel',
      success: true,
      output: `Cancelled session ${sessionId}`,
      timestamp: Date.now(),
    };
  }
}

export interface DaemonConfig {
  port: number;
  host: string;
  pidFile?: string;
}

export interface DaemonManager {
  start(config: DaemonConfig): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getConfig(): DaemonConfig | null;
}

export class DaemonManagerImpl implements DaemonManager {
  private running = false;
  private config: DaemonConfig | null = null;

  async start(config: DaemonConfig): Promise<void> {
    this.running = true;
    this.config = { ...config };
  }

  async stop(): Promise<void> {
    this.running = false;
    this.config = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): DaemonConfig | null {
    if (!this.config) {
      return null;
    }
    return { ...this.config };
  }
}
