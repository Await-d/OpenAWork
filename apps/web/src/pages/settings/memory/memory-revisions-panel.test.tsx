import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryEntry, MemoryRevisionRecord } from '@openAwork/web-client';
import { MemoryRevisionsPanel } from './memory-revisions-panel.js';

afterEach(cleanup);
const before: MemoryEntry = {
  id: 'm1',
  type: 'fact',
  key: 'runtime',
  value: '旧正文',
  source: 'manual',
  confidence: 1,
  priority: 50,
  workspaceRoot: null,
  enabled: true,
  createdAt: '',
  updatedAt: '',
};
const revision: MemoryRevisionRecord = {
  id: 'r2',
  memoryId: 'm1',
  revision: 2,
  operation: 'update',
  origin: 'manual',
  actorId: 'owner',
  createdAt: '',
  before,
  after: { ...before, value: '新正文' },
  payload: before,
};

describe('记忆历史真实快照', () => {
  it('非空历史可显示前后快照，明确回滚恢复before而非after', async () => {
    const rollback = vi.fn(async () => ({ ok: false, error: '版本冲突' }));
    render(
      <MemoryRevisionsPanel
        memoryId="m1"
        listRevisions={async () => [revision]}
        rollback={rollback}
      />,
    );
    await screen.findByText('版本 2');
    expect(screen.getByText(/旧正文/)).toBeTruthy();
    expect(screen.getByText(/新正文/)).toBeTruthy();
    expect(screen.getByText(/恢复变更前/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '回滚版本 2 的变更' }));
    await screen.findByText(/版本冲突/);
    expect(rollback).toHaveBeenCalledWith('r2');
  });
  it('创建记录的回滚展示为停用归档，旧版本不允许直接回滚', async () => {
    render(
      <MemoryRevisionsPanel
        memoryId="m1"
        listRevisions={async () => [
          { ...revision, id: 'r1', revision: 1, operation: 'create', before: null, payload: null },
          revision,
        ]}
        rollback={async () => ({ ok: true })}
      />,
    );
    await screen.findByText('版本 1');
    expect(screen.getByText(/撤销创建，停用并归档/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '回滚版本 1 的变更' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
