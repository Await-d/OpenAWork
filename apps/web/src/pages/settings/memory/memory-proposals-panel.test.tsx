// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryProposal } from '@openAwork/web-client';
import { MemoryProposalsPanel } from './memory-proposals-panel.js';
import type { MemoryProposalsPanelProps } from './memory-proposals-panel.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROPOSAL: MemoryProposal = {
  id: 'proposal-1',
  userId: 'user-1',
  action: 'create',
  scope: { type: 'workspace', id: 'project-42' },
  targetMemoryId: null,
  expectedRevision: null,
  payload: { type: 'fact', key: '构建命令', value: 'bun run build' },
  payloadDigest: 'digest-1',
  reason: '对话中反复提到构建命令，建议沉淀',
  origin: 'auto_extract',
  confidence: 0.82,
  status: 'pending',
  createdAt: '2026-11-01T08:00:00.000Z',
  expiresAt: '2026-12-01T08:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  resultMemoryId: null,
  revision: null,
  relations: [],
};

function createProps(
  overrides: Partial<MemoryProposalsPanelProps> = {},
): MemoryProposalsPanelProps {
  return {
    proposals: [],
    pendingCount: 0,
    listStatus: 'loaded',
    listError: null,
    feedback: { status: 'idle', message: null },
    onClearFeedback: vi.fn(),
    onRefresh: vi.fn(async () => {}),
    decide: vi.fn(async () => ({ ok: true })),
    listRevisions: vi.fn(async () => []),
    rollback: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe('MemoryProposalsPanel', () => {
  it('空列表时显示「暂无待确认」', () => {
    render(<MemoryProposalsPanel {...createProps()} />);

    expect(screen.getByText('暂无待确认')).toBeTruthy();
  });

  it('渲染一条提议时显示 value 全文与作用域中文名', () => {
    render(<MemoryProposalsPanel {...createProps({ proposals: [PROPOSAL], pendingCount: 1 })} />);

    expect(screen.getByText('bun run build')).toBeTruthy();
    expect(screen.getByText(/影响范围：项目/)).toBeTruthy();
    expect(screen.getByText(/项目 · project-42/)).toBeTruthy();
  });

  it('点击「接受」调用 decideProposal(id, {decision:"approve"})', async () => {
    const decide = vi.fn(async () => ({ ok: true }));
    render(
      <MemoryProposalsPanel {...createProps({ proposals: [PROPOSAL], pendingCount: 1, decide })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '接受' }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('proposal-1', { decision: 'approve' });
    });
  });

  it('拒绝且勾选「保留原状」时提交 {decision:"reject", keepOriginal:true}', async () => {
    const decide = vi.fn(async () => ({ ok: true }));
    render(
      <MemoryProposalsPanel {...createProps({ proposals: [PROPOSAL], pendingCount: 1, decide })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保留原状' }));

    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('proposal-1', {
        decision: 'reject',
        keepOriginal: true,
      });
    });
  });

  it('decideProposal 抛 409 时显示冲突中文提示，且不显示任何成功文案', async () => {
    const decide = vi.fn(async () => ({
      ok: false,
      error: '内容已被修改，请重新查看后确认。',
    }));
    render(
      <MemoryProposalsPanel {...createProps({ proposals: [PROPOSAL], pendingCount: 1, decide })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '接受' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('内容已被修改，请重新查看后确认。');
    expect(screen.queryByText('已接受')).toBeNull();
    expect(screen.queryByText(/已保存/)).toBeNull();
    expect(screen.queryByText(/成功/)).toBeNull();
  });

  it('规则修改后接受只编辑 name/body，不注入 key/value', async () => {
    const decide = vi.fn(async () => ({ ok: true }));
    const proposal: MemoryProposal = {
      ...PROPOSAL,
      action: 'rule',
      payload: { name: '代码规则', body: '旧正文' },
    };
    render(
      <MemoryProposalsPanel {...createProps({ proposals: [proposal], pendingCount: 1, decide })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '修改后接受' }));
    fireEvent.change(screen.getByLabelText('编辑提议键'), { target: { value: '代码规范' } });
    fireEvent.change(screen.getByLabelText('编辑提议内容'), { target: { value: '使用类型导入' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改后的内容' }));
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('proposal-1', {
        decision: 'approve',
        payload: { name: '代码规范', body: '使用类型导入' },
      });
    });
  });

  it('未勾选任何提议时批量按钮不可用', () => {
    render(<MemoryProposalsPanel {...createProps({ proposals: [PROPOSAL], pendingCount: 1 })} />);

    const approveButton = screen.getByRole('button', {
      name: '批量接受已勾选项',
    }) as HTMLButtonElement;
    const rejectButton = screen.getByRole('button', {
      name: '批量拒绝已勾选项',
    }) as HTMLButtonElement;

    expect(approveButton.disabled).toBe(true);
    expect(rejectButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: /选择提议/ }));

    expect(approveButton.disabled).toBe(false);
    expect(rejectButton.disabled).toBe(false);
  });
});
