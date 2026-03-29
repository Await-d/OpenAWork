import type { ToolCallContent, ToolResultContent } from '@openAwork/shared';
export type {
  PluginManifestVersion,
  PluginPermission,
  PluginManifest,
  PluginManifestValidator,
} from './manifest.js';
export { PluginManifestValidatorImpl } from './manifest.js';

export interface PluginHooks {
  onSessionStart?: (sessionId: string) => Promise<void> | void;
  onSessionEnd?: (sessionId: string) => Promise<void> | void;
  beforeToolCall?: (call: ToolCallContent) => Promise<ToolCallContent> | ToolCallContent;
  afterToolCall?: (call: ToolCallContent, result: ToolResultContent) => Promise<void> | void;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  hooks: PluginHooks;
}

export interface PluginLifecycleManager {
  register(plugin: Plugin): void;
  unregister(pluginId: string): void;
  list(): Plugin[];
  onSessionStart(sessionId: string): Promise<void>;
  onSessionEnd(sessionId: string): Promise<void>;
  beforeToolCall(call: ToolCallContent): Promise<ToolCallContent>;
  afterToolCall(call: ToolCallContent, result: ToolResultContent): Promise<void>;
}

export class PluginLifecycleManagerImpl implements PluginLifecycleManager {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  async onSessionStart(sessionId: string): Promise<void> {
    for (const p of this.plugins.values()) {
      await p.hooks.onSessionStart?.(sessionId);
    }
  }

  async onSessionEnd(sessionId: string): Promise<void> {
    for (const p of this.plugins.values()) {
      await p.hooks.onSessionEnd?.(sessionId);
    }
  }

  async beforeToolCall(call: ToolCallContent): Promise<ToolCallContent> {
    let current = call;
    for (const p of this.plugins.values()) {
      if (p.hooks.beforeToolCall) {
        current = await p.hooks.beforeToolCall(current);
      }
    }
    return current;
  }

  async afterToolCall(call: ToolCallContent, result: ToolResultContent): Promise<void> {
    for (const p of this.plugins.values()) {
      await p.hooks.afterToolCall?.(call, result);
    }
  }
}
