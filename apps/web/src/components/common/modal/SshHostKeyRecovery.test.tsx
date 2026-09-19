// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SshHostKeyRecovery from './SshHostKeyRecovery.js';
const mocks = vi.hoisted(() => ({ trustHostKey: vi.fn(), connect: vi.fn() }));
vi.mock('@openAwork/web-client', () => ({ createSshClient: () => mocks }));
vi.mock('../../../stores/auth/auth.js', () => ({
  useAuthStore: (select: (state: { accessToken: string; gatewayUrl: string }) => unknown) =>
    select({ accessToken: 'test', gatewayUrl: 'http://test' }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const expectedFingerprint = `SHA256:${'A'.repeat(43)}`;
const fingerprint = `SHA256:${'B'.repeat(43)}`;
const message = `SSH host key mismatch: test:22; expected ${expectedFingerprint}; received ${fingerprint}`;
it('明确核验后才更新并重连', async () => {
  const recovered = vi.fn();
  render(<SshHostKeyRecovery connectionId="c" message={message} onRecovered={recovered} />);
  const button = screen.getByRole('button');
  expect(button.hasAttribute('disabled')).toBe(true);
  expect(mocks.trustHostKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await waitFor(() => expect(recovered).toHaveBeenCalledOnce());
  expect(mocks.trustHostKey).toHaveBeenCalledWith('test', 'c', {
    expectedFingerprint,
    fingerprint,
  });
  expect(mocks.connect).toHaveBeenCalledWith('test', 'c');
});
it('指纹更新失败保留提示且不重连', async () => {
  mocks.trustHostKey.mockRejectedValue(new Error('指纹已变化，请重新核验'));
  render(<SshHostKeyRecovery connectionId="c" message={message} onRecovered={vi.fn()} />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('重新核验'));
  expect(mocks.connect).not.toHaveBeenCalled();
});
