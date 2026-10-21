import { release } from 'node:os';
import process from 'node:process';
import rootPackageJson from '../../../../../package.json' with { type: 'json' };
import { Clock, Duration, Effect, Stream } from 'effect';
import type { HttpClientRequest } from 'effect/http';
import { Headers } from 'effect/http';
import { Auth } from '../auth.js';
import { render as renderEndpoint } from '../endpoint.js';
import type { HttpMiddleware } from '../executor.js';
import { Framing, type Framing as FramingDef } from '../framing.js';
import type { Transport, TransportPrepareInput } from './index.js';
import * as ProviderShared from '../../protocols/shared.js';
import { httpStreamError } from './stream-error.js';
import {
  DEFAULT_CHUNK_TIMEOUT_MS,
  DEFAULT_HTTP_TIMEOUT_MS,
  LLMError,
  TransportReason,
  type HttpTimeout,
  type TransportOperation,
  mergeJsonRecords,
  type LLMRequest,
} from '../../schema/index.js';

export type JsonRequestInput<Body> = TransportPrepareInput<Body>;

const SYSTEM_NAMES: Readonly<Record<string, string>> = {
  aix: 'AIX',
  android: 'Android',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
  linux: 'Linux',
  openbsd: 'OpenBSD',
  win32: 'Windows',
};

const ARCHITECTURE_NAMES: Readonly<Record<string, string>> = {
  arm: 'arm',
  arm64: 'arm64',
  ia32: 'x86',
  ppc: 'ppc',
  ppc64: 'ppc64',
  riscv64: 'riscv64',
  s390x: 's390x',
  x32: 'x32',
  x64: 'x64',
};

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const configuredVersion = process.env['OPENAWORK_APP_VERSION']?.trim();
const appVersion =
  configuredVersion !== undefined && VERSION_PATTERN.test(configuredVersion)
    ? configuredVersion
    : rootPackageJson.version;
const systemName = SYSTEM_NAMES[process.platform] ?? process.platform;
const systemVersion = release();
const architecture = ARCHITECTURE_NAMES[process.arch] ?? process.arch;

export const OPENAWORK_USER_AGENT = `OpenAWork/${appVersion} (${systemName} ${systemVersion}; ${architecture})`;

export interface JsonRequestParts<Body = unknown> {
  readonly url: string;
  readonly jsonBody: Body | Record<string, unknown>;
  readonly bodyText: string;
  readonly headers: Headers.Headers;
}

export interface HttpPrepared<Frame> {
  readonly request: HttpClientRequest.HttpClientRequest;
  readonly framing: FramingDef<Frame>;
  /** 每次调用可带一个拦截器（`StreamOptions.http`），在状态码分类前拿到原始响应。 */
  readonly middleware?: HttpMiddleware;
}

const applyQuery = (url: string, query: Record<string, string> | undefined) => {
  if (!query) return url;
  const next = new URL(url);
  Object.entries(query).forEach(([key, value]) => next.searchParams.set(key, value));
  return next.toString();
};

const PROTOCOL_BODY_OVERLAY_DENYLIST = new Set([
  'content',
  'contents',
  'frequencyPenalty',
  'frequency_penalty',
  'generationConfig',
  'inferenceConfig',
  'input',
  'maxTokens',
  'max_tokens',
  'messages',
  'model',
  'presencePenalty',
  'presence_penalty',
  'responseFormat',
  'response_format',
  'seed',
  'stop',
  'stopSequences',
  'stop_sequences',
  'stream',
  'streamOptions',
  'stream_options',
  'system',
  'systemInstruction',
  'system_instruction',
  'temperature',
  'thinking',
  'toolChoice',
  'toolConfig',
  'tool_choice',
  'tool_config',
  'tools',
  'topK',
  'topP',
  'top_k',
  'top_p',
]);

const forbiddenBodyOverlayKeys = (body: Record<string, unknown>) =>
  Object.keys(body).filter((key) => PROTOCOL_BODY_OVERLAY_DENYLIST.has(key));

const bodyWithOverlay = <Body>(
  body: Body,
  request: LLMRequest,
  encodeBody: (body: Body) => string,
) =>
  Effect.gen(function* () {
    if (request.http?.body === undefined) return { jsonBody: body, bodyText: encodeBody(body) };
    const forbiddenKeys = forbiddenBodyOverlayKeys(request.http.body);
    if (forbiddenKeys.length > 0)
      return yield* ProviderShared.invalidRequest(
        `http.body cannot overlay protocol-owned field(s): ${forbiddenKeys.join(', ')}`,
      );
    if (ProviderShared.isRecord(body)) {
      const overlay = ProviderShared.supportsAnthropicContextManagement(request)
        ? request.http.body
        : Object.fromEntries(
            Object.entries(request.http.body).filter(
              ([key]) => key !== 'context_management' && !key.startsWith('clear_'),
            ),
          );
      const overlaid = mergeJsonRecords(body, overlay) ?? {};
      return { jsonBody: overlaid, bodyText: ProviderShared.encodeJson(overlaid) };
    }
    return yield* ProviderShared.invalidRequest(
      'http.body can only overlay JSON object request bodies',
    );
  });

const stripContextManagementBeta = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.toLowerCase().startsWith('context-management'))
    .join(',');

