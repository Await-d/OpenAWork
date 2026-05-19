/**
 * `/desktop-automation/*` 客户端：启动 Playwright sidecar、导航、点击、输入、截图。
 *
 * Settings → Devtools 面板用 `getStatus` 渲染状态徽标，连接演示工具用其它动作。
 */

import { authHeader, expectJson, expectOk, jsonAuthHeaders } from '../gateway/http.js';

export interface DesktopAutomationStatus {
  enabled: boolean;
}

export interface DesktopAutomationScreenshotResult {
  screenshotBase64: string;
}

export interface DesktopAutomationClient {
  getStatus(token: string, options?: { signal?: AbortSignal }): Promise<DesktopAutomationStatus>;
  start(token: string, url?: string): Promise<void>;
  goto(token: string, url: string): Promise<void>;
  click(token: string, selector: string): Promise<void>;
  type(token: string, selector: string, text: string): Promise<void>;
  screenshot(token: string): Promise<DesktopAutomationScreenshotResult>;
}

export function createDesktopAutomationClient(baseUrl: string): DesktopAutomationClient {
  return {
    async getStatus(token, options) {
      const response = await fetch(`${baseUrl}/desktop-automation/status`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      return expectJson<DesktopAutomationStatus>(response, 'desktopAutomation.status');
    },

    async start(token, url) {
      const response = await fetch(`${baseUrl}/desktop-automation/start`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(url ? { url } : {}),
      });
      await expectOk(response, 'desktopAutomation.start');
    },

    async goto(token, url) {
      const response = await fetch(`${baseUrl}/desktop-automation/goto`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ url }),
      });
      await expectOk(response, 'desktopAutomation.goto');
    },

    async click(token, selector) {
      const response = await fetch(`${baseUrl}/desktop-automation/click`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ selector }),
      });
      await expectOk(response, 'desktopAutomation.click');
    },

    async type(token, selector, text) {
      const response = await fetch(`${baseUrl}/desktop-automation/type`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify({ selector, text }),
      });
      await expectOk(response, 'desktopAutomation.type');
    },

    async screenshot(token) {
      const response = await fetch(`${baseUrl}/desktop-automation/screenshot`, {
        method: 'POST',
        headers: authHeader(token),
      });
      return expectJson<DesktopAutomationScreenshotResult>(
        response,
        'desktopAutomation.screenshot',
      );
    },
  };
}
