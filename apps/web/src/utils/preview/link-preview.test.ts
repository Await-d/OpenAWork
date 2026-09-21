import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OPEN_LINK_PREVIEW_EVENT,
  isPreviewableLinkHref,
  requestLinkPreview,
  tryOpenLinkPreview,
} from './link-preview.js';
import type { OpenLinkPreviewRequest } from './link-preview.js';

interface AnchorClickOptions {
  readonly button?: number;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

const registeredListeners: Array<() => void> = [];

function addPreviewListener(listener: (event: Event) => void): void {
  window.addEventListener(OPEN_LINK_PREVIEW_EVENT, listener);
  registeredListeners.push(() => window.removeEventListener(OPEN_LINK_PREVIEW_EVENT, listener));
}

/**
 * 构造 React 合成点击事件的最小替身：被测逻辑只读取点击按钮、修饰键与 preventDefault，
 * 完整合成事件无法直接构造，因此在此集中完成一次类型转换。
 */
function createAnchorClickEvent(options: AnchorClickOptions = {}) {
  const preventDefault = vi.fn();
  const event = {
    button: options.button ?? 0,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    preventDefault,
  } as unknown as MouseEvent<HTMLAnchorElement>;

  return { event, preventDefault };
}

function readRequestedUrl(event: Event): string {
  return (event as CustomEvent<OpenLinkPreviewRequest>).detail.url;
}

afterEach(() => {
  while (registeredListeners.length > 0) {
    registeredListeners.pop()?.();
  }
  vi.restoreAllMocks();
});

describe('isPreviewableLinkHref', () => {
  it('http(s) 链接（含首尾空白）判定为可预览', () => {
    expect(isPreviewableLinkHref('https://example.com')).toBe(true);
    expect(isPreviewableLinkHref('http://localhost:3000')).toBe(true);
    expect(isPreviewableLinkHref('  https://example.com  ')).toBe(true);
  });

  it('空值、相对路径、mailto 与锚点判定为不可预览', () => {
    expect(isPreviewableLinkHref(undefined)).toBe(false);
    expect(isPreviewableLinkHref(null)).toBe(false);
    expect(isPreviewableLinkHref('')).toBe(false);
    expect(isPreviewableLinkHref('/home')).toBe(false);
    expect(isPreviewableLinkHref('mailto:a@b.com')).toBe(false);
    expect(isPreviewableLinkHref('#x')).toBe(false);
  });
});

describe('requestLinkPreview', () => {
  it('没有监听者时返回 false', () => {
    expect(requestLinkPreview('https://example.com')).toBe(false);
  });

  it('监听者调用 preventDefault 认领时返回 true 并投递 url', () => {
    const receivedUrls: string[] = [];
    addPreviewListener((event) => {
      receivedUrls.push(readRequestedUrl(event));
      event.preventDefault();
    });

    expect(requestLinkPreview('https://example.com')).toBe(true);
    expect(receivedUrls).toEqual(['https://example.com']);
  });

  it('监听者未认领时返回 false', () => {
    const listener = vi.fn();
    addPreviewListener(listener);

    expect(requestLinkPreview('https://example.com')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('tryOpenLinkPreview', () => {
  it('中键点击不派发预览请求，也不阻止默认行为', () => {
    const listener = vi.fn();
    addPreviewListener(listener);
    const { event, preventDefault } = createAnchorClickEvent({ button: 1 });

    tryOpenLinkPreview(event, 'https://example.com');

    expect(listener).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('按住修饰键点击不派发预览请求，也不阻止默认行为', () => {
    const listener = vi.fn();
    addPreviewListener(listener);
    const modifierClicks: Array<{ label: string; options: AnchorClickOptions }> = [
      { label: 'metaKey', options: { metaKey: true } },
      { label: 'ctrlKey', options: { ctrlKey: true } },
      { label: 'shiftKey', options: { shiftKey: true } },
      { label: 'altKey', options: { altKey: true } },
    ];

    for (const { label, options } of modifierClicks) {
      const { event, preventDefault } = createAnchorClickEvent(options);

      tryOpenLinkPreview(event, 'https://example.com');

      expect(preventDefault, label).not.toHaveBeenCalled();
    }

    expect(listener).not.toHaveBeenCalled();
  });

  it('非 http(s) 链接不派发预览请求，也不阻止默认行为', () => {
    const listener = vi.fn();
    addPreviewListener(listener);
    const nonPreviewableHrefs: Array<string | undefined> = [
      undefined,
      '',
      '/home',
      'mailto:a@b.com',
      '#x',
    ];

    for (const href of nonPreviewableHrefs) {
      const { event, preventDefault } = createAnchorClickEvent();

      tryOpenLinkPreview(event, href);

      expect(preventDefault, `href=${String(href)}`).not.toHaveBeenCalled();
    }

    expect(listener).not.toHaveBeenCalled();
  });

  it('普通左键点击可预览链接时派发请求并阻止默认行为', () => {
    const receivedUrls: string[] = [];
    addPreviewListener((event) => {
      receivedUrls.push(readRequestedUrl(event));
      event.preventDefault();
    });
    const { event, preventDefault } = createAnchorClickEvent();

    tryOpenLinkPreview(event, 'https://example.com');

    expect(receivedUrls).toEqual(['https://example.com']);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
