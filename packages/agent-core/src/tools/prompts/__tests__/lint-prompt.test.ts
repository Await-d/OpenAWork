import { describe, it, expect } from 'vitest';
import {
  POST_WRITE_LINT_USAGE_GUIDE,
  POST_WRITE_LINT_TOOLS_LIST,
} from '../lint-prompt.js';

describe('Post-Write Lint 工具提示词', () => {
  describe('基本结构', () => {
    it('应该导出使用指南', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toBeDefined();
      expect(typeof POST_WRITE_LINT_USAGE_GUIDE).toBe('string');
      expect(POST_WRITE_LINT_USAGE_GUIDE.length).toBeGreaterThan(0);
    });

    it('应该导出工具列表', () => {
      expect(POST_WRITE_LINT_TOOLS_LIST).toBeDefined();
      expect(Array.isArray(POST_WRITE_LINT_TOOLS_LIST)).toBe(true);
      expect(POST_WRITE_LINT_TOOLS_LIST.length).toBeGreaterThan(0);
    });

    it('工具列表应该包含 post_write_lint', () => {
      expect(POST_WRITE_LINT_TOOLS_LIST).toContain('post_write_lint');
    });
  });

  describe('核心章节', () => {
    const requiredSections = [
      '核心概念',
      '什么是 Post-Write Lint？',
      '集成方式',
      'Lint 反馈格式',
      '处理 Lint 反馈',
      '自动修复',
      '常见 Lint 问题',
      '最佳实践',
      '配置优化',
      '错误处理',
      '与其他工具集成',
      '性能考虑',
      '常见问题',
      '总结',
    ];

    requiredSections.forEach((section) => {
      it(`应该包含"${section}"章节`, () => {
        expect(POST_WRITE_LINT_USAGE_GUIDE).toContain(section);
      });
    });
  });

  describe('核心特性说明', () => {
    it('应该说明增量检查特性', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('增量检查');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('只检查修改的文件');
    });

    it('应该说明自动触发特性', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('自动触发');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('编辑成功后自动运行');
    });

    it('应该说明即时反馈特性', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('即时反馈');
    });

    it('应该说明非阻塞特性', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('非阻塞');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('不影响编辑成功');
    });
  });

  describe('反馈格式说明', () => {
    it('应该包含反馈格式示例', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('[post-write-lint]');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('✗');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('⚠');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('✓');
    });

    it('应该说明字段含义', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('文件路径');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('执行时间');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('严重级别');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('Error');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('Warning');
    });

    it('应该说明状态标记', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('有错误');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('有警告');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('检查通过');
    });
  });

  describe('处理流程说明', () => {
    it('应该包含处理流程代码示例', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('applyEdits');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('lintFeedback');
    });

    it('应该说明严重级别处理策略', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('必须修复');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('建议修复');
    });

    it('应该包含解析反馈的代码示例', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('parseLintFeedback');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('ParsedLintFeedback');
    });
  });

  describe('常见问题说明', () => {
    const commonRules = [
      'no-unused-vars',
      'semi',
      'no-console',
      'no-explicit-any',
      'explicit-function-return-type',
    ];

    commonRules.forEach((rule) => {
      it(`应该包含规则 ${rule} 的说明`, () => {
        expect(POST_WRITE_LINT_USAGE_GUIDE).toContain(rule);
      });
    });

    it('应该包含代码示例', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('❌ 错误');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('✅ 正确');
    });

    it('应该说明是否可自动修复', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('修复方法');
    });
  });

  describe('最佳实践说明', () => {
    it('应该包含优先处理错误的实践', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('优先处理错误');
    });

    it('应该包含理解错误根因的实践', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('理解错误根因');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('不要盲目修复');
    });

    it('应该包含保持一致性的实践', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('一致性');
    });

    it('应该包含增量修复的实践', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('增量修复');
    });
  });

  describe('配置优化说明', () => {
    it('应该包含 ESLint 配置示例', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('.eslintrc.js');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('parser');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('plugins');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('rules');
    });

    it('应该说明性能优化', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('性能优化');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('超时控制');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('15 秒');
    });
  });

  describe('错误处理说明', () => {
    it('应该说明 lint 失败的处理', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('Lint 失败不会阻塞编辑');
    });

    it('应该说明配置错误的处理', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('eslint 配置');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('安静跳过');
    });
  });

  describe('集成说明', () => {
    it('应该说明与 Prettier 的集成', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('Prettier');
    });

    it('应该说明与 Git Hooks 的集成', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('Git Hooks');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('pre-commit');
    });
  });

  describe('性能说明', () => {
    it('应该说明增量检查的性能优势', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('50-200ms');
    });

    it('应该说明何时会跳过 lint', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('何时会跳过');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('没有 eslint 配置');
    });
  });

  describe('常见问题解答', () => {
    const faqs = [
      'Lint 失败会阻止编辑吗',
      '如何禁用某个规则',
      '为什么没有 lint 反馈',
      '如何加快 lint 速度',
      '可以手动触发 lint 吗',
    ];

    faqs.forEach((faq) => {
      it(`应该回答"${faq}"`, () => {
        expect(POST_WRITE_LINT_USAGE_GUIDE).toContain(faq);
      });
    });
  });

  describe('代码示例', () => {
    it('应该包含 TypeScript 代码块', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('```typescript');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('```');
    });

    it('应该包含完整的代码示例', () => {
      // 检查是否有足够的代码示例（至少10个代码块）
      const codeBlockCount = (POST_WRITE_LINT_USAGE_GUIDE.match(/```typescript/g) || [])
        .length;
      expect(codeBlockCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('中文内容', () => {
    it('应该使用中文编写', () => {
      // 检查是否包含足够的中文字符
      const chineseCharCount = (POST_WRITE_LINT_USAGE_GUIDE.match(/[一-龥]/g) || [])
        .length;
      expect(chineseCharCount).toBeGreaterThan(1000);
    });

    it('应该使用专业术语', () => {
      const terms = ['代码质量', '自动修复', '增量检查', '即时反馈', '最佳实践'];
      terms.forEach((term) => {
        expect(POST_WRITE_LINT_USAGE_GUIDE).toContain(term);
      });
    });
  });

  describe('格式规范', () => {
    it('应该使用 Markdown 标题', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('##');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('###');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('####');
    });

    it('应该包含表格', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('|');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('---');
    });

    it('应该使用列表', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('- ');
    });
  });

  describe('工具列表类型', () => {
    it('应该是只读数组', () => {
      // TypeScript 类型检查会确保这一点
      // 这里只是运行时验证不能被修改
      expect(() => {
        // @ts-expect-error - 测试只读属性
        POST_WRITE_LINT_TOOLS_LIST[0] = 'test';
      }).toThrow();
    });
  });

  describe('内容完整性', () => {
    it('提示词长度应该足够详细', () => {
      // 至少 10000 字符
      expect(POST_WRITE_LINT_USAGE_GUIDE.length).toBeGreaterThan(10000);
    });

    it('应该包含实用的工作流程图', () => {
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('→');
      expect(POST_WRITE_LINT_USAGE_GUIDE).toContain('↓');
    });
  });
});
