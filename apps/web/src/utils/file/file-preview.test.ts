import { describe, expect, it } from 'vitest';
import {
  getFilePreviewKind,
  getPreviewTitle,
  isBinaryPreviewKind,
  isNonTextPreviewKind,
} from './file-preview.js';

describe('getFilePreviewKind', () => {
  it('识别 Mermaid 图表源码文件', () => {
    expect(getFilePreviewKind('/workspace/demo/架构.mmd')).toBe('chart');
    expect(getFilePreviewKind('/workspace/demo/flow.mermaid')).toBe('chart');
    expect(getFilePreviewKind('/workspace/demo/ARCHIVE.MMD')).toBe('chart');
  });

  it('图表是文本类型，仍走文本读取路径', () => {
    expect(isNonTextPreviewKind('chart')).toBe(false);
  });

  it('识别分隔符表格文件', () => {
    expect(getFilePreviewKind('/workspace/demo/data.csv')).toBe('table');
    expect(getFilePreviewKind('/workspace/demo/data.tsv')).toBe('table');
  });

  it('识别常见纯文本类型，含点开头的配置文件', () => {
    expect(getFilePreviewKind('/workspace/demo/notes.txt')).toBe('text');
    expect(getFilePreviewKind('/workspace/demo/app.log')).toBe('text');
    expect(getFilePreviewKind('/workspace/demo/config.yaml')).toBe('text');
    expect(getFilePreviewKind('/workspace/demo/pom.xml')).toBe('text');
    expect(getFilePreviewKind('/workspace/demo/schema.sql')).toBe('text');
    expect(getFilePreviewKind('/workspace/demo/.gitignore')).toBe('text');
  });

  it('表格与纯文本都不是二进制，不需要占位提示', () => {
    expect(isBinaryPreviewKind('table')).toBe(false);
    expect(isBinaryPreviewKind('text')).toBe(false);
    expect(isNonTextPreviewKind('table')).toBe(false);
    expect(isNonTextPreviewKind('text')).toBe(false);
  });

  it('新类型有独立的预览标题', () => {
    expect(getPreviewTitle('chart')).toBe('图表预览');
    expect(getPreviewTitle('table')).toBe('表格预览');
    expect(getPreviewTitle('text')).toBe('文本预览');
  });

  it('不认识的扩展名仍返回 null', () => {
    expect(getFilePreviewKind('/workspace/demo/data.bin')).toBeNull();
  });
});
