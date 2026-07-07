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
});

export const desktopControlBridgeStatusSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
  capabilities: desktopControlCapabilitiesSchema.optional(),
});
