# 260923-PluginSendFile 通用工具与三平台文件发送

## 任务概述

新增通用 `PluginSendFile` 工具（模型可见），并为 **Telegram / Discord / Slack** 补齐 `service.sendFile` 实现。飞书、微信已有专属文件工具与实现，本批不改。

## 现状分析（一手证据）

- 工具层**无通用 `PluginSendFile`**（只有 `WeixinSendFile` / `FeishuSendFile` 专属）；`executeChannelMediaTool` 的 `file` 分支已存在但仅被 `WeixinSendFile` 触发（`tools/channel-tools.ts:119`）。
- 接口 `MessagingChannelService.sendFile?` 已存在（`channels/types.ts:132-141`）。
- `sendFile` 已实现：飞书、微信；未实现：Telegram / Discord / Slack / 钉钉 / 企业微信 / WhatsApp / QQ。
- 策略层需同步登记：`session/channel-tool-visibility-policy.ts:21` 的 `CHANNEL_SEND_TOOL_NAMES`、`permission/tool-permission-derivers.ts:638` 的 `CHANNEL_SEND_TOOL_NAMES`、`channels/descriptors-shared.ts:42` 的 `COMMON_CHANNEL_TOOLS`。

## 冻结契约

1. 工具名 **`PluginSendFile`**；参数 schema：`{ file_path: string; content?: string }`（**无 `message_id`** —— `MessagingChannelService` 无 `replyFile`）。
2. 执行：`service.sendFile(ctx.chatId, { buffer, fileName, ...(text ? { text } : {}) })`；能力缺失时抛既有文案 `Current channel does not support file sending.`（`channel-tools.ts:119`）。
3. `sendTelegramDocument({ apiBase, chatId, buffer, fileName, caption?, signal? })` → `POST /sendDocument` multipart（`document` 字段；caption ≤1024，复用 `TELEGRAM_CAPTION_MAX_LENGTH`）。
4. Discord：`sendFile` 复用私有 `postDiscordMessage`（content ≤2000 截断、文件名 sanitize、multipart 不带 `Content-Type`）。
5. Slack：`sendSlackFile({ client, channelId, buffer, fileName, text? })` → `files.uploadV2`（需 `files:write` scope；失败抛错，发送失败必须可见）。

## 任务拆分（DAG，3 代理并行）

### Phase 1：三条独立流（文件集互不重叠）

- [x] T-01（W1）工具与策略层：`tools/channel-tool-definitions.ts`（定义 + `pluginFileInputSchema`）+ `tools/channel-tools.ts`（执行分支；`executeChannelMediaTool` 参数放宽为最小结构类型）+ `tools/channel-tool-parameters.ts`（新增分支，判断依据：白名单返回参数、null 会兜底为「空参数任意字段」）+ `channels/descriptors-shared.ts`（`COMMON_CHANNEL_TOOLS`）+ `session/channel-tool-visibility-policy.ts` + `permission/tool-permission-derivers.ts` + 扩展测试 ✅（4 文件 51 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：类型放宽采用「最小结构类型」而非联合（`PluginFileInput` 与 `assertChannelContext` 的 weak type 目标零公共属性会触发 TS2345）；`PluginFileInput` 导出暂无消费者（有意保留）
- [x] T-02（W2）Telegram + Discord：`channels/telegram-media.ts`（+`sendTelegramDocument`）+ `channels/telegram.ts`（`sendFile`）+ `channels/discord.ts`（`sendFile`）+ 新测试 ✅（5 文件 32 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：`truncateTelegramCaption` 复用既有私有 helper；`sendFile` 无引用回复语义（接口无 `replyFile`）；`fileType` 按接口保留不用；协调者收口修 `postDiscordMessage` 错误前缀（`sendImage` → 通用 `message send`）
- [x] T-03（W3）Slack：`channels/slack-media.ts`（+`sendSlackFile`）+ `channels/slack.ts`（`sendFile` + `SlackWebClient.files.uploadV2` 类型）+ 新测试 ✅（7 用例；3 文件 29 测试绿；ESLint/Prettier 绿）
  - 偏差备案：`slack-media.ts` 文件头注释按入站/出站不同失败语义调整（入站 warn+null、出站抛错，对齐 `telegram-media.ts` 先例）；`signal` 因 `uploadV2` 无透传入口而仅保留接口参数（JSDoc 注明）

