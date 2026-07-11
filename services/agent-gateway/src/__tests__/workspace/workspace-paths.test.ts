import { describe, expect, it } from 'vitest';
import {
  isPathWithinRoot,
  validateWorkspaceRelativePath,
} from '../../workspace/workspace-paths.js';

describe('workspace path containment', () => {
  it('treats Windows child paths as inside their workspace root', () => {
    expect(
      isPathWithinRoot(
        'E:\\01Project\\appearance-automation\\appearance-automation-web\\package.json',
        'E:\\01Project\\appearance-automation',
      ),
    ).toBe(true);
  });

  it('rejects Windows sibling paths with a shared prefix', () => {
    expect(
      isPathWithinRoot(
        'E:\\01Project\\appearance-automation-web\\package.json',
        'E:\\01Project\\appearance-automation',
      ),
    ).toBe(false);
  });

  it('normalizes Windows relative workspace paths to forward slashes', () => {
    expect(
      validateWorkspaceRelativePath(
        'E:\\01Project\\appearance-automation',
        'appearance-automation-web\\package.json',
      ),
    ).toBe('appearance-automation-web/package.json');
  });
});
