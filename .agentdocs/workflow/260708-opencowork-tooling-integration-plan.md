# OpenCowork 工具生态集成方案

## Task Overview

目标是分析参考库 `temp/OpenCowork` 已内置的 MCP、Skill、Agent 工具、App Plugin、Channel Plugin 与 Custom Extension 能力，并为 OpenAWork 创建一套可执行的集成方案。

本方案特别遵守用户约束：如果 OpenAWork 已经有等价的简单工具或更完整的原生实现，不重复完整集成，只做登记、别名、文档、入口补齐或 provider-specific 扩展。

## Current Analysis

### OpenCowork 能力清单

OpenCowork 参考库当前可归纳为六类能力：

| 类别 | 已观察能力 | 关键路径 |
| --- | --- | --- |
| MCP | 通用 MCP 客户端与动态桥接，支持 `stdio`、`sse`、`streamable-http`；工具名 `mcp__{serverId}__{toolName}`；资源名 `mcp__{serverId}__resource__{resourceName}` | `temp/OpenCowork/src/main/mcp/`、`temp/OpenCowork/src/renderer/src/lib/mcp/` |
| 随包 Skills | `create-extension`、`csv-pipeline`、`docx`、`email-drafter`、`excel-processor`、`frontend-skill`、`image-ocr`、`pdf`、`post-to-x`、`product-design`、`web-scraper`、`xlsx` | `temp/OpenCowork/resources/skills/` |
| 核心 Agent 工具 | 文件读写编辑、Glob/Grep、Bash、WebSearch/WebFetch、Todo/Task、Plan、Cron、Goal、Memory、AskUser、Notify、Widget、Team、Browser、Desktop、Image 等 | `temp/OpenCowork/src/renderer/src/lib/tools/` |
| App Plugins | `image`、`browser`、`product-design` workflow、`desktop-control` | `temp/OpenCowork/docs/docs/capabilities/app-plugins.mdx`、相关 renderer/native tool |
| Channel Plugins | 飞书、钉钉、企业微信、QQ、微信公众、Telegram、Discord、WhatsApp；通用消息工具 + 飞书媒体/Bitable/成员/@/urgent + 微信媒体 | `temp/OpenCowork/src/main/channels/`、`temp/OpenCowork/src/renderer/src/lib/channel/plugin-tools.ts` |
| Custom Extensions | 本地 `extension.json` 声明 HTTP/JS 工具、权限 allowlist、配置、HTML renderer；工具名 `extension__{extensionId}__{toolName}` | `temp/OpenCowork/docs/docs/capabilities/custom-extensions.mdx`、`examples/extensions/demo-extension/` |

### OpenAWork 现状映射

OpenAWork 已有的主要底座：

| 表面 | 当前能力 | 判断 |
| --- | --- | --- |
| MCP runtime | `websearch`、`grep_app`、`codegraph`、`git_bash`、`lsp`、`omo` 内置；flat MCP 工具定义与命名已存在；OAuth、catalog、authorization 已有 | 不搬 OpenCowork MCP runtime，只补缺口 |
| MCP transport | `ConfiguredMCPServer.transport` 当前为 `'sse' | 'stdio'` | 缺 `streamable-http` |
| Skills | `@openAwork/skills` 已有 `git-master`、`review-work`、`programming`、`frontend`、`visual-qa`、`lsp`、`ast-grep`、`rules`；gateway 会扫描系统 `SKILL.md` | 通用工程类不重复；文档处理类可补 |
| 核心工具 | gateway 已有 `websearch`/`webfetch`、LSP、workspace read/write/edit/grep/glob、bash/background bash、question、plan mode、task、session read/search、ast-grep、image、desktop、codegraph、repo 等 | OpenCowork 简单工具大多已覆盖 |
| App plugin gate | `plugin_settings` 当前控制 `generate_image` 与 `desktop_control` 的 Agent 可见性 | Image/Desktop 不重复 |
| Channel | 已支持 `telegram`、`discord`、`slack`、`feishu`、`dingtalk`、`wecom`、`whatsapp`、`qq`；有自动回复和工具 allowlist | 平台覆盖基本齐；细分媒体/Bitable 能力不足 |
| Plugin host | 支持 `OPENAWORK_PLUGINS` 加载 hook：`tool.execute.before/after`、`chat.message`、`chat.params` | 这是可信 hook 插件，不等价于用户 Custom Extension |
| Dynamic tools | workspace `tool/`、`tools/` 动态扫描 JS/TS 工具 | 已有轻量本地工具能力，但缺安装、权限、UI、HTTP 声明式工具 |
| Web 设置入口 | 已有 MCP、Skills、Channels、Plugins、Desktop Control 等设置页和 web-client 封装 | 后续实现必须复用入口，不直接 `fetch()` 网关 |

