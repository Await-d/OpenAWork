# 260923-渠道出站媒体第四批（Slack / WhatsApp / 企业微信 / QQ）

## 任务概述

继续补齐出站媒体能力：
- **Slack**：`sendImage` + `replyImage`（复用第三批已建好的 `files.uploadV2` 基础设施）；
- **WhatsApp**：`sendImage` + `sendFile`（两步：上传媒体 → 发消息）；
- **企业微信**：`sendFile`（应用模式：上传媒体 → 发 file 消息；webhook 模式明确抛错）；
- **QQ**：`sendFile`（泛化既有 `uploadQQImage`，`file_type: 4`）。

**明确不做**：钉钉 `sendFile` —— 其文件消息 API（mediaId 获取路径与 `msgKey` 形态）无法在本环境验证，实现错误风险高，宁缺毋滥（记为待办）。

工具层无需改动：`PluginSendImage` / `PluginSendFile` 已存在，运行时按 `service.sendImage/sendFile` 能力探测自动打通（权限/可见性/描述符均已登记）。

## 冻结契约

1. **Slack**（`slack-media.ts` + `slack.ts`）：
   - `SlackUploadClient.files.uploadV2` args 增加可选 `thread_ts?: string`；`sendSlackFile` 增加可选 `threadTs?: string`（传入 `thread_ts`）；
   - `sendImage(chatId, { buffer, fileName?, text?, signal? })` → `sendSlackFile({ fileName: fileName ?? 'image.png', ... })`；
   - `replyImage(messageId, input)` → 解析 `<channel>:<ts>`（与 `replyMessage` 一致）→ `sendSlackFile({ threadTs: ts })`；缺 ts 时抛错。
2. **WhatsApp**（`whatsapp-media.ts` + `whatsapp.ts`）：
   - `sendWhatsAppMedia({ accessToken, phoneNumberId, to, buffer, fileName, kind: 'image' | 'file', caption?, signal? })`：① `POST /v19.0/{phoneNumberId}/media`（multipart：`messaging_product=whatsapp`、`type=image|document`、`file`）→ `{ id }`；② `POST /v19.0/{phoneNumberId}/messages`（`type: image` + `image: { id, caption? }`；或 `type: document` + `document: { id, filename, caption? }`）→ `{ messageId }`；任一步失败抛错（发送失败必须可见）。
   - service：`sendImage` / `sendFile` 均委托；`replyImage` 复用 `sendImage`（WhatsApp 无引用回复语义，与既有 `replyMessage` 一致）。
3. **企业微信**（`wecom.ts`）：
   - `sendFile(chatId, { buffer, fileName, text? })`：无 `corpId`（webhook-only）→ 抛 `WeCom webhook mode does not support file messages`；应用模式 → ① `POST /cgi-bin/media/upload?access_token=&type=file`（multipart `media`）→ `media_id`；② 复用既有 `sendViaApi` 的消息发送路径发 `msgtype: 'file'`（`file: { media_id }`）。
4. **QQ**（`qq-media.ts` + `qq.ts`）：
   - `uploadQQImage` 泛化为 `uploadQQMedia(context, path, { buffer, sourceUrl, fileType })`（图片 `1`、文件 `4`）；
   - `sendQQFile(context, target, { buffer, fileName, sourceUrl?, text?, replyToMessageId? })`；`channel` 目标仍抛错（与图片一致）；
   - service `sendFile` → `parseQQChatId(chatId)` + `sendQQFile`。

## 任务拆分（DAG，4 代理并行）

### Phase 1：四条独立流（文件集互不重叠）

- [x] T-01（W1）Slack：`channels/slack-media.ts` + `channels/slack.ts` + 新测试 ✅（7 用例；4 文件 36 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：`signal`/`sourceUrl` 按接口保留不透传（`uploadV2` 无 AbortSignal 入口，与既有 `sendFile` 一致）；非法引用抛裸 `Error`（与 Discord `replyImage` 同形，符合契约原文）
- [x] T-02（W2）WhatsApp：`channels/whatsapp-media.ts` + `channels/whatsapp.ts` + 新测试 ✅（7 用例；4 文件 28 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：步骤②复用同一 60s 超时常量（媒体慢路径，合理）；额外补「上游未回 messages → messageId 空串兜底」用例；`sourceUrl`/`fileType` 按接口保留不用；`replyImage` 无引用语义（按 chatId 重发，与既有 `replyMessage` 一致）
- [x] T-03（W3）企业微信：`channels/wecom.ts` + 新测试 ✅（6 用例；3 文件 14 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：步骤②也透传 `signal`（接口含该参数，合理扩展，测试已锁定）；webhook + 应用凭证同时配置时 `sendFile` 走应用模式（契约要求——文件消息仅应用模式支持）
- [x] T-04（W4）QQ：`channels/qq-media.ts`（`uploadQQMedia` 泛化 + `sendQQFile`）+ `channels/qq.ts`（`sendFile`）+ 新测试 ✅（5 用例；3 文件 19 测试绿；channels 全域 46 文件 / 305 用例全绿；typecheck exit 0）
  - 偏差备案：受文件范围限制未改 `qq-api.ts` → `qq.ts` 自建 `mediaContext()` 并重复约 15 行 POST/错误解析逻辑（**建议后续收编**，协调者评估中）；`getNextMsgSeq` 为显式抛错桩（无调用路径）；`AGENTS.md` 的「未实现」表述由协调者收口更新

### Phase 2：验证与收口（协调者）

