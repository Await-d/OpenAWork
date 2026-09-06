// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuiltInBrowser } from './BuiltInBrowser.js';

const STORAGE_KEY_PREFIX = 'openawork:builtin-browser:tabs:v1';
const LEGACY_DEFAULT_URL = 'http://localhost:3000';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('BuiltInBrowser', () => {
  it('以空白页作为新标签页，避免请求只提供 API 的网关根路径', () => {
    render(<BuiltInBrowser workspacePath="E:\\01.Projects\\OpenAWork" />);

    expect(screen.getByTitle('内置浏览器').getAttribute('src')).toBe('about:blank');
  });

  it('将已持久化的旧网关默认页迁移为空白页', () => {
    const workspacePath = 'E:\\01.Projects\\OpenAWork';
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}:${workspacePath}`,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'legacy-tab',
            url: LEGACY_DEFAULT_URL,
            title: 'localhost:3000',
            history: [LEGACY_DEFAULT_URL],
            historyIndex: 0,
          },
        ],
        activeTabId: 'legacy-tab',
      }),
    );

    render(<BuiltInBrowser workspacePath={workspacePath} />);

    expect(screen.getByTitle('内置浏览器').getAttribute('src')).toBe('about:blank');
    expect(screen.getByDisplayValue('about:blank')).toBeTruthy();
  });
});