## Solution Design

### 总体原则

1. 原生优先：OpenAWork 已有 gateway tool registry、MCP runtime、skill registry、channel manager、plugin settings 时，不搬 OpenCowork 的 renderer/native worker 注册体系。
2. 不重复简单工具：Read/Write/Edit/Glob/Grep/Bash/WebSearch/WebFetch/Todo/Task/Plan/AskUser/Memory/Goal/Cron/Image/Desktop/Browser 类能力，默认归入“已有，仅登记或补别名”。
3. 网关统一注入：所有 Agent 可见工具必须从 gateway tool definitions、MCP flat tool 或 skill tool 注入，不从 Web UI 绕开。
4. 权限统一收口：执行必须经过 `tool-sandbox`、session visibility、permission、audit、plugin settings 或 channel allowlist，不能因插件迁移引入第二套授权。
5. UI 统一走 web-client：后续 Web/桌面界面若新增配置入口，必须先补 `@openAwork/web-client`，再由 `apps/web` 消费。
6. 分层扩展：平台通用动作走 channel generic API；飞书 Bitable、媒体、urgent 等走 provider-specific action，不复制一整套 `PluginSendMessage` 工具命名。
7. 高风险能力延后：`post-to-x`、JS extension、跨平台桌面控制、未沙箱第三方插件默认暂缓或强门控。

### 内置资源目录方案

可以借鉴 OpenCowork 的 `resources/` 存放方式，但不建议把参考库目录原样复制到 OpenAWork 根目录。OpenAWork 是 pnpm monorepo，且已有 `@openAwork/skills`、agent catalog、team persona、commands、workflow templates、prompt snippets 等运行时入口；因此推荐新增一个 workspace 包作为静态资源包：

```text
packages/resources/
  package.json
  src/index.ts
  resources/
    skills/
      csv-pipeline/
        SKILL.md
        scripts/
      spreadsheet/
        SKILL.md
        scripts/
      docx/
      pdf/
      image-ocr/
      email-drafter/
      web-scraper/
      product-design/
      create-extension/
    agents/
      api-designer.md
      architect-reviewer.md
      code-reviewer.md
      frontend-developer.md
      security-auditor.md
      ...
    souls/
      reception.md
      pm1.md
      pm2.md
      executor.md
      reviewer.md
    commands/
      init.md
      plan.md
      review.md
      security-review.md
      commit.md
    prompts/
      codex-instructions.md
    extensions/
      demo-http-extension/
        extension.json
```

资源包职责是“随应用发布的默认资产”，不是运行时唯一真相源。运行时仍按现有架构落库或注册：

| 资源类型 | 推荐存放 | 运行时真相源 | 加载方式 |
| --- | --- | --- | --- |
| Skills | `packages/resources/resources/skills/<name>/SKILL.md` | `installed_skills` + `@openAwork/skills` manifest | gateway 启动时 seed 为 builtin/system skills；用户启停仍在 DB |
| Agents | `packages/resources/resources/agents/<id>.md` 或 `<id>.json` | `user_settings.agent_catalog` + builtin agent catalog | 启动时构建 builtin agent base；用户覆盖仍在 DB |
| SOUL / personas | `packages/resources/resources/souls/<role>.md` | `agent_personas` 表 | 默认版本 seed；用户自定义不被覆盖 |
| Commands | `packages/resources/resources/commands/<id>.md` | `buildCommandDescriptors()` + server action switch | 只作为描述/帮助/提示词资源；真正执行仍由 TS action 控制 |
| Prompt snippets | `packages/resources/resources/prompts/*.md` | prompt-snippets DB/API | 可 seed 默认分组；用户编辑后走 DB |
| Workflow templates | `packages/resources/resources/workflows/*.json` | workflow templates API/DB | 可 seed 默认模板；团队绑定仍走现有接口 |
| Extensions 示例 | `packages/resources/resources/extensions/*/extension.json` | 后续 Custom Extension registry | 只放示例/官方模板，不默认启用 |

