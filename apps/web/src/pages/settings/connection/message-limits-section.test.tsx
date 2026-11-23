// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MessageLimitsSection } from './message-limits-section.js';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { useMessageLimits } from '../../../hooks/use-message-limits.js';

const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@openAwork/web-client', async (original) => ({
  ...(await original<typeof import('@openAwork/web-client')>()),
  createMessageLimitsClient: () => ({ read, write }),
}));
const snapshot = {
  maxChars: 4096,
  minChars: 1024,
  hardMaxChars: 200000,
  defaultMaxChars: 32768,
  canEdit: true,
};
let identity = 0;
beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue(snapshot);
  write.mockImplementation(async (_token, maxChars) => ({ ...snapshot, maxChars }));
  useAuthStore.setState({
    gatewayUrl: 'http://limits.test',
    accessToken: `token-${++identity}`,
    email: 'admin@test',
  });
});
afterEach(cleanup);

it('认证读取，校验整数范围，恢复默认仅改草稿，显式保存后反馈成功', async () => {
  const view = render(<MessageLimitsSection />);
  expect(view.getByText('正在读取消息字符上限…')).toBeTruthy();
  const input = await view.findByLabelText('每条消息最多字符数');
  expect(read).toHaveBeenCalledWith(`token-${identity}`);
  for (const invalid of ['0', '1023', '200001', '1024.5', '']) {
    fireEvent.change(input, { target: { value: invalid } });
    expect(view.getByRole('alert').textContent).toContain('之间的整数');
    expect((view.getByText('保存字符上限') as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.click(view.getByText('恢复默认值'));
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(view.getByText('保存字符上限'));
  await view.findByText('消息字符上限已保存。');
  expect(write).toHaveBeenCalledWith(`token-${identity}`, 32768);
});

it('只读账号不可编辑或保存，切换账号不泄露旧权限', async () => {
  const view = render(<MessageLimitsSection />);
  await view.findByLabelText('每条消息最多字符数');
  read.mockResolvedValue({ ...snapshot, canEdit: false });
  act(() => useAuthStore.setState({ accessToken: 'viewer', email: 'viewer@test' }));
  expect(view.queryByText('保存字符上限')).toBeNull();
  await view.findByText('当前账号仅可查看，请联系管理员修改。');
  expect((view.getByLabelText('每条消息最多字符数') as HTMLInputElement).disabled).toBe(true);
});

it('读取失败可重试，保存失败保留草稿', async () => {
  read.mockRejectedValueOnce(new Error('连接失败'));
  const view = render(<MessageLimitsSection />);
  await view.findByText('连接失败');
  fireEvent.click(view.getByText('重试'));
  const input = await view.findByLabelText('每条消息最多字符数');
  write.mockRejectedValueOnce(new Error('无权限'));
  fireEvent.change(input, { target: { value: '8192' } });
  fireEvent.click(view.getByText('保存字符上限'));
  await view.findByText('保存失败：无权限');
  expect((input as HTMLInputElement).value).toBe('8192');
});

it('网关切换后迟到的保存不会覆盖新网关配置，focus 刷新', async () => {
  let finish!: (value: typeof snapshot) => void;
  write.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<MessageLimitsSection />);
  fireEvent.change(await view.findByLabelText('每条消息最多字符数'), { target: { value: '8192' } });
  fireEvent.click(view.getByText('保存字符上限'));
  await waitFor(() => expect(write).toHaveBeenCalled());
  read.mockResolvedValue({ ...snapshot, maxChars: 16384 });
  act(() => useAuthStore.setState({ gatewayUrl: 'http://other.test' }));
  await waitFor(() =>
    expect((view.getByLabelText('每条消息最多字符数') as HTMLInputElement).value).toBe('16384'),
  );
  await act(async () => finish({ ...snapshot, maxChars: 8192 }));
  expect((view.getByLabelText('每条消息最多字符数') as HTMLInputElement).value).toBe('16384');
  const calls = read.mock.calls.length;
  fireEvent.focus(window);
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(calls));
});

it('同身份订阅者在保存后共享新上限', async () => {
  function Probe() {
    const auth = useAuthStore();
    const limits = useMessageLimits(auth.gatewayUrl, auth.accessToken, auth.email ?? '');
    return <output data-testid="max">{limits.maxChars}</output>;
  }
  read.mockImplementation(async () =>
    write.mock.calls.length ? { ...snapshot, maxChars: 8192 } : snapshot,
  );
  const view = render(
    <>
      <MessageLimitsSection />
      <Probe />
    </>,
  );
  fireEvent.change(await view.findByLabelText('每条消息最多字符数'), { target: { value: '8192' } });
  fireEvent.click(view.getByText('保存字符上限'));
  await waitFor(() => expect(view.getByTestId('max').textContent).toBe('8192'));
});