- [x] T-05 全量回归 + 缺陷复查 —— **本批改动全部验证通过**：各代理定向全绿、channels 全域 **46 文件 / 305 用例全绿**、全包 ESLint exit 0、改动文件 Prettier 全绿；⚠️ 仓库级 typecheck 与全量单测各有一处**外部阻塞**（用户在途的「子代理数量限制」功能，非本批引入——typecheck 唯一错误在 `task/subagent-limits.ts:48`；全量 2 个失败在 `task/subagent-depth.test.ts`，由 `subagent-depth.ts` 重构引起且既有测试未同步）
- [x] T-06 `services/agent-gateway/AGENTS.md`（两处：出站发图扩展 + 文件能力全景修正）+ 归档 ✅

## 成果总结（2026-09-23）

**状态**：✅ 已交付（4 任务 / 4 个并行代理 + 协调者收口）；本批改动独立验证全绿，仓库级验证受两处外部在途工作阻塞（非本批引入）。

**交付内容**：

- ✅ **Slack**：`sendImage` + `replyImage`（复用 `files.uploadV2`；`replyImage` 用 `thread_ts` 挂线程，非法引用抛错不发请求）。
- ✅ **WhatsApp**：`sendImage` + `sendFile`（两步：`/{phoneNumberId}/media` multipart 上传 → `/messages` 发 `image`/`document`；上传失败不进入发送步骤）。
- ✅ **企业微信**：`sendFile`（应用模式 `media/upload?type=file` → `message/send` 的 `msgtype=file`；webhook-only 模式零网络即抛明确文案）。
- ✅ **QQ**：`sendFile`（`uploadQQMedia` 泛化，`file_type: 4`；c2c/group 可用、`channel` 抛错）。
- ✅ **工具层零改动**：`PluginSendImage` / `PluginSendFile` 能力探测自动打通（`tools/channel-tools.ts:134`）。

**改动面**：gateway 7 个源文件（`slack-media.ts` / `slack.ts` / `whatsapp-media.ts` / `whatsapp.ts` / `wecom.ts` / `qq-media.ts` / `qq.ts`）+ 4 个测试文件（25 新用例）+ `services/agent-gateway/AGENTS.md`。

**验证**：channels 全域 **46 文件 / 305 用例全绿** · 全包 ESLint exit 0 · 改动文件 Prettier 全绿 · 各代理定向全绿（W1 36 / W2 28 / W3 14 / W4 19）。

**外部阻塞（非本批，未修改用户文件）**：① `task/subagent-limits.ts:48` 类型错误（用户在途「子代理数量限制」功能）；② `task/subagent-depth.test.ts` 2 用例失败（同一功能重构后既有测试未同步）。

**已知限制 / 技术债**：钉钉 `sendFile` 未实现（API 不可验证）；Slack 需 `files:write` scope；WhatsApp 上传成功但发送失败会留孤立媒体（Meta 侧自动过期）；QQ `mediaContext` 与 `QQApiClient` 约 40 行重复（D-5 技术债，下批收编）。

## 风险与取舍

| 编号 | 风险 / 取舍 | 处置 |
| --- | --- | --- |
| R-1 | Slack `replyImage` 用 `thread_ts`（Slack 是线程模型，非消息引用） | 语义映射已注明；缺 ts 抛错 |
| R-2 | WhatsApp 上传失败/发送失败分两步，可能「上传成功但发送失败」留下孤立媒体 | 抛错可见；媒体由 Meta 侧自动过期 |
| R-3 | 企业微信 webhook 模式不支持文件 | 明确抛错文案（不静默失败） |
| R-4 | QQ `channel` 目标不支持文件（与图片一致） | 沿用既有抛错 |
| R-5 | 钉钉 `sendFile` 不做 | API 细节不可验证；记为待办 |
| R-6 | 真实渠道冒烟不可得（无 token） | mock 全链路 + 已知限制标注 |

## 复杂度评估

- 原子步骤：5（T-01…T-05）→ +2
- 并行流：4 条相互独立 → +2
- 涉及模块：channels×4（含 2 个 media 模块扩展）→ +1
- 单步 >5 min：是 → +1
- 需持久化供审查：是 → +1
- OpenCode 可用：是 → −1
- **合计**：6 → **Full orchestration**

## 收口补充记录（2026-09-23 21:00，协调者）

- ✅ **QQ 技术债（D-5）已偿还**：`QQApiClient` 新增 `sendFile`（委托 `sendQQFile` + 同一 context，含真实 `getNextMsgSeq`）；`qq.ts` 的 `sendFile` 退回纯委托并删除 `apiBase` / `mediaContext()` / `sendQQMessageBody()` 及相关 import/常量（约 −50 行）。验证：qq 三测试文件 19 用例绿、**channels 全域 46 文件 / 305 用例绿**、无 QQ 类型错误、ESLint / Prettier 绿。
- **钉钉调研结论**：官方文档站（`open.dingtalk.com`）需 JS 渲染不可达、搜索引擎未返回 API 细节 → 维持「不做」（待有可验证文档时再立项）。
- **真实渠道冒烟**：环境无任何渠道凭据（`.env` 无渠道键；渠道配置存于运行时 DB 的 `user_settings.channels`）→ 不可自动化；就绪步骤：在设置页配置真实凭据后，用 `/channels/:id/send` 与工具调用做端到端确认。
- **仓库级 typecheck**：用户已自行修复 `subagent-limits.ts` 类型错误 → **全包 typecheck 错误总数 0** ✅。
- **残留（用户工作，未代改）**：`src/__tests__/task/subagent-depth.test.ts` 仍 2 用例失败——「子代理数量限制」重构后的新期望值需产品决策（默认 1 / 护栏 1–8 / 错误文案已变更），协调者不代改用户测试。
