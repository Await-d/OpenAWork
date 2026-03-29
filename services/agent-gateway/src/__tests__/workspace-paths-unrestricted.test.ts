import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({
  WORKSPACE_ACCESS_MODE: 'unrestricted',
  WORKSPACE_ACCESS_RESTRICTED: false,
  WORKSPACE_BROWSER_ROOT: '/',
  WORKSPACE_ROOT: '/tmp/openawork-workspace-root',
  WORKSPACE_ROOTS: ['/tmp/openawork-workspace-root'],
}));

import { validateWorkspacePath } from '../workspace-paths.js';

describe('workspace path helpers in unrestricted mode', () => {
  it('accepts absolute paths outside configured roots', () => {
    expect(validateWorkspacePath('/opt/external/project')).toBe('/opt/external/project');
  });

  it('still rejects non-absolute paths', () => {
    expect(validateWorkspacePath('relative/path')).toBeNull();
  });
});