这个设计保留 OpenCowork `resources/` 的可浏览、可打包、可复制优点，同时避免破坏 OpenAWork 已经形成的“设置/DB 是用户态真相源、gateway 统一注入工具、web-client 统一访问”的架构。

#### 为什么不直接放根目录 `resources/`

- 根目录 `resources/` 不属于当前 workspace 包，构建、发布、桌面 sidecar 打包时容易遗漏。
- OpenAWork 已有 `packages/skills`，如果再新增根 `resources/skills` 但没有明确 loader，会形成第二套 skill 真相源。
- Agents、SOUL、commands 现在与 DB 迁移、路由、权限和 UI 强绑定，直接文件化会绕开用户覆盖/重置逻辑。
- `packages/resources` 可以通过 package exports 提供稳定路径和 manifest 索引，更适合 Web/Desktop/Gateway 共同消费。

#### 分阶段迁移建议

1. P0：先建 `packages/resources` 和只读索引，不改变运行时行为。
2. P1：把 OpenCowork 中低风险 skills 迁入 `resources/skills`，由 `@openAwork/skills` 或 gateway seed 读入。
3. P1：把 OpenCowork `agents/*.md` 转换为 OpenAWork `ManagedAgentRecord` 默认定义，但仍由 `agent-catalog.ts` 负责合并用户覆盖。
4. P2：把 SOUL 默认文案从 TS 常量迁到 `resources/souls/*.md`，保留 `DEFAULT_SOUL_VERSION` 和默认指纹迁移逻辑。
5. P2：commands/prompts/workflows 先做资源化文案与模板，不允许文件直接声明新的可执行 server action。
6. P3：Custom Extension 官方示例放入 `resources/extensions`，等 extension registry v1 完成后作为安装模板暴露。

### 能力处置矩阵

| OpenCowork 能力 | OpenAWork 处置 | 优先级 | 原因与落点 |
| --- | --- | --- | --- |
| MCP `stdio` / `sse` | 已有，不重复 | P0-登记 | 继续使用 `services/agent-gateway/src/mcp/mcp-runtime.ts` 与 settings schemas |
| MCP `streamable-http` | 新增 transport | P1 | 补 `ConfiguredMCPServer`、settings schema、mcp-client adapter、状态页测试 |
| MCP flat 命名 | 已有，不重复 | P0-登记 | 现有 `mcp__server__tool` 机制已对齐 |
| MCP resources/prompts 工具化 | 补齐读资源/取 prompt 的平面工具或 catalog 展示 | P2 | OpenCowork 暴露 resource/prompt，OpenAWork 当前重点在 tools |
| `frontend-skill` | 不复制 | P0-登记 | 已有 `frontend` + `visual-qa`，后续只补 OpenAWork token 指引 |
| `product-design` | 选择性迁移为 workflow skill | P2 | 价值在研究/原型/QA 流程，不是简单 frontend skill |
| `csv-pipeline` | 新增 builtin/system skill | P1 | 高价值文档/数据处理能力，风险低 |
| `excel-processor` / `xlsx` | 合并为一个 spreadsheet skill | P1 | 避免重复两个 Excel skill；统一为 `spreadsheet` 或 `excel-xlsx` |
| `docx` | 新增 builtin/system skill | P1 | 保留 OOXML 参考与脚本，需审查 license 与 Python 依赖 |
| `pdf` | 新增 builtin/system skill | P1 | 表单、图片转换、校验能力有产品价值 |
| `image-ocr` | 新增 skill，但优先复用现有图片/附件管线 | P1 | 不新增一套 image plugin，只加 OCR workflow |
| `email-drafter` | 新增 prompt skill | P2 | 简单低风险，可作为写作 skill |
| `web-scraper` | 部分迁移 | P2 | 已有 `webfetch`/`websearch`，只补动态 crawl/链接抽取流程 |
| `create-extension` | 改造为 OpenAWork extension authoring skill | P2 | 不能照搬 OpenCowork manifest；需生成 OpenAWork 规范 |
| `post-to-x` | 暂缓 | P3 | 外部发帖风险高，需 OAuth、审批、审计和速率限制 |
| 文件/Bash/搜索/Plan/Todo/Task/Question/Memory/Goal/Cron | 已有，不重复 | P0-登记 | 只需兼容别名或文档 |
| BrowserNavigate/GetContent/Screenshot/Click/Type/Scroll | 已有能力映射，不新增全套 | P1-补体验 | 映射到 `desktop_automation` / browser automation；补 alias 或 skill 文案 |
| DesktopScreenshot/Click/Type/Scroll/Wait | 已完成，不重复 | P0-登记 | 见 `260706-desktop-control-plugin-integration` |
| ImageGenerate | 已有，不重复 | P0-登记 | `generate_image` 已受 plugin settings 控制 |
| Channel 通用 send/reply/list/read/summarize | 不复制 `Plugin*` 命名，映射现有 channel service | P1 | 如需 Agent 主动调 channel，新增 `channel_send_message` 等 OpenAWork 命名 |
| 飞书图片/文件/@/成员/urgent | provider-specific channel action | P1/P2 | `sendImage/sendFile/listMembers/mention/urgent`，全部需要审批 |
| 飞书 Bitable CRUD | provider-specific channel/data action | P2 | 读操作先行；写/删必须强审批 |
| 微信公众图片/文件 | 暂缓或 P2 | P2/P3 | OpenAWork 当前无 `weixin-official` 平台，需先确认产品方向 |
| Custom Extension HTTP tool | 新增 OpenAWork Custom Tool Extension v1 | P2 | 声明式 HTTP + network allowlist 先行 |
| Custom Extension JS tool | 暂缓或受限 worker | P3 | 当前 plugin-host 不沙箱；workspace dynamic JS 不等于可安装 extension |
| HTML renderer | 暂缓 | P3 | 需 artifact/UI 安全模型，先只返回 text/json/artifact |
| `resources/skills` 存放方式 | 借鉴但放入 `packages/resources` | P0/P1 | 作为默认资产包；运行时仍 seed 到 skill registry/DB |
| `resources/agents` 存放方式 | 借鉴并转换为 builtin agent definitions | P1 | 不直接绕过 `agent-catalog.ts` 用户覆盖模型 |
| `resources/souls` 存放方式 | 借鉴并逐步替换 TS 默认文案 | P2 | 保留 `DEFAULT_SOUL_VERSION`、默认指纹和用户自定义保护 |
| `resources/commands` 存放方式 | 仅用于描述/帮助/模板 | P2 | 可执行 action 继续由 `command-descriptors.ts` 和路由 switch 白名单控制 |

