import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionWorkspaceRootMock: vi.fn<() => string | null>(),
  invalidateMock: vi.fn<(targetPath?: string) => void>(),
}));

vi.mock('../../workspace/workspace-safety.js', () => ({
  getSessionWorkspaceRoot: mocks.getSessionWorkspaceRootMock,
}));

vi.mock('../../workspace/workspace-file-index.js', () => ({
  invalidateWorkspaceFileIndex: mocks.invalidateMock,
}));

import {
  WORKSPACE_FILE_INDEX_WRITE_TOOLS,
  invalidateWorkspaceFileIndexForToolCall,
} from '../../workspace/workspace-file-index-invalidation.js';

describe('invalidateWorkspaceFileIndexForToolCall', () => {
  beforeEach(() => {
    mocks.getSessionWorkspaceRootMock.mockReset();
    mocks.invalidateMock.mockReset();
  });

  it('可写工具解析出工作区根时失效该根', () => {
    mocks.getSessionWorkspaceRootMock.mockReturnValue('/ws/root');

    invalidateWorkspaceFileIndexForToolCall('session-1', 'write');

    expect(mocks.getSessionWorkspaceRootMock).toHaveBeenCalledWith('session-1');
    expect(mocks.invalidateMock).toHaveBeenCalledWith('/ws/root');
  });

  it('只读工具不解析工作区根也不失效', () => {
    mocks.getSessionWorkspaceRootMock.mockReturnValue('/ws/root');

    for (const toolName of ['read', 'list', 'glob', 'grep', 'webfetch', 'todo_read']) {
      invalidateWorkspaceFileIndexForToolCall('session-1', toolName);
    }

    expect(mocks.getSessionWorkspaceRootMock).not.toHaveBeenCalled();
    expect(mocks.invalidateMock).not.toHaveBeenCalled();
  });

  it('可写工具但解析不到工作区根时静默跳过', () => {
    mocks.getSessionWorkspaceRootMock.mockReturnValue(null);

    invalidateWorkspaceFileIndexForToolCall('session-1', 'edit');

    expect(mocks.invalidateMock).not.toHaveBeenCalled();
  });

  it('解析工作区根抛错时吞掉异常且不失效', () => {
    mocks.getSessionWorkspaceRootMock.mockImplementation(() => {
      throw new Error('db down');
    });

    expect(() => invalidateWorkspaceFileIndexForToolCall('session-1', 'write')).not.toThrow();
    expect(mocks.invalidateMock).not.toHaveBeenCalled();
  });

  it('写工具集合覆盖文件写入与 shell 执行，但不含只读工具', () => {
    for (const toolName of [
      'write',
      'edit',
      'multi_edit',
      'apply_patch',
      'ast_grep_replace',
      'lsp_rename',
      'bash',
      'interactive_bash',
      'run_bash_in_background',
      'workspace_create_directory',
      'workspace_review_revert',
      'repo_clone',
    ]) {
      expect(WORKSPACE_FILE_INDEX_WRITE_TOOLS.has(toolName), toolName).toBe(true);
    }
    for (const toolName of ['read', 'glob', 'grep', 'list', 'webfetch']) {
      expect(WORKSPACE_FILE_INDEX_WRITE_TOOLS.has(toolName), toolName).toBe(false);
    }
  });
});
