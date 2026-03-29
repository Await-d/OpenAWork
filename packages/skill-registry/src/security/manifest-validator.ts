import type { SkillManifest, SkillPermission } from '@openAwork/skill-types';

export class ManifestValidationError extends Error {
  readonly fieldPath: string;
  readonly receivedValue: unknown;

  constructor(fieldPath: string, message: string, receivedValue?: unknown) {
    super(`Manifest validation failed at '${fieldPath}': ${message}`);
    this.name = 'ManifestValidationError';
    this.fieldPath = fieldPath;
    this.receivedValue = receivedValue;
  }
}

const REVERSE_DOMAIN_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;

const PERMISSION_TYPES = new Set([
  'network',
  'filesystem',
  'clipboard',
  'env',
  'notifications',
  'camera',
  'location',
]);

const VALID_PLATFORMS = new Set(['ios', 'android', 'macos', 'windows']);

function assertString(path: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ManifestValidationError(path, 'must be a non-empty string', value);
  }
  return value;
}

function assertArray(path: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new ManifestValidationError(path, 'must be an array', value);
  }
  return value;
}

function validatePermission(path: string, raw: unknown): SkillPermission {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError(path, 'must be an object', raw);
  }
  const obj = raw as Record<string, unknown>;

  const type = assertString(`${path}.type`, obj['type']);
  if (!PERMISSION_TYPES.has(type)) {
    throw new ManifestValidationError(
      `${path}.type`,
      `must be one of: ${[...PERMISSION_TYPES].join(', ')}`,
      type,
    );
  }

  const scope = assertString(`${path}.scope`, obj['scope']);

  if (typeof obj['required'] !== 'boolean') {
    throw new ManifestValidationError(`${path}.required`, 'must be a boolean', obj['required']);
  }

  return {
    type: type as SkillPermission['type'],
    scope,
    required: obj['required'],
  };
}

export function validateManifest(raw: unknown): SkillManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('$', 'manifest must be a non-null object', raw);
  }

  const obj = raw as Record<string, unknown>;

  if (obj['apiVersion'] !== 'agent-skill/v1') {
    throw new ManifestValidationError('apiVersion', "must be 'agent-skill/v1'", obj['apiVersion']);
  }

  const id = assertString('id', obj['id']);
  if (!REVERSE_DOMAIN_RE.test(id)) {
    throw new ManifestValidationError(
      'id',
      'must be reverse-domain format (e.g. com.example.skill-name)',
      id,
    );
  }

  const name = assertString('name', obj['name']);
  const displayName = assertString('displayName', obj['displayName']);

  const version = assertString('version', obj['version']);
  if (!SEMVER_RE.test(version)) {
    throw new ManifestValidationError('version', 'must be semver format (e.g. 1.0.0)', version);
  }

  const description = assertString('description', obj['description']);

  const rawPermissions = assertArray('permissions', obj['permissions']);
  const permissions = rawPermissions.map((p, i) => validatePermission(`permissions[${i}]`, p));

  const capabilities = assertArray('capabilities', obj['capabilities']);
  for (let i = 0; i < capabilities.length; i++) {
    assertString(`capabilities[${i}]`, capabilities[i]);
  }

  const manifest: SkillManifest = {
    apiVersion: 'agent-skill/v1',
    id,
    name,
    displayName,
    version,
    description,
    permissions,
    capabilities: capabilities as string[],
  };

  if (obj['descriptionForModel'] !== undefined) {
    manifest.descriptionForModel = assertString('descriptionForModel', obj['descriptionForModel']);
  }

  if (obj['author'] !== undefined) {
    manifest.author = assertString('author', obj['author']);
  }

  if (obj['license'] !== undefined) {
    manifest.license = assertString('license', obj['license']);
  }

  if (obj['platforms'] !== undefined) {
    const rawPlatforms = assertArray('platforms', obj['platforms']);
    for (let i = 0; i < rawPlatforms.length; i++) {
      const p = rawPlatforms[i];
      if (!VALID_PLATFORMS.has(p as string)) {
        throw new ManifestValidationError(
          `platforms[${i}]`,
          `must be one of: ${[...VALID_PLATFORMS].join(', ')}`,
          p,
        );
      }
    }
    manifest.platforms = rawPlatforms as SkillManifest['platforms'];
  }

  return manifest;
}

export function validateSource(sourceUrl: string, allowlist: string[]): boolean {
  for (const pattern of allowlist) {
    if (matchesPattern(sourceUrl, pattern)) {
      return true;
    }
  }
  return false;
}

function matchesPattern(url: string, pattern: string): boolean {
  if (pattern === '*') return true;

  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return url.startsWith(prefix);
  }

  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.endsWith(suffix.replace(/^\./, '')) || parsed.hostname === suffix.slice(1)
      );
    } catch {
      return false;
    }
  }

  return url === pattern || url.startsWith(pattern + '/');
}
