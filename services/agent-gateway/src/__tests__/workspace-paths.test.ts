import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'restricted',
  WORKSPACE_ACCESS_RESTRICTED: true,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root', '/tmp/openawork-second-root'],
}));

import {
  isPathWithinRoot,
  validateWorkspacePath,
  validateWorkspaceRelativePath,
} from '../workspace-paths.js';

describe('workspace path helpers', () => {
  it('accepts absolute paths within the workspace root', () => {
    expect(validateWorkspacePath('/tmp/openawork-workspace-root/apps/web')).toBe(
      '/tmp/openawork-workspace-root/apps/web',
    );
  });

  it('rejects absolute paths outside the workspace root', () => {
    expect(validateWorkspacePath('/tmp/openawork-workspace-root-sibling/file.ts')).toBeNull();
  });

  it('accepts absolute paths within a secondary workspace root', () => {
    expect(validateWorkspacePath('/tmp/openawork-second-root/apps/mobile')).toBe(
      '/tmp/openawork-second-root/apps/mobile',
    );
  });

  it('treats sibling directories as outside the root boundary', () => {
    expect(
      isPathWithinRoot(
        '/tmp/openawork-workspace-root-sibling/file.ts',
        '/tmp/openawork-workspace-root',
      ),
    ).toBe(false);
  });

  it('rejects relative paths that escape into sibling directories', () => {
    expect(
      validateWorkspaceRelativePath(
        '/tmp/openawork-workspace-root',
        '../openawork-workspace-root-sibling/secrets.txt',
      ),
    ).toBeNull();
  });

  it('keeps valid relative paths rooted inside the workspace', () => {
    expect(validateWorkspaceRelativePath('/tmp/openawork-workspace-root', 'src/index.ts')).toBe(
      'src/index.ts',
    );
  });
});
