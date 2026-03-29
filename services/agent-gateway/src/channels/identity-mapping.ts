import type { ChannelPermissions } from './types.js';

export interface ChannelUserId {
  pluginType: string;
  platformUserId: string;
}

export interface WorkspaceUserId {
  workspaceId: string;
  userId: string;
}

export interface WorkspaceUserProfile {
  identity: WorkspaceUserId;
  permissions: ChannelPermissions;
  toolAllowlist: string[] | null;
}

export interface IdentityMapping {
  channelUserId: ChannelUserId;
  workspaceUserId: WorkspaceUserId;
}

export interface IdentityStore {
  findWorkspaceUser(channelUser: ChannelUserId): Promise<WorkspaceUserId | null>;
  linkIdentity(mapping: IdentityMapping): Promise<void>;
  unlinkIdentity(channelUser: ChannelUserId): Promise<void>;
  getUserProfile(workspaceUser: WorkspaceUserId): Promise<WorkspaceUserProfile | null>;
}

const DEFAULT_DENY_PERMISSIONS: ChannelPermissions = {
  allowReadHome: false,
  readablePathPrefixes: [],
  allowWriteOutside: false,
  allowShell: false,
  allowSubAgents: false,
};

export class IdentityMapper {
  constructor(private readonly store: IdentityStore) {}

  async resolvePermissions(channelUser: ChannelUserId): Promise<WorkspaceUserProfile> {
    const workspaceUser = await this.store.findWorkspaceUser(channelUser);
    if (!workspaceUser) {
      return {
        identity: { workspaceId: '', userId: '' },
        permissions: DEFAULT_DENY_PERMISSIONS,
        toolAllowlist: [],
      };
    }
    const profile = await this.store.getUserProfile(workspaceUser);
    if (!profile) {
      return {
        identity: workspaceUser,
        permissions: DEFAULT_DENY_PERMISSIONS,
        toolAllowlist: [],
      };
    }
    return profile;
  }

  async isToolAllowed(channelUser: ChannelUserId, toolName: string): Promise<boolean> {
    const profile = await this.resolvePermissions(channelUser);
    if (profile.identity.userId === '') return false;
    if (profile.toolAllowlist === null) return true;
    return profile.toolAllowlist.includes(toolName);
  }

  async link(mapping: IdentityMapping): Promise<void> {
    await this.store.linkIdentity(mapping);
  }

  async unlink(channelUser: ChannelUserId): Promise<void> {
    await this.store.unlinkIdentity(channelUser);
  }
}

export class InMemoryIdentityStore implements IdentityStore {
  private mappings = new Map<string, WorkspaceUserId>();
  private profiles = new Map<string, WorkspaceUserProfile>();

  private channelKey(c: ChannelUserId): string {
    return `${c.pluginType}:${c.platformUserId}`;
  }

  private workspaceKey(w: WorkspaceUserId): string {
    return `${w.workspaceId}:${w.userId}`;
  }

  async findWorkspaceUser(channelUser: ChannelUserId): Promise<WorkspaceUserId | null> {
    return this.mappings.get(this.channelKey(channelUser)) ?? null;
  }

  async linkIdentity(mapping: IdentityMapping): Promise<void> {
    this.mappings.set(this.channelKey(mapping.channelUserId), mapping.workspaceUserId);
  }

  async unlinkIdentity(channelUser: ChannelUserId): Promise<void> {
    this.mappings.delete(this.channelKey(channelUser));
  }

  async getUserProfile(workspaceUser: WorkspaceUserId): Promise<WorkspaceUserProfile | null> {
    return this.profiles.get(this.workspaceKey(workspaceUser)) ?? null;
  }

  setUserProfile(profile: WorkspaceUserProfile): void {
    this.profiles.set(this.workspaceKey(profile.identity), profile);
  }
}