const requestHeaders = <Body>(input: JsonRequestInput<Body>) => {
  const routeHeaders = input.headers?.({ request: input.request, body: input.body }) ?? {};
  const customHeaders = input.request.http?.headers ?? {};
  const routeBeta = routeHeaders['anthropic-beta'];
  const customBeta = customHeaders['anthropic-beta'];
  const beta =
    routeBeta === undefined
      ? customBeta
      : customBeta === undefined || customBeta === routeBeta
        ? routeBeta
        : `${customBeta},${routeBeta}`;
  const merged = {
    ...routeHeaders,
    ...customHeaders,
    ...(beta === undefined ? {} : { 'anthropic-beta': beta }),
  };
  if (ProviderShared.supportsAnthropicContextManagement(input.request)) return merged;
  return Object.fromEntries(
    Object.entries(merged).flatMap(([key, value]) => {
      if (key.toLowerCase() !== 'anthropic-beta') return [[key, value]];
      const sanitized = stripContextManagementBeta(value);
      return sanitized.length === 0 ? [] : [[key, sanitized]];
    }),
  );
};

export const jsonRequestParts = <Body>(input: JsonRequestInput<Body>) =>
  Effect.gen(function* () {
    const url = applyQuery(
      renderEndpoint(input.endpoint, { request: input.request, body: input.body }).toString(),
      input.request.http?.query,
    );
    const body = yield* bodyWithOverlay(input.body, input.request, input.encodeBody);
    const authenticatedHeaders = yield* Auth.toEffect(input.auth)({
      request: input.request,
      method: 'POST',
      url,
      body: body.bodyText,
      headers: Headers.fromInput(requestHeaders(input)),
    });
    const headers = Headers.set(authenticatedHeaders, 'user-agent', OPENAWORK_USER_AGENT);
    return { url, jsonBody: body.jsonBody, bodyText: body.bodyText, headers };
  });

export interface HttpJsonInput<_Body, Frame> {
  readonly framing: FramingDef<Frame>;
}

export type HttpJsonPatch<Body, Frame> = Partial<HttpJsonInput<Body, Frame>>;

export interface HttpJsonTransport<Body, Frame> extends Transport<
  Body,
  HttpPrepared<Frame>,
  Frame
> {
  readonly with: (patch: HttpJsonPatch<Body, Frame>) => HttpJsonTransport<Body, Frame>;
}

// `false` 显式关闭该超时；未设置时回落到上游默认值。
const timeoutDuration = (value: HttpTimeout | undefined, fallback: number) =>
  value === false ? Duration.infinity : Duration.millis(value ?? fallback);

const timeout = (message: string, url: string, operation: TransportOperation = 'request') =>
  new LLMError({
    module: 'HttpTransport',
    method: 'frames',
    reason: new TransportReason({
      kind: 'Timeout',
      message,
      url,
      transport: 'http',
      operation,
      code: 'Timeout',
    }),
  });

export const httpJson = <Body, Frame>(
  input: HttpJsonInput<Body, Frame>,
): HttpJsonTransport<Body, Frame> => ({
  id: 'http-json',
  with: (patch) => httpJson({ ...input, ...patch }),
  prepare: (prepareInput) =>
    jsonRequestParts({
      ...prepareInput,
    }).pipe(
      Effect.map((parts) => ({
        request: ProviderShared.jsonPost({
          url: parts.url,
          body: parts.bodyText,
          headers: parts.headers,
          encoding: prepareInput.request.http?.encoding,
        }),
        framing: input.framing,
        middleware: prepareInput.middleware,
      })),
    ),
  // 三档超时：响应头、相邻分片、整次请求。缺失任一层保护都会让「上游静默」
  // 表现为无限挂起而不是可诊断的失败——分片超时默认 15 分钟是因为部分上游
  // （如 DeepSeek）在长推理期间确实会长时间不产出数据。
  frames: (prepared, request, runtime) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const total = timeoutDuration(request.http?.timeout, DEFAULT_HTTP_TIMEOUT_MS);
        const started = yield* Clock.currentTimeMillis;
        const response = yield* runtime.http.execute(prepared.request, prepared.middleware).pipe(
          Effect.timeoutOrElse({
            duration: Duration.min(
              timeoutDuration(request.http?.headerTimeout, DEFAULT_HTTP_TIMEOUT_MS),
              total,
            ),
            orElse: () => timeout('Timed out waiting for response headers', prepared.request.url),
          }),
        );
        const elapsed = Duration.millis((yield* Clock.currentTimeMillis) - started);
        return prepared.framing.frame(
          response.stream.pipe(
            Stream.mapError((error) =>
              httpStreamError(`${request.model.provider}/${request.model.route.id}`, error),
            ),
            Stream.timeoutOrElse({
              duration: timeoutDuration(request.http?.chunkTimeout, DEFAULT_CHUNK_TIMEOUT_MS),
              orElse: () =>
                Stream.fail(
                  timeout('Timed out waiting for response data', prepared.request.url, 'read'),
                ),
            }),
            Stream.interruptWhen(
              Effect.sleep(Duration.subtract(total, elapsed)).pipe(
                Effect.andThen(() =>
                  Effect.fail(
                    timeout(
                      'Timed out waiting for the response to complete',
                      prepared.request.url,
                      'read',
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      }),
    ),
});

export const sseJson = {
  id: 'http-json/sse',
  with: <Body>() => httpJson<Body, string>({ framing: Framing.sse }),
} as const;
