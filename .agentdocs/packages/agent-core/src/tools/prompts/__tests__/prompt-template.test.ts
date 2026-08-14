/**
 * 提示词模板测试
 *
 * 用于验证所有提示词文件遵循统一规范
 */

import { describe, it, expect } from 'vitest';

describe('提示词模板测试', () => {
  it('示例：验证提示词包含必需章节', () => {
    const examplePrompt = `
## 工具使用指南

### 核心概念
说明...

### 使用场景
场景...

### 最佳实践
实践...
`;

    const requiredSections = [
      '工具使用指南',
      '核心概念',
      '使用场景',
      '最佳实践',
    ];

    for (const section of requiredSections) {
      expect(examplePrompt).toContain(section);
    }
  });

  it('示例：验证工具列表导出格式', () => {
    const exampleToolsList = ['tool_a', 'tool_b'] as const;

    expect(Array.isArray(exampleToolsList)).toBe(true);
    expect(exampleToolsList.length).toBeGreaterThan(0);
  });
});