### 分阶段路线

#### Phase 0：登记与不重复声明

- R-01: 在文档和设置文案中明确已覆盖能力：核心文件工具、Bash、Web、Task、Plan、Image、Desktop、Browser 基础动作、MCP flat naming、通用工程 skills。
- R-02: 建立 OpenCowork → OpenAWork 工具别名表，只为兼容模型提示，不新增重复执行器。
- R-03: 对 `generate_image`、`desktop_control`、`desktop_automation`、`webfetch`、`websearch`、workspace tools 做一次 capability catalog 展示校验。

#### Phase 1：低风险高价值补齐

- R-04: MCP 增加 `streamable-http` transport，并保留 SSE fallback 策略。
- R-05: 新增文档/数据处理 builtin skills：CSV、Spreadsheet、DOCX、PDF、Image OCR。
- R-06: Browser automation 只补 alias/说明/状态页，不新增第二套工具执行链。
- R-07: Channel 增加 OpenCowork 对齐的通用 Agent 工具：发送、回复、读取群消息、列群、摘要当前会话；当前实现保留 `Plugin*` 兼容工具名，但执行统一走 `MessagingChannelService`、active service 与 channel allowlist，后续 UI/文档可再补 OpenAWork 命名别名。
- R-07a: Channel 自动回复 session 默认关闭 LLM gateway tool declarations，避免 Mimo / OpenAI-compatible 上游因 `tools` / `tool_choice:auto` 返回 400；本地 channel send/reply 工具与 LLM 工具声明分离。
- R-07b: Channel session 工具执行层同步 fail-closed：未显式 `channelLlmToolsEnabled:true` 时只允许本地 channel tools；显式 opt-in 后也只允许已映射、且 `channel.tools` 显式启用的工具类别，`bash` / `task` 还必须满足 channel permissions。
- R-07c: Channel 自动回复按 `pluginId + chatId` 串行进入 Agent run，参考 OpenCowork `pluginTaskChains`；同一外部聊天避免撞到 `SESSION_ALREADY_RUNNING` 并在用户消息持久化前丢消息，不同聊天仍保持并发。

