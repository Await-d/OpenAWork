import { describe, expect, it } from 'vitest';

import { normalizeWorkspacePathParam } from './workspace-path-param.js';

describe('normalizeWorkspacePathParam', () => {
  it('绝对路径原样返回（POSIX / 盘符 / UNC）', () => {
    expect(normalizeWorkspacePathParam('/home/await/repo/src/index.ts', '/home/await/repo')).toBe(
      '/home/await/repo/src/index.ts',
    );
    expect(normalizeWorkspacePathParam('E:\\repo\\src\\index.ts', 'E:\\repo')).toBe(
      'E:\\repo\\src\\index.ts',
    );
    expect(normalizeWorkspacePathParam('E:/repo/src/index.ts', 'E:\\repo')).toBe(
      'E:/repo/src/index.ts',
    );
    expect(normalizeWorkspacePathParam('\\\\host\\share\\a.ts', 'C:\\repo')).toBe(
      '\\\\host\\share\\a.ts',
    );
  });

  it('SSH 家目录路径原样透传，交给网关远端分支解析', () => {
    expect(normalizeWorkspacePathParam('~/projects/demo/src/index.ts', '/home/await/demo')).toBe(
      '~/projects/demo/src/index.ts',
    );
  });

  it('工作区相对路径拼到根下', () => {
    expect(
      normalizeWorkspacePathParam(
        'packages/web-client/src/infra/plugins.ts',
        '/home/await/project/OpenAWork',
      ),
    ).toBe('/home/await/project/OpenAWork/packages/web-client/src/infra/plugins.ts');
    expect(normalizeWorkspacePathParam('./src/index.ts', '/home/await/repo/')).toBe(
      '/home/await/repo/src/index.ts',
    );
    expect(normalizeWorkspacePathParam('src/../lib/util.py', '/home/await/repo')).toBe(
      '/home/await/repo/lib/util.py',
    );
    expect(normalizeWorkspacePathParam('src', '/')).toBe('/src');
    expect(normalizeWorkspacePathParam('.', '/home/await/repo')).toBe('/home/await/repo');
  });

  it('按根的系统分隔符拼接', () => {
    expect(
      normalizeWorkspacePathParam('packages/web-client/src/index.ts', 'E:\\repo\\client'),
    ).toBe('E:\\repo\\client\\packages\\web-client\\src\\index.ts');
    expect(normalizeWorkspacePathParam('src\\index.ts', 'E:\\repo')).toBe(
      'E:\\repo\\src\\index.ts',
    );
    expect(normalizeWorkspacePathParam('src/index.ts', 'E:\\')).toBe('E:\\src\\index.ts');
  });

  it('越界相对路径与缺失根时原样透传，由网关裁决', () => {
    expect(normalizeWorkspacePathParam('../secret.txt', '/home/await/repo')).toBe('../secret.txt');
    expect(normalizeWorkspacePathParam('a/../../secret.txt', '/home/await/repo')).toBe(
      'a/../../secret.txt',
    );
    expect(normalizeWorkspacePathParam('src/index.ts', undefined)).toBe('src/index.ts');
    expect(normalizeWorkspacePathParam('src/index.ts', '   ')).toBe('src/index.ts');
  });

  it('空路径原样返回', () => {
    expect(normalizeWorkspacePathParam('', '/home/await/repo')).toBe('');
    expect(normalizeWorkspacePathParam('   ', '/home/await/repo')).toBe('   ');
  });
});
