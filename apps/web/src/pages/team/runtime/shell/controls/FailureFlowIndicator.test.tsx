// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailureFlowIndicator } from './FailureFlowIndicator.js';

const authState = vi.hoisted(() => ({
  accessToken: 'token-1',
  gatewayUrl: 'http://localhost:3000',
}));

const runReviewActionMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../stores/auth/auth.js', () => ({
  useAuthStore: (selector?: ((state: typeof authState) => unknown) | undefined) =>
    typeof selector === 'function' ? selector(authState) : authState,
}));

vi.mock('@openAwork/web-client', () => ({
  createTeamHandoffsClient: () => ({
    runReviewAction: runReviewActionMock,
  }),
}));

beforeEach(() => {
  runReviewActionMock.mockReset().mockResolvedValue({
    action: 'redispatch',
    handoffId: 'pm2-handoff-1',
    handoffs: [],
    ok: true,
    retryable: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FailureFlowIndicator', () => {
  it('escalate-to-user 场景下仍允许用户手动改选 redispatch / return-to-c', async () => {
    render(
      <FailureFlowIndicator
        action="escalate-to-user"
        reason="团队建议升级给用户，但你仍可改选其他处置方式。"
        escalationRound={2}
        pm2HandoffId="pm2-handoff-1"
      />,
    );

    const redispatchButton = screen.getByRole('button', { name: '重派 e/f/g' });
    const returnToCButton = screen.getByRole('button', { name: '退回 PM1' });

    expect(redispatchButton.hasAttribute('disabled')).toBe(false);
    expect(returnToCButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(redispatchButton);
    await waitFor(() => {
      expect(runReviewActionMock).toHaveBeenCalledWith('token-1', 'pm2-handoff-1', 'redispatch');
    });

    fireEvent.click(returnToCButton);
    await waitFor(() => {
      expect(runReviewActionMock).toHaveBeenCalledWith('token-1', 'pm2-handoff-1', 'return-to-c');
    });
  });
});