#### Phase 2：平台细分能力

- R-08: 飞书 provider-specific actions：发图片、发文件、列成员、@成员、urgent；写类动作必须审批。
- R-09: 飞书 Bitable 读能力先行：list apps/tables/fields/records。
- R-10: 飞书 Bitable 写能力后置：create/update/delete records，强审批 + audit + dry-run 文案。
- R-11: `product-design` 迁移为 OpenAWork workflow skill，复用现有 `frontend`、`visual-qa`、artifacts 与 Web 原型入口。

#### Phase 3：Custom Extension v1

- R-12: 设计 OpenAWork extension manifest schema：id/name/version/config/permissions/tools/http/readOnly。
- R-13: 实现声明式 HTTP extension tool，工具名 `extension__{id}__{tool}`，支持 network allowlist、secret config、输入 schema 校验。
- R-14: 接入安装/启停/移除 API 与 web-client，Web 设置页复用现有插件/skill 风格。
- R-15: JS extension、HTML renderer、社交发帖类能力暂缓，等沙箱和 UI 安全边界明确后再做。

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: yes（MCP、Skill、Tool、Channel、Extension 可并行分析）→ +2
- Modules/systems/services: 7（gateway tools、mcp、skills、channels、plugin host、web-client、apps/web settings）→ +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 该方案横跨多个产品运行时表面，且必须把“不重复已有简单工具”的裁剪依据持久化，适合用完整 workflow + runtime 记录。

## Implementation Plan

### Phase 0: 范围锁定

- [x] T-01 ✅: 盘点 OpenCowork MCP、skills、tools、plugins、channels、extensions。
- [x] T-02 ✅: 盘点 OpenAWork 已有 MCP、skills、gateway tools、channels、plugin settings、dynamic tools 与 UI 入口。
- [x] T-03 ✅: 建立处置原则：原生优先、已有不重复、权限统一、web-client 统一。

### Phase 1: 集成路线

- [x] T-04 ✅: 形成能力处置矩阵，区分已有登记、补齐、选择性迁移、暂缓。
- [x] T-05 ✅: 按 P0/P1/P2/P3 制定阶段路线和主要落点。
- [x] T-06 ✅: 记录后续执行要求：Phase 1 代码集成前，为每个子项拆独立实施 workflow 并补测试清单。

### Phase 2: 验收基线

- [x] T-07 ✅: 明确验证命令与 QA 入口。
- [x] T-08 ✅: 记录后续验收要求：进入代码实现后，按子项运行对应 package 的 `pnpm --filter ... test`、`pnpm typecheck`、相关 Web 设置页视觉 QA。

### Phase 3: QQ/channel 对话运行时修复

