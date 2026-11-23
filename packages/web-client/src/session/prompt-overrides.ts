/**
 * 对话模式提示词覆盖客户端。
 *
 * 网关契约：
 *   - `GET  /prompt-overrides`：返回 { modes, maxChars, configState }
 *   - `PUT  /prompt-overrides/dialogue-modes/:mode`：body { text }
 *   - `POST /prompt-overrides/dialogue-modes/:mode/reset`
 *
 * 响应一律做运行时校验（不信任 wire）：字段缺失时回落到安全默认值，
 * 而不是把 `undefined` 透给 UI 造成渲染崩溃。
 */
import type { DialogueMode } from '@openAwork/shared';
import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface DialogueModePromptView {
  mode: DialogueMode;
  /** 当前版本的默认提示词（编辑起点 / 恢复默认的结果）。 */
  defaultText: string;
  /** 实际注入的文本（有覆盖取覆盖，否则等于默认）。 */
  effectiveText: string;
  hasOverride: boolean;
}

export interface PromptOverrideSnapshot {
  modes: DialogueModePromptView[];
  maxChars: number;
  /** `corrupt` 表示网关侧配置不可解析（已回落默认，需用户重置）。 */
  configState: 'ok' | 'corrupt';
}

export interface PromptOverridesClient {
  read(token: string, options?: { signal?: AbortSignal }): Promise<PromptOverrideSnapshot>;
  writeDialogueMode(
    token: string,
    mode: DialogueMode,
    text: string,
    options?: { signal?: AbortSignal },
  ): Promise<DialogueModePromptView>;
  resetDialogueMode(
    token: string,
    mode: DialogueMode,
    options?: { signal?: AbortSignal },
  ): Promise<DialogueModePromptView>;
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function toDialogueMode(value: unknown): DialogueMode | null {
  return value === 'clarify' || value === 'coding' || value === 'programmer' ? value : null;
}

function parseModeView(value: unknown): DialogueModePromptView | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const mode = toDialogueMode(record['mode']);
  if (mode === null) {
    return null;
  }
  const defaultText = typeof record['defaultText'] === 'string' ? record['defaultText'] : '';
  return {
    mode,
    defaultText,
    effectiveText:
      typeof record['effectiveText'] === 'string' ? record['effectiveText'] : defaultText,
    hasOverride: record['hasOverride'] === true,
  };
}

function parseSnapshot(value: unknown): PromptOverrideSnapshot {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const rawModes = Array.isArray(record['modes']) ? record['modes'] : [];
  const modes = rawModes
    .map((entry) => parseModeView(entry))
    .filter((view): view is DialogueModePromptView => view !== null);
  const maxChars = typeof record['maxChars'] === 'number' ? record['maxChars'] : 0;
  return {
    modes,
    maxChars,
    configState: record['configState'] === 'corrupt' ? 'corrupt' : 'ok',
  };
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

async function requireOk(res: Response, actionLabel: string): Promise<unknown> {
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as JsonErrorData | null;
    const extracted = extractJsonErrorMessage(data ?? undefined);
    throw new HttpError(
      extracted ?? `${actionLabel}失败（HTTP ${res.status}）。`,
      res.status,
      data ?? undefined,
    );
  }
  return res.json().catch(() => null);
}

export function createPromptOverridesClient(gatewayUrl: string): PromptOverridesClient {
  return {
    async read(token, options) {
      try {
        const res = await fetchWithTimeout(`${gatewayUrl}/prompt-overrides`, {
          method: 'GET',
          headers: { ...authHeader(token) },
          signal: options?.signal,
        });
        return parseSnapshot(await requireOk(res, '加载模式提示词配置'));
      } catch (error) {
        throw normalizeError('加载模式提示词配置', error);
      }
    },

    async writeDialogueMode(token, mode, text, options) {
      try {
        const res = await fetchWithTimeout(
          `${gatewayUrl}/prompt-overrides/dialogue-modes/${encodeURIComponent(mode)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeader(token) },
            body: JSON.stringify({ text }),
            signal: options?.signal,
          },
        );
        const payload = (await requireOk(res, '保存模式提示词')) as {
          promptOverride?: unknown;
        } | null;
        const view = parseModeView(payload?.promptOverride);
        if (!view) {
          throw new Error('保存模式提示词失败：网关返回格式异常。');
        }
        return view;
      } catch (error) {
        throw normalizeError('保存模式提示词', error);
      }
    },

    async resetDialogueMode(token, mode, options) {
      try {
        const res = await fetchWithTimeout(
          `${gatewayUrl}/prompt-overrides/dialogue-modes/${encodeURIComponent(mode)}/reset`,
          {
            method: 'POST',
            headers: { ...authHeader(token) },
            signal: options?.signal,
          },
        );
        const payload = (await requireOk(res, '恢复模式提示词默认值')) as {
          promptOverride?: unknown;
        } | null;
        const view = parseModeView(payload?.promptOverride);
        if (!view) {
          throw new Error('恢复模式提示词默认值失败：网关返回格式异常。');
        }
        return view;
      } catch (error) {
        throw normalizeError('恢复模式提示词默认值', error);
      }
    },
  };
}
