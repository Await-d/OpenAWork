import { release } from 'node:os';
import process from 'node:process';
import rootPackageJson from '../../../../../package.json' with { type: 'json' };
import { Effect, Stream } from 'effect';
import { Headers } from 'effect/unstable/http';
import { Auth } from '../auth.js';
import { render as renderEndpoint } from '../endpoint.js';
import { Framing } from '../framing.js';
import * as ProviderShared from '../../protocols/shared.js';
import { mergeJsonRecords } from '../../schema/index.js';
const SYSTEM_NAMES = {
  aix: 'AIX',
  android: 'Android',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
  linux: 'Linux',
  openbsd: 'OpenBSD',
  win32: 'Windows',
};
const ARCHITECTURE_NAMES = {
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
const applyQuery = (url, query) => {
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
const forbiddenBodyOverlayKeys = (body) =>
  Object.keys(body).filter((key) => PROTOCOL_BODY_OVERLAY_DENYLIST.has(key));
const bodyWithOverlay = (body, request, encodeBody) =>
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
const stripContextManagementBeta = (value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.toLowerCase().startsWith('context-management'))
    .join(',');
const requestHeaders = (input) => {
  const routeHeaders = input.headers?.({ request: input.request }) ?? {};
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
export const jsonRequestParts = (input) =>
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
export const httpJson = (input) => ({
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
        }),
        framing: input.framing,
      })),
    ),
  frames: (prepared, request, runtime) =>
    Stream.unwrap(
      runtime.http
        .execute(prepared.request)
        .pipe(
          Effect.map((response) =>
            prepared.framing.frame(
              response.stream.pipe(
                Stream.mapError((error) =>
                  ProviderShared.eventError(
                    `${request.model.provider}/${request.model.route.id}`,
                    `Failed to read ${request.model.provider}/${request.model.route.id} stream`,
                    ProviderShared.errorText(error),
                  ),
                ),
              ),
            ),
          ),
        ),
    ),
});
export const sseJson = {
  id: 'http-json/sse',
  with: () => httpJson({ framing: Framing.sse }),
};
//# sourceMappingURL=http.js.map
