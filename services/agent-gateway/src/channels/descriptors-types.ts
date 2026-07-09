import type { ChannelPlatform } from './types.js';

export type ChannelDescriptorCategory = 'china' | 'international' | 'custom';
export type ChannelDescriptorFieldType = 'text' | 'secret';

export interface ChannelDescriptorField {
  key: string;
  label: string;
  type: ChannelDescriptorFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface ChannelDescriptorTool {
  key: string;
  label: string;
  description: string;
  defaultEnabled?: boolean;
}

export interface ChannelDescriptorLink {
  label: string;
  url: string;
  description?: string;
}

export interface ChannelDescriptor {
  type: ChannelPlatform;
  displayName: string;
  description: string;
  icon: string;
  category: ChannelDescriptorCategory;
  configSchema: ChannelDescriptorField[];
  quickLinks?: readonly ChannelDescriptorLink[];
  tools: ChannelDescriptorTool[];
}
