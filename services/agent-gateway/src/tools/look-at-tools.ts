import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { basename, extname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { Effect } from 'effect';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { getProviderConfigForSelection } from '../provider/provider-config.js';
import { resolveModelRoute, resolveModelRouteFromProvider } from '../provider/model-router.js';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';
import {
  runUpstreamGenerate,
  type RunUpstreamGenerateResult,
} from '../v2-runtime/upstream/index.js';
import type { Message } from '@openAwork/opencode-llm';
import { listManagedAgentsForUser } from '../agent/agent-catalog.js';
import {
  getReferenceAgentModelEntries,
  type ReferenceModelEntry,
} from '../task/task-model-reference-snapshot.js';
import { selectDelegatedModelForUser } from '../task/task-model-selection.js';

/**
 * Wall-clock timeout for the multimodal `look_at` upstream call. The
 * tool runs through the gateway-managed sandbox path (see
 * `tool-sandbox.ts`), which bypasses the ToolRegistry's own
 * timeout/abort wrapper, and `runUpstreamGenerate` has no built-in
 * deadline. Without this an upstream
 * socket that connects but never responds would leave the look_at
 * call pending forever.
 */
const LOOK_AT_LLM_TIMEOUT_MS = 120_000;
const LOOK_AT_REMOTE_FETCH_TIMEOUT_MS = 30_000;

/**
 * Upper bound on a `look_at` source file. Every file branch reads the WHOLE
 * file into memory before any truncation — images are `readFile(..,'base64')`
 * (≈1.33× inflation), text is fully read then sliced to 16k chars, PDFs are
 * fully buffered for parsing. Without a ceiling a multi-GB workspace file (the
 * path is user-supplied) would OOM the gateway. We `stat` first and reject
 * oversized files before reading a single byte. Override via
 * `OPENAWORK_LOOK_AT_MAX_FILE_BYTES`; <=0 disables the guard.
 */
const DEFAULT_LOOK_AT_MAX_FILE_BYTES = 64 * 1024 * 1024;

function resolveLookAtMaxFileBytes(): number {
  const raw = globalThis.process?.env['OPENAWORK_LOOK_AT_MAX_FILE_BYTES'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_LOOK_AT_MAX_FILE_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Reject a file that exceeds the size ceiling BEFORE it is read into memory.
 * `stat` is cheap and avoids the OOM that a full `readFile` of a huge file
 * would cause. A stat failure (missing / unreadable) is left to the
 * subsequent read to surface a precise error.
 */
async function assertLookAtFileWithinLimit(filePath: string): Promise<void> {
  const max = resolveLookAtMaxFileBytes();
  if (max <= 0) return;
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    // Defer to the read for a precise ENOENT/EACCES error.
    return;
  }
  if (size > max) {
    throw new Error(`look_at file too large: ${size} bytes exceeds limit ${max} bytes`);
  }
}

interface UserSettingRow {
  value: string;
}

interface PdfParser {
  destroy(): Promise<void> | void;
  getText(): Promise<{ text: string }>;
}

type PdfParserConstructor = new (input: { data: Buffer }) => PdfParser;

interface ResolvedLookAtImageSource {
  readonly filename: string;
  readonly imageDataUrl: string;
  readonly mimeType: string;
}

const lookAtInputSchema = z
  .object({
    file_path: z.string().min(1).optional(),
    image_data: z.string().min(1).optional(),
    goal: z.string().min(1).optional(),
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
    if (match?.[1]) {
      return normalizeImageMimeType(match[1]);
    }
    const remoteUrl = tryParseHttpUrl(imageData);
    return inferPathMimeType(remoteUrl?.pathname);
  }
  return inferPathMimeType(filePath);
}

function inferPathMimeType(filePath: string | undefined): string {
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

function tryParseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/u, '')
    .toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first, second] = parts;
  if (first === undefined || second === undefined) return false;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::' ||
    normalizedHostname === '::1'
  ) {
    return true;
  }

  const ipVersion = isIP(normalizedHostname);
  if (ipVersion === 4) return isPrivateIpv4(normalizedHostname);
  if (ipVersion === 6) return isPrivateIpv6(normalizedHostname);
  return false;
}

