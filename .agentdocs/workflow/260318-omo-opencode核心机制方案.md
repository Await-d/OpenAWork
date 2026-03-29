# .agentdocs/workflow/260318-omo-opencode核心机制方案.md

## 任务概览

深度分析 OpenCode 与 oh-my-openagent/omo（41K stars）的核心机制，总结当前四份方案尚未覆盖的差距。本文档为纯研究记录，不含实施计划。

---

## OpenCode 核心功能

| 功能                 | 说明                                                        |
| -------------------- | ----------------------------------------------------------- |
| Terminal TUI         | Bubble Tea 构建，Vim-like 编辑器                            |
| Session 管理         | SQLite 持久化，`Ctrl+A` 切换                                |
| 多模型支持           | OpenAI/Anthropic/Gemini/Groq/Bedrock/Azure/Copilot/本地     |
| LSP 集成             | `diagnostics` tool 暴露给 AI                                |
| Auto Compact         | context 达 95% 自动摘要压缩，新会话继续                     |
| Non-interactive `-p` | `opencode -p "prompt" -f json -q`，执行后退出               |
| 自定义命令           | `.opencode/commands/*.md`，支持 `$NAMED_ARG`，`Ctrl+K` 执行 |
| MCP                  | stdio + SSE 两种 transport                                  |

---

## oh-my-openagent（omo）核心机制

### 11 个专业 Agent

| Agent             | 模型              | 职责                              |
| ----------------- | ----------------- | --------------------------------- |
| Sisyphus          | claude-opus-4-6   | 主编排器，Todo 驱动，32k thinking |
| Hephaestus        | gpt-5.3-codex     | 自主深度执行，端到端不停工        |
| Oracle            | gpt-5.4           | 只读架构咨询、调试                |
| Librarian         | gemini-3-flash    | 文档检索、多仓库分析              |
| Explore           | grok-code-fast-1  | 快速代码库 grep 探索              |
| Multimodal-Looker | gpt-5.3-codex     | PDF/图片视觉分析                  |
| Prometheus        | claude-opus-4-6   | 访谈式战略规划                    |
| Metis             | claude-opus-4-6   | 预规划分析，识别歧义              |
| Momus             | gpt-5.4           | 计划审查                          |
| Atlas             | claude-sonnet-4-6 | Todo 列表编排器                   |
| Sisyphus-Junior   | 按 category 动态  | 被委托执行者，不能再委托          |

### Category 系统

| Category             | 默认模型             | 适用场景        |
| -------------------- | -------------------- | --------------- |
| `visual-engineering` | gemini-3.1-pro       | 前端/UI/动画    |
| `ultrabrain`         | gpt-5.4 xhigh        | 硬逻辑/架构决策 |
| `deep`               | gpt-5.3-codex medium | 自主研究+执行   |
| `quick`              | gpt-5.4-mini         | 单文件/typo     |
| `unspecified-high`   | claude-opus-4-6 max  | 高复杂度通用    |
| `writing`            | gemini-3-flash       | 文档/技术写作   |

### Skills 系统

内置：`playwright`、`git-master`、`frontend-ui-ux`、`agent-browser`、`dev-browser`

Skill-Embedded MCP OAuth：OAuth 2.1 + PKCE + 动态注册 + Token 自动刷新。

### 内置命令

| 命令          | 说明                                         |
| ------------- | -------------------------------------------- |
| `/init-deep`  | 生成层级 AGENTS.md，Agent 自动注入目录上下文 |
| `/ralph-loop` | 自引用执行循环，检测完成后退出               |
| `/ulw-loop`   | ultrawork 模式 ralph-loop                    |
| `/refactor`   | LSP+AST-grep+TDD 验证的智能重构              |
| `/start-work` | 从 Prometheus 计划启动执行                   |
| `/handoff`    | 生成结构化交接文档，新会话无缝继续           |

### Hash-Anchored Edit（Hashline）

每行附带内容哈希 `11#VK| function hello()`，编辑时引用哈希；文件变更后哈希不匹配则拒绝编辑。效果：编辑成功率 **6.7% → 68.3%**。

### Hook 系统（34+ 内置）

| 类别       | 代表 Hook                    | 功能                           |
| ---------- | ---------------------------- | ------------------------------ |
| 上下文注入 | `directory-agents-injector`  | 读文件时自动注入 AGENTS.md     |
| 生产力控制 | `keyword-detector`           | `ultrawork`/`analyze` 激活模式 |
| 质量安全   | `comment-checker`            | 拦截过度 AI 注释               |
| 恢复稳定   | `runtime-fallback`           | 429/503 自动切换备用模型       |
| 任务延续   | `todo-continuation-enforcer` | Agent 空闲时强制拉回任务       |
| 通知       | `session-notification`       | OS 通知                        |

### Task System（持久化依赖图）

存储于 `.sisyphus/tasks/`，跨会话持久，`blockedBy` 为空自动并行。

内置 MCP：`websearch`（Exa）、`context7`（官方文档）、`grep_app`（GitHub 代码）

---

## 差距分析

### 已覆盖

| omo 机制              | 我们方案对应                |
| --------------------- | --------------------------- |
| MCP stdio/SSE         | MCP+Skills 方案（模块 A-D） |
| Skill Manifest + 权限 | MCP+Skills 方案（模块 A-B） |
| Plugin Hooks          | MCP+Skills 方案（模块 F）   |
| Slash Commands        | MCP+Skills 方案（模块 F）   |
| Orchestrator CLI      | MCP+Skills 方案（模块 J）   |
| Browser Automation    | 扩展能力方案（模块 W）      |
| 多 Agent 编排         | 扩展能力方案（模块 V）      |

### 尚未设计的差距

| omo 机制                         | 说明                                         | 优先级 |
| -------------------------------- | -------------------------------------------- | ------ |
| **Hash-Anchored Edit**           | 行内容哈希验证，编辑成功率 6.7%→68.3%        | 高     |
| **Auto Compact（95% 阈值）**     | context 接近上限自动压缩，新会话继续         | 高     |
| **ralph-loop 自引用执行循环**    | Agent 不停止直到完成，完成检测机制           | 高     |
| **Skill-Embedded MCP OAuth**     | OAuth 2.1 PKCE + 动态注册 + Token 自动刷新   | 中     |
| **Task System（依赖图+持久化）** | 跨会话任务，blockedBy 依赖图，自动并行       | 中     |
| **/init-deep 层级 AGENTS.md**    | 目录级上下文，Agent 自动注入                 | 中     |
| **Tmux 多 Agent 可视化**         | 后台 Agent 独立 pane 实时展示                | 中     |
| **runtime-fallback Hook**        | 429/503 自动切换备用模型，per-model cooldown | 中     |
| **/handoff 会话交接**            | 结构化交接文档，无缝新会话继续               | 低     |
| **非交互式 -p 脚本模式**         | 单次 prompt + JSON 输出 + 静默模式           | 低     |

---

## 备注

- OpenCode 原仓库已归档，续作为 `charmbracelet/crush`。
- omo 41K stars，持续维护中。
- 数据采集时间：2026-03-18。
- Memory sync: completed
