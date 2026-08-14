/**
 * Web 搜索工具使用提示词
 *
 * 为 Agent 提供详细的 Web 搜索工具使用指南，包括：
 * - 9 个提供商的详细对比
 * - 搜索技巧和优化建议
 * - 多提供商策略说明
 * - 错误处理和安全指导
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
- 查找开源项目和代码示例

**参数说明**:
- \`query\`: 搜索关键词（必需）
- \`maxResults\`: 返回结果数量（默认 5，最大 20）
- \`provider\`: 搜索提供商（默认 duckduckgo）
- \`apiKey\`: 提供商 API 密钥（部分提供商需要）
- \`baseUrl\`: 提供商配置 URL（部分提供商需要）

**基础示例**:
\`\`\`typescript
// 简单搜索（使用默认 DuckDuckGo）
web_search({
  query: "TypeScript 5.0 新特性",
  maxResults: 5
})

// 指定提供商
web_search({
  query: "React 最佳实践",
  provider: "tavily",
  apiKey: "your-api-key",
  maxResults: 10
})
\`\`\`

### 搜索提供商对比

#### 1. DuckDuckGo（推荐默认）
**特点**:
- ✅ 无需 API Key
- ✅ 快速响应
- ✅ 隐私保护
- ⚠️ 结果数量有限
- ⚠️ 深度不如专业搜索

**适用场景**:
- 快速查找常见信息
- 不需要 API 配置的场景
- 隐私敏感的搜索

**使用示例**:
\`\`\`typescript
web_search({
  query: "JavaScript 闭包原理",
  provider: "duckduckgo"
})
\`\`\`

#### 2. Tavily（推荐研究）
**特点**:
- ✅ 专为 AI 优化
- ✅ 结果质量高
- ✅ 支持深度搜索
- ⚠️ 需要 API Key
- ⚠️ 有调用限制

**适用场景**:
- 深度研究和分析
- 需要高质量结果
- AI 辅助决策

**使用示例**:
\`\`\`typescript
web_search({
  query: "distributed systems consensus algorithms comparison",
  provider: "tavily",
  apiKey: process.env.TAVILY_API_KEY,
  maxResults: 10
})
\`\`\`

#### 3. Exa（推荐语义搜索）
**特点**:
- ✅ 语义理解强
- ✅ 精准度高
- ✅ 适合概念搜索
- ⚠️ 需要 API Key
- ⚠️ 成本较高

**适用场景**:
- 概念和理论搜索
- 学术研究
- 复杂问题分析

**使用示例**:
\`\`\`typescript
web_search({
  query: "how does transformer attention mechanism work",
  provider: "exa",
  apiKey: process.env.EXA_API_KEY
})
\`\`\`

#### 4. Serper（Google 代理）
**特点**:
- ✅ Google 搜索结果
- ✅ 成本较低
- ✅ API 简单
- ⚠️ 需要 API Key
- ⚠️ 覆盖不如原生 Google

**适用场景**:
- 需要 Google 质量但成本受限
- 通用搜索需求
- 快速原型开发

**使用示例**:
\`\`\`typescript
web_search({
  query: "latest machine learning frameworks 2026",
  provider: "serper",
  apiKey: process.env.SERPER_API_KEY,
  maxResults: 8
})
\`\`\`

#### 5. SearXNG（自托管）
**特点**:
- ✅ 开源自托管
- ✅ 隐私保护
- ✅ 聚合多个搜索引擎
- ⚠️ 需要自己部署
- ⚠️ 需要提供 baseUrl

**适用场景**:
- 企业内网搜索
- 完全隐私控制
- 自定义搜索需求

**使用示例**:
\`\`\`typescript
web_search({
  query: "kubernetes best practices",
  provider: "searxng",
  baseUrl: "https://your-searxng.example.com",
  maxResults: 10
})
\`\`\`

#### 6. Bocha（企业级）
**特点**:
- ✅ 企业级稳定性
- ✅ 支持批量搜索
- ✅ 结果格式规范
- ⚠️ 需要 API Key
- ⚠️ 主要面向企业客户

**适用场景**:
- 企业应用集成
- 批量数据采集
- 高并发搜索需求

**使用示例**:
\`\`\`typescript
web_search({
  query: "competitor analysis software trends",
  provider: "bocha",
  apiKey: process.env.BOCHA_API_KEY,
  maxResults: 15
})
\`\`\`

#### 7. Zhipu 智谱（推荐中文）
**特点**:
- ✅ 中文搜索优化
- ✅ 国内访问快
- ✅ 理解中文语境
- ⚠️ 需要 API Key
- ⚠️ 英文结果较少

**适用场景**:
- 中文内容搜索
- 国内资源查找
- 中文技术文档

**使用示例**:
\`\`\`typescript
web_search({
  query: "Vue3 组合式 API 最佳实践",
  provider: "zhipu",
  apiKey: process.env.ZHIPU_API_KEY,
  maxResults: 8
})
\`\`\`

#### 8. Google（官方）
**特点**:
- ✅ 覆盖面最广
- ✅ 结果质量稳定
- ✅ 支持高级语法
- ⚠️ 需要 API Key + Custom Search Engine ID
- ⚠️ 成本较高

**适用场景**:
- 企业级应用
- 需要最全面的覆盖
- 预算充足的项目

**使用示例**:
\`\`\`typescript
web_search({
  query: "site:stackoverflow.com python async await",
  provider: "google",
  apiKey: process.env.GOOGLE_API_KEY,
  baseUrl: process.env.GOOGLE_CSE_ID,
  maxResults: 10
})
\`\`\`

#### 9. Bing（微软）
**特点**:
- ✅ 覆盖面广
- ✅ 与 Microsoft 生态集成
- ✅ 新闻时效性好
- ⚠️ 需要 API Key
- ⚠️ 某些地区结果偏向性强

**适用场景**:
- Microsoft 生态项目
- 新闻事件查询
- 企业级应用

**使用示例**:
\`\`\`typescript
web_search({
  query: "breaking news AI regulation 2026",
  provider: "bing",
  apiKey: process.env.BING_API_KEY,
  maxResults: 10
})
\`\`\`

### 搜索技巧

#### 技巧 1: 精确关键词
❌ **不好**: "怎么用 React"
✅ **好**: "React Hooks useEffect 依赖数组原理"

**原理**: 具体的关键词能获得更精准的结果

#### 技巧 2: 使用引号精确匹配
\`\`\`typescript
// 精确匹配短语
web_search({
  query: '"Cannot read property of undefined" TypeScript'
})
\`\`\`

#### 技巧 3: 排除无关内容
\`\`\`typescript
// 使用 - 排除关键词
web_search({
  query: "Python async -Django"  // 搜索 Python async，但排除 Django
})
\`\`\`

#### 技巧 4: 站点限定搜索
\`\`\`typescript
// 限定在特定网站搜索
web_search({
  query: "site:stackoverflow.com TypeScript generics"
})
\`\`\`

#### 技巧 5: 时间限定
\`\`\`typescript
// 搜索最近一年的内容
web_search({
  query: "React performance optimization 2026"
})
\`\`\`

#### 技巧 6: 文件类型搜索
\`\`\`typescript
// 搜索特定文件类型
web_search({
  query: "machine learning tutorial filetype:pdf"
})
\`\`\`

### 提供商选择策略

#### 决策流程图
\`\`\`
需要中文结果？
  ├─ 是 → 使用 zhipu
  └─ 否 → 继续

需要深度研究？
  ├─ 是 → 使用 tavily 或 exa
  └─ 否 → 继续

有 API Key 预算？
  ├─ 否 → 使用 duckduckgo
  └─ 是 → 根据具体需求选择
\`\`\`

#### 场景推荐表

| 场景 | 推荐提供商 | 理由 |
|------|----------|------|
| 快速查找常识 | duckduckgo | 无需配置，快速 |
| 技术深度研究 | tavily | AI 优化，质量高 |
| 概念理论搜索 | exa | 语义理解强 |
| 中文内容搜索 | zhipu | 中文优化 |
| 开源项目查找 | duckduckgo | 免费，覆盖 GitHub |
| 学术论文搜索 | exa 或 google | 深度和广度 |
| 新闻事件查询 | tavily 或 bing | 时效性好 |
| 企业级应用 | google 或 bocha | 稳定可靠 |

### 结果数量优化

#### maxResults 选择指南

| 结果数 | 适用场景 | 说明 |
|--------|---------|------|
| 1-3 | 快速验证 | 只需要确认信息是否存在 |
| 5 (默认) | 常规搜索 | 平衡质量和数量 |
| 8-10 | 深度研究 | 需要多角度信息 |
| 15-20 | 全面分析 | 需要详尽的资料收集 |

**性能考虑**:
- 结果越多，返回时间越长
- 建议先用默认值，不够再增加
- 超过 10 个结果时，考虑多次搜索

### 多提供商策略

OpenAWork 支持通过 \`searchMultiProvider\` 函数使用多个提供商，提供三种策略：

#### 策略 1: Sequential（顺序回退）
**使用场景**: 优先某个提供商，失败后尝试备选

**工作原理**: 按顺序依次尝试每个提供商，直到某个成功或全部失败

**示例**:
\`\`\`typescript
searchMultiProvider(
  "TypeScript best practices",
  {
    providers: [
      { provider: "tavily", apiKey: "key1" },
      { provider: "duckduckgo" },  // 备选
    ],
    rolloutMode: "sequential",
    maxResults: 5,
  },
  signal
)
\`\`\`

**适用场景**:
- 付费提供商优先，免费备用
- 有明确的提供商质量排序
- 需要节省 API 配额

#### 策略 2: First-Success（最快响应）
**使用场景**: 追求速度，谁先返回用谁

**工作原理**: 并行请求所有提供商，使用第一个成功的结果，取消其他请求

**示例**:
\`\`\`typescript
searchMultiProvider(
  "latest React news",
  {
    providers: [
      { provider: "duckduckgo" },
      { provider: "tavily", apiKey: "key1" },
      { provider: "serper", apiKey: "key2" },
    ],
    rolloutMode: "first-success",
  },
  signal
)
\`\`\`

**适用场景**:
- 对速度要求高
- 提供商之间质量相当
- 不在意使用哪个提供商

**注意事项**:
- 会同时启动所有提供商请求
- 获胜者之外的请求会被中止，但可能已产生部分费用

#### 策略 3: Merge（结果合并）
**使用场景**: 需要多角度信息，合并去重

**工作原理**: 并行请求所有提供商，等待全部完成（或超时），按 URL 去重后合并结果

**示例**:
\`\`\`typescript
searchMultiProvider(
  "distributed systems patterns",
  {
    providers: [
      { provider: "tavily", apiKey: "key1", weight: 2 },  // 高权重
      { provider: "duckduckgo", weight: 1 },
      { provider: "exa", apiKey: "key2", weight: 2 },
    ],
    rolloutMode: "merge",
    maxResults: 10,
    timeoutMs: 5000,  // 等待所有提供商，最多 5 秒
  },
  signal
)
\`\`\`

**权重说明**:
- \`weight\`: 结果优先级（默认 1）
- 更高权重的结果会排在前面
- 相同 URL 的结果，保留权重最高的
- 权重相同时，按提供商顺序排序

**适用场景**:
- 需要全面覆盖
- 不同提供商有不同优势领域
- 愿意等待所有结果

**注意事项**:
- 会同时启动所有提供商请求
- 设置合理的 \`timeoutMs\` 避免等待过久
- 所有提供商都会产生费用

### 错误处理

#### 错误 1: API Key 无效
**错误信息**: "API key is required" 或 "Invalid API key"

**解决方案**:
1. 检查环境变量是否正确设置
2. 验证 API Key 是否过期
3. 回退到 duckduckgo（无需 Key）

**代码示例**:
\`\`\`typescript
try {
  return await web_search({
    query: "...",
    provider: "tavily",
    apiKey: process.env.TAVILY_API_KEY,
  });
} catch (error) {
  // 回退到免费提供商
  return await web_search({
    query: "...",
    provider: "duckduckgo",
  });
}
\`\`\`

#### 错误 2: 请求超时
**错误信息**: "Request timeout" 或 "Network error"

**解决方案**:
1. 减少 maxResults
2. 切换到更快的提供商
3. 检查网络连接

#### 错误 3: 配额超限
**错误信息**: "Rate limit exceeded" 或 "Quota exhausted"

**解决方案**:
1. 实施请求频率控制
2. 使用多个 API Key 轮换
3. 回退到免费提供商

#### 错误 4: 无结果返回
**情况**: 搜索成功但返回 "No results found"

**解决方案**:
1. 简化搜索关键词
2. 去除过于严格的限定条件
3. 尝试不同的提供商
4. 使用更通用的术语

### 工作流模式

#### 模式 1: 快速事实验证
\`\`\`
1. web_search(query="具体问题", maxResults=3)
2. 查看前 3 个结果
3. 如果信息一致 → 采纳
4. 如果信息冲突 → 增加 maxResults 到 8
\`\`\`

#### 模式 2: 深度技术研究
\`\`\`
1. 第一轮：broad search
   web_search(query="general topic", provider="duckduckgo", maxResults=5)
   → 了解概况

2. 第二轮：focused search
   web_search(query="specific aspect", provider="tavily", maxResults=10)
   → 深入细节

3. 第三轮：cross-reference
   web_search(query="alternative approach", provider="exa", maxResults=5)
   → 对比方案
\`\`\`

#### 模式 3: 多语言信息收集
\`\`\`
1. 中文搜索：
   web_search(query="中文关键词", provider="zhipu", maxResults=8)

2. 英文搜索：
   web_search(query="English keywords", provider="tavily", maxResults=8)

3. 合并分析两者结果
\`\`\`

#### 模式 4: 时效性追踪
\`\`\`
1. 搜索最新信息：
   web_search(query="topic 2026", maxResults=5)

2. 搜索趋势变化：
   web_search(query="topic vs old-approach", maxResults=10)

3. 综合判断当前最佳实践
\`\`\`

### 性能优化建议

#### 优化 1: 缓存搜索结果
对于相同或相似的查询，缓存结果避免重复请求

\`\`\`typescript
const cache = new Map<string, SearchResult>();

async function cachedSearch(query: string) {
  if (cache.has(query)) {
    return cache.get(query);
  }
  const result = await web_search({ query });
  cache.set(query, result);
  return result;
}
\`\`\`

#### 优化 2: 并行搜索不同方面
\`\`\`typescript
// 并行搜索不同关键词
const [result1, result2, result3] = await Promise.all([
  web_search({ query: "aspect A" }),
  web_search({ query: "aspect B" }),
  web_search({ query: "aspect C" }),
]);
\`\`\`

#### 优化 3: 渐进式增加结果
从少量结果开始，根据需要递增

\`\`\`typescript
let results = await web_search({ query: "...", maxResults: 5 });

if (needMoreInfo(results)) {
  results = await web_search({ query: "...", maxResults: 10 });
}
\`\`\`

#### 优化 4: 使用搜索建议优化查询
\`\`\`typescript
const initialResults = await web_search({
  query: "vague query",
  maxResults: 3
});

// 根据初步结果优化查询
const refinedQuery = extractBetterKeywords(initialResults);
const betterResults = await web_search({
  query: refinedQuery,
  maxResults: 10
});
\`\`\`

### 安全和隐私

#### 隐私考虑
1. **避免在查询中包含敏感信息**:
   - 用户个人信息
   - 内部项目代码
   - 商业机密

2. **选择隐私友好的提供商**:
   - DuckDuckGo: 不追踪用户
   - SearXNG: 自托管，完全控制
   - 其他提供商: 查看隐私政策

3. **API Key 安全**:
   - 使用环境变量，不硬编码
   - 定期轮换 API Key
   - 监控 API 使用情况

#### 使用限制
1. 遵守提供商的服务条款
2. 不要进行恶意爬取
3. 尊重网站的 robots.txt
4. 合理控制请求频率

### 常见问题 (FAQ)

**Q1: 为什么 DuckDuckGo 结果比 Google 少？**
A: DuckDuckGo 的免费 API 限制了结果数量。如需更多结果，使用 Tavily 或付费提供商。

**Q2: 如何选择 maxResults？**
A: 默认 5 个通常足够。深度研究用 10-15 个。避免超过 20 个，性能下降明显。

**Q3: 多个提供商如何选择？**
A: 优先 DuckDuckGo（免费快速），中文用 Zhipu，深度研究用 Tavily。

**Q4: 搜索结果不准确怎么办？**
A: 1) 优化关键词 2) 增加 maxResults 3) 尝试不同提供商 4) 使用高级搜索语法

**Q5: 如何减少 API 成本？**
A: 1) 缓存结果 2) 优先免费提供商 3) 精确查询减少结果数 4) 批量查询

**Q6: 哪个提供商最适合编程问题？**
A: DuckDuckGo (免费) 或 Tavily (高质量)，都能很好地索引 StackOverflow 和 GitHub。

**Q7: Sequential 策略和 First-Success 有什么区别？**
A: Sequential 是串行尝试（A 失败才试 B），First-Success 是并行竞速（谁快用谁）。

**Q8: Merge 策略什么时候使用？**
A: 需要综合多个搜索源的结果时使用，比如学术研究、全面调研等场景。

**Q9: 如何处理中英文混合搜索？**
A: 使用 Merge 策略，同时调用 Zhipu（中文）和 Tavily（英文），合并结果。
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
