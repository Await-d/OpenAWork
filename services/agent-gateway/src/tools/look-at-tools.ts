import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ToolDefinition } from '@openAwork/agent-core';
import type { RequestOverrides } from '@openAwork/agent-core';
import { z } from 'zod';
import { Effect } from 'effect';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { readPublicUrlError } from '../security/public-url-guard.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';
import { sniffImageMediaType } from '../media/image-signature.js';
import { formatTextReadOutput } from '../artifacts/text-read-output.js';
import { extractBufferFromDataUrl } from '../media/media-artifact.js';
import { getArtifactById } from '../session/artifact-content-store.js';
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
 * `OPENAWORK_LOOK_AT_MAX_FILE_BYTES`; <=0 disables the guard. Images are
 * additionally capped by `LOOK_AT_MAX_IMAGE_BYTES` (the upstream media limit).
 */
const DEFAULT_LOOK_AT_MAX_FILE_BYTES = 64 * 1024 * 1024;

/** 镜像 `IMAGE_MIMES`（packages/opencode-llm/src/protocols/shared.ts）——包外不可导入，改协议白名单时须同步。 */
const LOOK_AT_SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * 图片专用上限：镜像上游 `validateMedia` 的 `MAX_MEDIA_DECODED_BYTES`（20 MiB）。
 * 图片原样内联上送（文本/PDF 会先截断），故必须受此约束；64 MiB 的文件闸门只防 OOM。
 */
const LOOK_AT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * `.svg` passes the generic `isImageMime` gate but is absent from the upstream
 * protocol whitelist (`IMAGE_MIMES` in `@openAwork/opencode-llm`), so the
 * provider would reject it with a cryptic error. Fail fast instead.
 */
const LOOK_AT_SVG_MIME = 'image/svg+xml';
const LOOK_AT_SVG_UNSUPPORTED_MESSAGE =
  'look_at 不支持 SVG（image/svg+xml）：上游多模态模型无法解析该格式，请先将 SVG 转换为 PNG/JPEG/WebP 后再分析。';
const LOOK_AT_REMOTE_IMAGE_MESSAGE = 'look_at remote image only supports public http(s) URLs';
const LOOK_AT_ARTIFACT_PREFIX = 'artifact:';

/**
 * 上游多模态模型不接受 `application/octet-stream`。旧实现会把无法识别的来源
 * 推成该类型，再被 provider 以难懂的协议错误拒绝。此消息在打上游前失败，
 * 并给出可执行的修复路径。
 */
const LOOK_AT_OCTET_STREAM_MESSAGE =
  'look_at 无法识别图片格式（application/octet-stream）：请提供 data:image/png|jpeg|gif|webp;base64,... 形式的 data URL、对应格式的裸 base64、带正确扩展名的文件路径、公网 http(s) 图片地址，或有效的 artifact:<id>。';

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
    offset: z.number().int().min(1).optional(),
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

async function assertPublicRemoteImageUrl(imageUrl: string): Promise<URL> {
  const url = tryParseHttpUrl(imageUrl);
  if (!url) {
    throw new Error(LOOK_AT_REMOTE_IMAGE_MESSAGE);
  }

  const urlError = await readPublicUrlError(imageUrl, LOOK_AT_REMOTE_IMAGE_MESSAGE);
  if (urlError) {
    throw new Error(urlError);
  }

  return url;
}

function normalizeImageMimeType(mimeType: string): string {
  return mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isSvgMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase() === LOOK_AT_SVG_MIME;
}

function assertLookAtMimeTypeNotOctetStream(mimeType: string): void {
  if (mimeType.toLowerCase() === 'application/octet-stream') {
    throw new Error(LOOK_AT_OCTET_STREAM_MESSAGE);
  }
}

function assertLookAtMimeTypeSupported(mimeType: string): void {
  if (isSvgMimeType(mimeType)) {
    throw new Error(LOOK_AT_SVG_UNSUPPORTED_MESSAGE);
  }
  assertLookAtMimeTypeNotOctetStream(mimeType);
}

function stripDataUrlPrefix(value: string): string {
  const index = value.indexOf('base64,');
  return index >= 0 ? value.slice(index + 'base64,'.length) : value;
}

function buildImageDataUrl(value: string, mimeType: string): string {
  return `data:${mimeType};base64,${stripDataUrlPrefix(value)}`;
}

