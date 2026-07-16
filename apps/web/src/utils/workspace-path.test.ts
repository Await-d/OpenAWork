import { describe, expect, it } from 'vitest';
import {
  findContainingRoot,
  getParentPath,
  getPathBasename,
  isPathWithinRoot,
  joinDirectoryPath,
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
});
