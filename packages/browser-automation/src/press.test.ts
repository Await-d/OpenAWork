import { describe, expect, it, vi } from 'vitest';

import { DesktopBrowserAutomation, type TypeTextOptions } from './index.js';
import {
  InProcessDesktopProxyTransport,
  MobileBrowserAutomationProxy,
  type BrowserProxyCommand,
} from './proxy.js';

interface FakePage {
  press(selector: string, key: string, options?: TypeTextOptions): Promise<void>;
  keyboard: {
    press(key: string, options?: TypeTextOptions): Promise<void>;
  };
}

function createFakePage(): FakePage {
  return {
    press: vi.fn(async (_selector: string, _key: string, _options?: TypeTextOptions) => undefined),
    keyboard: {
      press: vi.fn(async (_key: string, _options?: TypeTextOptions) => undefined),
    },
  };
}

/**
 * 通过注入当前页替身来驱动 `press`，避免在单测中真实启动 Playwright 浏览器。
 */
function createAutomationWithPage(page: FakePage): DesktopBrowserAutomation {
  const automation = new DesktopBrowserAutomation();
  Object.assign(automation, {
    currentPageId: 'page-1',
    pageById: new Map<string, FakePage>([['page-1', page]]),
  });
  return automation;
}

describe('DesktopBrowserAutomation.press', () => {
  it('selector 缺省时调用 page.keyboard.press 执行全局按键', async () => {
    const page = createFakePage();
    const automation = createAutomationWithPage(page);

    await automation.press(undefined, 'l');

    expect(page.keyboard.press).toHaveBeenCalledWith('l', {});
    expect(page.press).not.toHaveBeenCalled();
  });

  it('selector 为空字符串时同样回退为全局按键', async () => {
    const page = createFakePage();
    const automation = createAutomationWithPage(page);

    await automation.press('', 'l');

    expect(page.keyboard.press).toHaveBeenCalledWith('l', {});
    expect(page.press).not.toHaveBeenCalled();
  });

  it('提供 selector 时保持元素级 page.press 行为并透传 options', async () => {
    const page = createFakePage();
    const automation = createAutomationWithPage(page);

    await automation.press('#query', 'Enter', { delay: 15 });

    expect(page.press).toHaveBeenCalledWith('#query', 'Enter', { delay: 15 });
    expect(page.keyboard.press).not.toHaveBeenCalled();
  });
});

describe('press 代理协议', () => {
  it('MobileBrowserAutomationProxy 在缺少 selector 时仍发出 press 命令', async () => {
    const commands: BrowserProxyCommand[] = [];
    const proxy = new MobileBrowserAutomationProxy({
      execute: async <T>(command: BrowserProxyCommand): Promise<T> => {
        commands.push(command);
        return undefined as T;
      },
    });

    await proxy.press(undefined, 'l');

    expect(commands).toEqual([
      { type: 'press', selector: undefined, key: 'l', options: undefined },
    ]);
  });

  it('InProcessDesktopProxyTransport 将缺少 selector 的 press 透传为全局按键', async () => {
    const page = createFakePage();
    const automation = createAutomationWithPage(page);
    const transport = new InProcessDesktopProxyTransport(automation);

    await transport.execute({ type: 'press', key: 'l' });

    expect(page.keyboard.press).toHaveBeenCalledWith('l', {});
    expect(page.press).not.toHaveBeenCalled();
  });
});
