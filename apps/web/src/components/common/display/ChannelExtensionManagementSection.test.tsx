// @vitest-environment jsdom
/**
 * 渠道「会话级扩展管理」开关（规格 :34）。
 *
 * 关注点是**确认前不切换**：开启会让渠道会话不再继承用户级技能 / MCP，是个有后果的
 * 动作，所以勾选必须先进待确认态，且取消不得改动草稿。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelExtensionManagementSection,
  type ChannelExtensionImpact,
} from './ChannelExtensionManagementSection.js';

afterEach(cleanup);

function renderSection(
  overrides: {
    value?: boolean;
    loadImpact?: () => Promise<ChannelExtensionImpact>;
  } = {},
) {
  const onChange = vi.fn();
  render(
    <ChannelExtensionManagementSection
      value={overrides.value ?? false}
      {...(overrides.loadImpact ? { loadImpact: overrides.loadImpact } : {})}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('渠道会话级扩展管理开关', () => {
  it('开启先进待确认态，取消不改动草稿', async () => {
    const loadImpact = vi.fn().mockResolvedValue({ mcpServers: [], skills: [] });
    const { onChange } = renderSection({ loadImpact });

    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText('确认开启')).toBeTruthy());
    // 关键：还没确认，草稿不能被改。
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('取消'));
    await waitFor(() => expect(screen.getByText('开启会话级扩展管理')).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('确认后才写入，并且只写一次', async () => {
    const { onChange } = renderSection({
      loadImpact: async () => ({ mcpServers: [], skills: [] }),
    });

    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText('确认开启')).toBeTruthy());
    fireEvent.click(screen.getByText('确认开启'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('列出将不再继承的用户级 MCP 与技能', async () => {
    renderSection({
      loadImpact: async () => ({
        mcpServers: ['figma-mcp', 'db-mcp'],
        skills: ['pdf-tools'],
      }),
    });

    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText('将不再继承以下 3 项：')).toBeTruthy());
    expect(screen.getByText(/figma-mcp、db-mcp/)).toBeTruthy();
    expect(screen.getByText(/pdf-tools/)).toBeTruthy();
  });

  it('没有用户级配置时如实说明开启不会减少能力', async () => {
    renderSection({ loadImpact: async () => ({ mcpServers: [], skills: [] }) });
    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText(/你当前没有用户级技能或 MCP/)).toBeTruthy());
  });

  it('读不到影响清单时不阻断确认，但如实说出读不到', async () => {
    const { onChange } = renderSection({
      loadImpact: async () => {
        throw new Error('网络不可用');
      },
    });

    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText(/无法读取影响清单/)).toBeTruthy());
    expect(screen.getByText(/网络不可用/)).toBeTruthy();

    fireEvent.click(screen.getByText('确认开启'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('未注入影响读取器时只给通用提示，仍可确认', async () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByText('开启会话级扩展管理'));
    await waitFor(() => expect(screen.getByText('确认开启')).toBeTruthy());
    fireEvent.click(screen.getByText('确认开启'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('已开启时展示现状并可关闭', () => {
    const { onChange } = renderSection({ value: true });
    expect(screen.getByText(/已开启：/)).toBeTruthy();
    fireEvent.click(screen.getByText('关闭会话级扩展管理'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('关闭说明不承诺「恢复继承」，也不指向不存在的路径', () => {
    renderSection({ value: true });
    // 曾经这里写「关闭后本渠道会话恢复继承你的用户级技能与 MCP」，但关闭只停掉本能力，
    // 已经按 explicit 建过策略行的会话仍按「只用会话条目」运行（行值优先）。而「恢复
    // 继承」等于把用户级技能 / MCP 放给渠道——关闭一个功能顺带扩权，方向是反的。
    expect(screen.queryByText(/恢复继承你的用户级技能/)).toBeNull();
    // 第二版文案又写成「如需恢复继承请到对应会话的扩展面板调整」，可渠道会话在那边
    // 也被禁用（网关对 channel→inherit 直接 403）：指引了一条走不通的路。
    expect(screen.queryByText(/请到对应会话的扩展面板调整/)).toBeNull();
    expect(screen.getByText(/渠道会话不允许改回继承/)).toBeTruthy();
  });
});
