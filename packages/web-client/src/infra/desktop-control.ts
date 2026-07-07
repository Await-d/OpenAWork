import {
  authHeader,
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  jsonAuthHeaders,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

export interface DesktopControlStatus {
  readonly enabled: boolean;
  readonly reason?: string;
  readonly capabilities?: DesktopControlCapabilities;
}

export interface DesktopControlCapability {
  readonly available: boolean;
  readonly driver?: string;
  readonly reason?: string;
}

export interface DesktopControlCapabilities {
  readonly screenshot: DesktopControlCapability;
  readonly click: DesktopControlCapability;
  readonly typeText: DesktopControlCapability;
  readonly key: DesktopControlCapability;
  readonly hotkey: DesktopControlCapability;
  readonly scroll: DesktopControlCapability;
  readonly wait: DesktopControlCapability;
}

export type DesktopControlMouseButton = 'left' | 'right' | 'middle';
export type DesktopControlClickAction = 'click' | 'double_click' | 'down' | 'up';
export type DesktopControlActionResult = Readonly<Record<string, unknown>>;

export interface DesktopControlScreenshotInput {
  readonly delayMs?: number;
}

export interface DesktopControlClickInput {
  readonly x: number;
  readonly y: number;
  readonly button?: DesktopControlMouseButton;
  readonly clickAction?: DesktopControlClickAction;
}

export interface DesktopControlTypeInput {
  readonly text: string;
}

export interface DesktopControlKeyInput {
  readonly key: string;
}

export interface DesktopControlHotkeyInput {
  readonly keys: readonly string[];
}

export interface DesktopControlScrollInput {
  readonly x?: number;
  readonly y?: number;
  readonly scrollX?: number;
  readonly scrollY?: number;
}

export interface DesktopControlWaitInput {
  readonly ms?: number;
}

export interface DesktopControlClient {
  getStatus(token: string, options?: { signal?: AbortSignal }): Promise<DesktopControlStatus>;
  screenshot(
    token: string,
    input?: DesktopControlScreenshotInput,
  ): Promise<DesktopControlActionResult>;
  click(token: string, input: DesktopControlClickInput): Promise<DesktopControlActionResult>;
  type(token: string, input: DesktopControlTypeInput): Promise<DesktopControlActionResult>;
  key(token: string, input: DesktopControlKeyInput): Promise<DesktopControlActionResult>;
  hotkey(token: string, input: DesktopControlHotkeyInput): Promise<DesktopControlActionResult>;
  scroll(token: string, input: DesktopControlScrollInput): Promise<DesktopControlActionResult>;
  wait(token: string, input?: DesktopControlWaitInput): Promise<DesktopControlActionResult>;
}

function buildDesktopControlActionErrorMessage(
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
    return `目标系统桌面控制资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function normalizeDesktopControlError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
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

async function performDesktopControlRequest<T>(input: {
  readonly actionLabel: string;
  readonly request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildDesktopControlActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeDesktopControlError(input.actionLabel, error);
  }
}

async function performDesktopControlAction(
  actionLabel: string,
  request: () => Promise<Response>,
): Promise<DesktopControlActionResult> {
  const data = await performDesktopControlRequest<{ result: DesktopControlActionResult }>({
    actionLabel,
    request,
  });
  return data.result;
}

export function createDesktopControlClient(baseUrl: string): DesktopControlClient {
  return {
    async getStatus(token, options) {
      return performDesktopControlRequest<DesktopControlStatus>({
        actionLabel: '读取系统桌面控制状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-control/status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async screenshot(token, input = {}) {
      return performDesktopControlAction('获取系统桌面截图', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/screenshot`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async click(token, input) {
      return performDesktopControlAction('执行系统桌面点击', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/click`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async type(token, input) {
      return performDesktopControlAction('执行系统桌面文本输入', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/type`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async key(token, input) {
      return performDesktopControlAction('执行系统桌面按键', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/key`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async hotkey(token, input) {
      return performDesktopControlAction('执行系统桌面组合键', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/hotkey`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async scroll(token, input) {
      return performDesktopControlAction('执行系统桌面滚动', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/scroll`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },

    async wait(token, input = {}) {
      return performDesktopControlAction('等待系统桌面状态', () =>
        fetchWithTimeout(`${baseUrl}/desktop-control/wait`, {
          method: 'POST',
          headers: jsonAuthHeaders(token),
          body: JSON.stringify(input),
        }),
      );
    },
  };
}
