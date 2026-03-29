import type { SkillManifest, SkillPermission } from '@openAwork/skill-types';

export type RegistrySourceType = 'official' | 'community' | 'enterprise' | 'local';

export type RegistryTrustLevel = 'full' | 'verified' | 'untrusted';

export type RegistryAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'api-key'; header: string; value: string };

export interface RegistrySource {
  id: string;
  name: string;
  url: string;
  type: RegistrySourceType;
  trust: RegistryTrustLevel;
  enabled: boolean;
  priority: number;
  auth?: RegistryAuth;
  metadata?: Record<string, string>;
  lastVerifiedAt?: number;
}

export interface RegistryInfo {
  id: string;
  name: string;
  description?: string;
  apiVersion: string;
  homepage?: string;
}

export type SkillCategory =
  | 'automation'
  | 'productivity'
  | 'development'
  | 'communication'
  | 'data'
  | 'system'
  | 'creative'
  | 'other';

export interface SkillEntry {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  category: SkillCategory;
  sourceId: string;
  manifestUrl?: string;
  downloadUrl?: string;
  signature?: string;
  tags: string[];
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  manifest?: SkillManifest;
}

export interface InstalledSkillRecord {
  skillId: string;
  sourceId: string;
  manifest: SkillManifest;
  grantedPermissions: SkillPermission[];
  installedAt: number;
  updatedAt: number;
}

export interface SearchOptions {
  query?: string;
  category?: SkillCategory;
  capabilities?: string[];
  sourceIds?: string[];
  limit?: number;
  offset?: number;
}

export interface InstallOptions {
  sourceId?: string;
  version?: string;
  allowUntrusted?: boolean;
  skipSignatureVerification?: boolean;
  grantedPermissions?: SkillPermission[];
}