- [x] T-09 ✅: 参考 OpenCowork QQ Gateway 生命周期补齐 QQ validate、gateway session 持久化/恢复、invalid session 降级、token refresh 与退避重连。
- [x] T-10 ✅: 让 channel session 默认不向上游 LLM 暴露 gateway tools，修复 QQ 私聊入站后 Mimo / OpenAI-compatible 因大量 tools 请求体 400 导致无回复的问题。
- [x] T-11 ✅: 将 channel 工具门控收口为声明层与执行层一致的 fail-closed；本地 `PluginSendMessage` / `PluginReplyMessage` 等 channel tools 继续可由 sandbox 执行。
- [x] T-12 ✅: 保留已有 channel session 的显式 `channelLlmToolsEnabled:true`，新建/普通保存实例默认 false，避免保存实例时意外清掉用户明确 opt-in。
- [x] T-13 ✅: 补充 session tool visibility 与 channel session metadata 回归测试，并运行通道/自动回复/QQ 相关验证命令。
- [x] T-14 ✅: 参考 OpenCowork renderer 自动回复队列，为 OpenAWork `AutoReplyPipeline` 增加 per sessionKey 串行队列，修复 QQ/channel 快速连续消息“一发一回、非多轮状态”的冲突丢消息问题；队列带 per-chat 上限和忙碌回执，避免外部消息无限积压，并补同会话串行、不同会话并发、跨 plugin 隔离、队列超限后恢复、streaming 串行与异常推进测试。
- [x] T-15 ✅: 增强 channel 统一链路日志，覆盖实例 start/stop/restart、router notify/filter/manual-send、auto-reply 入站/跳过/Agent run/发送回复、QQ webhook/文本/图片发送与富媒体上传；日志只记录 messageId/chatId、长度、预览、附件摘要与状态，不记录密钥或完整长正文。
- [x] T-16 ✅: 按 QQ 官方富媒体发送流程补齐 `PluginSendImage` 与 QQ 图片发送：C2C/群聊先调用 `/v2/users/{openid}/files` 或 `/v2/groups/{group_openid}/files` 上传/登记图片，再用 `msg_type:7` + `media.file_info` 发送；自动回复场景会携带原始 `msg_id` 与递增 `msg_seq`，网络图片优先走官方 `url` 字段而不是 Markdown 图片链接。
- [x] T-17 ✅: 参考 OpenCowork 后台任务/插件回发思路补齐 cron 通道回发：定时任务可通过 `plugin_id + plugin_chat_id` 定位任意已启动 channel，创建/复用 channel-managed session，注入 `Channel Reply Routing` prompt，并要求模型用 `PluginSendMessage` 回发到原通道；cron 路由补用户所有权过滤与 patch Zod 校验。
- [x] T-18 ✅: 补齐通道诊断前端展示。`/settings/channels` 的“运行诊断”不再只显示摘要，而是分组展示连接、QQ/平台事件分发、消息入站、忽略事件、socket close、入站错误与运行错误；样式改用 E · Nebula spacing/radius/color token，并补充详细诊断字段的 React 回归测试与 1280/390 视口截图。
- [x] T-19 ✅: 复查补齐 `PluginSendImage` 历史消息图片回复：模型可见参数只暴露 `file_path`、`content`、可选 `message_id`，仍不暴露 `plugin_id/chat_id`；执行层对显式 `message_id` 先用当前 channel context 构造/校验 `replyMessageId`，跨 chat 预组合 ID 直接拒绝，再调用当前服务的 `replyImage`。QQ 当前自动回复继续使用入站 `channelMessageId` 被动回复。
- [x] T-20 ✅: 补齐最终复核证据包并通过 gate。新增 `PluginSendImage` 当前 brief 的 code review PASS、manual QA matrix、schema probe、focused vitest/tsc/eslint/diff-check 日志；最终 gate 复核结果为 `APPROVE`，确认前序“证据不完整”阻断已解除。

## Notes