async function assertPublicRemoteImageUrl(imageUrl: string): Promise<URL> {
  const url = tryParseHttpUrl(imageUrl);
  if (!url) {
    throw new Error('look_at remote image only supports public http(s) URLs');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isLocalOrPrivateHost(hostname)) {
    throw new Error('look_at remote image only supports public http(s) URLs');
  }

  if (isIP(hostname) !== 0) {
    return url;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => isLocalOrPrivateHost(entry.address))) {
      throw new Error('look_at remote image only supports public http(s) URLs');
    }
  } catch {
    throw new Error('look_at remote image only supports public http(s) URLs');
  }

  return url;
}

function normalizeImageMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function stripDataUrlPrefix(value: string): string {
  const index = value.indexOf('base64,');
  return index >= 0 ? value.slice(index + 'base64,'.length) : value;
}

function buildImageDataUrl(value: string, mimeType: string): string {
  return `data:${mimeType};base64,${stripDataUrlPrefix(value)}`;
}

function extractMimeTypeFromContentType(contentType: string | null): string | undefined {
  const mimeType = contentType?.split(';', 1)[0]?.trim();
  return mimeType ? normalizeImageMimeType(mimeType) : undefined;
}

function buildClipboardFilename(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1] ?? 'png';
  return `clipboard.${subtype === 'svg+xml' ? 'svg' : subtype}`;
}

function buildRemoteImageFilename(url: URL, mimeType: string): string {
  const candidate = basename(url.pathname);
  if (candidate && candidate !== '.' && candidate !== '/') {
    return candidate;
  }
  return buildClipboardFilename(mimeType);
}

