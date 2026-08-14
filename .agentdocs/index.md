# OpenAWork Agent Docs 索引

## 当前进行中的任务

### 260814-tool-prompt-system - 工具提示词系统优化
**状态**: 🔵 规划完成，等待执行  
**创建日期**: 2026-08-14  
**负责人**: Team Lead + 4 名开发者  
**文档**: [workflow/260814-tool-prompt-system.md](workflow/260814-tool-prompt-system.md)

**任务概述**:
为 OpenAWork 项目实施完整的工具提示词系统，参考 Claude Code 的最佳实践，为每个内置工具创建详细的使用指南。

**核心目标**:
1. 为 LSP、Web 搜索、哈希编辑、Lint 工具创建详细提示词
2. 实现系统提示词构建器，集成到网关
3. 实施提示词缓存策略，优化性能
4. 完整的测试验证体系

**开发分工**:
- **Team Lead**: 基础设施、架构设计、集成、代码审查
- **开发者 A**: LSP 工具提示词 + 系统集成
- **开发者 B**: Web 搜索提示词 + 集成测试
- **开发者 C**: 哈希编辑提示词 + 场景测试
- **开发者 D**: Lint 提示词 + 性能优化

**预期成果**:
- 4个工具的完整提示词文档
- 系统提示词构建器模块
- 完整的测试套件
- 性能优化报告

---

## 项目记忆

### 架构决策
- [2026-08-14] 采用 Claude Code 的工具提示词模式：每个工具独立 prompt.ts 文件，通过系统提示词构建器动态组装

### 编码约定
- 所有提示词使用中文编写
- 提示词文件命名: `<tool-name>-prompt.ts`
- 导出常量命名: `<TOOL>_USAGE_GUIDE`

### 已知陷阱
- 提示词过长会影响性能 → 使用动态边界分隔静态和动态内容
- 工具提示词需要定期更新 → 每次工具更新时同步更新提示词

### 全局重要记忆
- Claude Code 源码位置: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 系统提示词构建参考: `src/constants/prompts.ts`
- 工具提示词参考: `src/tools/*/prompt.ts`

---

## 相关资源

### 外部参考
- Claude Code 源码库: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 项目 CLAUDE.md: `E:\01.Projects\OpenAWork\CLAUDE.md`

### 内部文档
- 提交规范: `docs/commit-convention.md`
- 设计规范: `packages/shared-ui/DESIGN-TOKENS.md`

---

## 使用说明

本目录用于 OpenAWork 项目的 Agent 工作流管理和知识积累。

### 目录结构
```
.agentdocs/
├── index.md              # 本文件：知识入口
├── workflow/             # 任务规划（持久化，提交到 git）
│   ├── 260814-tool-prompt-system.md
│   └── done/             # 已完成任务归档
└── runtime/              # 执行协调（临时，.gitignore）
    └── 260814-tool-prompt-system/
        ├── master_plan.md
        ├── agent_tasks/   # 4个开发者的详细任务
        └── results/       # 执行结果（测试报告等）
```

### Git 配置
请确保 `.gitignore` 包含：
```
.agentdocs/runtime/
```

### 更新记录
- 2026-08-14: 创建工具提示词系统优化任务，完成详细规划
