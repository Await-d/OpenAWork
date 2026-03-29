# .agentdocs/workflow/260318-omo-opencode核心机制研究.md

## 概览

- `opencode-ai/opencode`（11K stars，已归档，续作为 charmbracelet/crush）
- `code-yeongyu/oh-my-openagent`（omo，41K stars）

---

## OpenCode 核心能力

### 运行模式

- TUI 交互模式：Bubble Tea 终端 UI，vim-like 编辑器
- 非交互式 -p 模式：`opencode -p "prompt"` 脚本自动化，`-f json` 输出，`-q` 静默
- Auto Compact：token 使用率 95% 时自动摘要压缩，创建新会话继续

### 自定义命令系统

- 命令 = `.opencode/commands/*.md` Markdown 文件
- 命名参数：`$ISSUE_NUMBER` 占位符，执行时交互提示
- 内置：Initialize Project、Compact Session

### 权限快捷键

a=Allow once | A=Allow for session | d=Deny

---

## omo 核心机制

### 11 个专业 Agent

| Agent             | 模型              | 职责                          |
| ----------------- | ----------------- | ----------------------------- |
| Sisyphus          | claude-opus-4-6   | 主编排器，并行委托，todo 驱动 |
| Hephaestus        | gpt-5.3-codex     | 深度自主执行，端到端不停止    |
| Oracle            | gpt-5.4           | 架构/调试，只读咨询           |
| Librarian         | gemini-3-flash    | 文档/OSS 搜索                 |
| Explore           | grok-code-fast-1  | 快速代码库探索                |
| Multimodal-Looker | gpt-5.3-codex     | PDF/图片视觉分析              |
| Prometheus        | claude-opus-4-6   | 战略规划，面试模式            |
| Metis             | claude-opus-4-6   | 预规划分析                    |
| Momus             | gpt-5.4           | 计划审查                      |
| Atlas             | claude-sonnet-4-6 | Todo 编排器                   |
| Sisyphus-Junior   | 按 category       | 委托执行者，不可再次委托      |

### Category 系统

| Category           | 默认模型          | 适用场景        |
| ------------------ | ----------------- | --------------- |
| visual-engineering | gemini-3.1-pro    | 前端/UI/设计    |
| ultrabrain         | gpt-5.4 xhigh     | 深度逻辑/架构   |
| deep               | gpt-5.3-codex     | 自主研究+执行   |
| artistry           | gemini-3.1-pro    | 创意任务        |
| quick              | gpt-5.4-mini      | 单文件/简单修改 |
| unspecified-low    | claude-sonnet-4-6 | 低工作量通用    |
| unspecified-high   | claude-opus-4-6   | 高工作量通用    |
| writing            | gemini-3-flash    | 文档写作        |

### Skills 系统

内置：git-master、playwright、playwright-cli、agent-browser、dev-browser、frontend-ui-ux

加载优先级：.opencode/skills/ > ~/.config/opencode/skills/ > .claude/skills/ > .agents/skills/

Skill-Embedded MCP：Skill 携带专属 MCP server，按需启动，任务结束即销毁。

Skill-Embedded MCP OAuth：OAuth 2.1（PKCE + RFC 9728/8414/7591），自动发现、动态注册、token 自动刷新。

### 内置 Slash Commands

| 命令               | 功能                           |
| ------------------ | ------------------------------ |
| /init-deep         | 生成层级 AGENTS.md             |
| /ralph-loop        | 自引用执行循环，不停止直到完成 |
| /ulw-loop          | ultrawork 模式的 ralph-loop    |
| /cancel-ralph      | 取消 Ralph Loop                |
| /refactor          | 智能重构（LSP+AST-grep+TDD）   |
| /start-work        | 从 Prometheus 计划启动执行     |
| /stop-continuation | 停止所有续行机制               |
| /handoff           | 生成交接文档，新会话无缝继续   |

### Hash-Anchored Edit（Hashline）

每行读取附加内容哈希标签（11#VK| code...），Agent 引用标签编辑。文件变更后哈希不匹配则拒绝编辑。编辑成功率：6.7% → 68.3%。

### ralph-loop 自引用循环

- Agent 持续工作直到检测到 <promise>DONE</promise>
- 自动续行（Agent 停止但未完成时重新拉起）
- 最大迭代次数默认 100

### Task System（跨会话持久任务）

- 存储为 .sisyphus/tasks/ JSON 文件，跨会话持久
- blockedBy 为空的任务自动并行执行
- vs TodoWrite：有依赖图、持久化、自动并行

### Hooks 系统（40+ 内置 Hook）

事件类型：PreToolUse、PostToolUse、Message、Event、Transform、Params

| 类别       | 代表 Hook                                                     |
| ---------- | ------------------------------------------------------------- |
| 上下文注入 | directory-agents-injector、rules-injector                     |
| 生产力控制 | keyword-detector、ralph-loop、todo-continuation-enforcer      |
| 质量安全   | comment-checker、write-existing-file-guard、hashline-enhancer |
| 恢复稳定   | runtime-fallback（429/503 自动切换）、session-recovery        |
| 通知 UX    | session-notification（OS 通知）、background-notification      |

runtime-fallback：429/503/超时自动切换备用模型，带 cooldown。
keyword-detector：检测 ultrawork/ulw（最高性能）、search/find（并行探索）、analyze/investigate（深度分析）。

### /init-deep 层级 AGENTS.md

Agent 读取文件时自动从文件目录向上注入最近的 AGENTS.md，项目/src/组件各级独立上下文。

### 内置 MCPs

| MCP                 | 说明                       |
| ------------------- | -------------------------- |
| websearch（Exa AI） | 实时网络搜索               |
| context7            | 官方文档查找               |
| grep_app            | 跨公共 GitHub 仓库代码搜索 |

---

## 与现有方案的差距（尚未设计）

| omo 机制                     | 说明                                        | 优先级 |
| ---------------------------- | ------------------------------------------- | ------ |
| Hash-Anchored Edit           | LINE#ID 哈希验证，编辑成功率 6.7%→68.3%     | 高     |
| Auto Compact（95%）          | context 接近上限自动摘要压缩，新会话继续    | 高     |
| ralph-loop 自引用循环        | Agent 不停止直到完成，带 DONE 检测          | 高     |
| runtime-fallback Hook        | 429/503 自动切换备用模型，带 cooldown       | 高     |
| Task System（依赖图+持久化） | 跨会话持久任务，blockedBy 依赖图，自动并行  | 中     |
| /init-deep 层级 AGENTS.md    | 目录级上下文文件，Agent 自动注入            | 中     |
| Tmux 多 Agent 可视化         | 后台 Agent 在独立 pane 实时展示             | 中     |
| Skill-Embedded MCP OAuth     | OAuth 2.1 保护的远程 MCP，PKCE+动态注册     | 中     |
| keyword-detector Hook        | ultrawork/search/analyze 关键词自动激活模式 | 中     |
| /handoff 会话交接            | 生成结构化交接文档，无缝新会话继续          | 低     |
| 非交互式 -p 脚本模式         | 单次 prompt 执行 + JSON 输出 + 静默模式     | 低     |

---

## 备注

- OpenCode 原仓库已归档，续作为 charmbracelet/crush。
- omo（oh-my-openagent）是目前最活跃的增强插件，41K stars。
- 数据采集时间：2026-03-18。
- Memory sync: completed
