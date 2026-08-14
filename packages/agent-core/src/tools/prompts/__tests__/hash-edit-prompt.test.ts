import { describe, it, expect } from 'vitest';
import { HASH_EDIT_TOOL_USAGE_GUIDE, HASH_EDIT_TOOLS_LIST } from '../hash-edit-prompt.js';

describe('哈希编辑工具提示词', () => {
  it('应该包含核心章节', () => {
    const sections = [
      '核心概念',
      '工具函数',
      '完整工作流',
      '错误处理',
      'Lint 反馈处理',
      '最佳实践',
      '性能优化',
      '使用场景',
      '常见问题',
    ];

    for (const section of sections) {
      expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain(section);
    }
  });

  it('应该包含所有工具函数的说明', () => {
    const functions = [
      'computeLineHashes',
      'formatWithHashes',
      'applyEdit',
      'applyEdits',
    ];

    for (const func of functions) {
      expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain(func);
    }
  });

  it('应该包含代码示例', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('```typescript');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('await');
  });

  it('应该包含错误处理说明', () => {
    const errors = [
      'Hash Mismatch',
      'Old Content Mismatch',
      'Line Out of Range',
      'Unable to Load File',
      'Atomic Apply Failed',
    ];

    for (const error of errors) {
      expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain(error);
    }
  });

  it('应该强调原子性', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('原子性');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('回滚');
  });

  it('应该包含工作流示例', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('工作流 1');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('工作流 2');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('工作流 3');
  });

  it('应该包含最佳实践示例', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('实践 1');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('实践 2');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('实践 3');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('实践 4');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('实践 5');
  });

  it('应该包含性能优化建议', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('优化 1');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('优化 2');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('优化 3');
  });

  it('应该包含 Lint 反馈处理', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Lint 反馈格式');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('处理 Lint 反馈');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('自动修复 Lint 问题');
  });

  it('应该包含使用场景', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('场景 1');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('场景 2');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('场景 3');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('场景 4');
  });

  it('应该包含常见问题解答', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Q1:');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Q2:');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Q3:');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Q4:');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('Q5:');
  });

  it('应该包含核心优势说明', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('并发安全');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('原子性');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('精确定位');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('自动 Lint');
  });

  it('应该包含与传统编辑的对比', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('与传统编辑的对比');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('传统编辑');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('哈希锚定编辑');
  });

  it('HASH_EDIT_TOOLS_LIST 应该包含工具名称', () => {
    expect(HASH_EDIT_TOOLS_LIST).toContain('hash_edit');
    expect(HASH_EDIT_TOOLS_LIST.length).toBe(1);
  });

  it('应该包含详细的接口定义', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('interface LineHash');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('interface AnchoredEdit');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('lineNumber');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('expectedHash');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('oldContent');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('newContent');
  });

  it('应该强调批量编辑的优势', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('批量编辑（推荐）');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('优先使用 applyEdits');
  });

  it('应该包含跨文件编辑说明', () => {
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('跨文件批量编辑');
    expect(HASH_EDIT_TOOL_USAGE_GUIDE).toContain('跨文件编辑也是原子性的');
  });
});