- `streamable-http` 是当前最明确的 MCP 协议缺口。
- OpenAWork 已有 `desktop_control` 集成闭环，不应再搬 OpenCowork 的 Desktop plugin。
- OpenAWork 已有 `generate_image`，不应再搬 OpenCowork 的 Image plugin，只需保持技能/workflow 能调用。
- OpenAWork 已有 `frontend` 与 `visual-qa`，不应复制 `frontend-skill`；`product-design` 的价值在更高层 workflow。
- OpenAWork 当前 `plugin-host` 是可信 hook，不是用户可安装沙箱 extension；Custom Extension 需要单独设计。
- Memory sync: completed，已将“OpenCowork 工具体系接入采用原生优先、不重复简单工具”写入 `.agentdocs/index.md` 架构决策。
- 2026-07-09 plan maintenance: QQ 私聊“发送消息无反应”的当前根因已定位为 channel session 自动回复链路向 Mimo / OpenAI-compatible 透传大量 gateway tools，导致上游 400；修复后 channel session 默认 `channelLlmToolsEnabled:false`，`filterEnabledGatewayToolsForSession()` 返回空声明，本地 channel reply/send 工具仍可用。
- 2026-07-09 plan maintenance: channel 工具安全边界已改为 fail-closed。默认 channel session 不允许 `websearch/read/bash/run_bash_in_background/interactive_bash/flat MCP/task/Agent/generate_image/repo_clone/codegraph_search` 等普通 gateway tools；显式 opt-in 后仍要求工具名映射到 channel policy 且 `channel.tools[key] === true`，`bash` / `task` 还需 `allowShell` / `allowSubAgents` 为 true。
- 2026-07-09 verification: `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session/session-tool-visibility.test.ts src/__tests__/channels/channel-sessions.test.ts src/__tests__/channels/channel-session-tool-e2e.test.ts src/__tests__/channels/auto-reply.test.ts src/__tests__/channels/qq-gateway.test.ts --testTimeout 20000` 通过，5 files / 38 tests。
- 2026-07-09 verification: `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/session/session-tool-visibility.test.ts src/__tests__/channels/channel-session-tool-e2e.test.ts src/__tests__/channels/auto-reply.test.ts src/__tests__/channels/qq-service.test.ts src/__tests__/channels/channel-inbound-route.test.ts --testTimeout 20000` 通过，5 files / 38 tests。
- 2026-07-09 verification: scoped ESLint、`pnpm --filter @openAwork/agent-gateway exec tsc -p tsconfig.typecheck.json --pretty false --noEmit`、`git diff --check` 均通过。
- 2026-07-09 root cause: channel 自动回复入口是 fire-and-forget 并发执行；`stream.ts` 在同 session 已有 in-flight request 时会于用户消息持久化之前返回 `SESSION_ALREADY_RUNNING`，所以外部平台快速连续发消息时第二条可能不会进入历史，表现为“一发一回”而不是多轮。OpenCowork 在 renderer 侧用 `pluginTaskChains` 按 `pluginId + chatId` 排队，OpenAWork 已在 gateway `AutoReplyPipeline` 侧迁移等价策略，覆盖所有 channel；当前实现同一 chat 最多保留 8 个正在处理/等待处理的自动回复任务，超过后直接给忙碌提示，防止无限排队与延迟 LLM 调用风暴。
- 2026-07-09 verification: `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/channels/auto-reply.test.ts src/__tests__/channels/channel-session-tool-e2e.test.ts src/__tests__/channels/channel-sessions.test.ts src/__tests__/channels/inbound-parsers.test.ts --testTimeout 20000` 通过，4 files / 29 tests。
- 2026-07-09 verification: 针对复查提出的“是否真正形成多轮历史”缺口，已新增 route 级回归：两次 `/channels/:id/inbound` 同 chat 入站必须复用同一个 channel session，并留下 `user/assistant/user/assistant` 历史；后续复查又把该用例改成第一轮仍 in-flight 时发第二条入站，断言第二轮会等第一轮释放后才进入 runtime。
- 2026-07-10 plan maintenance: QQ 网络图片展示问题不再交给模型用 Markdown 解释；本地 channel 工具新增 `PluginSendImage`，工具描述明确要求 WebFetch / 网络图片 URL 场景优先发送真实图片。QQ 执行层对 C2C/群聊使用官方富媒体 `/files` 上传/登记接口，拿到 `file_info` 后发 `msg_type:7` 图片消息；频道消息暂未纳入该 sender，保持显式报错，避免误用不匹配的官方接口。
- 2026-07-10 plan maintenance: `PluginSendImage` 默认走当前 active channel 的 `sendImage`；QQ 自动回复 session 若带有当前入站 `channelMessageId`，会优先调用 `replyImage`，从而携带被动回复所需的原始 `msg_id` 与 `msg_seq`。
- 2026-07-10 plan maintenance: cron/background job 已补齐 OpenCowork 风格通道回发链路。新增 `runCronAgentJob` 后，后台任务不再只创建普通 session；当任务配置 `plugin_id/plugin_chat_id` 时，会进入对应 channel 的会话与回发工具链，适用于 QQ、飞书、Telegram、Discord、Slack、钉钉、企业微信、WhatsApp 等任意已注册 `MessagingChannelService`。
- 2026-07-10 follow-up complexity assessment: 本次复查横跨 tool schema、模型参数、执行层、persona prompt、回归测试与 workflow 同步，按 5+ 原子步骤 +2、3+ 模块 +1、单步验证超过 5 分钟 +1、需持久化复查记录 +1，合计 5，继续落在既有 Full orchestration workflow 内收口。
- 2026-07-10 plan maintenance: 针对复查发现的“`PluginSendImage` 没有显式 `message_id` 历史回复路径”假绿问题，已重新加红测并修复。现在模型要回复历史图片时可传 `PluginGetCurrentChatMessages` 返回的 `replyMessageId` 到 `PluginSendImage.message_id`；执行层通过 `buildChannelReplyReference()` 保证该 ID 属于当前 chat，跨 chat 会在读取/发送前拒绝。模型无须也不应传 `plugin_id/chat_id`。
- 2026-07-10 verification: 红测阶段 `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/tools/channel-tool-definitions.test.ts src/__tests__/tools/channel-tools.test.ts src/__tests__/tools/channel-tool-parameters.test.ts` 失败，失败点为 schema 丢弃 `message_id`、显式图片回复误走 `sendImage`、跨 chat 未拒绝。
- 2026-07-10 verification: 修复后 `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/tools/channel-tool-runtime.test.ts src/__tests__/channels/qq-service.test.ts src/__tests__/tools/channel-tool-definitions.test.ts src/__tests__/tools/channel-tool-parameters.test.ts src/__tests__/tools/channel-tools.test.ts src/__tests__/channels/channel-persona-prompt.test.ts src/__tests__/session/session-tool-visibility.test.ts src/__tests__/channels/channel-sessions.test.ts` 通过，8 files / 58 tests。
- 2026-07-10 verification: `pnpm --filter @openAwork/agent-gateway exec tsc --noEmit --pretty false`、scoped ESLint、`git diff --check` 与 scoped forbidden scan 均通过。
- 2026-07-10 evidence closure: 针对最终 gate 曾指出的证据缺口，已补齐 `.omo/evidence/plugin-send-image-message-id-fix-code-review.md`（code review PASS / APPROVE）、`.omo/evidence/plugin-send-image-channel-fix/manual-qa-matrix.md`（manual QA matrix）、`.omo/evidence/plugin-send-image-channel-fix/schema-parameters-probe.log`（模型可见参数为 `content/file_path/message_id`，required 仅 `file_path`）以及 focused `vitest` / `tsc` / `eslint` / `git diff --check` 日志。
- 2026-07-10 final gate: `.omo/evidence/openawork-channel-qq-image-reply-fix-gate-review.md` 的早期 `REJECT` 阻断来自缺少当前 brief 的 PASS code review 与 manual QA matrix；补齐证据后重新执行 final gate，结果 `APPROVE`。本轮只修复 `PluginSendImage.message_id` 与通道图片回复相关缺口；工作区内其他既有/并行改动保持不回滚、不扩修。
- 2026-07-10 known limit: 当前可重复 QA 覆盖后端匹配表面（sandbox 工具执行、QQ service/API body、schema 参数、prompt 注入）。没有用户 QQ 生产/沙箱实时凭据，因此未做真实 QQ 客户端端到端发送截图；QQ `channel:` 子频道图片 sender 仍显式未支持，当前完整路径覆盖 QQ C2C 私聊与群聊。
- 2026-07-10 plan maintenance: 通道诊断 UI 已从摘要卡升级为分组诊断矩阵，覆盖 `currentIntentDescription`、`lastInboundAt/Accepted/Type/Error`、`lastIgnoredDispatchAt/Type`、`lastSocketCloseAt/Code/Reason`、`lastErrorAt/Error` 等 Gateway 字段，便于定位“收到了但没回复”“被忽略”“socket 断开”“上游发送失败”等问题。
- 2026-07-10 verification: `pnpm --filter @openAwork/agent-gateway exec vitest run src/__tests__/channels/qq-service.test.ts src/__tests__/tools/channel-tools.test.ts src/__tests__/session/session-tool-visibility.test.ts src/__tests__/channels/channel-persona-prompt.test.ts src/__tests__/channels/channel-sessions.test.ts src/__tests__/channels/channel-descriptors.test.ts --testTimeout 20000` 通过，6 files / 51 tests。
- 2026-07-10 verification: `pnpm --filter @openAwork/agent-gateway exec tsc -p tsconfig.typecheck.json --pretty false --noEmit`、`pnpm --filter @openAwork/agent-core exec tsc -p tsconfig.typecheck.json --pretty false --noEmit`、改动文件 scoped ESLint 与 Prettier check 均通过。
- 2026-07-10 verification: 资源/中文人设展示相关回归通过：`@openAwork/resources` 1 file / 9 tests，`@openAwork/web-client` 1 file / 4 tests，`@openAwork/web` targeted 5 files / 16 tests。
- 2026-07-10 verification: cron/channel 回发与通道核心回归通过：`@openAwork/agent-gateway` 11 files / 61 tests；`@openAwork/web-client` channels client 1 file / 9 tests；`@openAwork/web` channels UI targeted 2 files / 10 tests。Web 全量 `tsc --noEmit` 仍被既有 Node 类型、`MiddleTabRouter.openFile`、`TeamPageV2 null`、`packages/artifacts` Node 类型问题阻塞，非本轮通道改动引入。
