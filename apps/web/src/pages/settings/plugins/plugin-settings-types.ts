/** 插件设置的数据契约（设置 → 插件）。与网关 `GET/PUT /settings/plugins` 对齐。 */

export interface ImageGenerationPluginSettings {
  enabled: boolean;
  modelSource?: 'global' | 'dedicated';
  dedicatedProviderId?: string;
  dedicatedModelId?: string;
}

export interface DesktopControlPluginSettings {
  enabled: boolean;
}

export interface DesktopAutomationPluginSettings {
  enabled: boolean;
}

export interface PluginSettings {
  imageGeneration?: ImageGenerationPluginSettings;
  desktopControl?: DesktopControlPluginSettings;
  desktopAutomation?: DesktopAutomationPluginSettings;
}