function isSupportedImageMime(mimeType: string): boolean {
  return LOOK_AT_SUPPORTED_IMAGE_MIMES.includes(mimeType.toLowerCase());
}

/** 剥掉 data URL 前缀并剔除空白，得到上游 `validateMedia` 要求的规范 base64。 */
function normalizeBase64Payload(value: string): string {
  return stripDataUrlPrefix(value).replace(/\s+/g, '');
}

/**
 * `image_data` 的 MIME：data URL 用声明值，裸 base64 靠魔数嗅探。嗅不出、
 * 或嗅出上游白名单外的格式（如 BMP）时抛可读错误，避免留个
 * `application/octet-stream` 让上游抛出难懂的协议拒绝。
 */
function resolveInlineImageMimeType(rawImageData: string): string {
  const declared = inferMimeType(undefined, rawImageData);
  if (isSvgMimeType(declared)) {
    throw new Error(LOOK_AT_SVG_UNSUPPORTED_MESSAGE);
  }
  if (isSupportedImageMime(declared)) {
    return declared.toLowerCase();
  }

  const sniffed = sniffImageMediaType(Buffer.from(normalizeBase64Payload(rawImageData), 'base64'));
  if (sniffed && isSupportedImageMime(sniffed)) {
    return sniffed;
  }
  if (sniffed) {
    throw new Error(
      `look_at 不支持 ${sniffed} 图片：上游多模态模型只支持 PNG / JPEG / GIF / WebP。`,
    );
  }
  throw new Error(LOOK_AT_OCTET_STREAM_MESSAGE);
}

function assertLookAtImageBytesWithinLimit(byteLength: number, source: string): void {
  if (byteLength > LOOK_AT_MAX_IMAGE_BYTES) {
    throw new Error(
      `look_at ${source} too large: ${byteLength} bytes exceeds the multimodal image limit ${LOOK_AT_MAX_IMAGE_BYTES} bytes`,
    );
  }
}

async function assertLookAtImageFileWithinLimit(filePath: string): Promise<void> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    // Defer to the read for a precise ENOENT/EACCES error.
    return;
  }
  assertLookAtImageBytesWithinLimit(size, 'image file');
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

const LOOK_AT_MAX_REDIRECTS = 5;

