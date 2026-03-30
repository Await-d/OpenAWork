import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';

export const CALL_OMO_ALLOWED_AGENTS = [
  'explore',
  'librarian',
  'oracle',
  'hephaestus',
  'metis',
  'momus',
  'multimodal-looker',
] as const;

const callOmoAgentInputSchema = z.object({
  description: z.string().min(1),
  prompt: z.string().min(1),
  subagent_type: z.string().min(1),
  run_in_background: z.boolean(),
  session_id: z.string().min(1).optional(),
});

export const callOmoAgentToolDefinition: ToolDefinition<
  typeof callOmoAgentInputSchema,
  z.ZodString
> = {
  name: 'call_omo_agent',
  description: 'Directly invoke a named built-in subagent with sync/background execution modes.',
  inputSchema: callOmoAgentInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('call_omo_agent must execute through the gateway-managed sandbox path');
  },
};
