// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpServerManager, type MCPServerEntry, type MCPServerStatus } from '../index.js';

const server = (patch: Partial<MCPServerEntry> = {}): MCPServerEntry => ({
  id: 'fs',
  name: 'filesystem',
  transport: 'stdio',
  command: 'mcp-server-fs',
  enabled: true,
  ...patch,
});

const status = (patch: Partial<MCPServerStatus> = {}): MCPServerStatus => ({
  id: 'fs',
  name: 'filesystem',
  status: 'connected',
  toolCount: 12,
  ...patch,
});

function renderManager(overrides: Partial<Parameters<typeof McpServerManager>[0]> = {}) {
  const props = {
    servers: [server()],
    statuses: [status()],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onUpdate: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  const view = render(<McpServerManager {...props} />);
  return { ...props, view };
}

afterEach(cleanup);

describe('McpServerManager', () => {
  it('单行展示配置 + 运行状态 + 工具数', () => {
    renderManager();

    expect(screen.getByText('filesystem')).toBeTruthy();
    expect(screen.getByText('fs')).toBeTruthy();
    expect(screen.getAllByText(/已连接/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/12 tools/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 个/)).toBeTruthy();
  });

  it('开关按下一态回传，并保持内置桥接脱敏', () => {
    const onUpdate = vi.fn();
    renderManager({
      servers: [
        server({
          id: 'codegraph',
          name: 'codegraph',
          builtin: true,
          builtinKind: 'virtual',
          source: 'builtin',
          url: 'https://fake.invalid/codegraph',
          command: 'openawork-virtual-codegraph',
        }),
      ],
      statuses: [],
      onUpdate,
    });

    fireEvent.click(screen.getByRole('switch', { name: '禁用 codegraph' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [id, patch] = onUpdate.mock.calls[0] as [string, MCPServerEntry];
    expect(id).toBe('codegraph');
    expect(patch.enabled).toBe(false);
    expect(patch).not.toHaveProperty('command');
    expect(patch).not.toHaveProperty('url');
  });

  it('状态为 pending 时重试按钮禁用', () => {
    const onRetry = vi.fn();
    renderManager({
      statuses: [status({ retryFeedback: { kind: 'pending' } })],
      onRetry,
    });

    const retry = screen.getByText('处理中…') as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('编辑展开行内字段（含 ID / 名称）并回传补丁', () => {
    const onUpdate = vi.fn<(id: string, entry: MCPServerEntry) => void>();
    renderManager({ onUpdate });

    fireEvent.click(screen.getByText('编辑'));
    const nameInput = screen.getByLabelText('MCP 名称') as HTMLInputElement;
    expect(nameInput.readOnly).toBe(false);
    fireEvent.change(nameInput, { target: { value: 'filesystem-2' } });
    expect(onUpdate).toHaveBeenCalled();
    const namePatch = onUpdate.mock.calls.at(-1)?.[1] as MCPServerEntry;
    expect(namePatch.name).toBe('filesystem-2');

    const disabledTools = screen.getByLabelText('禁用工具') as HTMLInputElement;
    fireEvent.change(disabledTools, { target: { value: 'fs_write, fs_delete' } });

    expect(onUpdate).toHaveBeenCalled();
    const patch = onUpdate.mock.calls.at(-1)?.[1] as MCPServerEntry;
    expect(patch.disabledTools).toEqual(['fs_write', 'fs_delete']);

    fireEvent.click(screen.getByText('完成'));
    expect(screen.queryByLabelText('禁用工具')).toBeNull();
  });

  it('内置项移除文案与二次确认', () => {
    const { onRemove } = renderManager({
      servers: [server({ builtin: true, source: 'builtin', id: 'omo', name: 'omo' })],
      statuses: [],
    });

    fireEvent.click(screen.getByText('禁用'));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('确认禁用'));
    expect(onRemove).toHaveBeenCalledWith('omo');
  });

  it('添加服务器表单可展开并回传 entry', () => {
    const onAdd = vi.fn<(entry: MCPServerEntry) => void>();
    renderManager({ onAdd });

    fireEvent.click(screen.getByText('+ 添加服务器'));
    fireEvent.change(screen.getByLabelText('服务器名称'), { target: { value: '新服务器' } });
    fireEvent.change(screen.getByLabelText('服务器 URL'), {
      target: { value: 'https://mcp.test/sse' },
    });
    fireEvent.click(screen.getByText('+ 确认添加'));

    expect(onAdd).toHaveBeenCalledTimes(1);
    const entry = onAdd.mock.calls[0]?.[0] as MCPServerEntry;
    expect(entry).toMatchObject({
      name: '新服务器',
      url: 'https://mcp.test/sse',
      transport: 'sse',
    });
  });

  it('空列表渲染提示文案', () => {
    renderManager({ servers: [], statuses: [] });
    expect(screen.getByText(/暂无服务器配置/)).toBeTruthy();
  });

  // 回归：`disabledTools` 会被目录侧隐藏（模型不应看到永远调不通的工具），
  // 所以 UI 必须把「运行状态里的已启用工具」与「配置里的已禁用工具名」合起来
  // 渲染，否则用户没有入口把工具改回来 —— 内置默认收口就成了单向操作。
  it('工具开关：已启用项可勾除，全部启用时显式写出空数组', () => {
    const onUpdate = vi.fn<(id: string, entry: MCPServerEntry) => void>();
    renderManager({
      servers: [server({ disabledTools: ['fs_delete'] })],
      statuses: [
        status({
          tools: [{ name: 'fs_read', description: '读取文件' }, { name: 'fs_write' }],
        }),
      ],
      onUpdate,
    });

    fireEvent.click(screen.getByText(/管理工具/));

    // 被禁用的工具只剩名字，且默认未勾选 → 勾选即从禁用列表移除（空数组 = 全部启用）。
    const remove = screen.getByRole('checkbox', { name: /fs_delete/ }) as HTMLInputElement;
    expect(remove.checked).toBe(false);
    fireEvent.click(remove);
    expect(onUpdate.mock.calls.at(-1)?.[1].disabledTools).toEqual([]);

    // 已启用工具默认勾选 → 取消勾选即写入禁用列表。
    const read = screen.getByRole('checkbox', { name: /fs_read/ }) as HTMLInputElement;
    expect(read.checked).toBe(true);
    fireEvent.click(read);
    expect(onUpdate.mock.calls.at(-1)?.[1].disabledTools).toEqual(['fs_delete', 'fs_read']);
  });

  it('同名同时出现在启用与禁用两处（矛盾数据）以禁用为准', () => {
    renderManager({
      servers: [server({ disabledTools: ['fs_write'] })],
      statuses: [status({ tools: [{ name: 'fs_write' }] })],
      onUpdate: vi.fn(),
    });

    fireEvent.click(screen.getByText(/管理工具/));

    // 执行侧会拒绝该工具，UI 不能显示成「已启用」。
    const write = screen.getByRole('checkbox', { name: /fs_write/ }) as HTMLInputElement;
    expect(write.checked).toBe(false);
  });

  it('工具开关保持内置桥接脱敏，并在无工具信息时隐藏', () => {
    const onUpdate = vi.fn();
    renderManager({
      servers: [
        server({
          id: 'open_websearch',
          name: 'Open WebSearch',
          builtin: true,
          builtinKind: 'adapter',
          source: 'builtin',
          command: 'openawork-virtual-open-websearch',
          url: 'https://fake.invalid/open-websearch',
          disabledTools: ['search'],
        }),
      ],
      statuses: [status({ id: 'open_websearch', tools: [{ name: 'fetch_web' }] })],
      onUpdate,
    });

    fireEvent.click(screen.getByText(/管理工具/));
    fireEvent.click(screen.getByRole('checkbox', { name: /search/ }));

    const patch = onUpdate.mock.calls.at(-1)?.[1] as MCPServerEntry;
    expect(patch.disabledTools).toEqual([]);
    expect(patch).not.toHaveProperty('command');
    expect(patch).not.toHaveProperty('url');
  });

  it('无 onUpdate 时不渲染工具开关（只读场景）', () => {
    renderManager({
      servers: [server({ disabledTools: ['fs_write'] })],
      statuses: [status({ tools: [{ name: 'fs_read' }] })],
      onUpdate: undefined,
    });

    expect(screen.queryByText(/管理工具/)).toBeNull();
  });
});
