import { describe, it, expect } from 'vitest';
import { LSP_TOOL_USAGE_GUIDE, LSP_TOOLS_LIST } from '../prompts/lsp-prompt.js';

describe('LSP 工具提示词', () => {
  describe('LSP_TOOLS_LIST', () => {
    it('应该包含所有 10 个 LSP 工具名称', () => {
      expect(LSP_TOOLS_LIST).toHaveLength(10);
      expect(LSP_TOOLS_LIST).toEqual([
        'lsp_diagnostics',
        'lsp_touch',
        'lsp_goto_definition',
        'lsp_goto_implementation',
        'lsp_find_references',
        'lsp_symbols',
        'lsp_prepare_rename',
        'lsp_rename',
        'lsp_hover',
        'lsp_call_hierarchy',
      ]);
    });

    it('工具名称应该符合命名规范', () => {
      for (const toolName of LSP_TOOLS_LIST) {
        // 工具名应该以 lsp_ 开头
        expect(toolName).toMatch(/^lsp_[a-z_]+$/);
        // 不应该有大写字母
        expect(toolName).toBe(toolName.toLowerCase());
      }
    });
  });

  describe('LSP_TOOL_USAGE_GUIDE', () => {
    it('应该是非空字符串', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toBeTruthy();
      expect(typeof LSP_TOOL_USAGE_GUIDE).toBe('string');
      expect(LSP_TOOL_USAGE_GUIDE.length).toBeGreaterThan(1000);
    });

    it('应该包含所有 LSP 工具的使用说明', () => {
      for (const toolName of LSP_TOOLS_LIST) {
        expect(LSP_TOOL_USAGE_GUIDE).toContain(toolName);
      }
    });

    it('应该包含核心章节标题', () => {
      const sections = [
        '## LSP 工具使用指南',
        '### 概述',
        '### 核心工具',
        '### 代码导航工具',
        '### 符号搜索工具',
        '### 符号信息工具',
        '### 重命名工具',
        '### 调用层次工具',
        '### 工具组合模式',
        '### 常见错误处理',
        '### 性能优化建议',
        '### 最佳实践总结',
      ];

      for (const section of sections) {
        expect(LSP_TOOL_USAGE_GUIDE).toContain(section);
      }
    });

    it('应该包含核心工具的详细说明', () => {
      // lsp_diagnostics
      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_diagnostics');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('获取诊断信息');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**使用场景**');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**参数说明**');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**最佳实践**');

      // lsp_touch
      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_touch');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('通知文件变更');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('waitForDiagnostics');
    });

    it('应该包含代码导航工具的说明', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_goto_definition');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('跳转到定义');

      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_goto_implementation');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('跳转到实现');

      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_find_references');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('查找引用');
    });

    it('应该包含符号搜索工具的说明', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_symbols');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('符号列表与搜索');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('文档模式');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('工作区模式');
    });

    it('应该包含重命名工具的安全警告', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_prepare_rename');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('验证重命名');

      expect(LSP_TOOL_USAGE_GUIDE).toContain('#### lsp_rename');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('执行重命名');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('⚠️');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('危险操作');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('必须先');
    });

    it('应该包含工作流示例', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('工作流');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('示例');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('场景');
      // 检查代码块
      expect(LSP_TOOL_USAGE_GUIDE).toContain('```');
    });

    it('应该包含工具组合模式', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('模式 1');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('模式 2');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('模式 3');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('代码理解流程');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('重构前影响评估');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('代码修改验证工作流');
    });

    it('应该包含常见错误处理', () => {
      const errors = [
        'No LSP server configured',
        'Position out of range',
        'Symbol not found',
        'Rename failed',
        'LSP server timeout',
        'Diagnostics not ready',
      ];

      for (const error of errors) {
        expect(LSP_TOOL_USAGE_GUIDE).toContain(error);
      }

      // 每个错误都应该有原因和解决方法
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**原因**');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**解决方法**');
    });

    it('应该包含性能优化建议', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('批量操作优化');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('符号搜索优化');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('避免重复查询');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('❌');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('✅');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('低效方式');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('高效方式');
    });

    it('应该包含最佳实践总结', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toContain('最佳实践总结');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('修改前验证');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('修改后通知');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('批量操作');
    });

    it('应该包含所有工具的参数说明', () => {
      // 位置参数
      expect(LSP_TOOL_USAGE_GUIDE).toContain('filePath');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('line');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('character');

      // 特定工具参数
      expect(LSP_TOOL_USAGE_GUIDE).toContain('includeDeclaration');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('scope');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('query');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('limit');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('newName');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('direction');
    });

    it('应该说明参数的数据类型和格式', () => {
      // 行号从 1 开始
      expect(LSP_TOOL_USAGE_GUIDE).toContain('从 1 开始');
      // 列号从 0 开始
      expect(LSP_TOOL_USAGE_GUIDE).toContain('从 0 开始');
      // 方向枚举值
      expect(LSP_TOOL_USAGE_GUIDE).toContain('incoming');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('outgoing');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('both');
    });

    it('应该包含具体的使用示例', () => {
      // 检查是否有具体的文件名和行号示例
      expect(LSP_TOOL_USAGE_GUIDE).toMatch(/\w+\.ts/);
      expect(LSP_TOOL_USAGE_GUIDE).toMatch(/line=\d+/);
      expect(LSP_TOOL_USAGE_GUIDE).toMatch(/character=\d+/);
    });

    it('内容应该使用中文', () => {
      // 检查主要内容是中文
      const chineseCharCount = (LSP_TOOL_USAGE_GUIDE.match(/[一-龥]/g) || []).length;
      const totalCharCount = LSP_TOOL_USAGE_GUIDE.length;

      // 中文字符应该占相当比例（至少 20%）
      expect(chineseCharCount / totalCharCount).toBeGreaterThan(0.2);
    });

    it('应该有清晰的文档结构', () => {
      // 检查 Markdown 结构
      expect(LSP_TOOL_USAGE_GUIDE).toContain('##');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('###');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('####');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('**');
      expect(LSP_TOOL_USAGE_GUIDE).toContain('```');
    });
  });

  describe('导出完整性', () => {
    it('LSP_TOOLS_LIST 应该可以被外部导入', () => {
      expect(LSP_TOOLS_LIST).toBeDefined();
      expect(Array.isArray(LSP_TOOLS_LIST)).toBe(true);
    });

    it('LSP_TOOL_USAGE_GUIDE 应该可以被外部导入', () => {
      expect(LSP_TOOL_USAGE_GUIDE).toBeDefined();
      expect(typeof LSP_TOOL_USAGE_GUIDE).toBe('string');
    });
  });

  describe('与现有工具定义的一致性', () => {
    it('LSP_TOOLS_LIST 应该与 ALL_LSP_TOOL_NAMES 一致', async () => {
      // 动态导入避免循环依赖
      const { ALL_LSP_TOOL_NAMES } = await import('../lsp.js');

      expect(LSP_TOOLS_LIST).toEqual(ALL_LSP_TOOL_NAMES);
    });

    it('应该覆盖核心工具', async () => {
      const { LSP_TOOLS } = await import('../lsp.js');

      for (const tool of LSP_TOOLS) {
        expect(LSP_TOOLS_LIST).toContain(tool.name);
      }
    });

    it('应该覆盖高级工具', async () => {
      const { LSP_RICHER_TOOL_METADATA } = await import('../lsp.js');

      for (const meta of LSP_RICHER_TOOL_METADATA) {
        expect(LSP_TOOLS_LIST).toContain(meta.name);
      }
    });
  });
});
