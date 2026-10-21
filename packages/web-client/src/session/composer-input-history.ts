import { HttpError } from './sessions.js';
import {
  extractJsonErrorMessage,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

/**
 * 输入框历史客户端（输入框按 ↑ / ↓ 调出的已提交文本）。
 *
 * 历史原先只活在浏览器 Zustand 内存里，刷新 / 换端即丢。迁到网关后本客户端是
 * 唯一读写通道——`apps/` 下不得直接 fetch 网关。
 *
 * 容量与去重由服务端裁决：`list` 返回旧 → 新顺序（末尾是最近一次提交），
 * `append` 返回落库后的全量列表，调用方直接覆盖本地缓存即可，不需要在两处
 * 各写一份「删到 50 条 / 相邻去重」的逻辑。
 */

export interface ComposerInputHistoryClient {
  /** 追加若干条已提交的输入，返回落库后的全量（旧 → 新，最多 50 条）。 */
  append(
    token: string,
    sessionId: string,
    entries: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<string[]>;
  /** 读取某会话的输入历史（旧 → 新）。 */
  list(token: string, sessionId: string, options?: { signal?: AbortSignal }): Promise<string[]>;
}

const ACTION_LIST = '读取输入历史';
const ACTION_APPEND = '写入输入历史';

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function buildActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标会话不存在，无法${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericFetchErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function readJsonOrThrow(response: Response, actionLabel: string): Promise<unknown> {
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as JsonErrorData | null;
    throw new HttpError(
      buildActionErrorMessage(actionLabel, response.status, data ?? undefined),
      response.status,
      data ?? undefined,
    );
  }
  return (await response.json().catch(() => null)) as unknown;
}

/**
 * 单条历史文本长度上限——与网关 `COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH` 对齐。
 *
 * 客户端提前截断而不是让网关 400：历史只影响上下键回填，一条超长文本不该让整批
 * 迁移失败（新会话建立时 pending 历史是批量写入的）。
 */
export const COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH = 200_000;

/** 一次追加允许携带的条数上限，与网关 `COMPOSER_INPUT_HISTORY_APPEND_MAX_ENTRIES` 对齐。 */
export const COMPOSER_INPUT_HISTORY_MAX_ENTRIES = 50;

/**
 * 收敛解析：单条脏数据不应让整个历史读取失败，但**整个字段缺失必须抛错**。
 *
 * 返回空数组会让调用方误以为「服务端确认没有历史」，进而在水合时清空本地缓存；
 * 抛错则走保留本地记录的降级路径。两者语义完全不同，不能合并。
 */
function toEntries(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function createComposerInputHistoryClient(gatewayUrl: string): ComposerInputHistoryClient {
  const base = (sessionId: string): string =>
    `${gatewayUrl}/sessions/${encodeURIComponent(sessionId)}/composer-input-history`;

  return {
    async list(token, sessionId, options) {
      try {
        const response = await fetchWithTimeout(base(sessionId), {
          method: 'GET',
          headers: authHeader(token),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_LIST)) as {
          entries?: unknown;
        } | null;
        const entries = toEntries(payload?.entries);
        if (entries === null) {
          throw new Error(`${ACTION_LIST}失败：网关未返回可识别的历史列表。`);
        }
        return entries;
      } catch (error) {
        throw normalizeError(ACTION_LIST, error);
      }
    },

    async append(token, sessionId, entries, options) {
      try {
        const payloadEntries = entries
          .slice(-COMPOSER_INPUT_HISTORY_MAX_ENTRIES)
          .map((text) => text.slice(0, COMPOSER_INPUT_HISTORY_TEXT_MAX_LENGTH));
        const response = await fetchWithTimeout(base(sessionId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader(token) },
          body: JSON.stringify({ entries: payloadEntries }),
          signal: options?.signal,
        });
        const payload = (await readJsonOrThrow(response, ACTION_APPEND)) as {
          entries?: unknown;
        } | null;
        const mergedEntries = toEntries(payload?.entries);
        if (mergedEntries === null) {
          throw new Error(`${ACTION_APPEND}失败：网关未返回可识别的历史列表。`);
        }
        return mergedEntries;
      } catch (error) {
        throw normalizeError(ACTION_APPEND, error);
      }
    },
  };
}
