import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProposal } from '@openAwork/web-client';
const client = vi.hoisted(() => ({
  listProposals: vi.fn(),
  countPendingProposals: vi.fn(),
  decideProposal: vi.fn(),
  rollbackRevision: vi.fn(),
  listRevisions: vi.fn(),
}));
vi.mock('@openAwork/web-client', () => ({ createMemoriesClient: () => client }));
import { useMemoryProposals } from './use-memory-proposals.js';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  client.listProposals.mockResolvedValue([]);
  client.countPendingProposals.mockResolvedValue(0);
});
const proposal: MemoryProposal = {
  id: 'p1',
  userId: 'a',
  action: 'create',
  scope: { type: 'user', id: 'a' },
  targetMemoryId: null,
  expectedRevision: null,
  payload: { key: 'private', value: 'secret-a' },
  payloadDigest: 'digest',
  reason: '',
  origin: 'api',
  confidence: 1,
  status: 'pending',
  createdAt: '',
  expiresAt: null,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  resultMemoryId: null,
  revision: 1,
};

describe('待确认身份隔离', () => {
  it.each(['decide', 'rollback'] as const)('HTTP成功但%s返回ok:false不显示成功', async (action) => {
    client.decideProposal.mockResolvedValueOnce({ ok: false });
    client.rollbackRevision.mockResolvedValueOnce({ ok: false });
    const onChanged = vi.fn();
    const { result } = renderHook(() =>
      useMemoryProposals({ gatewayUrl: 'http://gateway', token: 'a', active: true, onChanged }),
    );
    await waitFor(() => expect(result.current.listStatus).toBe('loaded'));
    await act(async () => {
      const response =
        action === 'decide'
          ? await result.current.decide('p1', { decision: 'approve' })
          : await result.current.rollback('r1');
      expect(response.ok).toBe(false);
    });
    expect(result.current.feedback.status).toBe('error');
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('切换token后重新加载并丢弃旧响应', async () => {
    let complete: ((value: MemoryProposal[]) => void) | undefined;
    client.listProposals.mockImplementationOnce(
      () =>
        new Promise<MemoryProposal[]>((resolve) => {
          complete = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ token }) => useMemoryProposals({ gatewayUrl: 'http://gateway', token, active: true }),
      { initialProps: { token: 'a' } },
    );
    await waitFor(() => expect(client.listProposals).toHaveBeenCalledWith('a', expect.anything()));
    rerender({ token: 'b' });
    await waitFor(() => expect(result.current.listStatus).toBe('loaded'));
    await act(async () => {
      complete?.([proposal]);
    });
    expect(client.listProposals).toHaveBeenCalledWith('b', expect.anything());
    expect(result.current.proposals).toEqual([]);
    expect(result.current.pendingCount).toBe(0);
  });
  it('旧身份的决策迟到不更新新身份反馈或触发刷新', async () => {
    let complete: ((value: { ok: boolean }) => void) | undefined;
    client.decideProposal.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          complete = resolve;
        }),
    );
    const onChanged = vi.fn();
    const { result, rerender } = renderHook(
      ({ token }) =>
        useMemoryProposals({ gatewayUrl: 'http://gateway', token, active: true, onChanged }),
      { initialProps: { token: 'a' } },
    );
    await waitFor(() => expect(result.current.listStatus).toBe('loaded'));
    let pending: ReturnType<typeof result.current.decide> | undefined;
    act(() => {
      pending = result.current.decide('p1', { decision: 'approve' });
    });
    rerender({ token: 'b' });
    await act(async () => {
      complete?.({ ok: true });
      await pending;
    });
    expect(onChanged).not.toHaveBeenCalled();
    expect(result.current.feedback.status).toBe('idle');
  });
});
