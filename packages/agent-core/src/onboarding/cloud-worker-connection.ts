export interface CloudWorkerConfig {
  endpoint: string;
  token: string;
  region?: string;
}

export interface CloudWorkerSession {
  workerId: string;
  endpoint: string;
  status: 'connected' | 'disconnected';
  connectedAt: number;
}

export class CloudWorkerConnection {
  private sessions: Map<string, CloudWorkerSession> = new Map();

  async connect(config: CloudWorkerConfig): Promise<CloudWorkerSession> {
    this.validateConfig(config);

    const workerId = this.generateWorkerId(config.endpoint);
    this.stubConnectToRemote(config);

    const session: CloudWorkerSession = {
      workerId,
      endpoint: config.endpoint,
      status: 'connected',
      connectedAt: Date.now(),
    };

    this.sessions.set(workerId, session);
    return session;
  }

  async disconnect(workerId: string): Promise<void> {
    const session = this.sessions.get(workerId);
    if (!session) {
      throw new Error(`No session found for workerId: ${workerId}`);
    }

    this.stubDisconnectFromRemote(workerId);
    session.status = 'disconnected';
    this.sessions.set(workerId, session);
  }

  getStatus(workerId: string): CloudWorkerSession['status'] {
    const session = this.sessions.get(workerId);
    if (!session) {
      return 'disconnected';
    }
    return session.status;
  }

  getSession(workerId: string): CloudWorkerSession | undefined {
    const session = this.sessions.get(workerId);
    return session ? { ...session } : undefined;
  }

  listSessions(): CloudWorkerSession[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s }));
  }

  private validateConfig(config: CloudWorkerConfig): void {
    if (!config.endpoint || !config.endpoint.startsWith('http')) {
      throw new Error('CloudWorkerConfig.endpoint must be a valid HTTP/HTTPS URL');
    }
    if (!config.token) {
      throw new Error('CloudWorkerConfig.token must not be empty');
    }
  }

  private stubConnectToRemote(config: CloudWorkerConfig): void {
    void config;
  }

  private stubDisconnectFromRemote(workerId: string): void {
    void workerId;
  }

  private generateWorkerId(endpoint: string): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 7);
    const host = endpoint.replace(/^https?:\/\//, '').split('/')[0] ?? 'worker';
    return `${host}-${ts}-${rand}`;
  }
}
