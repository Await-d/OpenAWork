# 260923-渠道入站图片第二批（Slack / WhatsApp / 企业微信）

## 任务概述

第一批（Telegram / Discord）已交付（见 `done/260923-渠道入站图片与出站发图.md`）。本批把**入站图片**扩展到 Slack、WhatsApp、企业微信，并为此引入**通用 service 级入站媒体 enrich 钩子**。

**范围边界**：
- 不含出站媒体（Slack/WhatsApp/企业微信的发图另立任务）；
- 不含 QQ 入站图片；relay 模式不接入 enrich（与第一批的已知限制一致）；
- 企业微信 v1 只做 `PicUrl` 直映射（不下载、不解密）。

## 现状分析（一手证据）

| 平台 | 入站路径 | 图片消息现状 | 接入点 |
| --- | --- | --- | --- |
| Slack | service 内 Bolt `app.message` handler（`slack.ts:234`） | 纯文件消息被丢弃（parser 要求 `text` 非空，`inbound-parsers/slack.ts:58`） | service handler 内下载（`url_private_download` + Bearer token） |
| WhatsApp | 通用 `POST /channels/:id/inbound`（`channel-inbound-route.ts:277`） | 只读 `text.body`（`inbound-parsers/whatsapp.ts:65`） | **需新增通用 enrich 钩子**（service 无入站循环；`handleWebhookEvent` 是未接线死代码） |
| 企业微信 | 通用 `POST /channels/:id/inbound` | 只处理 `MsgType === 'text'`（`inbound-parsers/wecom.ts:76`） | parser 内直接映射 `PicUrl` → `imageUrl`（纯函数，无需 token） |

消费链路已就绪：`auto-reply.ts:400` 的 `buildInputImageParts` 支持 `base64` / `imageUrl` 双形态。

## 方案设计

### D-1 通用 enrich 钩子（冻结契约）

`channels/types.ts` 的 `MessagingChannelService` 新增可选方法：

```ts
/**
 * 入站消息媒体补全：HTTP 入站路由在 parser 之后、notify 之前调用。
 * 实现方应从 message.raw 提取媒体引用并下载，返回可能带 images 的新消息。
 * 契约：失败时必须原样返回入参消息（不得抛错、不得阻塞投递）；无媒体时原样返回。
 */
enrichInboundMessage?(message: ChannelMessage): Promise<ChannelMessage>;
```

- `channel-inbound-route.ts`：deps 新增 `enrichInboundMessage?: (input: { channel: ChannelInstance; message: ChannelMessage }) => Promise<ChannelMessage>`；在通用 POST 分支的 parse 之后、`recordInboundDiagnostic` / `notifyChannel` 之前调用（**QQ 特殊分支不动**）。
- `router.ts` 注入：查 `channelManager.getService(channel.id)`；无方法 → 原样返回；有 → `try { await service.enrichInboundMessage(message) } catch { warn; return message }`。
- 路由层再加一层 try/catch 兜底（双重降级，确保投递永不因 enrich 失败而丢失）。

### D-2 WhatsApp 入站图片（下载 → base64）

- parser 扩展（`inbound-parsers/whatsapp.ts`）：识别 `messages[].image = { id, mime_type, caption? }`；`content = caption || '[User sent an image]'`；无图无文本才丢弃。
- 新建 `channels/whatsapp-media.ts`：
  - `WHATSAPP_INBOUND_IMAGE_MAX_BYTES = 5 * 1024 * 1024`（Cloud API 图片消息上限）
  - `downloadWhatsAppInboundImage({ accessToken, mediaId, mimeType?, fileName?, fileSize?, signal? })`：`GET /v19.0/{mediaId}`（Bearer）→ `{ url, mime_type, file_size }` → 校验 → `GET {url}`（Bearer）→ buffer → `sniff ?? mimeType` → base64；任何失败 warn + `null`（对齐 `telegram-media.ts` 的分层校验与降级）。
  - `attachWhatsAppInboundImages({ accessToken, message })`：从 `message.raw` 提 image 引用 → 下载 → 返回带 `images` 的消息。
- `whatsapp.ts` 实现 `enrichInboundMessage`（委托 `attachWhatsAppInboundImages`）。

### D-3 Slack 入站图片（下载 → base64）

