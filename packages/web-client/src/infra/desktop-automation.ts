/**
 * `/desktop-automation/*` 客户端：启动 Playwright sidecar，执行页面导航、输入、
 * 滚动、等待、内容读取与截图。
 *
 * Settings → Devtools 面板用 `getStatus` 渲染状态徽标，连接演示工具用其它动作。
 */

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

export interface DesktopAutomationStatus {
  readonly enabled: boolean;
  readonly started: boolean;
}

export interface DesktopAutomationScreenshotResult {
  readonly screenshotBase64: string;
}

export type DesktopAutomationScrollDirection = 'up' | 'down';

export interface DesktopAutomationWaitInput {
  readonly ms?: number;
  readonly selector?: string;
}

export interface DesktopAutomationSnapshot {
  readonly currentPageId: string;
  readonly openPages: readonly string[];
  readonly url: string;
  readonly title: string;
}

export interface DesktopAutomationContentResult {
  readonly content: string;
}

export interface DesktopAutomationSnapshotResult {
  readonly snapshot: DesktopAutomationSnapshot;
}

export interface DesktopAutomationClient {
  getStatus(token: string, options?: { signal?: AbortSignal }): Promise<DesktopAutomationStatus>;
  start(token: string, url?: string): Promise<void>;
  goto(token: string, url: string): Promise<void>;
  back(token: string): Promise<void>;
  forward(token: string): Promise<void>;
  reload(token: string): Promise<void>;
  click(token: string, selector: string): Promise<void>;
  type(token: string, selector: string, text: string): Promise<void>;
  press(token: string, selector: string, key: string): Promise<void>;
  scroll(
    token: string,
    direction?: DesktopAutomationScrollDirection,
    amount?: number,
  ): Promise<void>;
  wait(token: string, input: DesktopAutomationWaitInput): Promise<void>;
  content(token: string): Promise<DesktopAutomationContentResult>;
  snapshot(token: string): Promise<DesktopAutomationSnapshotResult>;
  screenshot(token: string): Promise<DesktopAutomationScreenshotResult>;
}

function buildDesktopAutomationActionErrorMessage(
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
    return `目标桌面自动化资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericDesktopAutomationNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeDesktopAutomationError(actionLabel: string, error: unknown): Error {
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
    if (message.length > 0 && !isGenericDesktopAutomationNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performDesktopAutomationRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildDesktopAutomationActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeDesktopAutomationError(input.actionLabel, error);
  }
}

export function createDesktopAutomationClient(baseUrl: string): DesktopAutomationClient {
  return {
    async getStatus(token, options) {
      return performDesktopAutomationRequest<DesktopAutomationStatus>({
        actionLabel: '读取桌面自动化状态',
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/status`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
    },

    async start(token, url) {
      await performDesktopAutomationRequest({
        actionLabel: '启动桌面自动化',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/start`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(url ? { url } : {}),
          }),
      });
    },

    async goto(token, url) {
      await performDesktopAutomationRequest({
        actionLabel: '导航桌面自动化页面',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/goto`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ url }),
          }),
      });
    },

    async back(token) {
      await performDesktopAutomationRequest({
        actionLabel: '返回上一页',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/back`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async forward(token) {
      await performDesktopAutomationRequest({
        actionLabel: '前进到下一页',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/forward`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async reload(token) {
      await performDesktopAutomationRequest({
        actionLabel: '刷新桌面自动化页面',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/reload`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async click(token, selector) {
      await performDesktopAutomationRequest({
        actionLabel: '执行桌面自动化点击',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/click`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ selector }),
          }),
      });
    },

    async type(token, selector, text) {
      await performDesktopAutomationRequest({
        actionLabel: '执行桌面自动化输入',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/type`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ selector, text }),
          }),
      });
    },

    async press(token, selector, key) {
      await performDesktopAutomationRequest({
        actionLabel: '执行桌面自动化按键',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/press`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ selector, key }),
          }),
      });
    },

    async scroll(token, direction = 'down', amount) {
      await performDesktopAutomationRequest({
        actionLabel: '执行桌面自动化滚动',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/scroll`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify({ direction, amount }),
          }),
      });
    },

    async wait(token, input) {
      await performDesktopAutomationRequest({
        actionLabel: '等待桌面自动化页面',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/wait`, {
            method: 'POST',
            headers: jsonAuthHeaders(token),
            body: JSON.stringify(input),
          }),
      });
    },

    async content(token) {
      return performDesktopAutomationRequest<DesktopAutomationContentResult>({
        actionLabel: '读取桌面自动化页面内容',
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/content`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async snapshot(token) {
      return performDesktopAutomationRequest<DesktopAutomationSnapshotResult>({
        actionLabel: '读取桌面自动化页面快照',
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/snapshot`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async screenshot(token) {
      return performDesktopAutomationRequest<DesktopAutomationScreenshotResult>({
        actionLabel: '获取桌面自动化截图',
        request: () =>
          fetchWithTimeout(`${baseUrl}/desktop-automation/screenshot`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },
  };
}
