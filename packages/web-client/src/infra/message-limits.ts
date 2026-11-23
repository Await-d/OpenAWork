import {
  authHeader,
  jsonAuthHeaders,
  expectJson,
  fetchWithTimeout,
  HttpError,
} from '../gateway/http.js';

export interface MessageLimitsSnapshot {
  maxChars: number;
  minChars: 1024;
  hardMaxChars: 200000;
  defaultMaxChars: 32768;
  canEdit: boolean;
}

export interface MessageLimitsClient {
  read(token: string, options?: { signal?: AbortSignal }): Promise<MessageLimitsSnapshot>;
  write(
    token: string,
    maxChars: number,
    options?: { signal?: AbortSignal },
  ): Promise<MessageLimitsSnapshot>;
}

function parseSnapshot(value: unknown): MessageLimitsSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new HttpError('消息字符上限响应格式无效。', 502, value);
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row['maxChars'] !== 'number' ||
    !Number.isInteger(row['maxChars']) ||
    row['maxChars'] < 1024 ||
    row['maxChars'] > 200000 ||
    row['minChars'] !== 1024 ||
    row['hardMaxChars'] !== 200000 ||
    row['defaultMaxChars'] !== 32768 ||
    typeof row['canEdit'] !== 'boolean'
  ) {
    throw new HttpError('消息字符上限响应格式无效。', 502, value);
  }
  return {
    maxChars: row['maxChars'],
    minChars: 1024,
    hardMaxChars: 200000,
    defaultMaxChars: 32768,
    canEdit: row['canEdit'],
  };
}

export function createMessageLimitsClient(gatewayUrl: string): MessageLimitsClient {
  const url = `${gatewayUrl.replace(/\/$/, '')}/settings/message-limits`;
  return {
    async read(token, options) {
      const response = await fetchWithTimeout(url, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return parseSnapshot(await expectJson<unknown>(response, '读取消息字符上限'));
    },
    async write(token, maxChars, options) {
      const response = await fetchWithTimeout(url, {
        method: 'PUT',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ maxChars }),
        signal: options?.signal,
      });
      return parseSnapshot(await expectJson<unknown>(response, '保存消息字符上限'));
    },
  };
}
