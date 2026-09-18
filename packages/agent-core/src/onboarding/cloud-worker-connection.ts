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

/**
 * 云 worker 的远端传输抽象。
 *
 * 仓库内目前没有任何云 worker 的协议/产品规格（端点路径、鉴权头、请求体、
 * 响应体、region 语义均为未定义状态），因此这里只定义可注入的接口，不附带
 * 任何默认实现：调用方必须显式注入传输，`CloudWorkerConnection` 才会真正
 * 尝试连接，避免再次出现“没有传输也报告已连接”的假成功。
 */
export interface CloudWorkerTransport {
  connect(config: CloudWorkerConfig): Promise<{ workerId: string }>;
  disconnect(workerId: string): Promise<void>;
}

/**
 * 云 worker 连接管理器。
 *
 * 历史实现里 `connect()` 不做任何远端调用就写入 `status: 'connected'`
 * （见已删除的 stubConnectToRemote / stubDisconnectFromRemote），等于向调用方
 * 谎报连接成功；`disconnect()` 同样是只在本地改状态。由于云 worker 协议规格
 * 至今没有定稿，现在的策略是“宁可直接失败，也不伪造成功”：
 * - 未注入 `CloudWorkerTransport` 时，`connect()` / `disconnect()` 一律抛出明确错误；
 * - 只有 `transport.connect()` 真正 resolve 之后，才会记录 `'connected'` 会话，
 *   且 workerId 由传输返回，而不是本地编造；
 * - 只有 `transport.disconnect()` 真正 resolve 之后，才会把会话改为 `'disconnected'`。
 *
 * 在真实协议落地前，请勿重新引入任何“无传输也返回 connected”的假成功路径。
 */
export class CloudWorkerConnection {
  private sessions: Map<string, CloudWorkerSession> = new Map();
  private readonly transport?: CloudWorkerTransport;

  constructor(transport?: CloudWorkerTransport) {
    this.transport = transport;
  }

  async connect(config: CloudWorkerConfig): Promise<CloudWorkerSession> {
    this.validateConfig(config);

    if (!this.transport) {
      throw new Error(
        'CloudWorkerConnection 未配置远端传输（缺少协议规格），拒绝伪造云 worker 连接',
      );
    }

    const { workerId } = await this.transport.connect(config);

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

    if (!this.transport) {
      throw new Error(
        'CloudWorkerConnection 未配置远端传输（缺少协议规格），拒绝伪造云 worker 断开连接',
      );
    }

    await this.transport.disconnect(workerId);
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
}
