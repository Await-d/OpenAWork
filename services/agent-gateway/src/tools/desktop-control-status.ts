import { z } from 'zod';

export interface DesktopControlCapability {
  readonly available: boolean;
  readonly driver?: string;
  readonly reason?: string;
}

export interface DesktopControlCapabilities {
  readonly screenshot: DesktopControlCapability;
  readonly click: DesktopControlCapability;
  readonly typeText: DesktopControlCapability;
  readonly key: DesktopControlCapability;
  readonly hotkey: DesktopControlCapability;
  readonly scroll: DesktopControlCapability;
  readonly wait: DesktopControlCapability;
  // 新增动作位在旧版桥上不会返回，必须保持 optional，避免旧桥 status 解析失败。
  readonly drag?: DesktopControlCapability;
  readonly mouseMove?: DesktopControlCapability;
  readonly longPress?: DesktopControlCapability;
}

export interface DesktopControlStatus {
  readonly enabled: boolean;
  readonly reason?: string;
  readonly capabilities?: DesktopControlCapabilities;
}

const desktopControlCapabilitySchema = z.object({
  available: z.boolean(),
  driver: z.string().optional(),
  reason: z.string().optional(),
});

const desktopControlCapabilitiesSchema = z.object({
  screenshot: desktopControlCapabilitySchema,
  click: desktopControlCapabilitySchema,
  typeText: desktopControlCapabilitySchema,
  key: desktopControlCapabilitySchema,
  hotkey: desktopControlCapabilitySchema,
  scroll: desktopControlCapabilitySchema,
  wait: desktopControlCapabilitySchema,
  // 桥是外部数据源，旧版桥不会上报这三个字段 —— 必须 optional，否则旧桥 status 解析失败。
  drag: desktopControlCapabilitySchema.optional(),
  mouseMove: desktopControlCapabilitySchema.optional(),
  longPress: desktopControlCapabilitySchema.optional(),
});

export const desktopControlBridgeStatusSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
  capabilities: desktopControlCapabilitiesSchema.optional(),
});
