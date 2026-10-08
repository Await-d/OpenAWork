import { describe, expect, it } from 'vitest';
import {
  findContainingRoot,
  formatWorkspacePathLabel,
  getRelativePath,
  getParentPath,
  getPathBasename,
  hasDirectorySeparator,
  isAbsolutePath,
  isPathWithinRoot,
  joinDirectoryPath,
  rebasePath,
  resolvePathWithinRoot,
} from './workspace-path.js';

describe('workspace-path', () => {
  it('识别 Windows 路径的 basename', () => {
    expect(getPathBasename('D:\\Projects\\OpenAWork')).toBe('OpenAWork');
    expect(getPathBasename('D:\\')).toBe('D:\\');
  });

  it('计算 Windows 路径的父目录', () => {
    expect(getParentPath('D:\\Projects\\OpenAWork')).toBe('D:\\Projects');
    expect(getParentPath('D:\\Projects')).toBe('D:\\');
    expect(getParentPath('D:\\')).toBeNull();
  });

  it('支持 Windows 多盘根目录匹配', () => {
    expect(findContainingRoot('E:\\repo\\client', ['C:\\', 'D:\\', 'E:\\'])).toBe('E:\\');
    expect(isPathWithinRoot('E:\\repo\\client', 'E:\\')).toBe(true);
    expect(isPathWithinRoot('E:\\repo-client', 'E:\\repo')).toBe(false);
  });

  it('拼接目录时保留对应系统分隔符', () => {
    expect(joinDirectoryPath('C:\\Work', 'OpenAWork')).toBe('C:\\Work\\OpenAWork');
    expect(joinDirectoryPath('/home/await', 'OpenAWork')).toBe('/home/await/OpenAWork');
  });

  it('计算 Windows 路径相对工作区的相对路径', () => {
    expect(getRelativePath('E:\\repo\\client\\src\\index.ts', 'E:\\repo\\client')).toBe(
      'src/index.ts',
    );
    expect(getRelativePath('E:\\repo\\client', 'E:\\repo\\client')).toBe('.');
  });

  it('重定基路径时保留对应系统分隔符', () => {
    expect(
      rebasePath('E:\\repo\\client\\src\\index.ts', 'E:\\repo\\client', 'E:\\repo\\renamed-client'),
    ).toBe('E:\\repo\\renamed-client\\src\\index.ts');
    expect(rebasePath('/workspace/demo/src/index.ts', '/workspace/demo', '/workspace/next')).toBe(
      '/workspace/next/src/index.ts',
    );
  });

  it('区分绝对路径与带目录的相对路径', () => {
    expect(isAbsolutePath('/workspace/demo/src/index.ts')).toBe(true);
    expect(isAbsolutePath('E:\\repo\\src\\index.ts')).toBe(true);
    expect(isAbsolutePath('E:/repo/src/index.ts')).toBe(true);
    expect(isAbsolutePath('\\\\host\\share\\index.ts')).toBe(true);
    expect(isAbsolutePath('packages/web-client/src/index.ts')).toBe(false);
    expect(isAbsolutePath('index.ts')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);

    expect(hasDirectorySeparator('packages/web-client/src/index.ts')).toBe(true);
    expect(hasDirectorySeparator('src\\index.ts')).toBe(true);
    expect(hasDirectorySeparator('index.ts')).toBe(false);
  });

  it('把工作区相对路径拼成根下的绝对路径', () => {
    expect(
      resolvePathWithinRoot('packages/web-client/src/infra/plugins.ts', '/home/await/repo'),
    ).toBe('/home/await/repo/packages/web-client/src/infra/plugins.ts');
    expect(resolvePathWithinRoot('./src/index.ts', '/home/await/repo/')).toBe(
      '/home/await/repo/src/index.ts',
    );
    expect(resolvePathWithinRoot('src/../lib/util.py', '/home/await/repo')).toBe(
      '/home/await/repo/lib/util.py',
    );
    expect(resolvePathWithinRoot('.', '/home/await/repo')).toBe('/home/await/repo');
  });

  it('按根的系统分隔符拼接相对路径', () => {
    expect(resolvePathWithinRoot('packages/web-client/src/index.ts', 'E:\\repo\\client')).toBe(
      'E:\\repo\\client\\packages\\web-client\\src\\index.ts',
    );
    expect(resolvePathWithinRoot('src\\index.ts', 'E:\\repo\\client')).toBe(
      'E:\\repo\\client\\src\\index.ts',
    );
  });

  it('相对路径越出工作区根时返回 null', () => {
    expect(resolvePathWithinRoot('../secret.txt', '/home/await/repo')).toBeNull();
    expect(resolvePathWithinRoot('a/../../secret.txt', '/home/await/repo')).toBeNull();
    expect(resolvePathWithinRoot('src/index.ts', '')).toBeNull();
    expect(resolvePathWithinRoot('', '/home/await/repo')).toBeNull();
  });

  it('窄栏位路径标签超预算时从左侧省略中间层级', () => {
    expect(formatWorkspacePathLabel('/home/await/project/OpenAWork')).toBe('/…/project/OpenAWork');
    expect(formatWorkspacePathLabel('/home/await/project/OpenAWork/services/agent-gateway')).toBe(
      '/…/services/agent-gateway',
    );
  });

  it('窄栏位路径标签在预算内原样返回', () => {
    expect(formatWorkspacePathLabel('/home/await/repo')).toBe('/home/await/repo');
    expect(formatWorkspacePathLabel('/home/await/repo/')).toBe('/home/await/repo');
    expect(formatWorkspacePathLabel('E:\\repo\\client\\src')).toBe('E:\\repo\\client\\src');
    expect(formatWorkspacePathLabel('\\\\host\\share\\repo')).toBe('\\\\host\\share\\repo');
  });

  it('窄栏位路径标签可排除已在标题行展示的目录名', () => {
    expect(
      formatWorkspacePathLabel('/home/await/project/OpenAWork', { includeBasename: false }),
    ).toBe('/home/await/project');
    expect(formatWorkspacePathLabel('/home/await/repo', { includeBasename: false })).toBe(
      '/home/await',
    );
    // 只剩根锚点时交回根本身，供调用方判定「根目录」语境。
    expect(formatWorkspacePathLabel('C:\\repo', { includeBasename: false })).toBe('C:\\');
  });

  it('窄栏位路径标签的预算与最小尾部层级可覆盖', () => {
    expect(formatWorkspacePathLabel('/home/await/repo', { maxLength: 8 })).toBe('/…/await/repo');
    // 最小尾部层级放宽到 1 时，长路径才会收缩到只剩末段。
    expect(
      formatWorkspacePathLabel('/home/await/project/OpenAWork/services/agent-gateway', {
        minTailSegments: 1,
      }),
    ).toBe('/…/agent-gateway');
  });

  it('根路径与空路径不产出可省略的标签', () => {
    expect(formatWorkspacePathLabel('/')).toBe('');
    expect(formatWorkspacePathLabel('D:\\')).toBe('');
    expect(formatWorkspacePathLabel('  ')).toBe('');
    expect(formatWorkspacePathLabel(null)).toBe('');
  });
});
