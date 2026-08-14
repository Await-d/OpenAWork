# 工具提示词系统优化实施方案

## 任务概述

为 OpenAWork 项目实施完整的工具提示词系统，参考 Claude Code 的最佳实践，为每个内置工具创建详细的使用指南，并集成到系统提示词中。

## 当前分析

### 现状问题
1. 工具只有简单的 `description` 字段，缺少详细使用说明
2. 没有工具使用场景、最佳实践、错误处理等指导
3. 工具组合使用没有明确的工作流模式
4. LLM 需要自行推断工具使用方式，容易出错

### Claude Code 参考架构
- **每个工具独立提示词文件**：`src/tools/XxxTool/prompt.ts`
- **分层系统提示词**：静态部分（可缓存）+ 动态部分（会话特定）
- **工具使用章节**：`getUsingYourToolsSection()`
- **详细使用指南**：包含场景、示例、注意事项

### 关键参考代码位置
- Claude Code 工具提示词：`E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src\src\tools\*/prompt.ts`
- 系统提示词构建：`E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src\src\constants\prompts.ts`
- 工具注册：`E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src\src\tools.ts`

## 解决方案设计

### 架构设计
```
packages/agent-core/src/tools/
├── lsp-prompt.ts              # LSP 工具提示词
├── web-search-prompt.ts       # Web 搜索提示词
├── hash-edit-prompt.ts        # 哈希编辑提示词
├── post-write-lint-prompt.ts  # Lint 提示词
└── tool-usage-guide.ts        # 统一工具使用指南模块

services/agent-gateway/src/
├── prompt/
│   ├── system-prompt-builder.ts  # 系统提示词构建器
│   └── tool-sections.ts          # 工具章节生成器
└── routes/stream.ts               # 注入系统提示词
```

### 实施策略
1. **并行开发**：4个开发人员各负责一类工具的提示词
2. **统一接口**：所有提示词文件遵循相同的导出结构
3. **渐进集成**：先实现核心工具，再扩展到其他工具
4. **测试验证**：每个工具提示词需要实际测试效果

## 复杂度评估

- 原子步骤：8+ 步骤 → +2
- 并行流：4人并行开发 → +2
- 模块数：3个核心模块 → +1
- 长步骤：深度源码分析 → +1
- 持久化审查：代码审查 → +1
- OpenCode 可用：是 → -1

**总分：6**
**选择模式：完整编排（Full orchestration）**
**路由理由：**多模块深度改造，4人并行开发，需要严格协调和代码审查。

## 实施计划

### Phase 1: 基础设施准备（Team Lead）
- [ ] T-01: 创建工具提示词模块结构
- [ ] T-02: 定义统一的提示词接口规范
- [ ] T-03: 实现系统提示词构建器框架
- [ ] T-04: 创建单元测试框架

### Phase 2: 核心工具提示词实现（4人并行）
- [ ] T-05: 实现 LSP 工具提示词（开发者 A）
- [ ] T-06: 实现 Web 搜索工具提示词（开发者 B）
- [ ] T-07: 实现哈希编辑工具提示词（开发者 C）
- [ ] T-08: 实现 Lint 工具提示词（开发者 D）

### Phase 3: 系统提示词集成（Team Lead + 开发者 A）
- [ ] T-09: 实现工具使用章节生成器
- [ ] T-10: 集成到网关系统提示词
- [ ] T-11: 实现提示词缓存策略

### Phase 4: 测试与优化（全员）
- [ ] T-12: 编写集成测试（开发者 B）
- [ ] T-13: 实际场景测试（开发者 C）
- [ ] T-14: 性能优化（开发者 D）
- [ ] T-16: 层级联动集成测试（开发者 E）
- [ ] T-17: 功能链路端到端验证（开发者 E）
- [ ] T-15: 代码审查与文档完善（Team Lead）

## 开发分工

### 开发者 A - LSP 工具专家
**负责任务：** T-05, T-10
**技能要求：** 熟悉 LSP 协议、TypeScript、代码导航工具

### 开发者 B - Web 搜索专家
**负责任务：** T-06, T-12
**技能要求：** 了解搜索引擎集成、API 设计、测试框架

### 开发者 C - 编辑工具专家
**负责任务：** T-07, T-13
**技能要求：** 文件操作、哈希算法、代码编辑工作流

### 开发者 D - 质量保障专家
**负责任务：** T-08, T-14
**技能要求：** Lint 工具、性能优化、代码质量

### 开发者 E - 系统集成测试工程师
**负责任务：** T-16, T-17
**技能要求：** 系统架构理解、集成测试、E2E 测试、缺陷追踪

### Team Lead - 架构与集成
**负责任务：** T-01, T-02, T-03, T-04, T-09, T-11, T-15
**技能要求：** 系统架构、模块集成、代码审查

## 技术依赖

### 必需库
- `zod`：参数校验
- `@openAwork/shared`：共享类型
- `@openAwork/agent-core`：工具定义

### 开发环境
- Node.js 18+
- TypeScript 5.0+
- pnpm 8+

## 风险与缓解

### 风险1：提示词过长导致性能问题
**缓解措施：** 实现提示词缓存策略，参考 Claude Code 的 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`

### 风险2：工具提示词不一致
**缓解措施：** 制定严格的接口规范和代码审查流程

### 风险3：并行开发冲突
**缓解措施：** 明确模块边界，使用独立的文件和目录

## 验证标准

1. 每个工具提示词包含完整的使用说明、示例、注意事项
2. 系统提示词正确集成所有工具提示词
3. 通过所有单元测试和集成测试
4. 实际场景测试验证工具使用效果提升
5. 代码审查通过，符合项目规范

## 相关文档

- Claude Code 源码参考：`E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src\`
- 项目 CLAUDE.md：`E:\01.Projects\OpenAWork\CLAUDE.md`
- 设计规范：`packages/shared-ui/DESIGN-TOKENS.md`

## 备注

- 所有提示词使用中文
- 遵循项目的 TypeScript strict 模式
- 提交信息遵循 `type(scope): 中文描述` 格式
