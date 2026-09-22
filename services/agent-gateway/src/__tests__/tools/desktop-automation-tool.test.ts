import { describe, expect, it, vi } from 'vitest';
import {
  desktopAutomationToolDefinition,
  type DesktopAutomationConsoleInput,
  type DesktopAutomationConsoleSnapshot,
  type DesktopAutomationElementMatch,
  type DesktopAutomationFrameInfo,
  type DesktopAutomationManager,
  type DesktopAutomationNetworkInput,
  type DesktopAutomationNetworkRequest,
  type DesktopAutomationNetworkSnapshot,
  runDesktopAutomationTool,
} from '../../tools/desktop-automation.js';

const SAMPLE_NETWORK_REQUEST: DesktopAutomationNetworkRequest = {
  id: 'req-1',
  method: 'POST',
  url: 'https://api.example.test/login',
  resourceType: 'fetch',
  status: 200,
  ok: true,
  startedAt: 1,
  durationMs: 12,
  failureText: null,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
};

class FakeDesktopAutomationManager implements DesktopAutomationManager {
  readonly status = vi.fn(async () => ({ enabled: true, started: true }));
  readonly start = vi.fn(async (_startUrl?: string) => {});
  readonly goto = vi.fn(async (_url: string) => {});
  readonly back = vi.fn(async () => {});
  readonly forward = vi.fn(async () => {});
  readonly reload = vi.fn(async () => {});
  readonly click = vi.fn(async (_selector: string) => {});
  readonly type = vi.fn(async (_selector: string, _text: string) => {});
  readonly press = vi.fn(async (_selector: string | undefined, _key: string) => {});
  readonly hover = vi.fn(async (_selector: string) => {});
  readonly check = vi.fn(async (_selector: string, _checked: boolean) => {});
  readonly select = vi.fn(
    async (_selector: string, _values: readonly string[]): Promise<string[]> => ['alpha'],
  );
  readonly find = vi.fn(
    async (_selector: string, _limit: number): Promise<DesktopAutomationElementMatch[]> => [
      {
        tag: 'button',
        id: 'save',
        text: '保存',
        visible: true,
        attributes: { type: 'button' },
      },
    ],
  );
  readonly frames = vi.fn(async (): Promise<DesktopAutomationFrameInfo[]> => [
    { index: 0, name: '', url: 'https://example.test/', isMain: true, parentIndex: null },
  ]);
  readonly evaluate = vi.fn(
    async (_script: string, _args?: readonly unknown[]): Promise<unknown> => ({ title: 'Ready' }),
  );
  readonly console = vi.fn(
    async (_input: DesktopAutomationConsoleInput): Promise<DesktopAutomationConsoleSnapshot> => ({
      messages: [{ level: 'error', text: 'boom', timestamp: 1 }],
      errors: [{ message: 'uncaught', timestamp: 2 }],
      truncated: false,
    }),
  );
  readonly network = vi.fn(
    async (_input: DesktopAutomationNetworkInput): Promise<DesktopAutomationNetworkSnapshot> => ({
      requests: [SAMPLE_NETWORK_REQUEST],
      truncated: false,
    }),
  );
  readonly networkRequest = vi.fn(
    async (_id: string): Promise<DesktopAutomationNetworkRequest | null> => SAMPLE_NETWORK_REQUEST,
  );
  readonly scroll = vi.fn(async (_direction: 'up' | 'down', _amount?: number) => {});
  readonly wait = vi.fn(async (_input: { readonly ms?: number; readonly selector?: string }) => {});
  readonly content = vi.fn(async () => '<html><body>ready</body></html>');
  readonly snapshot = vi.fn(async () => ({
    currentPageId: 'page-1',
    openPages: ['page-1'],
    title: 'Ready',
    url: 'https://example.test/',
  }));
  readonly screenshot = vi.fn(async () => 'base64-image');
}

