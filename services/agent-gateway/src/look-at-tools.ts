import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { RequestOverrides } from '@openAwork/agent-core';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { sqliteGet, sqliteRun } from './db.js';
import { appendSessionMessageV2 as appendSessionMessage } from './message-v2-adapter.js';
import { validateWorkspacePath } from './workspace-paths.js';
import { getProviderConfigForSelection } from './provider-config.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from './model-router.js';
import { applyRequestOverridesToBody } from './routes/upstream-request.js';
import { extractWorkflowLlmText } from './routes/workflow-llm.js';
import { listManagedAgentsForUser } from './agent-catalog.js';
import {
  getReferenceAgentModelEntries,
  type ReferenceModelEntry,
} from './task-model-reference-snapshot.js';
import { selectDelegatedModelForUser } from './task-model-selection.js';

interface UserSettingRow {
  value: string;
}

const lookAtInputSchema = z
  .object({
    file_path: z.string().min(1).optional(),
    image_data: z.string().min(1).optional(),
    goal: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (!value.file_path && !value.image_data) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must provide either file_path or image_data',
        path: ['file_path'],
      });
    }
    if (value.file_path && value.image_data) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide only one of file_path or image_data',
        path: ['image_data'],
      });
    }
  });

export const lookAtToolDefinition: ToolDefinition<typeof lookAtInputSchema, z.ZodString> = {
  name: 'look_at',
  description:
    'Extract basic information from local images or text files using the configured multimodal path.',
  inputSchema: lookAtInputSchema,
  outputSchema: z.string(),
  timeout: 120000,
  execute: async () => {
    throw new Error('look_at must execute through the gateway-managed sandbox path');
  },
};

function inferMimeType(filePath: string | undefined, imageData: string | undefined): string {
  if (imageData) {
    const match = imageData.match(/^data:([^;]+);base64,/i);
    return match?.[1] ?? 'image/png';
  }
  const ext = extname(filePath ?? '').toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function stripDataUrlPrefix(value: string): string {
  const index = value.indexOf('base64,');
  return index >= 0 ? value.slice(index + 'base64,'.length) : value;
}

async function readFileAsText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return buffer.toString('utf8');
}

async function readPdfAsText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return parsed.text;
  } finally {
    await parser.destroy();
  }
}

function buildLookAtPrompt(goal: string, filename: string, mimeType: string): string {
  return [
    `Analyze the provided file and extract the information relevant to this goal: ${goal}`,
    `Filename: ${filename}`,
    `MIME type: ${mimeType}`,
    'Be concise and only return the useful extracted result.',
  ].join('\n');
}

