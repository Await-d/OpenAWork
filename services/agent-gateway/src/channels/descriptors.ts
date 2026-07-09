import { CHINA_CHANNEL_DESCRIPTORS } from './descriptors-china.js';
import { INTERNATIONAL_CHANNEL_DESCRIPTORS } from './descriptors-international.js';
import type { ChannelDescriptor } from './descriptors-types.js';

export type {
  ChannelDescriptor,
  ChannelDescriptorCategory,
  ChannelDescriptorField,
  ChannelDescriptorFieldType,
  ChannelDescriptorLink,
  ChannelDescriptorTool,
} from './descriptors-types.js';

export const CHANNEL_DESCRIPTORS: ChannelDescriptor[] = [
  ...CHINA_CHANNEL_DESCRIPTORS,
  ...INTERNATIONAL_CHANNEL_DESCRIPTORS,
];
