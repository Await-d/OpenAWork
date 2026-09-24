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
});