async function fetchLookAtRemoteImage(initialUrl: string): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LOOK_AT_REMOTE_FETCH_TIMEOUT_MS);
  timer.unref?.();

  try {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= LOOK_AT_MAX_REDIRECTS; hop += 1) {
      // 安全：逐跳校验重定向目标，防止 fetch 默认跟随重定向绕过 SSRF 预检。
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = readRedirectLocation(response);
      if (location === null) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
      const nextUrl = new URL(location, currentUrl).toString();
      const hopError = await readPublicUrlError(nextUrl, LOOK_AT_REMOTE_IMAGE_MESSAGE);
      if (hopError) {
        throw new Error(hopError);
      }
      currentUrl = nextUrl;
    }
    throw new Error(`look_at remote image exceeded ${LOOK_AT_MAX_REDIRECTS} redirects`);
  } catch (err) {
    if (timedOut) {
      throw new Error(`look_at remote image timeout (${LOOK_AT_REMOTE_FETCH_TIMEOUT_MS}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function readRedirectLocation(response: Response): string | null {
  if (response.status < 300 || response.status >= 400) {
    return null;
  }
  const location = response.headers.get('location');
  return location !== null && location.length > 0 ? location : null;
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
  if (isSvgMimeType(mimeType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(LOOK_AT_SVG_UNSUPPORTED_MESSAGE);
  }

  const buffer = await readResponseBufferWithLimit(response, LOOK_AT_MAX_IMAGE_BYTES);
  return {
    filename: buildRemoteImageFilename(url, mimeType),
    imageDataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
  };
}

function resolveLookAtArtifactSource(
  userId: string,
  artifactId: string,
): ResolvedLookAtImageSource {
  const artifact = getArtifactById(userId, artifactId);
  if (!artifact) {
    throw new Error(`找不到 artifact: ${artifactId}`);
  }

  let extracted: { buffer: Buffer; mimeType: string };
  try {
    extracted = extractBufferFromDataUrl(artifact.content);
  } catch {
    throw new Error(
      `look_at 无法读取 artifact ${artifactId} 的媒体内容：artifact 内容不是有效的 data URL（data:<mime>;base64,<data>）。`,
    );
  }

  const mimeType = normalizeImageMimeType(extracted.mimeType);
  if (isSvgMimeType(mimeType)) {
    throw new Error(LOOK_AT_SVG_UNSUPPORTED_MESSAGE);
  }
  if (!isImageMime(mimeType)) {
    throw new Error(`look_at 不支持该 artifact 的 MIME 类型：${mimeType}`);
  }
  assertLookAtMimeTypeNotOctetStream(mimeType);

  return {
    filename: buildClipboardFilename(mimeType),
    imageDataUrl: `data:${mimeType};base64,${extracted.buffer.toString('base64')}`,
    mimeType,
  };
}

async function resolveLookAtImageSource(input: {
  filePath?: string;
  imageData?: string;
  userId: string;
}): Promise<ResolvedLookAtImageSource | null> {
  if (input.imageData) {
    const remoteUrl = tryParseHttpUrl(input.imageData);
    if (remoteUrl) {
      return await fetchRemoteImageAsDataUrl(remoteUrl.toString());
    }
    if (input.imageData.startsWith(LOOK_AT_ARTIFACT_PREFIX)) {
      return resolveLookAtArtifactSource(
        input.userId,
        input.imageData.slice(LOOK_AT_ARTIFACT_PREFIX.length),
      );
    }
    const base64 = normalizeBase64Payload(input.imageData);
    assertLookAtImageBytesWithinLimit(Buffer.byteLength(base64, 'base64'), 'inline image_data');
    const mimeType = resolveInlineImageMimeType(input.imageData);
    return {
      filename: buildClipboardFilename(mimeType),
      imageDataUrl: buildImageDataUrl(base64, mimeType),
      mimeType,
    };
  }

  if (!input.filePath) {
    return null;
  }

  const mimeType = inferMimeType(input.filePath, undefined);
  assertLookAtMimeTypeSupported(mimeType);
  if (!isImageMime(mimeType)) {
    return null;
  }
  await assertLookAtImageFileWithinLimit(input.filePath);

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

/**
 * 解析一次多模态调用的路由。
 *
 * `selectionOverride` 用于**显式指定 provider/model**，绕过默认的
 * `multimodal-looker` 委派模型选择。GUI Agent（`computer_use`）需要它：
 * 其模型由 `resolveGuiModelGate` 按 grounding 能力单独判定，若不走 override，
 * 内层调用会落到与门控结果不一致的模型上（路径 B 的自定义 GUI endpoint 更会完全失效）。
 */
export async function resolveLookAtRoute(
  userId: string,
  systemPrompt: string | undefined,
  selectionOverride?: { readonly providerId: string; readonly modelId: string },
) {
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
  // override 优先：GUI 门控已判定过模型能力，这里必须尊重其结果。
  const providerConfig = await getProviderConfigForSelection(
    providersRow?.value ? JSON.parse(providersRow.value) : undefined,
    selectionRow?.value ? JSON.parse(selectionRow.value) : undefined,
    selectionOverride ?? delegatedModel,
  );
  if (providerConfig) {
    // 输出上限的优先级链（由 model-router 合成，这里只提供**兜底默认值**）：
    //   1. 模型级 requestOverrides.maxTokens（最高）
    //   2. Provider 级 requestOverrides.maxTokens
    //   3. 模型声明的 maxOutputTokens（收敛到 schema 上限）
    //   4. 常量兜底 MODEL_REQUEST_DEFAULT_MAX_TOKENS（与本地 INNER_DEFAULT_MAX_TOKENS 同值）
    // 即：用户配置的 maxTokens 本来就会生效，无需在此读取配置。
    const modelConfig = providerConfig.provider.defaultModels.find(
      (model) => model.id === providerConfig.modelId,
    );
    return {
      route: resolveModelRouteFromProvider(providerConfig.provider, providerConfig.modelId, {
        maxTokens: resolveInnerMaxTokens(modelConfig?.maxOutputTokens),
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
      // 无 Provider 配置可用 → 没有模型级 maxOutputTokens，只能走常量兜底。
      maxTokens: INNER_DEFAULT_MAX_TOKENS,
      variant: delegatedModel?.variant ?? managedLooker?.variant,
      systemPrompt,
      temperature: 0.2,
    }),
    providerId: delegatedModel?.providerId,
    modelId: fallbackModel,
  };
}

/**
 * 内层调用输出上限的**本地兜底常量**。
 *
 * 为什么不用 `model-router` 导出的常量：`look-at-*` 系列测试会 `vi.mock`
 * `../provider/model-router.js`，新增的具名导入会让 mock 缺字段而整体报错。
 * 为避免无谓地改动多个测试文件，这里保留本地副本；**数值漂移由测试守护**——
 * `look-at-inner-max-tokens.test.ts` 会断言本模块的收敛结果等于
 * `MODEL_REQUEST_MAX_TOKENS_CAP`，若上游改上限则该测试立刻失败。
 */
const INNER_MAX_TOKENS_CAP = 16_384;
const INNER_DEFAULT_MAX_TOKENS = 2_048;

/**
 * 内层调用（look_at / computer_use）的输出上限兜底值。
 *
 * 优先级链见 {@link resolveLookAtRoute}：**用户配置的 `requestOverrides.maxTokens`
 * 始终优先**，本函数只决定「都没配时用什么」——优先采用模型声明的
 * `maxOutputTokens`（按 schema 上限收敛），否则退回常量默认值。
 *
 * 收敛是必需的：模型声明的值（65536 / 131072 等）大于 `ModelRequest` 的
 * `maxTokens` 上限，直接传入会被 Zod 拒绝。
 */
export function resolveInnerMaxTokens(modelMaxOutputTokens?: number): number {
  if (
    typeof modelMaxOutputTokens === 'number' &&
    Number.isFinite(modelMaxOutputTokens) &&
    modelMaxOutputTokens > 0
  ) {
    return Math.min(Math.floor(modelMaxOutputTokens), INNER_MAX_TOKENS_CAP);
  }
  return INNER_DEFAULT_MAX_TOKENS;
}

/**
 * 通过 look_at 已解析出的路由发起一次多模态上游调用，返回模型原始文本。
 *
 * 该函数原本是 look_at 的内部实现；GUI Agent（`computer_use`）复用同一链路，
 * 因此对外导出（T-13）。相对 look_at 的单图调用，这里新增可选的
 * {@link RequestLookAtTextInput.imageDataUrls}，用于一次上送最近多张截图
 * （GUI 主循环的滑动窗口）。`imageDataUrl` 单图入参保持向后兼容。
 */
export async function requestLookAtText(input: {
  apiBaseUrl: string;
  apiKey: string;
  imageDataUrl?: string;
  /**
   * 多图上行（GUI 滑动窗口）。提供时优先于 {@link imageDataUrl}，
   * 每个元素都会作为一条 `media` 内容上送。
   */
  imageDataUrls?: readonly { readonly data: string; readonly mediaType: string }[];
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
  /**
   * 上游 token 用量回调（T-15）。
   *
   * `requestLookAtText` 原本只回传文本、丢弃 `RunUpstreamGenerateResult` 里的 usage，
   * 导致多模态链路（`look_at` / `computer_use`）的消耗不计入用户用量。
   * 这里以可选回调的形式把 usage 交回调用方，**不改变既有调用方的行为**。
   */
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }) => void;
}): Promise<string> {
  const imageParts: Message.ContentInput =
    input.imageDataUrls !== undefined && input.imageDataUrls.length > 0
      ? input.imageDataUrls.map((image) => ({
          type: 'media' as const,
          data: image.data,
          mediaType: image.mediaType,
        }))
      : input.imageDataUrl
        ? [{ type: 'media' as const, data: input.imageDataUrl, mediaType: input.mimeType }]
        : [];

  const userContent: Message.ContentInput = [
    { type: 'text', text: input.prompt },
    ...(input.textContent ? ([{ type: 'text', text: input.textContent }] as const) : imageParts),
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
  // T-15：把上游 usage 交回调用方（GUI 内循环跨多步聚合后入账）。
  input.onUsage?.({
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cacheReadTokens: result.cacheReadTokens,
    cacheWriteTokens: result.cacheWriteTokens,
  });
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
  offset?: number;
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
    userId: input.userId,
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
    const pdfText = await readPdfAsText(filePath);
    // 与文本文件同一套语义（行号 + 2000 行 / 50KB 上限 + 可执行的续读提示），
    // 避免旧实现「静默截断到 2 万字符、模型无从得知还有内容」。
    const readOutput = formatTextReadOutput({
      buffer: Buffer.from(pdfText, 'utf-8'),
      displayPath: filePath,
      ...(input.offset !== undefined ? { offset: input.offset } : {}),
    });
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
      textContent: `PDF text:\n${readOutput?.text ?? '（该 PDF 未提取到可读文本，可能是扫描件或纯图片页）'}`,
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
