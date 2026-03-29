export type PluginManifestVersion = 'agent-plugin/v1';

export interface PluginPermission {
  type: 'tool' | 'network' | 'filesystem' | 'env';
  scope: string;
  required: boolean;
}

export interface PluginManifest {
  apiVersion: PluginManifestVersion;
  id: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  capabilities: string[];
  permissions: PluginPermission[];
  hooks: Array<'onSessionStart' | 'onSessionEnd' | 'beforeToolCall' | 'afterToolCall'>;
  configSchema?: Record<string, unknown>;
}

export interface PluginManifestValidator {
  validate(manifest: unknown): { valid: boolean; errors: string[] };
}

const VALID_HOOKS = new Set(['onSessionStart', 'onSessionEnd', 'beforeToolCall', 'afterToolCall']);

const VALID_PERMISSION_TYPES = new Set(['tool', 'network', 'filesystem', 'env']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export class PluginManifestValidatorImpl implements PluginManifestValidator {
  validate(manifest: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!isObject(manifest)) {
      return { valid: false, errors: ['manifest must be an object'] };
    }

    if (manifest.apiVersion !== 'agent-plugin/v1') {
      errors.push('apiVersion must be agent-plugin/v1');
    }

    const requiredStringFields = ['id', 'name', 'displayName', 'version', 'description'];
    for (const field of requiredStringFields) {
      if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
        errors.push(`${field} is required and must be a non-empty string`);
      }
    }

    if (!isStringArray(manifest.capabilities)) {
      errors.push('capabilities is required and must be a string array');
    }

    if (!Array.isArray(manifest.permissions)) {
      errors.push('permissions is required and must be an array');
    } else {
      for (let index = 0; index < manifest.permissions.length; index += 1) {
        const permission = manifest.permissions[index];
        if (!isObject(permission)) {
          errors.push(`permissions[${index}] must be an object`);
          continue;
        }

        if (typeof permission.type !== 'string' || !VALID_PERMISSION_TYPES.has(permission.type)) {
          errors.push(`permissions[${index}].type must be one of tool|network|filesystem|env`);
        }

        if (typeof permission.scope !== 'string' || permission.scope.length === 0) {
          errors.push(`permissions[${index}].scope must be a non-empty string`);
        }

        if (typeof permission.required !== 'boolean') {
          errors.push(`permissions[${index}].required must be a boolean`);
        }
      }
    }

    if (!Array.isArray(manifest.hooks)) {
      errors.push('hooks is required and must be an array');
    } else {
      for (let index = 0; index < manifest.hooks.length; index += 1) {
        const hook = manifest.hooks[index];
        if (typeof hook !== 'string' || !VALID_HOOKS.has(hook)) {
          errors.push(`hooks[${index}] is invalid`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
