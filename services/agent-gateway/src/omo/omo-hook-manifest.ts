import { z } from 'zod';
import {
  duplicateOmoManifestIdError,
  type OmoManifestError,
  zodToOmoManifestError,
} from './omo-adapter-errors.js';

export type OmoHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PostCompact'
  | 'Stop'
  | 'SubagentStop';

export type OmoCommandHook = {
  readonly kind: 'command';
  readonly command: string;
  readonly timeoutSeconds?: number;
  readonly statusMessage?: string;
  readonly commandWindows?: string;
};

export type OmoHookRegistration = {
  readonly event: OmoHookEvent;
  readonly matcher?: string;
  readonly commands: readonly OmoCommandHook[];
};

export type OmoHookManifest = { readonly hooks: readonly OmoHookRegistration[] };

export type OmoHookManifestParseResult =
  | { readonly ok: true; readonly value: OmoHookManifest }
  | { readonly ok: false; readonly error: OmoManifestError };

const commandHookSchema = z
  .object({
    type: z.literal('command'),
    command: z.string().trim().min(1).max(4000),
    timeout: z.number().int().min(1).max(3600).optional(),
    statusMessage: z.string().max(1000).optional(),
    commandWindows: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();

const hookRegistrationSchema = z
  .object({
    matcher: z.string().trim().min(1).max(1000).optional(),
    hooks: z.array(commandHookSchema).min(1).max(50),
  })
  .strict();

const hookManifestSchema = z
  .object({
    hooks: z
      .object({
        PreToolUse: z.array(hookRegistrationSchema).max(100).optional(),
        PostToolUse: z.array(hookRegistrationSchema).max(100).optional(),
        SessionStart: z.array(hookRegistrationSchema).max(100).optional(),
        UserPromptSubmit: z.array(hookRegistrationSchema).max(100).optional(),
        PostCompact: z.array(hookRegistrationSchema).max(100).optional(),
        Stop: z.array(hookRegistrationSchema).max(100).optional(),
        SubagentStop: z.array(hookRegistrationSchema).max(100).optional(),
      })
      .strict(),
  })
  .strict();

type OmoRawHookRegistration = z.infer<typeof hookRegistrationSchema>;
type OmoRawCommandHook = z.infer<typeof commandHookSchema>;

const HOOK_EVENTS: readonly OmoHookEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'UserPromptSubmit',
  'PostCompact',
  'Stop',
  'SubagentStop',
] as const;

export function parseOmoHookManifest(
  input: unknown,
  sourcePath?: string,
): OmoHookManifestParseResult {
  const parsed = hookManifestSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: zodToOmoManifestError(parsed.error, { sourcePath }) };

  const hooks: OmoHookRegistration[] = [];
  for (const event of HOOK_EVENTS) {
    const registrations = parsed.data.hooks[event] ?? [];
    for (const registration of registrations) {
      hooks.push(toHookRegistration(event, registration));
    }
  }

  const duplicateError = findDuplicateHook(hooks, sourcePath);
  if (duplicateError) return { ok: false, error: duplicateError };
  return { ok: true, value: { hooks } };
}

function toHookRegistration(
  event: OmoHookEvent,
  registration: OmoRawHookRegistration,
): OmoHookRegistration {
  return {
    event,
    ...(registration.matcher ? { matcher: registration.matcher } : {}),
    commands: registration.hooks.map(toCommandHook),
  };
}

function toCommandHook(hook: OmoRawCommandHook): OmoCommandHook {
  return {
    kind: 'command',
    command: hook.command,
    ...(hook.timeout !== undefined ? { timeoutSeconds: hook.timeout } : {}),
    ...(hook.statusMessage !== undefined ? { statusMessage: hook.statusMessage } : {}),
    ...(hook.commandWindows !== undefined ? { commandWindows: hook.commandWindows } : {}),
  };
}

function findDuplicateHook(
  hooks: readonly OmoHookRegistration[],
  sourcePath: string | undefined,
): OmoManifestError | null {
  const seen = new Set<string>();
  for (const hook of hooks) {
    const normalized = `${hook.event}:${hook.matcher ?? ''}`;
    if (seen.has(normalized)) {
      return duplicateOmoManifestIdError({
        id: normalized,
        path: ['hooks', hook.event],
        sourcePath,
      });
    }
    seen.add(normalized);
  }
  return null;
}
