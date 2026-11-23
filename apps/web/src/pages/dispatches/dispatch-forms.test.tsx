import type { DispatchAttempt, DispatchDetail } from '@openAwork/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreateDispatchForm, DispatchDraftEditor } from './dispatch-draft-forms.js';
import { DispatchItemThread } from './dispatch-item-thread.js';

const draft: DispatchDetail = {
  id: 'batch',
  title: '会议纪要',
  status: 'draft',
  revision: 2,
  request: '总结',
  excerpt: '',
  total: 1,
  succeeded: 0,
  updatedAt: 0,
  selection: { providerId: 'provider', modelId: 'model' },
  draftItems: [{ title: '摘要', objective: '提炼要点', acceptance: '列出三点', role: 'summarize' }],
  items: [],
};

it('discloses external model use before sending only pasted text and preserves input on failure', async () => {
  const create = vi.fn().mockRejectedValue(new Error('offline'));
  render(<CreateDispatchForm create={create} />);
  expect(screen.getByText(/外部提供方托管/)).toBeTruthy();
  const request = screen.getByLabelText('派工目标');
  fireEvent.change(request, { target: { value: '总结' } });
  fireEvent.change(screen.getByLabelText('粘贴文本（选填）'), { target: { value: '会议记录' } });
  fireEvent.click(screen.getByRole('button', { name: '生成草稿' }));
  expect((await screen.findByRole('alert')).textContent).toContain('无法生成草稿');
  expect(create).toHaveBeenCalledWith({ request: '总结', excerpt: '会议记录' });
  expect(request).toHaveProperty('value', '总结');
});

it('saves edits without enqueueing, then explicitly confirms the saved revision', async () => {
  const updated = { ...draft, revision: 3, title: '更新后的标题' };
  const save = vi.fn().mockResolvedValue(updated);
  const confirm = vi.fn().mockResolvedValue({ ...updated, status: 'queued' });
  const editor = (detail: DispatchDetail) => (
    <DispatchDraftEditor detail={detail} busy={false} enabled save={save} confirm={confirm} />
  );
  const { rerender } = render(editor(draft));
  fireEvent.change(screen.getByLabelText('派工标题'), { target: { value: updated.title } });
  const confirmButton = screen.getByRole('button', { name: '确认并派工' });
  expect(confirmButton).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      revision: 2,
      title: updated.title,
      items: draft.draftItems,
    }),
  );
  expect(confirm).not.toHaveBeenCalled();
  rerender(editor(updated));
  await waitFor(() => expect(confirmButton).toHaveProperty('disabled', false));
  fireEvent.click(confirmButton);
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(3));
});

it('sends a follow-up to the latest attempt and keeps older results visible', async () => {
  const attempt: DispatchAttempt = {
    id: 'old',
    number: 1,
    threadId: 'thread',
    kind: 'initial',
    status: 'succeeded',
    question: null,
    result: '旧结果',
    error: null,
    stopRequested: false,
    createdAt: 0,
    finishedAt: 1,
  };
  const act = vi.fn().mockResolvedValue(draft);
  const item = {
    id: 'item',
    title: '摘要',
    objective: '提炼要点',
    acceptance: '列出三点',
    role: 'summarize' as const,
    hasEarlierAttempts: true,
    attempts: [
      { ...attempt, id: 'latest', number: 2, kind: 'follow-up' as const, result: '新结果' },
      attempt,
    ],
  };
  render(<DispatchItemThread item={item} locked={false} busy={false} act={act} />);
  expect(screen.getByText('旧结果')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('追问此事项'), { target: { value: '再补充一点' } });
  fireEvent.click(screen.getByRole('button', { name: '发送追问' }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith({
      kind: 'follow-up',
      expectedAttemptId: 'latest',
      question: '再补充一点',
    }),
  );
});
