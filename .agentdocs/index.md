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

### ✅ 260816-team-lightweight-routing - Team 简单任务轻量路由优化
**状态**: 已完成
**完成日期**: 2026-08-16
**归档位置**: [workflow/done/260816-team-lightweight-routing.md](workflow/done/260816-team-lightweight-routing.md)
**最终报告**: [runtime/260816-team-lightweight-routing/final_output.md](runtime/260816-team-lightweight-routing/final_output.md)

**成果总结**:
- ✅ 只读了解、解释、查看、检索、对比输入走 `light`，直接留在 reception stream。
- ✅ 明确开发、修复、重构、设计、执行和部署意图继续走完整 handoff 链。
- ✅ LLM `LIGHT` 协议与风险敏感 fallback 已接入，4 个目标测试文件 57/57 通过。
- ✅ gateway typecheck exit 0，light 路径实测 0 条 PM1 handoff，复杂任务 handoff 回归保持通过。

### ✅ 260816-team-routing-safety-hardening - Team 路由安全与取消优化
**状态**: 已完成
**完成日期**: 2026-08-16
**归档位置**: [workflow/done/260816-team-routing-safety-hardening.md](workflow/done/260816-team-routing-safety-hardening.md)
**最终报告**: [runtime/260816-team-routing-safety-hardening/final_output.md](runtime/260816-team-routing-safety-hardening/final_output.md)

**成果总结**:
- ✅ fallback 按明确只读/明确修改/意图不明分别进入 `light`/`orchestrate`/`clarify`。
- ✅ 高风险动作词覆盖配置改写、生产操作、排查诊断等场景。
- ✅ 路由 AbortSignal 已透传到底层 workflow LLM，reception 只读工具契约已固定。

## 当前进行中的任务

### 🔵 250109-opencode-llm-full-migration - OpenCode LLM 完整迁移续作
**状态**: 分阶段完成，保留明确阻塞；未达到发布条件
**复核日期**: 2026-08-15
**工作流文档**: [workflow/250109-opencode-llm-full-migration.md](workflow/250109-opencode-llm-full-migration.md)
**运行时证据**: [runtime/250109-opencode-llm-resume-20260815](runtime/250109-opencode-llm-resume-20260815)
**Effect 原生终态证据**: [runtime/250815-opencode-llm-effect-native-final](runtime/250815-opencode-llm-effect-native-final)

**当前结果**:
- gateway 已移除 `ai`、全部 `@ai-sdk/*`、`streamText`、`generateText`、`LanguageModelV4`、`AsyncGenerator` 生产残留；源码/manifest/lockfile residue scan = 0。
- Responses reasoning metadata replay 已完成 `thinking_end.itemId → ReasoningPart → AssistantReasoning → providerMetadata.openai.itemId` 链路，完整 `test:responses` exit 0。
- gateway `test:v2-runtime`、typecheck、build、replay bookend、cancellation/stall 聚焦验证通过；完整 `@openAwork/opencode-llm` 套件最终复跑为 25 files / 399 tests / 0 errors。
- T-27/T-31/T-42 已完成 Effect 边界收紧：native upstream 无 async/Promise 包装，Fastify/SSE/WS 与文件/数据库/plugin hook async 作为明确边界保留；路由矩阵 6 files/30 tests、replay race 1/1 通过。
- 当前未达到发布条件的原因只剩：真实 provider/隔离部署/LLM 负载/回滚由用户执行，以及本续作 exact-SHA 五路独立 review gate 尚未取得 PASS；不得把 synthetic fixture 结果当作真实供应商验证。
- 用户提供代理的真实 native Effect 验证已补齐：OpenAI Chat/Responses (`gpt-5.6-terra`) 及 Anthropic Messages (`grok-4.6`) 的非流式、SSE 流式、usage 与 `stop` 终止均通过；该单代理验证不替代部署、负载和全供应商 gate。

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
- [2026-08-16] Team 路由 fallback 采用三态安全策略：明确只读才 `light`，明确修改/执行才 `orchestrate`，不确定则 `clarify`；避免故障时把未知请求误放入轻量路径。
- [2026-08-16] 路由超时必须通过 AbortSignal 贯穿 `routeByLlm → requestWorkflowLlmCompletion`，仅停止等待不能停止底层 provider 请求。
- [2026-08-16] Team reception 对只读了解/解释/检索采用 `light` 直接回答路径；仅检测到明确修改、执行或高风险意图时创建 PM1 handoff，避免简单问题展开完整层级。
- [2026-08-15] agent-gateway 的 LLM upstream 统一使用 `@openAwork/opencode-llm` 的 Effect `LLMClient`/`RequestExecutor`；禁止重新引入 AI SDK 兼容层。
- [2026-08-15] native Stream/Effect 的执行终止点允许保留 Fastify/SSE/WS 的 `async` 与单一 `Effect.runPromise`；只有 upstream 业务契约必须保持 lazy Effect，不能为“全 Generator”形式改写 700 行路由编排。
- [2026-08-15] Responses reasoning replay 必须同时携带 output item `itemId` 与 encrypted content；仅保存 encrypted content 会使 `lowerReasoning` 丢弃整个 reasoning item。
- [2026-08-15] 入口通过单一 Effect `ManagedRuntime` + `ConfigService`/`LoggerService`/`Metric` 接入 Fastify；`/metrics` 使用 Prometheus exposition，关闭时释放 runtime。
- [2026-08-15] native OpenAI/Anthropic provider 的 `baseURL` 必须是完整 API 前缀；本代理应传至 `/v1`，而 gateway 的 OpenAI 模型路由会在根地址场景规范化补齐 `/v1`。
- [2026-08-14] 采用 Claude Code 的工具提示词模式：每个工具独立 prompt.ts 文件，通过系统提示词构建器动态组装
- [2026-08-14] 使用 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 分隔静态和动态内容，静态部分可被 LLM 缓存
- [2026-08-14] 实施分层架构：agent-core（数据层）+ agent-gateway（业务层）

### 编码约定
- 所有提示词使用中文编写
- 提示词文件命名: `<tool-name>-prompt.ts`
- 导出常量命名: `<TOOL>_USAGE_GUIDE` 和 `<TOOL>_TOOLS_LIST`
- 遵循统一的导出规范，便于维护和扩展

### 已知陷阱
- `effect@4.0.0-beta.83` 下 `Stream.async`、旧 `Runtime.runPromise/defaultRuntime` 等 API 漂移会使 gateway 启动/类型检查失败；必须按实际 beta API 逐项迁移，不可仅凭包级测试宣称全局通过。
- Responses `store:false` 回放失败时，先检查真实第二轮 wire body 是否包含 `type=reasoning`、`id`、`encrypted_content`；单元测试中的手工 native message 不能替代完整 gateway verifier。
- 全包测试 353/393 通过仍不代表迁移完成；需同时验证 gateway typecheck/build、完整 verification matrix、真实 `/health`/`/metrics` 和部署回滚。
- Vitest fake-timer 重试测试必须在推进 timers 前注册预期 rejection observer；否则会把中间态 rejection 误报为 unhandled error，或让最终拒绝断言悬空。
- 真实 provider、隔离部署、LLM 负载和回滚不能由本地 synthetic HTTP fixture 代替；缺少凭据时必须保留为 human/external gate，并把 exact SHA 与文件 hash 作为回滚锚点。
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
