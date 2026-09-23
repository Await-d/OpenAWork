// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotTreeEntry } from '@openAwork/web-client';
import { SnapshotRestoreConfirmDialog } from './SnapshotRestoreConfirmDialog.js';
import type { AffectedFileEntry } from './affected-changes.js';

afterEach(() => {
  cleanup();
});

function makeSnapshot(overrides: Partial<SnapshotTreeEntry> = {}): SnapshotTreeEntry {
  return {
    treeHash: 'tree-1',
    parentTreeHash: 'tree-parent',
    clientRequestId: 'req-1',
    scopeKind: 'turn',
    sourceKind: 'session_snapshot',
    guaranteeLevel: 'strong',
    filesChanged: 2,
    additions: 3,
    deletions: 1,
    toolName: null,
    toolCallId: null,
    createdAt: '2026-07-15T10:05:00.000Z',
    ...overrides,
  };
}

const FILES: readonly AffectedFileEntry[] = [
  { file: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, requestId: 'req-1' },
  { file: 'src/b.ts', status: 'added', additions: 5, deletions: 0, requestId: 'req-1' },
];

function renderDialog(overrides: Partial<Parameters<typeof SnapshotRestoreConfirmDialog>[0]> = {}) {
  return render(
    <SnapshotRestoreConfirmDialog
      action="retry"
      affectedSnapshots={[]}
      files={FILES}
      onCancel={vi.fn()}
      onContinueWithoutRestore={vi.fn()}
      onRestoreAndContinue={vi.fn()}
      open
      restoreTargetTreeHash={null}
      {...overrides}
    />,
  );
}

describe('SnapshotRestoreConfirmDialog', () => {
  it('无快照但检测到文件变更时展示文件清单与不可恢复原因，且不渲染恢复按钮', () => {
    renderDialog({
      restoreUnavailableReason: '当前回退范围之前没有可用快照，暂时无法自动恢复文件。',
    });

    expect(screen.getByText('此操作将影响已产生的文件变更')).toBeTruthy();
    expect(screen.getByText(/检测到/)).toBeTruthy();
    expect(screen.getByTestId('snapshot-restore-file-list')).toBeTruthy();
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('src/b.ts')).toBeTruthy();
    expect(screen.getByText(/没有可用快照/)).toBeTruthy();
    expect(screen.queryByText('恢复文件后继续')).toBeNull();
  });

  it('存在快照且可恢复时展示快照摘要与恢复按钮', () => {
    renderDialog({
      affectedSnapshots: [makeSnapshot()],
      files: [],
      restoreTargetTreeHash: 'tree-parent',
    });

    expect(screen.getByText(/个快照/)).toBeTruthy();
    expect(screen.getByText('恢复文件后继续')).toBeTruthy();
    expect(screen.queryByTestId('snapshot-restore-file-list')).toBeNull();
  });

  it('提供面板入口时渲染「打开文件变更面板」并回调，缺省时不渲染', () => {
    const onOpenFileChangesPanel = vi.fn();
    const { unmount } = renderDialog({ onOpenFileChangesPanel });

    screen.getByText('打开文件变更面板').click();
    expect(onOpenFileChangesPanel).toHaveBeenCalledTimes(1);

    unmount();
    renderDialog();
    expect(screen.queryByText('打开文件变更面板')).toBeNull();
  });

  it('「保留文件并继续」触发继续回调', () => {
    const onContinueWithoutRestore = vi.fn();
    renderDialog({ onContinueWithoutRestore });

    screen.getByText('保留文件并继续').click();
    expect(onContinueWithoutRestore).toHaveBeenCalledTimes(1);
  });

  it('检测不完整且无任何证据时展示「无法确认」，不渲染文件清单与恢复按钮', () => {
    renderDialog({
      detectionIncomplete: true,
      files: [],
      restoreUnavailableReason:
        '检测文件变更时出错，无法确认该范围是否存在变更。可先保留文件并继续，或稍后重试。',
    });

    expect(screen.getByText(/文件变更检测未完成/)).toBeTruthy();
    expect(screen.getByText(/继续操作不会恢复任何文件/)).toBeTruthy();
    expect(screen.getByText(/检测文件变更时出错/)).toBeTruthy();
    expect(screen.queryByTestId('snapshot-restore-file-list')).toBeNull();
    expect(screen.queryByText('恢复文件后继续')).toBeNull();
    expect(screen.getByText('保留文件并继续')).toBeTruthy();
  });

  it('既无快照也无文件条目时不渲染', () => {
    renderDialog({ files: [] });
    expect(screen.queryByText('此操作将影响已产生的文件变更')).toBeNull();
  });

  it('恢复失败时展示错误信息且不关闭对话框', () => {
    renderDialog({
      affectedSnapshots: [makeSnapshot()],
      files: [],
      restoreErrorMessage: 'restore failed badly',
      restoreTargetTreeHash: 'tree-parent',
    });

    expect(screen.getByRole('alert').textContent).toContain('restore failed badly');
    expect(screen.getByText('恢复文件后继续')).toBeTruthy();
  });
});