- parser 扩展（`inbound-parsers/slack.ts`）：`message.files` 中存在图片文件（`mimetype` 以 `image/` 开头或 `filetype` 白名单）时，即使 `text` 为空也返回消息（`content = text || '[User sent an image]'`）；提及过滤保持用 text 判定。
- 新建 `channels/slack-media.ts`：
  - `SLACK_INBOUND_IMAGE_MAX_BYTES = 4 * 1024 * 1024`、最多 4 张
  - `attachSlackInboundImages({ token, message, raw })`：从 raw 读 `files`，`url_private_download || url_private` + `Authorization: Bearer <botToken>` 下载 → base64；逐张独立降级（单张失败跳过，不阻塞其余）。
- `slack.ts`：`SlackMessage` 类型补 `files?: unknown[]`；`app.message` handler 在 parse 后 `await attachSlackInboundImages(...)` 再 notify。

### D-4 企业微信入站图片（PicUrl 直映射，v1）

- parser 扩展（`inbound-parsers/wecom.ts`）：`MsgType === 'image'` 且 `PicUrl` 非空 → `content = '[User sent an image]'`、`images: [{ imageUrl: PicUrl, mediaType: 'image/jpeg' }]`（企业微信不提供 mime，默认 jpeg）；无 `PicUrl` → 仍返回 null。
- 不下载（无需 access_token、不涉加密媒体）；`PicUrl` 可访问性记为已知限制。

## 任务拆分（DAG，4 代理并行）

### Phase 1：四条独立流（文件集互不重叠）

- [x] T-01（W1）通用 enrich 钩子：`types.ts` + `channel-inbound-route.ts` + `router.ts` + 扩展 `__tests__/channels/channel-inbound-route.test.ts` ✅（新增 4 用例；3 文件 25 测试绿；typecheck exit 0；ESLint/Prettier 绿）
  - 偏差备案：新增用例走「直接注册 `registerChannelInboundRoutes` + 显式注入 deps」，`router.ts` 的 `getService` 查表层未被专门用例覆盖（需启动真实渠道，收口阶段由渠道全域回归间接覆盖）；测试夹具用 `Parameters<typeof registerChannelInboundRoutes>[1]` 推导类型，不扩大生产导出面
- [x] T-02（W2）WhatsApp：`inbound-parsers/whatsapp.ts` + 新建 `whatsapp-media.ts` + `whatsapp.ts` + 新建 `__tests__/channels/whatsapp-inbound-media.test.ts` ✅（18 用例；4 文件 41 测试绿；ESLint/Prettier 绿）
  - 偏差备案：第二步二进制响应无 JSON `mime_type`，实现改为「响应 `Content-Type`（仅接受 image/*）→ 第一步元数据 `mime_type`」，回退顺序仍严格 `sniff → input.mimeType → 响应侧`
- [ ] T-03（W3）Slack：`inbound-parsers/slack.ts` + 新建 `slack-media.ts` + `slack.ts` + 新建 `__tests__/channels/slack-inbound-media.test.ts`
- [x] T-04（W4）企业微信：`inbound-parsers/wecom.ts` + 新建 `__tests__/channels/wecom-inbound-media.test.ts` ✅（6 用例；3 文件 28 测试绿；ESLint/Prettier 绿）

### Phase 2：验证与收口（协调者）

- [ ] T-05 全量回归（`test:unit` + `typecheck` + 全包 ESLint + Prettier）+ 缺陷复查
- [ ] T-06 更新 `services/agent-gateway/AGENTS.md` + 归档

## 风险与取舍

| 编号 | 风险 / 取舍 | 处置 |
| --- | --- | --- |
| R-1 | Slack `url_private` 需要 `files:read` scope，未授权时下载 401 | 单张失败跳过 + warn；文档标注需要的 scope |
| R-2 | WhatsApp 媒体 URL 有短期时效且需 Bearer | 立即下载转 base64（不落 URL） |
| R-3 | 企业微信 `PicUrl` 可访问性/时效不可验证 | v1 直映射 + 已知限制；后续可改 MediaId + access_token 下载 |
| R-4 | enrich 失败导致消息丢失 | 双重 try/catch 降级（service + 路由层），失败原样投递 |
| R-5 | relay 模式不经过 enrich | 与第一批一致，记为已知限制 |

## 复杂度评估

- 原子步骤：6（T-01…T-06，含 4 个平台/钩子实现）→ +2
- 并行流：4 条（hook / WhatsApp / Slack / 企业微信）相互独立 → +2
- 涉及模块：types / route / router / parser×3 / media×2 / service×2 → +1
- 单步 >5 min：是 → +1
- 需持久化供审查：是 → +1
- OpenCode 可用：是 → −1
- **合计**：6 → **Full orchestration**
