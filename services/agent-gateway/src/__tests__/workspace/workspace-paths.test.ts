import { beforeAll, describe, expect, it } from 'vitest';

let isPathWithinRoot: typeof import('../../workspace/workspace-paths.js').isPathWithinRoot;
let isSamePath: typeof import('../../workspace/workspace-paths.js').isPathWithinRoot;
let validateWorkspaceRelativePath: typeof import('../../workspace/workspace-paths.js').validateWorkspaceRelativePath;

beforeAll(async () => {
  process.env['DATABASE_URL'] = ':memory:';
  process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
  process.env['WORKSPACE_ROOT'] = 'E:\\01Project';
  const module = await import('../../workspace/workspace-paths.js');
  isPathWithinRoot = module.isPathWithinRoot;
  isSamePath = module.isSamePath;
  validateWorkspaceRelativePath = module.validateWorkspaceRelativePath;
});

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

  it('treats differently cased Windows paths as the same location', () => {
    expect(isSamePath('E:\\01Project\\Demo', 'e:/01project/demo/')).toBe(true);
    expect(isSamePath('E:\\01Project\\Demo', 'E:\\01Project\\Demo\\child')).toBe(false);
  });
});