async function readResponseBufferWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (maxBytes > 0) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `look_at remote image too large: content-length ${declared} exceeds limit ${maxBytes} bytes`,
      );
    }
  }

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (maxBytes > 0 && buffer.byteLength > maxBytes) {
      throw new Error(`look_at remote image too large: exceeds limit ${maxBytes} bytes`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (maxBytes > 0 && total > maxBytes) {
        throw new Error(`look_at remote image too large: exceeds limit ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

async function fetchLookAtRemoteImage(url: string): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOK_AT_REMOTE_FETCH_TIMEOUT_MS);
  timer.unref?.();

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new Error(`look_at remote image timeout (${LOOK_AT_REMOTE_FETCH_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRemoteImageAsDataUrl(imageUrl: string): Promise<ResolvedLookAtImageSource> {
  const url = await assertPublicRemoteImageUrl(imageUrl);

  const response = await fetchLookAtRemoteImage(url.toString());
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`look_at remote image request failed with status ${response.status}`);
  }

  const headerMimeType = extractMimeTypeFromContentType(response.headers.get('content-type'));
  const mimeType = headerMimeType ?? inferPathMimeType(url.pathname);
  if (!isImageMime(mimeType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `look_at remote image did not return an image content-type: ${response.headers.get('content-type') ?? 'unknown'}`,
    );
  }

  const buffer = await readResponseBufferWithLimit(response, resolveLookAtMaxFileBytes());
  return {
    filename: buildRemoteImageFilename(url, mimeType),
    imageDataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
  };
}

async function resolveLookAtImageSource(input: {
  filePath?: string;
  imageData?: string;
}): Promise<ResolvedLookAtImageSource | null> {
  if (input.imageData) {
    const remoteUrl = tryParseHttpUrl(input.imageData);
    if (remoteUrl) {
      return await fetchRemoteImageAsDataUrl(remoteUrl.toString());
    }
    const mimeType = inferMimeType(undefined, input.imageData);
    return {
      filename: buildClipboardFilename(mimeType),
      imageDataUrl: buildImageDataUrl(input.imageData, mimeType),
      mimeType,
    };
  }

  if (!input.filePath) {
    return null;
  }

  const mimeType = inferMimeType(input.filePath, undefined);
  if (!isImageMime(mimeType)) {
    return null;
  }

  return {
    filename: basename(input.filePath),
    imageDataUrl: `data:${mimeType};base64,${await readFile(input.filePath, 'base64')}`,
    mimeType,
  };
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
  openaiFastMode?: boolean;
  /**
   * Resolved upstream protocol (e.g. `anthropic_messages`, `responses`).
   * Forwarding this is required for multimodal calls that target a non-
   * OpenAI provider; without it the native client silently degrades to OpenAI
   * Chat Completions which most providers do not support.
   */
  upstreamProtocol?: UpstreamProtocol;
  prompt: string;
  requestOverrides: RequestOverrides;
  systemPrompt?: string;
  textContent?: string;
}): Promise<string> {
  const userContent: Message.ContentInput = [
    { type: 'text', text: input.prompt },
    ...(input.textContent
      ? ([{ type: 'text', text: input.textContent }] as const)
      : input.imageDataUrl
        ? ([
            {
              type: 'media',
              data: input.imageDataUrl,
              mediaType: input.mimeType,
            },
          ] as const)
        : []),
  ];

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOK_AT_LLM_TIMEOUT_MS);
  timer.unref?.();

  let result: RunUpstreamGenerateResult;
  try {
    result = await Effect.runPromise(
      runUpstreamGenerate({
        providerType: input.providerType ?? 'openai',
        ...(input.upstreamProtocol ? { upstreamProtocol: input.upstreamProtocol } : {}),
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.apiBaseUrl ? { baseURL: input.apiBaseUrl } : {}),
        ...(input.openaiFastMode === true ? { openaiFastMode: true } : {}),
        ...(input.requestOverrides.headers && Object.keys(input.requestOverrides.headers).length > 0
          ? { headers: input.requestOverrides.headers }
          : {}),
        model: input.model,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        messages: [{ role: 'user', content: userContent }],
        maxOutputTokens: 2048,
        temperature: 0.2,
        requestOverrides: input.requestOverrides,
        signal: controller.signal,
      }),
    );
  } catch (err) {
    if (timedOut) {
      throw new Error(`look_at LLM timeout (${LOOK_AT_LLM_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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
  const filePath = input.filePath
    ? (validateWorkspacePath(input.filePath) ?? undefined)
    : undefined;
  if (input.filePath && !filePath) {
    throw new Error('Forbidden file_path');
  }
  // Size guard before any read: every file branch buffers the whole file, so
  // reject oversized files up front to avoid OOM on a user-supplied path.
  if (filePath) {
    await assertLookAtFileWithinLimit(filePath);
  }
  const resolvedImageSource = await resolveLookAtImageSource({
    filePath,
    imageData: input.imageData,
  });
  const mimeType = resolvedImageSource?.mimeType ?? inferMimeType(filePath, undefined);
  const agentPrompt = listManagedAgentsForUser(input.userId).find(
    (agent) => agent.id === 'multimodal-looker',
  )?.systemPrompt;
  const routeConfig = await resolveLookAtRoute(input.userId, agentPrompt);
  const filename =
    resolvedImageSource?.filename ??
    (input.filePath ? basename(input.filePath) : buildClipboardFilename(mimeType));
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
  if (resolvedImageSource) {
    analysisText = await requestLookAtText({
      apiBaseUrl: routeConfig.route.apiBaseUrl,
      apiKey: routeConfig.route.apiKey,
      imageDataUrl: resolvedImageSource.imageDataUrl,
      mimeType: resolvedImageSource.mimeType,
      model: routeConfig.route.model,
      ...(routeConfig.route.providerType ? { providerType: routeConfig.route.providerType } : {}),
      ...(routeConfig.route.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
      ...(routeConfig.route.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
      ...(routeConfig.route.openaiFastMode === true ? { openaiFastMode: true } : {}),
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