async function resolveLookAtRoute(userId: string, systemPrompt: string | undefined) {
  const managedLooker = listManagedAgentsForUser(userId).find(
    (agent) => agent.id === 'multimodal-looker',
  );
  const managedEntries: ReferenceModelEntry[] = [
    managedLooker?.model,
    ...(managedLooker?.fallbackModels ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((modelId) => ({ modelId, providerHints: [], variant: managedLooker?.variant }));
  const providersRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  const delegatedModel = selectDelegatedModelForUser(
    userId,
    managedEntries.length > 0 ? managedEntries : getReferenceAgentModelEntries('multimodal-looker'),
  );
  const providerConfig = await getProviderConfigForSelection(
    providersRow?.value ? JSON.parse(providersRow.value) : undefined,
    selectionRow?.value ? JSON.parse(selectionRow.value) : undefined,
    delegatedModel,
  );
  if (providerConfig) {
    return {
      route: resolveModelRouteFromProvider(providerConfig.provider, providerConfig.modelId, {
        maxTokens: 2048,
        variant: delegatedModel?.variant ?? managedLooker?.variant,
        systemPrompt,
        temperature: 0.2,
      }),
      providerId: providerConfig.provider.id,
      modelId: providerConfig.modelId,
    };
  }
  const fallbackModel = delegatedModel?.modelId ?? 'default';
  return {
    route: resolveModelRoute({
      model: fallbackModel,
      maxTokens: 2048,
      variant: delegatedModel?.variant ?? managedLooker?.variant,
      systemPrompt,
      temperature: 0.2,
    }),
    providerId: delegatedModel?.providerId,
    modelId: fallbackModel,
  };
}

async function requestLookAtText(input: {
  apiBaseUrl: string;
  apiKey: string;
  imageDataUrl?: string;
  mimeType: string;
  model: string;
  protocol: 'chat_completions' | 'responses';
  prompt: string;
  requestOverrides: RequestOverrides;
  systemPrompt?: string;
  textContent?: string;
}): Promise<string> {
  const bodyBase =
    input.protocol === 'responses'
      ? {
          model: input.model,
          input: [
            ...(input.systemPrompt
              ? [
                  {
                    role: 'system',
                    content: [{ type: 'input_text', text: input.systemPrompt }],
                  },
                ]
              : []),
            {
              role: 'user',
              content: [
                { type: 'input_text', text: input.prompt },
                ...(input.textContent
                  ? [{ type: 'input_text', text: input.textContent }]
                  : input.imageDataUrl
                    ? [{ type: 'input_image', image_url: input.imageDataUrl }]
                    : []),
              ],
            },
          ],
          max_output_tokens: 2048,
          temperature: 0.2,
          stream: false,
        }
      : {
          model: input.model,
          messages: [
            ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
            {
              role: 'user',
              content: [
                { type: 'text', text: input.prompt },
                ...(input.textContent
                  ? [{ type: 'text', text: input.textContent }]
                  : input.imageDataUrl
                    ? [{ type: 'image_url', image_url: { url: input.imageDataUrl } }]
                    : []),
              ],
            },
          ],
          max_tokens: 2048,
          temperature: 0.2,
          stream: false,
        };

  const body = applyRequestOverridesToBody(
    bodyBase as Record<string, unknown>,
    input.requestOverrides,
    input.protocol,
  );
  const response = await fetch(
    `${input.apiBaseUrl}${input.protocol === 'responses' ? '/responses' : '/chat/completions'}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const payload = (await response.json()) as unknown;
  const text = extractWorkflowLlmText(payload).trim();
  if (!text) {
    throw new Error('No multimodal response text returned');
  }
  return text;
}

function createLookAtChildSession(
  userId: string,
  parentSessionId: string,
  metadata: Record<string, unknown>,
): string {
  const sessionId = randomUUID();
  sqliteRun(
    'INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, title) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, userId, '[]', 'idle', JSON.stringify(metadata), 'look_at'],
  );
  void parentSessionId;
  return sessionId;
}

export async function runLookAtTool(input: {
  filePath?: string;
  goal: string;
  imageData?: string;
  parentSessionId: string;
  userId: string;
}): Promise<string> {
  const mimeType = inferMimeType(input.filePath, input.imageData);
  const filePath = input.filePath ? validateWorkspacePath(input.filePath) : undefined;
  if (input.filePath && !filePath) {
    throw new Error('Forbidden file_path');
  }
  const agentPrompt = listManagedAgentsForUser(input.userId).find(
    (agent) => agent.id === 'multimodal-looker',
  )?.systemPrompt;
  const routeConfig = await resolveLookAtRoute(input.userId, agentPrompt);
  const filename = input.filePath
    ? basename(input.filePath)
    : `clipboard.${mimeType.split('/')[1] ?? 'png'}`;
  const childSessionId = createLookAtChildSession(input.userId, input.parentSessionId, {
    parentSessionId: input.parentSessionId,
    createdByTool: 'look_at',
    subagentType: 'multimodal-looker',
    providerId: routeConfig.providerId,
    modelId: routeConfig.modelId,
    variant: routeConfig.route.variant,
  });
  const prompt = buildLookAtPrompt(input.goal, filename, mimeType);
  appendSessionMessage({
    sessionId: childSessionId,
    userId: input.userId,
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  });

  let analysisText: string;
  if (input.imageData || (filePath && isImageMime(mimeType))) {
    const imageDataUrl = input.imageData
      ? input.imageData.startsWith('data:')
        ? input.imageData
        : `data:${mimeType};base64,${stripDataUrlPrefix(input.imageData)}`
      : `data:${mimeType};base64,${(await readFile(filePath!, 'base64')).toString()}`;
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      imageDataUrl,
      mimeType,
      model: routeConfig.route.model,
      protocol: routeConfig.route.upstreamProtocol,
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      systemPrompt: routeConfig.route.systemPrompt,
    });
  } else if (filePath && ['text/plain', 'text/markdown', 'application/json'].includes(mimeType)) {
    const textContent = (await readFileAsText(filePath)).slice(0, 16000);
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      mimeType,
      model: routeConfig.route.model,
      protocol: routeConfig.route.upstreamProtocol,
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      systemPrompt: routeConfig.route.systemPrompt,
      textContent: `File content:\n${textContent}`,
    });
  } else if (filePath && mimeType === 'application/pdf') {
    const textContent = (await readPdfAsText(filePath)).slice(0, 20000);
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      mimeType,
      model: routeConfig.route.model,
      protocol: routeConfig.route.upstreamProtocol,
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      systemPrompt: routeConfig.route.systemPrompt,
      textContent: `PDF text:\n${textContent}`,
    });
  } else {
    throw new Error(`Unsupported look_at mime type in this runtime: ${mimeType}`);
  }

  appendSessionMessage({
    sessionId: childSessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text: analysisText }],
  });
  return analysisText;
}
