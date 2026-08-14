# OpenAWork Agent Docs 索引

## 已完成的任务

### ✅ 260814-tool-prompt-system - 工具提示词系统优化
**状态**: 核心实施完成  
**完成日期**: 2026-08-14  
**归档位置**: [workflow/done/260814-tool-prompt-system.md](workflow/done/260814-tool-prompt-system.md)  
**最终报告**: [runtime/260814-tool-prompt-system/results/final-archive-report.md](runtime/260814-tool-prompt-system/results/final-archive-report.md)

**成果总结**:
- ✅ 创建 4 个核心工具的完整提示词系统（2,785行代码）
- ✅ 实现系统提示词构建器和工具章节生成器
- ✅ 完成 agent-core 和 agent-gateway 两层集成
- ✅ 代码质量优秀：0 错误，0 警告
- ⏳ 待完成：性能优化、完整测试、代码审查

**核心交付物**:
1. LSP 工具提示词（10个工具，884行）
2. Web 搜索工具提示词（9个提供商，466行）
3. 哈希编辑工具提示词（原子性保证，489行）
4. Lint 工具提示词（自动反馈，419行）
5. 系统提示词构建器（支持动态组装和缓存）
6. 完整的文档和测试框架

---

## 当前进行中的任务

### 🔵 260814-migrate-opencode-llm-library - 移植 OpenCode LLM 库
**状态**: 进行中  
**开始日期**: 2026-08-14  
**工作流文档**: [workflow/260814-migrate-opencode-llm-library.md](workflow/260814-migrate-opencode-llm-library.md)  
**执行计划**: [runtime/260814-migrate-opencode-llm-library/master_plan.md](runtime/260814-migrate-opencode-llm-library/master_plan.md)

**目标**: 解决 Vercel AI SDK 的 Responses API bug，通过移植 OpenCode 的直接 HTTP 实现来正确传递 thinking 参数

**当前阶段**: Phase 1 - 环境准备和依赖安装  
**进度**: 0/18 任务完成

---

## 项目记忆

### 架构决策
- [2026-08-14] 采用 Claude Code 的工具提示词模式：每个工具独立 prompt.ts 文件，通过系统提示词构建器动态组装
- [2026-08-14] 使用 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 分隔静态和动态内容，静态部分可被 LLM 缓存
- [2026-08-14] 实施分层架构：agent-core（数据层）+ agent-gateway（业务层）

### 编码约定
- 所有提示词使用中文编写
- 提示词文件命名: `<tool-name>-prompt.ts`
- 导出常量命名: `<TOOL>_USAGE_GUIDE` 和 `<TOOL>_TOOLS_LIST`
- 遵循统一的导出规范，便于维护和扩展

### 已知陷阱
- 提示词过长会影响性能 → 使用动态边界分隔静态和动态内容
- 工具提示词需要定期更新 → 每次工具更新时同步更新提示词
- tool-sections.ts 需要手动添加新工具 → 未来可考虑自动发现机制

### 全局重要记忆
- Claude Code 源码位置: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 系统提示词构建参考: `src/constants/prompts.ts`
- 工具提示词参考: `src/tools/*/prompt.ts`
- 提示词总代码量: 2,785 行（截至 2026-08-14）

---

## 相关资源

### 外部参考
- Claude Code 源码库: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 项目 CLAUDE.md: `E:\01.Projects\OpenAWork\CLAUDE.md`
- Claude Prompt Caching 文档

### 内部文档
- 提交规范: `docs/commit-convention.md`
- 设计规范: `packages/shared-ui/DESIGN-TOKENS.md`
- 工具提示词 README: `packages/agent-core/src/tools/prompts/README.md`

---

## 使用说明

本目录用于 OpenAWork 项目的 Agent 工作流管理和知识积累。

### 目录结构
```
.agentdocs/
├── index.md              # 本文件：知识入口
├── workflow/             # 任务规划（持久化，提交到 git）
│   ├── done/             # 已完成任务归档
│   │   └── 260814-tool-prompt-system.md
│   └── [活跃任务].md
└── runtime/              # 执行协调（临时，.gitignore）
    └── 260814-tool-prompt-system/
        ├── master_plan.md
        ├── agent_tasks/   # 5个开发者的详细任务
        └── results/       # 实施报告和质量报告
```

### Git 配置
请确保 `.gitignore` 包含：
```
.agentdocs/runtime/
```

### 更新记录
- 2026-08-14: 完成工具提示词系统核心实施，归档到 done/
- 2026-08-14: 创建工具提示词系统优化任务，完成详细规划
