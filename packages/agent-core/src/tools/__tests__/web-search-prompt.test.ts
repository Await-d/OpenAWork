import { describe, it, expect } from 'vitest';
import {
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  WEB_SEARCH_PROVIDERS,
} from '../prompts/web-search-prompt.js';

describe('Web 搜索工具提示词', () => {
  describe('基础导出', () => {
    it('应该导出工具列表', () => {
      expect(WEB_SEARCH_TOOLS_LIST).toBeDefined();
      expect(WEB_SEARCH_TOOLS_LIST).toContain('web_search');
      expect(WEB_SEARCH_TOOLS_LIST.length).toBe(1);
    });

    it('应该导出提供商列表', () => {
      expect(WEB_SEARCH_PROVIDERS).toBeDefined();
      expect(WEB_SEARCH_PROVIDERS.length).toBe(9);
      expect(WEB_SEARCH_PROVIDERS).toEqual([
        'duckduckgo',
        'tavily',
        'exa',
        'serper',
        'searxng',
        'bocha',
        'zhipu',
        'google',
        'bing',
      ]);
    });

    it('应该导出使用指南', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toBeDefined();
      expect(typeof WEB_SEARCH_TOOL_USAGE_GUIDE).toBe('string');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE.length).toBeGreaterThan(1000);
    });
  });

  describe('提供商覆盖', () => {
    it('应该包含所有提供商的说明', () => {
      for (const provider of WEB_SEARCH_PROVIDERS) {
        expect(WEB_SEARCH_TOOL_USAGE_GUIDE.toLowerCase()).toContain(provider);
      }
    });

    it('应该包含每个提供商的特点说明', () => {
      const providers = [
        'duckduckgo',
        'tavily',
        'exa',
        'serper',
        'searxng',
        'bocha',
        'zhipu',
        'google',
        'bing',
      ];

      for (const provider of providers) {
        // 每个提供商应该有"特点"部分
        expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('特点');
      }
    });

    it('应该包含每个提供商的适用场景', () => {
      // 检查是否包含"适用场景"关键字
      const scenarioCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/适用场景/g) || []).length;
      expect(scenarioCount).toBeGreaterThanOrEqual(9); // 至少 9 个提供商的适用场景
    });

    it('应该包含每个提供商的使用示例', () => {
      // 检查是否包含"使用示例"关键字
      const exampleCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/使用示例/g) || []).length;
      expect(exampleCount).toBeGreaterThanOrEqual(9); // 至少 9 个提供商的使用示例
    });
  });

  describe('核心章节', () => {
    it('应该包含所有必需的章节', () => {
      const sections = [
        '基本用法',
        '搜索提供商对比',
        '搜索技巧',
        '提供商选择策略',
        '结果数量优化',
        '多提供商策略',
        '错误处理',
        '工作流模式',
        '性能优化建议',
        '安全和隐私',
        '常见问题',
      ];

      for (const section of sections) {
        expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain(section);
      }
    });

    it('基本用法章节应该包含参数说明', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('参数说明');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('query');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('maxResults');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('provider');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('apiKey');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('baseUrl');
    });

    it('搜索技巧章节应该包含多个技巧', () => {
      const techniques = [
        '精确关键词',
        '引号精确匹配',
        '排除无关内容',
        '站点限定搜索',
        '时间限定',
        '文件类型搜索',
      ];

      for (const technique of techniques) {
        expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain(technique);
      }
    });

    it('多提供商策略章节应该包含三种策略', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Sequential');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('First-Success');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Merge');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('顺序回退');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('最快响应');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('结果合并');
    });

    it('错误处理章节应该包含常见错误', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('API Key 无效');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('请求超时');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('配额超限');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('无结果返回');
    });
  });

  describe('代码示例', () => {
    it('应该包含 TypeScript 代码示例', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('```typescript');
      const codeBlockCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/```typescript/g) || []).length;
      expect(codeBlockCount).toBeGreaterThan(10); // 至少 10 个代码示例
    });

    it('代码示例应该包含 web_search 调用', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('web_search({');
    });

    it('应该包含 searchMultiProvider 示例', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('searchMultiProvider');
    });

    it('代码示例应该展示不同的提供商用法', () => {
      // 检查至少包含几个提供商的具体使用示例
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('provider: "duckduckgo"');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('provider: "tavily"');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('provider: "zhipu"');
    });
  });

  describe('决策指导', () => {
    it('应该包含决策流程图', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('决策流程');
    });

    it('应该包含场景推荐表', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('场景推荐');
    });

    it('应该包含 maxResults 选择指南', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('maxResults 选择指南');
    });

    it('应该包含性能考虑说明', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('性能考虑');
    });
  });

  describe('工作流模式', () => {
    it('应该包含多种工作流模式', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('快速事实验证');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('深度技术研究');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('多语言信息收集');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('时效性追踪');
    });

    it('每个工作流应该有具体步骤', () => {
      // 检查是否有编号步骤
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('1.');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('2.');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('3.');
    });
  });

  describe('性能优化', () => {
    it('应该包含性能优化建议', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('缓存搜索结果');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('并行搜索');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('渐进式增加结果');
    });

    it('性能优化应该有代码示例', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('cache');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Promise.all');
    });
  });

  describe('安全和隐私', () => {
    it('应该包含隐私考虑', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('隐私考虑');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('避免在查询中包含敏感信息');
    });

    it('应该包含 API Key 安全建议', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('API Key 安全');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('环境变量');
    });

    it('应该包含使用限制说明', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('使用限制');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('服务条款');
    });
  });

  describe('FAQ', () => {
    it('应该包含常见问题解答', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('常见问题');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('FAQ');
    });

    it('FAQ 应该包含多个问答', () => {
      const questionCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/\*\*Q\d+:/g) || []).length;
      expect(questionCount).toBeGreaterThanOrEqual(5); // 至少 5 个问题
    });

    it('每个问题应该有对应的答案', () => {
      const answerCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/A:/g) || []).length;
      const questionCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/\*\*Q\d+:/g) || []).length;
      expect(answerCount).toBe(questionCount); // 问答数量应该相等
    });
  });

  describe('内容质量', () => {
    it('应该使用中文编写', () => {
      // 检查是否包含常见的中文关键词
      const chineseKeywords = [
        '使用',
        '提供商',
        '搜索',
        '结果',
        '优化',
        '错误',
        '场景',
      ];

      for (const keyword of chineseKeywords) {
        expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain(keyword);
      }
    });

    it('应该使用表格展示对比信息', () => {
      // 检查是否包含 Markdown 表格
      const tableCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/\|.*\|.*\|/g) || []).length;
      expect(tableCount).toBeGreaterThan(5); // 至少有一些表格行
    });

    it('应该使用符号标记优缺点', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('✅');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('⚠️');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('❌');
    });

    it('应该包含实用的提示和警告', () => {
      // 检查是否有注意事项
      const noteCount = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(/注意/g) || []).length;
      expect(noteCount).toBeGreaterThan(0);
    });
  });

  describe('多提供商策略详解', () => {
    it('应该详细说明 Sequential 策略', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Sequential');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('顺序回退');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('rolloutMode: "sequential"');
    });

    it('应该详细说明 First-Success 策略', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('First-Success');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('最快响应');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('rolloutMode: "first-success"');
    });

    it('应该详细说明 Merge 策略', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Merge');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('结果合并');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('rolloutMode: "merge"');
    });

    it('Merge 策略应该说明权重机制', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('weight');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('权重');
    });

    it('应该说明每种策略的适用场景', () => {
      const strategyScenarios = [
        '使用场景',
        '工作原理',
        '适用场景',
        '注意事项',
      ];

      for (const scenario of strategyScenarios) {
        const count = (WEB_SEARCH_TOOL_USAGE_GUIDE.match(new RegExp(scenario, 'g')) || []).length;
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  describe('特定提供商的详细说明', () => {
    it('DuckDuckGo 应该标注为推荐默认', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('DuckDuckGo');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('推荐默认');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('无需 API Key');
    });

    it('Tavily 应该标注为推荐研究', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Tavily');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('推荐研究');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('AI 优化');
    });

    it('Zhipu 应该标注为推荐中文', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Zhipu');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('推荐中文');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('中文搜索优化');
    });

    it('Exa 应该标注为推荐语义搜索', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('Exa');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('推荐语义搜索');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('语义理解');
    });
  });

  describe('实用性检查', () => {
    it('应该包含环境变量使用示例', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('process.env');
    });

    it('应该包含错误处理示例', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('try');
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('catch');
    });

    it('应该包含 AbortSignal 说明', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('signal');
    });

    it('应该说明超时配置', () => {
      expect(WEB_SEARCH_TOOL_USAGE_GUIDE).toContain('timeout');
    });
  });
});
