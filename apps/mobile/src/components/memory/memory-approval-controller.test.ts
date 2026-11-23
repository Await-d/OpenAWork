import { describe, expect, it, vi } from 'vitest';
import type { MemoryProposal } from '@openAwork/web-client';
import { createMemoryApprovalController } from './memory-approval-controller';
import type { MemoryApprovalState } from './memory-approval-controller';

const proposal: MemoryProposal = {
  id: 'p1',
  userId: 'owner',
  action: 'update',
  scope: { type: 'user', id: 'owner' },
  targetMemoryId: 'm1',
  expectedRevision: 4,
  payload: { key: 'runtime', value: 'bun' },
  payloadDigest: 'hash',
  reason: '稳定偏好',
  origin: 'maintenance',
  confidence: 1,
  status: 'pending',
  createdAt: '2026-11-01',
  expiresAt: null,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  resultMemoryId: null,
  revision: 20,
};
function setup() {
  let current = true;
  const states: MemoryApprovalState[] = [];
  const client = {
    listProposals: vi.fn(async () => [proposal]),
    getProposal: vi.fn(async () => ({ proposal, relations: [] })),
    decideProposal: vi.fn(async () => ({ ok: true })),
  };
  const controller = createMemoryApprovalController({
    client,
    token: 'token',
    isCurrent: () => current,
    onChange: (state) => states.push(state),
  });
  return {
    controller,
    client,
    states,
    switchIdentity: () => {
      current = false;
    },
  };
}

describe('原生移动端记忆确认', () => {
  it('明确确认使用目标版本，不是提议版本', async () => {
    const { controller, client, states } = setup();
    await controller.load();
    await controller.open('p1');
    await controller.decide({ decision: 'approve' });
    expect(client.decideProposal).toHaveBeenCalledWith('token', 'p1', {
      decision: 'approve',
      expectedRevision: 4,
    });
    expect(states.at(-1)?.message).toBe('已确认并保存');
  });
  it('内容变化重新展示，不批准新内容', async () => {
    const { controller, client, states } = setup();
    await controller.open('p1');
    client.getProposal.mockResolvedValueOnce({
      proposal: { ...proposal, payloadDigest: 'changed' },
      relations: [],
    });
    await controller.decide({ decision: 'approve' });
    expect(client.decideProposal).not.toHaveBeenCalled();
    expect(states.at(-1)?.error).toContain('已变化');
  });
  it('切换身份后不得再发送批准', async () => {
    const { controller, client, switchIdentity } = setup();
    await controller.open('p1');
    switchIdentity();
    await controller.decide({ decision: 'approve' });
    expect(client.decideProposal).not.toHaveBeenCalled();
  });
  it('列表加载失败与空列表区分', async () => {
    const { controller, client, states } = setup();
    client.listProposals.mockRejectedValueOnce(new Error('网络失败'));
    await controller.load();
    expect(states.at(-1)?.loaded).toBe(false);
    expect(states.at(-1)?.error).toBe('网络失败');
  });
  it('空列表刷新失败后不能继续视为加载成功', async () => {
    const { controller, client, states } = setup();
    client.listProposals.mockResolvedValueOnce([]);
    await controller.load();
    expect(states.at(-1)?.loaded).toBe(true);
    client.listProposals.mockRejectedValueOnce(new Error('刷新失败'));
    await controller.load();
    expect(states.at(-1)?.loaded).toBe(false);
    expect(states.at(-1)?.error).toBe('刷新失败');
  });
  it('刷新过程中不沿用上一次空列表的成功状态', async () => {
    const { controller, client, states } = setup();
    client.listProposals.mockResolvedValueOnce([]);
    await controller.load();
    const start = states.length;
    await controller.load();
    expect(states[start]?.busy).toBe(true);
    expect(states[start]?.loaded).toBe(false);
    expect(states.at(-1)?.loaded).toBe(true);
  });
  it('409或ok:false不提示保存成功', async () => {
    const { controller, client, states } = setup();
    await controller.open('p1');
    client.decideProposal.mockResolvedValueOnce({ ok: false });
    await controller.decide({ decision: 'approve' });
    expect(states.at(-1)?.message).toBeNull();
    expect(states.at(-1)?.error).toContain('失败');
    client.decideProposal.mockRejectedValueOnce(new Error('409 内容冲突'));
    await controller.decide({ decision: 'approve' });
    expect(states.at(-1)?.message).toBeNull();
    expect(states.at(-1)?.error).toContain('409');
  });
  it('保留原状显式传递keepOriginal', async () => {
    const { controller, client } = setup();
    await controller.open('p1');
    await controller.decide({ decision: 'reject', keepOriginal: true });
    expect(client.decideProposal).toHaveBeenCalledWith('token', 'p1', {
      decision: 'reject',
      keepOriginal: true,
      expectedRevision: 4,
    });
  });
  it('详情重读期间切换账号，不能发送旧身份批准', async () => {
    const { controller, client, switchIdentity, states } = setup();
    await controller.open('p1');
    const seen = states.length;
    client.getProposal.mockImplementationOnce(async () => {
      switchIdentity();
      return { proposal, relations: [] };
    });
    await controller.decide({ decision: 'approve' });
    expect(client.decideProposal).not.toHaveBeenCalled();
    expect(states.slice(seen).some((state) => state.message !== null)).toBe(false);
  });
  it('dispose后迟到详情不再展示', async () => {
    const { controller, client, states } = setup();
    client.getProposal.mockImplementationOnce(async () => {
      controller.dispose();
      return { proposal, relations: [] };
    });
    await controller.open('p1');
    expect(states.at(-1)?.detail).toBeNull();
  });
  it('重复点击只产生一个提交', async () => {
    const { controller, client } = setup();
    await controller.open('p1');
    await Promise.all([
      controller.decide({ decision: 'approve' }),
      controller.decide({ decision: 'approve' }),
    ]);
    expect(client.decideProposal).toHaveBeenCalledTimes(1);
  });
});
