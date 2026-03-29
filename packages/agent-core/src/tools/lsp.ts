import { z } from 'zod';
import type { ToolDefinition } from '../tool-contract.js';

export const lspDiagnosticsTool: ToolDefinition<
  z.ZodObject<{ filePath: z.ZodOptional<z.ZodString> }>,
  z.ZodRecord<z.ZodString, z.ZodArray<z.ZodUnknown>>
> = {
  name: 'lsp_diagnostics',
  description:
    'Get LSP diagnostics (errors, warnings) for a file or all open files. Returns a map of filePath → diagnostic array.',
  inputSchema: z.object({
    filePath: z.string().optional(),
  }),
  outputSchema: z.record(z.string(), z.array(z.unknown())),
  timeout: 10_000,
  execute: async (input, _signal) => {
    const gatewayUrl = globalThis.process?.env['GATEWAY_URL'] ?? 'http://localhost:3000';
    const token = globalThis.process?.env['GATEWAY_TOKEN'] ?? '';

    const res = await fetch(`${gatewayUrl}/lsp/diagnostics`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: _signal,
    });

    if (!res.ok) throw new Error(`LSP diagnostics request failed: ${res.status}`);

    const data = (await res.json()) as { diagnostics: Record<string, unknown[]> };
    const all = data.diagnostics;

    if (input.filePath) {
      const key = Object.keys(all).find((k) => k.endsWith(input.filePath!));
      return key ? { [key]: all[key]! } : {};
    }

    return all;
  },
};

export const lspTouchTool: ToolDefinition<
  z.ZodObject<{ path: z.ZodString; waitForDiagnostics: z.ZodDefault<z.ZodBoolean> }>,
  z.ZodObject<{ ok: z.ZodBoolean }>
> = {
  name: 'lsp_touch',
  description:
    'Notify the LSP server that a file has been modified. Optionally waits for diagnostics to update before returning.',
  inputSchema: z.object({
    path: z.string(),
    waitForDiagnostics: z.boolean().default(true),
  }),
  outputSchema: z.object({ ok: z.boolean() }),
  timeout: 15_000,
  execute: async (input, _signal) => {
    const gatewayUrl = globalThis.process?.env['GATEWAY_URL'] ?? 'http://localhost:3000';
    const token = globalThis.process?.env['GATEWAY_TOKEN'] ?? '';

    const res = await fetch(`${gatewayUrl}/lsp/touch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ path: input.path, waitForDiagnostics: input.waitForDiagnostics }),
      signal: _signal,
    });

    if (!res.ok) throw new Error(`LSP touch request failed: ${res.status}`);
    return { ok: true };
  },
};

export const LSP_TOOLS = [lspDiagnosticsTool, lspTouchTool] as const;