describe('runDesktopAutomationTool', () => {
  it('执行滚动、等待、按键和内容读取动作', async () => {
    const manager = new FakeDesktopAutomationManager();

    await expect(
      runDesktopAutomationTool({ action: 'scroll', direction: 'down', amount: 480 }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'wait', selector: '#ready', ms: 1000 }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(
      runDesktopAutomationTool({ action: 'press', selector: '#search', key: 'Enter' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    await expect(runDesktopAutomationTool({ action: 'content' }, manager)).resolves.toBe(
      JSON.stringify({ content: '<html><body>ready</body></html>' }),
    );

    expect(manager.scroll).toHaveBeenCalledWith('down', 480);
    expect(manager.wait).toHaveBeenCalledWith({ selector: '#ready', ms: 1000 });
    expect(manager.press).toHaveBeenCalledWith('#search', 'Enter');
    expect(manager.content).toHaveBeenCalledOnce();
  });

  it('读取浏览器快照并保留页面元数据', async () => {
    const manager = new FakeDesktopAutomationManager();

    await expect(runDesktopAutomationTool({ action: 'snapshot' }, manager)).resolves.toBe(
      JSON.stringify({
        snapshot: {
          currentPageId: 'page-1',
          openPages: ['page-1'],
          title: 'Ready',
          url: 'https://example.test/',
        },
      }),
    );
  });

  it('press 输入允许省略 selector 并转发为全局按键', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({ action: 'press', key: 'l' });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({ ok: true }),
    );

    expect(manager.press).toHaveBeenCalledWith(undefined, 'l');
  });

  it('press 提供 selector 时仍转发元素级按键', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'press',
      selector: '#x',
      key: 'Enter',
    });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({ ok: true }),
    );

    expect(manager.press).toHaveBeenCalledWith('#x', 'Enter');
  });

  it('执行 hover / check / select / find / frames 检查类动作', async () => {
    const manager = new FakeDesktopAutomationManager();

    await expect(
      runDesktopAutomationTool({ action: 'hover', selector: '#menu' }, manager),
    ).resolves.toBe(JSON.stringify({ ok: true }));
    const checkInput = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'check',
      selector: '#agree',
    });
    await expect(runDesktopAutomationTool(checkInput, manager)).resolves.toBe(
      JSON.stringify({ ok: true }),
    );
    await expect(
      runDesktopAutomationTool({ action: 'select', selector: '#color', values: ['red'] }, manager),
    ).resolves.toBe(JSON.stringify({ selected: ['alpha'] }));
    const findInput = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'find',
      selector: '.row',
    });
    await expect(runDesktopAutomationTool(findInput, manager)).resolves.toBe(
      JSON.stringify({
        matches: [
          {
            tag: 'button',
            id: 'save',
            text: '保存',
            visible: true,
            attributes: { type: 'button' },
          },
        ],
      }),
    );
    await expect(runDesktopAutomationTool({ action: 'frames' }, manager)).resolves.toBe(
      JSON.stringify({
        frames: [
          { index: 0, name: '', url: 'https://example.test/', isMain: true, parentIndex: null },
        ],
      }),
    );

    expect(manager.hover).toHaveBeenCalledWith('#menu');
    expect(manager.check).toHaveBeenCalledWith('#agree', true);
    expect(manager.select).toHaveBeenCalledWith('#color', ['red']);
    expect(manager.find).toHaveBeenCalledWith('.row', 20);
    expect(manager.frames).toHaveBeenCalledOnce();
  });

  it('check 传 checked=false 时转发为取消勾选', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'check',
      selector: '#agree',
      checked: false,
    });

    await runDesktopAutomationTool(parsed, manager);

    expect(manager.check).toHaveBeenCalledWith('#agree', false);
  });

  it('evaluate 透传脚本与参数并返回 JSON 可序列化结果', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'evaluate',
      script: '(name) => ({ title: document.title, name })',
      args: ['demo'],
    });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({ result: { title: 'Ready' } }),
    );

    expect(manager.evaluate).toHaveBeenCalledWith('(name) => ({ title: document.title, name })', [
      'demo',
    ]);
  });

  it('evaluate 结果为 undefined 时归一为 null', async () => {
    const manager = new FakeDesktopAutomationManager();
    manager.evaluate.mockResolvedValueOnce(undefined);

    await expect(
      runDesktopAutomationTool({ action: 'evaluate', script: '() => undefined' }, manager),
    ).resolves.toBe(JSON.stringify({ result: null }));
  });

  it('evaluate 输入校验拒绝空脚本、超长脚本与超量参数', () => {
    const schema = desktopAutomationToolDefinition.inputSchema;

    expect(schema.safeParse({ action: 'evaluate', script: '' }).success).toBe(false);
    expect(schema.safeParse({ action: 'evaluate', script: 'x'.repeat(20001) }).success).toBe(false);
    expect(
      schema.safeParse({
        action: 'evaluate',
        script: '() => 1',
        args: Array.from({ length: 21 }, (_value, index) => index),
      }).success,
    ).toBe(false);
  });

  it('console 返回有界消息与未捕获错误，并透传过滤参数', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'console',
      level: 'error',
      limit: 5,
      clear: true,
    });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({
        messages: [{ level: 'error', text: 'boom', timestamp: 1 }],
        errors: [{ message: 'uncaught', timestamp: 2 }],
        truncated: false,
      }),
    );

    expect(manager.console).toHaveBeenCalledWith({ level: 'error', limit: 5, clear: true });
  });

  it('console 的 limit 缺省为 50，且拒绝越界与非法级别', () => {
    const schema = desktopAutomationToolDefinition.inputSchema;

    expect(schema.parse({ action: 'console' })).toMatchObject({ limit: 50, clear: false });
    expect(schema.safeParse({ action: 'console', limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ action: 'console', limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ action: 'console', level: 'trace' }).success).toBe(false);
  });

  it('select / find 的输入校验拒绝空数组与越界 limit', () => {
    const schema = desktopAutomationToolDefinition.inputSchema;

    expect(schema.safeParse({ action: 'select', selector: '#color', values: [] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ action: 'find', selector: '.row', limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ action: 'find', selector: '' }).success).toBe(false);
  });

  it('network_list 透传过滤参数并返回有界请求列表', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'network_list',
      urlContains: '/login',
      method: 'post',
      limit: 5,
    });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({ requests: [SAMPLE_NETWORK_REQUEST], truncated: false }),
    );

    expect(manager.network).toHaveBeenCalledWith({
      urlContains: '/login',
      method: 'post',
      limit: 5,
    });
  });

  it('network_list 的 limit 缺省为 50，且拒绝越界与空过滤值', () => {
    const schema = desktopAutomationToolDefinition.inputSchema;

    expect(schema.parse({ action: 'network_list' })).toMatchObject({ limit: 50 });
    expect(schema.safeParse({ action: 'network_list', limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ action: 'network_list', limit: 201 }).success).toBe(false);
    expect(schema.safeParse({ action: 'network_list', urlContains: '' }).success).toBe(false);
  });

  it('network_get 按 requestId 返回单条详情', async () => {
    const manager = new FakeDesktopAutomationManager();
    const parsed = desktopAutomationToolDefinition.inputSchema.parse({
      action: 'network_get',
      requestId: 'req-1',
    });

    await expect(runDesktopAutomationTool(parsed, manager)).resolves.toBe(
      JSON.stringify({ request: SAMPLE_NETWORK_REQUEST }),
    );

    expect(manager.networkRequest).toHaveBeenCalledWith('req-1');
  });

  it('network_get 未命中时抛出明确错误，且拒绝空 requestId', async () => {
    const manager = new FakeDesktopAutomationManager();
    manager.networkRequest.mockResolvedValueOnce(null);

    await expect(
      runDesktopAutomationTool({ action: 'network_get', requestId: 'req-404' }, manager),
    ).rejects.toThrow(/未找到网络请求：req-404/);

    const schema = desktopAutomationToolDefinition.inputSchema;
    expect(schema.safeParse({ action: 'network_get', requestId: '' }).success).toBe(false);
    expect(schema.safeParse({ action: 'network_get' }).success).toBe(false);
  });
});
