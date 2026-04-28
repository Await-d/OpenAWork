import {
  listEffectiveWorkspacePermissionRules,
  hasWorkspacePersistentPermission,
  loadWorkspacePermissionConfig,
  resolveWorkspacePermissionAction,
  upsertWorkspacePermanentPermission,
  writeWorkspacePermissionConfig,
  type WorkspacePermissionConfig,
} from './workspace-permission-config.js';

export type PermissionDecision = 'once' | 'session' | 'permanent' | 'reject';

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  scope: string;
  workspaceRoot?: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
}

export interface GrantedPermission {
  id: string;
  toolName: string;
  scope: string;
  grantedAt: number;
  decision: PermissionDecision;
  sessionId?: string;
}

export interface PermissionManager {
  check(
    toolName: string,
    scope: string,
    sessionId: string,
    workspaceRoot?: string,
  ): Promise<PermissionDecision | null>;
  reply(requestId: string, decision: PermissionDecision): Promise<void>;
  listPermanent(): Promise<GrantedPermission[]>;
  revoke(permissionId: string): Promise<void>;
  disableTool(toolName: string): void;
  isDisabled(toolName: string): boolean;
}

export class PermissionManagerImpl implements PermissionManager {
  private sessionGrants = new Map<string, GrantedPermission[]>();
  private permanentGrants = new Map<string, GrantedPermission>();
  private workspaceConfigs = new Map<string, WorkspacePermissionConfig>();
  private loadedWorkspaceRoots = new Set<string>();
  private disabledTools = new Set<string>();
  private pendingRequests = new Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      request: PermissionRequest;
    }
  >();
  private onRequest?: (request: PermissionRequest) => void;

  constructor(onRequest?: (request: PermissionRequest) => void) {
    this.onRequest = onRequest;
  }

  async check(
    toolName: string,
    scope: string,
    sessionId: string,
    workspaceRoot?: string,
  ): Promise<PermissionDecision | null> {
    if (this.disabledTools.has(toolName)) return 'reject';

    if (workspaceRoot) {
      await this.loadWorkspacePermissions(workspaceRoot);
      const workspaceConfig = this.workspaceConfigs.get(workspaceRoot);
      if (workspaceConfig) {
        const workspaceAction = resolveWorkspacePermissionAction(
          toolName,
          scope,
          listEffectiveWorkspacePermissionRules(workspaceConfig),
        );
        if (workspaceAction === 'deny') {
          return 'reject';
        }
        if (workspaceAction === 'allow') {
          return 'permanent';
        }
      }
    }

    const permKey = `${toolName}:${scope}`;

    const permanent = this.permanentGrants.get(permKey);
    if (permanent) return 'permanent';

    const sessionGrants = this.sessionGrants.get(sessionId) ?? [];
    const sessionGrant = sessionGrants.find((g) => g.toolName === toolName && g.scope === scope);
    if (sessionGrant) return 'session';

    return null;
  }

  async reply(requestId: string, decision: PermissionDecision): Promise<void> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    const { request } = pending;
    const permKey = `${request.toolName}:${request.scope}`;
    const id = `${permKey}:${Date.now()}`;

    if (decision === 'permanent') {
      const grant: GrantedPermission = {
        id,
        toolName: request.toolName,
        scope: request.scope,
        grantedAt: Date.now(),
        decision,
      };
      this.permanentGrants.set(permKey, grant);
      if (request.workspaceRoot) {
        await this.saveWorkspacePermission(request.workspaceRoot, grant);
      }
    } else if (decision === 'session') {
      const existing = this.sessionGrants.get(request.sessionId) ?? [];
      existing.push({
        id,
        toolName: request.toolName,
        scope: request.scope,
        grantedAt: Date.now(),
        decision,
        sessionId: request.sessionId,
      });
      this.sessionGrants.set(request.sessionId, existing);
    }

    this.pendingRequests.delete(requestId);
    pending.resolve(decision);
  }

  async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pendingRequests.set(request.requestId, { resolve, request });
      this.onRequest?.(request);
    });
  }

  async listPermanent(): Promise<GrantedPermission[]> {
    return [...this.permanentGrants.values()];
  }

  async revoke(permissionId: string): Promise<void> {
    for (const [key, grant] of this.permanentGrants) {
      if (grant.id === permissionId) {
        this.permanentGrants.delete(key);
        return;
      }
    }
    for (const [sessionId, grants] of this.sessionGrants) {
      const filtered = grants.filter((g) => g.id !== permissionId);
      this.sessionGrants.set(sessionId, filtered);
    }
  }

  disableTool(toolName: string): void {
    this.disabledTools.add(toolName);
  }

  enableTool(toolName: string): void {
    this.disabledTools.delete(toolName);
  }

  isDisabled(toolName: string): boolean {
    return this.disabledTools.has(toolName);
  }

  clearSession(sessionId: string): void {
    this.sessionGrants.delete(sessionId);
  }

  private async loadWorkspacePermissions(workspaceRoot: string): Promise<void> {
    if (this.loadedWorkspaceRoots.has(workspaceRoot)) {
      return;
    }

    this.loadedWorkspaceRoots.add(workspaceRoot);
    const parsed = loadWorkspacePermissionConfig(workspaceRoot);
    this.workspaceConfigs.set(workspaceRoot, parsed);
    for (const grant of parsed.permanentGrants ?? []) {
      this.permanentGrants.set(`${grant.toolName}:${grant.scope}`, grant);
    }
  }

  private async saveWorkspacePermission(
    workspaceRoot: string,
    grant: GrantedPermission,
  ): Promise<void> {
    const current =
      this.workspaceConfigs.get(workspaceRoot) ?? loadWorkspacePermissionConfig(workspaceRoot);
    const next = upsertWorkspacePermanentPermission(current, {
      toolName: grant.toolName,
      scope: grant.scope,
      grantedAt: grant.grantedAt,
    });
    this.workspaceConfigs.set(workspaceRoot, next);
    writeWorkspacePermissionConfig(workspaceRoot, next);
  }
}
