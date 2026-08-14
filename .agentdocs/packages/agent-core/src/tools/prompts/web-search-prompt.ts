/**
 * Web 搜索工具使用提示词
 *
 * 参考: Claude Code WebSearchTool/prompt.ts
 */

export const WEB_SEARCH_TOOL_USAGE_GUIDE = `
## Web 搜索工具使用指南

### 基本用法

#### web_search - 网络搜索
**使用场景**:
- 查找最新资讯和新闻
- 搜索技术文档和教程
- 验证事实和数据
- 研究技术问题和解决方案

**参数说明**:
- \`query\`: 搜索关键词（必需）
- \`maxResults\`: 返回结果数量（默认 5，最大 20）
- \`provider\`: 搜索提供商（默认 duckduckgo）
- \`apiKey\`: 提供商 API 密钥（部分提供商需要）

### 搜索提供商对比

#### 1. DuckDuckGo（推荐默认）
**特点**:
- ✅ 无需 API Key
- ✅ 快速响应
- ✅ 隐私保护

**适用场景**:
- 快速查找常见信息
- 不需要 API 配置的场景

#### 2. Tavily（推荐研究）
**特点**:
- ✅ 专为 AI 优化
- ✅ 结果质量高
- ⚠️ 需要 API Key

**适用场景**:
- 深度研究和分析
- 需要高质量结果

#### 3. Zhipu 智谱（推荐中文）
**特点**:
- ✅ 中文搜索优化
- ✅ 国内访问快
- ⚠️ 需要 API Key

**适用场景**:
- 中文内容搜索
- 国内资源查找

### 搜索技巧

#### 技巧 1: 精确关键词
❌ 不好: "怎么用 React"
✅ 好: "React Hooks useEffect 依赖数组原理"

#### 技巧 2: 使用引号精确匹配
\`\`\`typescript
web_search({
  query: '"Cannot read property of undefined" TypeScript'
})
\`\`\`

#### 技巧 3: 站点限定搜索
\`\`\`typescript
web_search({
  query: "site:stackoverflow.com TypeScript generics"
})
\`\`\`

### 提供商选择策略

#### 决策流程
\`\`\`
需要中文结果？
  ├─ 是 → 使用 zhipu
  └─ 否 → 继续

需要深度研究？
  ├─ 是 → 使用 tavily 或 exa
  └─ 否 → 使用 duckduckgo
\`\`\`

### 场景推荐表

| 场景 | 推荐提供商 | 理由 |
|------|----------|------|
| 快速查找常识 | duckduckgo | 无需配置，快速 |
| 技术深度研究 | tavily | AI 优化，质量高 |
| 中文内容搜索 | zhipu | 中文优化 |
| 开源项目查找 | duckduckgo | 免费，覆盖 GitHub |

### 错误处理

#### 错误 1: API Key 无效
**解决方案**:
1. 检查环境变量是否正确设置
2. 验证 API Key 是否过期
3. 回退到 duckduckgo（无需 Key）

#### 错误 2: 无结果返回
**解决方案**:
1. 简化搜索关键词
2. 去除过于严格的限定条件
3. 尝试不同的提供商
`;

export const WEB_SEARCH_TOOLS_LIST = ['web_search'] as const;

export const WEB_SEARCH_PROVIDERS = [
  'duckduckgo',
  'tavily',
  'exa',
  'serper',
  'searxng',
  'bocha',
  'zhipu',
  'google',
  'bing',
] as const;
