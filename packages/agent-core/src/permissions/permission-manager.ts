export type PermissionScope = 'once' | 'session' | 'permanent' | 'reject';

export interface PermissionRecord {
  toolName: string;
  scope: PermissionScope;
  grantedAt: number;
  expiresAt?: number;
  sessionId?: string;
}

export interface PermissionManagerInterface {
  grant(toolName: string, scope: PermissionScope, sessionId?: string): void;
  check(toolName: string, sessionId?: string): PermissionScope | 'unknown';
  consume(toolName: string): boolean;
  revoke(toolName: string): void;
  revokeAll(): void;
  clearSession(sessionId: string): void;
  listActive(sessionId?: string): PermissionRecord[];
  enableYolo(options?: { mobileDevice?: boolean }): void;
  disableYolo(): void;
  isYoloEnabled(): boolean;
}

export class PermissionManager implements PermissionManagerInterface {
  private permanent = new Map<string, PermissionRecord>();
  private session = new Map<string, Map<string, PermissionRecord>>();
  private once = new Map<string, PermissionRecord>();
  private yolo = false;

  enableYolo(options?: { mobileDevice?: boolean }): void {
    if (options?.mobileDevice) {
      throw new Error('Yolo mode not supported on mobile');
    }
    this.yolo = true;
  }

  disableYolo(): void {
    this.yolo = false;
  }

  isYoloEnabled(): boolean {
    return this.yolo;
  }

  grant(toolName: string, scope: PermissionScope, sessionId?: string): void {
    const record: PermissionRecord = {
      toolName,
      scope,
      grantedAt: Date.now(),
    };

    if (scope === 'permanent' || scope === 'reject') {
      this.permanent.set(toolName, record);
    } else if (scope === 'session') {
      if (!sessionId) throw new Error('sessionId required for session-scoped permission');
      if (!this.session.has(sessionId)) {
        this.session.set(sessionId, new Map());
      }
      this.session.get(sessionId)!.set(toolName, { ...record, sessionId });
    } else if (scope === 'once') {
      this.once.set(toolName, record);
    }
  }

  check(toolName: string, sessionId?: string): PermissionScope | 'unknown' {
    if (this.yolo) return 'permanent';

    const perm = this.permanent.get(toolName);
    if (perm) return perm.scope;

    if (sessionId) {
      const sessionMap = this.session.get(sessionId);
      if (sessionMap?.has(toolName)) {
        return sessionMap.get(toolName)!.scope;
      }
    }

    if (this.once.has(toolName)) return 'once';

    return 'unknown';
  }

  consume(toolName: string): boolean {
    if (this.once.has(toolName)) {
      this.once.delete(toolName);
      return true;
    }
    return false;
  }

  revoke(toolName: string): void {
    this.permanent.delete(toolName);
    this.once.delete(toolName);
    for (const sessionMap of this.session.values()) {
      sessionMap.delete(toolName);
    }
  }

  revokeAll(): void {
    this.permanent.clear();
    this.session.clear();
    this.once.clear();
  }

  clearSession(sessionId: string): void {
    this.session.delete(sessionId);
  }

  listActive(sessionId?: string): PermissionRecord[] {
    const results: PermissionRecord[] = [];

    for (const record of this.permanent.values()) {
      results.push(record);
    }

    if (sessionId) {
      const sessionMap = this.session.get(sessionId);
      if (sessionMap) {
        for (const record of sessionMap.values()) {
          results.push(record);
        }
      }
    }

    for (const record of this.once.values()) {
      results.push(record);
    }

    return results;
  }
}
