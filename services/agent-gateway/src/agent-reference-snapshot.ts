import type { ManagedAgentBody } from '@openAwork/shared';
import { BUILTIN_AGENT_FROZEN_SNAPSHOT } from './reference-frozen/agent-snapshot.js';

function trim(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function make(body: Partial<ManagedAgentBody>): Partial<ManagedAgentBody> {
  return {
    label: trim(body.label),
    description: trim(body.description),
    systemPrompt: trim(body.systemPrompt),
  };
}

export const BUILTIN_AGENT_REFERENCE_SNAPSHOT: Record<
  string,
  Partial<ManagedAgentBody>
> = Object.fromEntries(
  Object.entries(BUILTIN_AGENT_FROZEN_SNAPSHOT).map(([key, value]) => [key, make(value)]),
);
