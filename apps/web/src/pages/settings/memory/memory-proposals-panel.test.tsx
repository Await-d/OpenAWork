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
    expect((screen.getByLabelText('编辑提议键') as HTMLInputElement).readOnly).toBe(true);
    fireEvent.change(screen.getByLabelText('编辑提议内容'), { target: { value: '使用类型导入' } });
    fireEvent.click(screen.getByRole('button', { name: '提交修改后的内容' }));
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith('proposal-1', {
        decision: 'approve',
        payload: { name: '代码规则', body: '使用类型导入' },
      });
    });
  });

  it('更新规则提议按 payload.ruleId 暴露版本入口', async () => {
    const listRevisions = vi.fn(async () => []);
    const proposal: MemoryProposal = {
      ...PROPOSAL,
      action: 'rule',
      // 规则提议不写 targetMemoryId；ruleId 携带在载荷里，作为历史查询的 memoryId。
      targetMemoryId: null,
      payload: { name: '代码规则', body: '正文', ruleId: 'rule-99', ruleRevision: 1 },
    };
    render(
      <MemoryProposalsPanel
        {...createProps({ proposals: [proposal], pendingCount: 1, listRevisions })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '查看历史版本' }));
    await waitFor(() => {
      expect(listRevisions).toHaveBeenCalledWith('rule-99');
    });
  });

  it('新建规则提议（尚无 ruleId）不暴露版本入口', () => {
    const proposal: MemoryProposal = {
      ...PROPOSAL,
      action: 'rule',
      // 新建规则：规则还不存在，没有历史可看。即便后端误填 targetMemoryId 也不得暴露入口。
      targetMemoryId: 'rule-as-memory',
      payload: { name: '代码规则', body: '正文' },
    };
    render(<MemoryProposalsPanel {...createProps({ proposals: [proposal], pendingCount: 1 })} />);

    expect(screen.queryByRole('button', { name: '查看历史版本' })).toBeNull();
    expect(screen.queryByRole('button', { name: /回滚版本/ })).toBeNull();
  });

  it('冲突更新保留替代与暂不处理，不提供未实现的两者并存', () => {
    render(
      <MemoryProposalsPanel
        {...createProps({
          proposals: [
            {
              ...PROPOSAL,
              action: 'update',
              targetMemoryId: 'memory-old',
              relations: [
                { kind: 'conflict', memoryId: 'memory-old', key: '旧键', value: '旧内容' },
              ],
            },
          ],
          pendingCount: 1,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: '用新内容替代' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '暂不处理' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /两者并存/ })).toBeNull();
    expect(screen.queryByText(/两者并存/)).toBeNull();
  });

  it('合并说明保留与归档语义，展示保留ID及依赖版本且不允许编辑', () => {
    const payload = {
      ...PROPOSAL.payload,
      mergeIntoId: 'memory-kept',
      dependencies: [{ memoryId: 'memory-kept', revision: 3 }],
    };
    render(
      <MemoryProposalsPanel
        {...createProps({
          proposals: [
            { ...PROPOSAL, action: 'merge', targetMemoryId: 'memory-duplicate', payload },
          ],
          pendingCount: 1,
        })}
      />,
    );
    expect(screen.getByText(/保留指定条目，归档重复项/)).toBeTruthy();
    expect(screen.getByText(/目标 ID：memory-duplicate/)).toBeTruthy();
    expect(JSON.parse(screen.getByLabelText('批准完整载荷').textContent ?? '')).toEqual(payload);
    expect(screen.queryByRole('button', { name: '修改后接受' })).toBeNull();
    expect(screen.queryByRole('button', { name: '提交修改后的内容' })).toBeNull();
  });

  it('完整展示每条批准载荷、false、角色层与目标版本，批量仍逐条可见', () => {
    const payload = {
      ...PROPOSAL.payload,
      enabled: false,
      roleLayers: ['reviewer', 'worker'],
      priority: 0,
      workspaceRoot: '/workspace/project',
    };
    render(
      <MemoryProposalsPanel
        {...createProps({
          proposals: [
            {
              ...PROPOSAL,
              action: 'update',
              targetMemoryId: 'memory-42',
              expectedRevision: 7,
              payload,
            },
            { ...PROPOSAL, id: 'proposal-2' },
          ],
          pendingCount: 2,
        })}
      />,
    );
    const previews = screen.getAllByLabelText('批准完整载荷');
    expect(previews).toHaveLength(2);
    expect(JSON.parse(previews[0]?.textContent ?? '')).toEqual(payload);
    expect(JSON.parse(previews[1]?.textContent ?? '')).toEqual(PROPOSAL.payload);
    expect(screen.getByText(/目标 ID：memory-42 · expectedRevision：7/)).toBeTruthy();
  });

  it('编辑后预览与实际提交一致，保留未编辑的完整字段', async () => {
    const decide = vi.fn(async () => ({ ok: true }));
    const payload = { ...PROPOSAL.payload, enabled: false, roleLayers: ['reviewer'], priority: 0 };
    render(
      <MemoryProposalsPanel
        {...createProps({ proposals: [{ ...PROPOSAL, payload }], pendingCount: 1, decide })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '修改后接受' }));
    fireEvent.change(screen.getByLabelText('编辑提议键'), { target: { value: ' 新键 ' } });
    fireEvent.change(screen.getByLabelText('编辑提议内容'), { target: { value: ' 新内容 ' } });
    const expectedPayload = { ...payload, key: '新键', value: '新内容' };
    expect(JSON.parse(screen.getByLabelText('编辑后完整载荷').textContent ?? '')).toEqual(
      expectedPayload,
    );
    expect(JSON.parse(screen.getByLabelText('批准完整载荷').textContent ?? '')).toEqual(payload);
    fireEvent.click(screen.getByRole('button', { name: '提交修改后的内容' }));
    await waitFor(() => {
      expect(decide).toHaveBeenCalledWith(PROPOSAL.id, {
        decision: 'approve',
        payload: expectedPayload,
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
