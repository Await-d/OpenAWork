import { describe, it, expect, beforeEach } from 'vitest';

type PermissionType =
  | 'network'
  | 'filesystem'
  | 'clipboard'
  | 'env'
  | 'notifications'
  | 'camera'
  | 'location';

interface GrantedPermission {
  type: PermissionType;
  scope: string;
}

class PermissionDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly requiredPermission: GrantedPermission,
  ) {
    super(
      `Permission denied: tool '${toolName}' requires ${requiredPermission.type}:${requiredPermission.scope}`,
    );
    this.name = 'PermissionDeniedError';
  }
}

interface ToolPermissionRequirement {
  toolName: string;
  requiredPermission: GrantedPermission;
}

class PermissionBoundary {
  private granted = new Map<string, Set<string>>();

  grant(permission: GrantedPermission): void {
    const key = permission.type;
    if (!this.granted.has(key)) {
      this.granted.set(key, new Set());
    }
    this.granted.get(key)!.add(permission.scope);
  }

  revoke(permission: GrantedPermission): void {
    this.granted.get(permission.type)?.delete(permission.scope);
  }

  revokeAll(): void {
    this.granted.clear();
  }

  check(requirement: ToolPermissionRequirement): void {
    const { toolName, requiredPermission } = requirement;
    const scopes = this.granted.get(requiredPermission.type);
    if (!scopes?.has(requiredPermission.scope)) {
      throw new PermissionDeniedError(toolName, requiredPermission);
    }
  }

  isGranted(permission: GrantedPermission): boolean {
    return this.granted.get(permission.type)?.has(permission.scope) ?? false;
  }
}

const NETWORK_PERM: GrantedPermission = { type: 'network', scope: 'https://api.example.com/*' };
const FS_PERM: GrantedPermission = { type: 'filesystem', scope: '/tmp/*' };
const ENV_PERM: GrantedPermission = { type: 'env', scope: 'API_KEY' };

describe('PermissionBoundary: unauthorized calls blocked', () => {
  let boundary: PermissionBoundary;

  beforeEach(() => {
    boundary = new PermissionBoundary();
  });

  it('throws PermissionDeniedError when no permissions granted', () => {
    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).toThrow(PermissionDeniedError);
  });

  it('error message includes tool name and permission details', () => {
    let caught: unknown;
    try {
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PermissionDeniedError);
    const err = caught as PermissionDeniedError;
    expect(err.message).toContain('web-search');
    expect(err.message).toContain('network');
    expect(err.toolName).toBe('web-search');
  });

  it('blocks tool requiring filesystem when only network granted', () => {
    boundary.grant(NETWORK_PERM);
    expect(() => boundary.check({ toolName: 'file-reader', requiredPermission: FS_PERM })).toThrow(
      PermissionDeniedError,
    );
  });

  it('blocks tool requiring different scope of same type', () => {
    boundary.grant({ type: 'network', scope: 'https://other.com/*' });
    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).toThrow(PermissionDeniedError);
  });
});

describe('PermissionBoundary: allowed calls succeed', () => {
  let boundary: PermissionBoundary;

  beforeEach(() => {
    boundary = new PermissionBoundary();
  });

  it('does not throw when matching permission is granted', () => {
    boundary.grant(NETWORK_PERM);
    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).not.toThrow();
  });

  it('allows multiple independent permissions', () => {
    boundary.grant(NETWORK_PERM);
    boundary.grant(FS_PERM);
    boundary.grant(ENV_PERM);
    expect(() =>
      boundary.check({ toolName: 'tool-a', requiredPermission: NETWORK_PERM }),
    ).not.toThrow();
    expect(() => boundary.check({ toolName: 'tool-b', requiredPermission: FS_PERM })).not.toThrow();
    expect(() =>
      boundary.check({ toolName: 'tool-c', requiredPermission: ENV_PERM }),
    ).not.toThrow();
  });

  it('isGranted returns true for granted permission', () => {
    boundary.grant(NETWORK_PERM);
    expect(boundary.isGranted(NETWORK_PERM)).toBe(true);
  });

  it('isGranted returns false for ungrantd permission', () => {
    expect(boundary.isGranted(NETWORK_PERM)).toBe(false);
  });
});

describe('PermissionBoundary: revoke takes immediate effect', () => {
  let boundary: PermissionBoundary;

  beforeEach(() => {
    boundary = new PermissionBoundary();
  });

  it('blocks immediately after single permission revoked', () => {
    boundary.grant(NETWORK_PERM);
    boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM });

    boundary.revoke(NETWORK_PERM);

    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).toThrow(PermissionDeniedError);
  });

  it('isGranted returns false immediately after revoke', () => {
    boundary.grant(NETWORK_PERM);
    expect(boundary.isGranted(NETWORK_PERM)).toBe(true);
    boundary.revoke(NETWORK_PERM);
    expect(boundary.isGranted(NETWORK_PERM)).toBe(false);
  });

  it('revoke does not affect other granted permissions', () => {
    boundary.grant(NETWORK_PERM);
    boundary.grant(FS_PERM);
    boundary.revoke(NETWORK_PERM);
    expect(() =>
      boundary.check({ toolName: 'file-reader', requiredPermission: FS_PERM }),
    ).not.toThrow();
  });

  it('revokeAll blocks all subsequent calls', () => {
    boundary.grant(NETWORK_PERM);
    boundary.grant(FS_PERM);
    boundary.grant(ENV_PERM);
    boundary.revokeAll();
    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).toThrow(PermissionDeniedError);
    expect(() => boundary.check({ toolName: 'file-reader', requiredPermission: FS_PERM })).toThrow(
      PermissionDeniedError,
    );
  });

  it('re-grant after revoke allows calls again', () => {
    boundary.grant(NETWORK_PERM);
    boundary.revoke(NETWORK_PERM);
    boundary.grant(NETWORK_PERM);
    expect(() =>
      boundary.check({ toolName: 'web-search', requiredPermission: NETWORK_PERM }),
    ).not.toThrow();
  });

  it('revoke of non-existent permission does not throw', () => {
    expect(() => boundary.revoke(NETWORK_PERM)).not.toThrow();
  });
});
