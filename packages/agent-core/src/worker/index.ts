import type { ChildProcess } from 'node:child_process';
import { CloudWorkerConnection } from '../onboarding/cloud-worker-connection.js';

export type WorkerStatus = 'idle' | 'running' | 'stopped' | 'error';
export type WorkerMode = 'local' | 'cloud_worker' | 'sandbox';

export interface WorkerLaunchConfig {
  mode: WorkerMode;
  name: string;
  endpoint?: string;
  token?: string;
  region?: string;
  sandboxRoot?: string;
  allowedHosts?: string[];
}

export interface WorkerSession {
  workerId: string;
  name: string;
  mode: WorkerMode;
  status: WorkerStatus;
  startedAt: number;
  endpoint?: string;
  region?: string;
  sandboxRoot?: string;
  allowedHosts?: string[];
}

export interface WorkerSessionManager {
  launch(config: WorkerLaunchConfig): Promise<WorkerSession>;
  stop(workerId: string): Promise<void>;
  list(): Promise<WorkerSession[]>;
  getStatus(workerId: string): Promise<WorkerStatus>;
}

export interface WorkerInfo {
  id: string;
  name: string;
  pid?: number;
  status: WorkerStatus;
  startedAt?: number;
  endpoint?: string;
}

export interface SandboxConfig {
  isolateFilesystem: boolean;
  isolateNetwork: boolean;
  allowedPaths: string[];
  allowedHosts: string[];
  timeoutMs: number;
}

export interface WorkerManager {
  launch(
    name: string,
    command: string,
    args: string[],
    sandbox?: SandboxConfig,
  ): Promise<WorkerInfo>;
  connect(workerId: string): Promise<{ endpoint: string }>;
  stop(workerId: string): Promise<void>;
  list(): WorkerInfo[];
  getStatus(workerId: string): WorkerStatus;
}

interface WorkerRuntime {
  info: WorkerInfo;
  process: ChildProcess;
  sandbox?: SandboxConfig;
}

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class WorkerManagerImpl implements WorkerManager {
  private workers = new Map<string, WorkerRuntime>();

  async launch(
    name: string,
    command: string,
    args: string[],
    sandbox?: SandboxConfig,
  ): Promise<WorkerInfo> {
    const childProcessModule = await import('node:child_process');
    const child = childProcessModule.spawn(command, args, {
      stdio: 'ignore',
      detached: false,
    });

    const id = generateId();
    const endpoint = `worker://${id}`;
    const info: WorkerInfo = {
      id,
      name,
      pid: child.pid,
      status: 'running',
      startedAt: Date.now(),
      endpoint,
    };

    const childAsAny = child as unknown as { once: (event: string, cb: () => void) => void };
    childAsAny.once('exit', () => {
      const runtime = this.workers.get(id);
      if (!runtime) {
        return;
      }
      runtime.info.status = 'stopped';
      runtime.info.pid = undefined;
    });

    childAsAny.once('error', () => {
      const runtime = this.workers.get(id);
      if (!runtime) {
        return;
      }
      runtime.info.status = 'error';
    });

    this.workers.set(id, { info, process: child, sandbox });
    return { ...info };
  }

  async connect(workerId: string): Promise<{ endpoint: string }> {
    const runtime = this.workers.get(workerId);
    if (!runtime || !runtime.info.endpoint) {
      throw new Error(`Worker not found: ${workerId}`);
    }
    return { endpoint: runtime.info.endpoint };
  }

  async stop(workerId: string): Promise<void> {
    const runtime = this.workers.get(workerId);
    if (!runtime) {
      return;
    }
    if (runtime.info.status === 'running') {
      runtime.process.kill();
      runtime.info.status = 'stopped';
      runtime.info.pid = undefined;
    }
  }

  list(): WorkerInfo[] {
    return [...this.workers.values()].map((runtime) => ({ ...runtime.info }));
  }

  getStatus(workerId: string): WorkerStatus {
    const runtime = this.workers.get(workerId);
    if (!runtime) {
      return 'error';
    }
    return runtime.info.status;
  }
}

class WorkerSessionManagerImpl implements WorkerSessionManager {
  private sessions = new Map<string, WorkerSession>();
  private cloudConnection = new CloudWorkerConnection();

  async launch(config: WorkerLaunchConfig): Promise<WorkerSession> {
    this.validateConfig(config);

    if (config.mode === 'cloud_worker') {
      const session = await this.cloudConnection.connect({
        endpoint: config.endpoint!,
        token: config.token!,
        region: config.region,
      });
      const next: WorkerSession = {
        workerId: session.workerId,
        name: config.name,
        mode: 'cloud_worker',
        status: 'running',
        startedAt: session.connectedAt,
        endpoint: session.endpoint,
        region: config.region,
      };
      this.sessions.set(next.workerId, next);
      return { ...next };
    }

    const workerId = generateId();
    const next: WorkerSession = {
      workerId,
      name: config.name,
      mode: config.mode,
      status: config.mode === 'local' ? 'idle' : 'running',
      startedAt: Date.now(),
      ...(config.mode === 'sandbox'
        ? {
            sandboxRoot: config.sandboxRoot,
            allowedHosts: config.allowedHosts ?? [],
          }
        : {}),
    };
    this.sessions.set(workerId, next);
    return { ...next };
  }

  async stop(workerId: string): Promise<void> {
    const session = this.sessions.get(workerId);
    if (!session) {
      return;
    }
    if (session.mode === 'cloud_worker') {
      await this.cloudConnection.disconnect(workerId);
    }
    session.status = 'stopped';
    this.sessions.set(workerId, session);
  }

  async list(): Promise<WorkerSession[]> {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  async getStatus(workerId: string): Promise<WorkerStatus> {
    return this.sessions.get(workerId)?.status ?? 'error';
  }

  private validateConfig(config: WorkerLaunchConfig): void {
    if (config.mode === 'cloud_worker') {
      if (!config.endpoint || !config.endpoint.startsWith('http') || !config.token) {
        throw new Error('cloud_worker requires valid endpoint and token');
      }
      return;
    }

    if (config.mode === 'sandbox' && !config.sandboxRoot) {
      throw new Error('sandbox requires sandboxRoot');
    }
  }
}

export function createWorkerSessionManager(): WorkerSessionManager {
  return new WorkerSessionManagerImpl();
}
