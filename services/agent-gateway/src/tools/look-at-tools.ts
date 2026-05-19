import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../db.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { getProviderConfigForSelection } from '../provider/provider-config.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from '../provider/model-router.js';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';
import { runUpstreamGenerate } from '../v2-runtime/upstream/index.js';
import type { UserContent } from 'ai';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import {
  getReferenceAgentModelEntries,
  type ReferenceModelEntry,
} from '../task/task-model-reference-snapshot.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';

interface UserSettingRow {
  value: string;
}

interface PdfParser {
  destroy(): Promise<void> | void;
  getText(): Promise<{ text: string }>;
}

type PdfParserConstructor = new (input: { data: Buffer }) => PdfParser;

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
  description: '使用配置好的多模态通道，从本地图片或文本文件中提取基本信息。',
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
  const { PDFParse } = (await import('pdf-parse')) as { PDFParse: PdfParserConstructor };
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
    `分析所提供的文件，提取与以下目标相关的信息：${goal}`,
    `文件名：${filename}`,
    `MIME 类型：${mimeType}`,
    '保持简洁，只返回提取出的有用结果。',
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
  providerType?: string;
  /**
   * Resolved upstream protocol (e.g. `anthropic_messages`, `responses`).
   * Forwarding this is required for multimodal calls that target a non-
   * OpenAI provider; without it the AI SDK silently degrades to OpenAI
   * Chat Completions which most providers do not support.
   */
  upstreamProtocol?: UpstreamProtocol;
  prompt: string;
  requestOverrides: RequestOverrides;
  systemPrompt?: string;
  textContent?: string;
}): Promise<string> {
  const userContent: UserContent = [
    { type: 'text', text: input.prompt },
    ...(input.textContent
      ? ([{ type: 'text', text: input.textContent }] as const)
      : input.imageDataUrl
        ? ([
            {
              type: 'image',
              image: input.imageDataUrl,
              mediaType: input.mimeType,
            },
          ] as const)
        : []),
  ];

  const result = await runUpstreamGenerate({
    providerType: input.providerType ?? 'openai',
    ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.apiBaseUrl ? { baseURL: input.apiBaseUrl } : {}),
    ...(input.requestOverrides.headers && Object.keys(input.requestOverrides.headers).length > 0
      ? { headers: input.requestOverrides.headers }
      : {}),
    model: input.model,
    ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
    messages: [{ role: 'user', content: userContent }],
    maxOutputTokens: 2048,
    temperature: 0.2,
    requestOverrides: input.requestOverrides,
  });

  const text = result.text.trim();
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
      ...(routeConfig.route.providerType ? { providerType: routeConfig.route.providerType } : {}),
      ...(routeConfig.route.upstreamProtocol
        ? { upstreamProtocol: routeConfig.route.upstreamProtocol }
        : {}),
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      ...(routeConfig.route.systemPrompt ? { systemPrompt: routeConfig.route.systemPrompt } : {}),
    });
  } else if (filePath && ['text/plain', 'text/markdown', 'application/json'].includes(mimeType)) {
    const textContent = (await readFileAsText(filePath)).slice(0, 16000);
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      mimeType,
      model: routeConfig.route.model,
      ...(routeConfig.route.providerType ? { providerType: routeConfig.route.providerType } : {}),
      ...(routeConfig.route.upstreamProtocol
        ? { upstreamProtocol: routeConfig.route.upstreamProtocol }
        : {}),
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      ...(routeConfig.route.systemPrompt ? { systemPrompt: routeConfig.route.systemPrompt } : {}),
      textContent: `File content:\n${textContent}`,
    });
  } else if (filePath && mimeType === 'application/pdf') {
    const textContent = (await readPdfAsText(filePath)).slice(0, 20000);
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      mimeType,
      model: routeConfig.route.model,
      ...(routeConfig.route.providerType ? { providerType: routeConfig.route.providerType } : {}),
      ...(routeConfig.route.upstreamProtocol
        ? { upstreamProtocol: routeConfig.route.upstreamProtocol }
        : {}),
      prompt,
      requestOverrides: routeConfig.route.requestOverrides,
      ...(routeConfig.route.systemPrompt ? { systemPrompt: routeConfig.route.systemPrompt } : {}),
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
