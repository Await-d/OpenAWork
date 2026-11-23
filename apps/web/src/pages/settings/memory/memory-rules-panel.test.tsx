import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
afterEach(cleanup);
const client = vi.hoisted(() => ({
  listRules: vi.fn(),
  proposeRule: vi.fn(),
  disableRule: vi.fn(),
  deleteRule: vi.fn(),
}));
vi.mock('@openAwork/web-client', () => ({ createMemoriesClient: () => client }));
import { MemoryRulesPanel } from './memory-rules-panel.js';
const token = `header.${btoa(JSON.stringify({ sub: 'owner' }))}.signature`;
const rule = {
  id: 'r1',
  userId: 'owner',
  scope: { type: 'user', id: 'owner' },
  name: '测试规则',
  body: '原有规则正文',
  revision: 3,
  enabled: true,
  confirmedAt: '',
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  client.listRules.mockResolvedValue([]);
  client.proposeRule.mockResolvedValue({ status: 'pending_confirmation', proposalId: 'p1' });
  client.disableRule.mockResolvedValue({ ok: true, enabled: false });
});

describe('规则编辑管理', () => {
  it('个人作用域自动取当前用户，提交后只提示待确认', async () => {
    const onProposed = vi.fn();
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} onProposed={onProposed} />);
    await screen.findByText('暂无已确认规则');
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '运行约定' } });
    fireEvent.change(screen.getByLabelText('规则正文'), { target: { value: '修改后运行测试。' } });
    fireEvent.click(screen.getByText('提交规则提议'));
    await waitFor(() =>
      expect(client.proposeRule).toHaveBeenCalledWith(token, {
        scope: { type: 'user', id: 'owner' },
        name: '运行约定',
        body: '修改后运行测试。',
        expectedRevision: 0,
      }),
    );
    await screen.findByText(/已提交待确认/);
    expect(onProposed).toHaveBeenCalled();
    expect(screen.queryByText('规则已保存')).toBeNull();
  });
  it('失败不显示成功，保留输入供重试', async () => {
    client.proposeRule.mockRejectedValueOnce(new Error('409 内容已变化'));
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} />);
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '规则' } });
    fireEvent.change(screen.getByLabelText('规则正文'), { target: { value: '正文' } });
    fireEvent.click(screen.getByText('提交规则提议'));
    await screen.findByText('409 内容已变化');
    expect(screen.queryByText(/已提交待确认/)).toBeNull();
    expect((screen.getByLabelText('规则正文') as HTMLTextAreaElement).value).toBe('正文');
  });
  it('编辑锁名称和范围并绑定规则版本', async () => {
    client.listRules.mockResolvedValue([rule]);
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} />);
    fireEvent.click(await screen.findByText('编辑并重新提议'));
    expect((screen.getByLabelText('规则名称') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('规则正文'), { target: { value: '新正文' } });
    fireEvent.click(screen.getByText('提交规则修改'));
    await waitFor(() =>
      expect(client.proposeRule).toHaveBeenCalledWith(
        token,
        expect.objectContaining({ name: rule.name, body: '新正文', expectedRevision: 3 }),
      ),
    );
  });
  it('渠道对话作用域标识不合法时前置拦截，不发起请求且提示前缀要求', async () => {
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} />);
    await screen.findByText('暂无已确认规则');
    fireEvent.change(screen.getByLabelText('规则作用域'), { target: { value: 'channel_chat' } });
    fireEvent.change(screen.getByLabelText('规则作用域标识'), { target: { value: '随便填的id' } });
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '渠道规则' } });
    fireEvent.change(screen.getByLabelText('规则正文'), { target: { value: '正文' } });
    fireEvent.click(screen.getByText('提交规则提议'));
    await screen.findByText(/channel:<渠道ID>:chat:<会话ID>/);
    expect(client.proposeRule).not.toHaveBeenCalled();
  });
  it('合法的渠道对话作用域标识可提交', async () => {
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} />);
    await screen.findByText('暂无已确认规则');
    fireEvent.change(screen.getByLabelText('规则作用域'), { target: { value: 'channel_chat' } });
    fireEvent.change(screen.getByLabelText('规则作用域标识'), {
      target: { value: 'channel:telegram:chat:123' },
    });
    fireEvent.change(screen.getByLabelText('规则名称'), { target: { value: '渠道规则' } });
    fireEvent.change(screen.getByLabelText('规则正文'), { target: { value: '正文' } });
    fireEvent.click(screen.getByText('提交规则提议'));
    await waitFor(() =>
      expect(client.proposeRule).toHaveBeenCalledWith(
        token,
        expect.objectContaining({
          scope: { type: 'channel_chat', id: 'channel:telegram:chat:123' },
        }),
      ),
    );
  });
  it('停用成功后刷新规则列表', async () => {
    client.listRules
      .mockResolvedValueOnce([rule])
      .mockResolvedValueOnce([{ ...rule, enabled: false }]);
    render(<MemoryRulesPanel gatewayUrl="http://gateway" token={token} />);
    fireEvent.click(await screen.findByText('停用'));
    await screen.findByText('规则已停用');
    expect(client.disableRule).toHaveBeenCalledWith(token, 'r1');
    await waitFor(() => expect(client.listRules).toHaveBeenCalledTimes(2));
  });
});
