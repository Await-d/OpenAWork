import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isUnsafeWorkspaceRootFallback } from '../../workspace/workspace-config.js';

describe('isUnsafeWorkspaceRootFallback', () => {
  it('flags Windows system32-style paths', () => {
    expect(isUnsafeWorkspaceRootFallback('C:\\WINDOWS\\system32')).toBe(true);
    expect(isUnsafeWorkspaceRootFallback('C:/Windows/System32')).toBe(true);
    expect(isUnsafeWorkspaceRootFallback('C:\\Windows\\SysWOW64')).toBe(true);
  });

  it('flags drive roots', () => {
    // On Linux test hosts, resolve('C:\\') stays a relative-looking path; use
    // the platform root which is always unsafe as a project workspace.
    expect(isUnsafeWorkspaceRootFallback(path.parse(process.cwd()).root || '/')).toBe(true);
  });

  it('allows normal project paths', () => {
    expect(isUnsafeWorkspaceRootFallback('/home/await/project/OpenAWork')).toBe(false);
    expect(isUnsafeWorkspaceRootFallback('/tmp/workspace')).toBe(false);
  });
});