### Phase 2：验证与收口（协调者）

- [x] T-04 全量回归 + 缺陷复查 ✅：全量 **557 文件 / 4292 用例 EXIT=0**（3 skipped）；typecheck exit 0；全包 ESLint exit 0；agent-core 48 文件 / 589 测试绿；首轮全量抓到的 agent-core 权限类别登记点缺失已修复
- [x] T-05 收口补强 ✅：`channel-persona-prompt.ts` 补 `PluginSendFile` 指引（中英）+ 权限派生测试补 `PluginSendFile` 断言 + `postDiscordMessage` 错误前缀修复（`sendImage` → `message send`，联动更新 1 条既有断言）；定向 61 测试绿
- [x] T-06 文档与归档 ✅：`services/agent-gateway/AGENTS.md` 追加「渠道出站文件能力」+ 策略层登记点清单升级为「5 处缺一不可」（含失败模式说明）；workflow 归档 `done/`

## 成果总结（2026-09-23）

**状态**：✅ 已交付并验证 —— T-01…T-06 全部完成（3 任务 / 3 个并行代理 + 协调者收口）。

**交付内容**：

- ✅ **通用 `PluginSendFile` 工具**：定义 + `{ file_path, content? }` schema（无 `message_id`）+ 执行分支（走既有 `executeChannelMediaTool` 的 file 分支）+ 参数说明显式登记；模型在渠道会话中可直接发文件。
- ✅ **Telegram**：`sendTelegramDocument`（`/sendDocument` multipart，caption ≤1024 复用截断 helper）+ service `sendFile`。
- ✅ **Discord**：`sendFile` 复用 `postDiscordMessage`（content ≤2000 截断、文件名 sanitize）；错误前缀由 `sendImage` 修为通用 `message send`。
- ✅ **Slack**：`sendSlackFile`（`files.uploadV2`，需 `files:write` scope）+ service `sendFile`。
- ✅ **策略层登记（5 处）**：描述符 `COMMON_CHANNEL_TOOLS`、可见性 `CHANNEL_SEND_TOOL_NAMES`、权限派生发送类名单、**agent-core `CHANNEL_PERMISSION_TOOL_NAMES`**（收口抓到）、参数说明白名单。

**改动面**：gateway 12 个源文件（+`telegram-media.ts`/`discord.ts`/`slack-media.ts`/`slack.ts` 等）+ 5 个测试文件（29 新用例）+ agent-core 2 个文件（映射 + 断言）+ `services/agent-gateway/AGENTS.md`。

**验证**：全量单测 **557 文件 / 4292 用例 EXIT=0** · gateway typecheck exit 0 · 全包 ESLint exit 0 · agent-core 48 文件 / 589 测试绿 · 改动文件 Prettier 全绿。

**已知限制**：钉钉/企业微信/WhatsApp/QQ 未实现 `sendFile`（调用命中能力探测文案）；Slack 需 `files:write` scope；`sendFile` 无引用回复语义（接口无 `replyFile`）；`fileType` 参数保留不用（Telegram 按文件名推断、Discord 同端点）。

## 风险与取舍

| 编号 | 风险 / 取舍 | 处置 |
| --- | --- | --- |
| R-1 | Slack `files.uploadV2` 需 `files:write` scope | 失败抛错并提示 scope；文档标注 |
| R-2 | 未实现 `sendFile` 的平台（钉钉/企业微信/WhatsApp/QQ）会看到工具但调用报错 | 与第一批前 `PluginSendImage` 的既有模式一致；能力探测文案清晰 |
| R-3 | 通用工具与飞书/微信专属文件工具并存 | 既有模式（`PluginSendImage` + `FeishuSendImage` 并存），保持一致 |
| R-4 | 微信 `sendFile` 需 context token（仅能回复既有会话） | 不在本批范围，保持现状 |

## 复杂度评估

- 原子步骤：4（T-01…T-04）→ 0
- 并行流：3 条相互独立 → +2
- 涉及模块：tools / descriptors / session / permission / channels×3 → +1
- 单步 >5 min：是 → +1
- 需持久化供审查：是 → +1
- OpenCode 可用：是 → −1
- **合计**：4 → **Full orchestration**
