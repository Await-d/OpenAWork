# .agentdocs/workflow/260422-gpt-image2-集成方案.md

## Task Overview
- 目标：为当前系统新增 GPT Image 2 能力建立一份可实施的集成方案，覆盖设置页配置、Web/桌面 Chat 交互、gateway 接入、artifact 承载与分阶段落地顺序。
- 范围：`apps/web` 设置页与 Chat 页、`packages/shared-ui` Provider/Attachment/Artifact UI、`packages/agent-core` provider 类型、`services/agent-gateway` provider/settings/stream/artifacts/image-generation、`apps/mobile` 后续补齐策略。
- 非目标：本次不直接实现代码；首期不承诺移动端同步交付，不把“模型可选”误当作“图片真正可生成”，也不把图像编辑/多轮图像工作流硬塞进第一批。

## Current Analysis
- 当前设置链路只维护 `activeSelection.chat / fast / compaction` 与 `defaultThinking`；`AIModelConfig` 只有 `supportsTools / supportsVision / supportsThinking`，没有“图片生成能力/默认图片模型”这一层产品语义。
- Web Chat 已具备附件条、图片缩略图与 artifact 工作区入口，但发送前会先把文件上传到 `/sessions/:sessionId/artifacts`，随后把 `artifact:<id>` 与文本摘录拼进用户消息；这条链路本质上仍是**文本中心**。
- `services/agent-gateway/src/render-responses-api.ts` 当前只会把用户消息渲染为 `input_text`；`message-to-model-messages.ts` 里的 `UnifiedMessage` 也只有字符串 `content`，没有图像输入结构，因此 GPT Image 2 不能靠“换个模型名”直接工作。
- gateway 现有最接近多模态输入的范式是 `look-at-tools.ts`：它已经分别演示了 Responses `input_image`、Anthropic base64 image、Chat Completions `image_url` 的拼装方式。
- 产物体系已经支持 `ArtifactContentType = 'image'`，`ArtifactPreview.tsx` / `ImagePreview.tsx` 也已有图片预览能力；但当前 `assistant-content-artifacts.ts` 只会从 fenced code block 提取 artifact，不会主动接收模型生成的图片结果。
- 桌面端直接复用 Web 页面，所以 Web 方案会天然覆盖 Desktop；Mobile 则有独立的 `SettingsScreen.tsx`、`ChatScreen.tsx` 与 `providerPersistence.ts`，必须明确后置或单列阶段。

## Solution Design

### 核心设计决策
1. **首期采用“专用图片生成闭环”，不直接篡改主聊天模型链路。**
   - 原因：当前对话链路是文本中心，直接把 GPT Image 2 挂进 `/stream` 会同时牵动 `UnifiedMessage`、Responses renderer、流式事件投影与前端 transcript，风险过大。
   - 首期建议新增专用 gateway 能力：`POST /sessions/:sessionId/images/generations`，由它直接对接 OpenAI Images API，稳定产出 image artifact。
2. **设置页新增“图片模型档”而不是复用现有 chat 默认模型。**
   - 原因：`gpt-image-2` 与通用聊天模型职责不同，不能让用户为了生图把 `activeSelection.chat` 改成图片模型。
   - 建议在 `ActiveSelection` 增加 `image` 档位，并新增 `imageGenerationDefaults`（如 quality/size/outputFormat/background）。
3. **Chat 页采用显式“对话 / 生图”双模式 UI，并保留 slash 命令作为增强，而不是完全依赖模型自动判断。**
   - 原因：图片生成需要可见的参数、成本提示和结果预期；显式模式切换比“让模型自己决定要不要出图”更可控、更易发现。
4. **图片结果以 content artifact 为真值源，聊天记录只做索引与说明。**
   - 原因：现有 artifact 工作区、预览和分享链路已成熟，应该复用它，而不是把 base64 大块塞进消息正文。
5. **首期范围固定为 Web + Desktop 文生图闭环；图片编辑/以图生图与 Mobile 都进入后续阶段。**
   - 原因：当前 attachment 流程并没有真正的 `input_image`；移动端配置与聊天实现也完全独立，首期一起做会显著放大风险。

### 接入路径选择
- **Phase 1：Images API（推荐）**
  - 使用 `model: 'gpt-image-2'` 的 OpenAI Images API 直接出图。
  - 优点：输出确定、与当前文本聊天链路解耦、最适合先跑通文生图 + artifact 落库。
- **Phase 2：Responses API + image_generation / input_image（后续）**
  - 当需要多轮图像编辑、基于图片继续追问、或让 agent 工作流自行编排生图时，再扩展 `UnifiedMessage` 与 `render-responses-api.ts`。

### Release 切分（避免 Phase 与上线单元混淆）
- **Release 1（首期上线单元）** = 当前 Phase 1 + Phase 2 + Phase 3
  - 包含：settings 图片模型档、专用图片生成 route、Web/Desktop 生图模式与 artifact 联动
  - 不包含：真实图片输入、多轮图片编辑、Mobile UI 跟进
- **Release 2** = 当前 Phase 4
  - 包含：`input_image`、图片编辑、Responses 多模态对齐
- **Release 3** = 当前 Phase 5
  - 包含：Mobile 设置/聊天生图与多模态补齐

## Complexity Assessment
- Atomic steps: 5+（设置配置、provider 类型、gateway 能力、Chat UI、artifact 承载、移动端策略、测试）→ +2
- Parallel streams: 是（配置面、Chat UI、gateway/service、artifact/read model 可并行规划）→ +2
- Modules/systems/services: 3+（apps/web、packages/shared-ui、packages/agent-core、services/agent-gateway、apps/mobile）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是一个跨前后端与产品交互面的正式实施方案，需要保留阶段、依赖、风险、验收口径与移动端边界，适合 full orchestration 持久化。

## Implementation Strategy

### Phase 0 — 范围冻结与契约命名
- [ ] I-00: 冻结首期目标为 **Web+Desktop 文生图闭环**，明确 Mobile 后置、图片编辑后置
- [ ] I-01: 确定产品术语：`图片模型档 / 图片生成默认值 / 生图模式 / 图片产物`
- [ ] I-02: 冻结首期后端路由命名与返回 shape（建议 `POST /sessions/:sessionId/images/generations`）

### Phase 1 — Provider / Settings 能力扩展
- [x] I-10: `packages/agent-core/src/provider/types.ts` 为 `AIModelConfig` 增加 `supportsImageGeneration` ✅
- [x] I-11: 为 `ActiveSelection` 增加 `image: { providerId, modelId }` ✅
- [x] I-12: 新增 `imageGenerationDefaults` 配置结构（quality / size / outputFormat / background）✅
- [x] I-13: 扩展 `services/agent-gateway/src/provider-config.ts`、`routes/settings.ts` 与 schema，读写新的图片配置 ✅
- [x] I-14: 扩展 `packages/shared-ui/src/ProviderSettings.tsx` 与 `apps/web/src/pages/settings/connection-tab-content.tsx`，把图片模型档与图片默认值暴露到设置页 ✅

#### Settings UI 设计要求
- 现有“模型与提供商”区块下新增 **图片生成** 卡片，而不是把图片模型塞进 chat/fast 两个下拉框里。
- 模型能力需要从“支持视觉”区分出“支持生图”，避免用户把 `supportsVision` 误解成可生成图片。
- 对 OpenAI provider 的 `gpt-image-2` 应展示能力说明、支持的输出格式与参数提示。
- 保存逻辑沿用 `/settings/providers` 主链，但要新增配置摘要，避免用户保存后不知道“图片模式默认走哪个模型”。

#### Settings 持久化与兼容性约束
- `activeSelection.image` 与 `imageGenerationDefaults` 初始可为空；空值表示“图片功能未配置完成”，不得静默回退到 `chat` 模型。
- 服务端在保存 `/settings/providers` 时必须做 **merge-preserving**，旧客户端或 Mobile 提交缺少 image 字段的 payload 时，不能把已存在的 image 配置清空。
- 保存图片配置不得影响既有 `chat / fast / compaction / defaultThinking`。
- provider 被禁用、删除或模型不可用时，settings 读取必须返回可解释的降级状态，而不是保留一个不可解析的悬空选择。

### Phase 2 — Gateway 图片生成服务与 artifact 真值链
- [x] I-20: 新增 `services/agent-gateway/src/image-generation/` 领域模块（service / schema / mapper）✅
- [x] I-21: 新增 `POST /sessions/:sessionId/images/generations` 路由，完成 owner 校验、provider 解析、参数校验与调用 OpenAI Images API ✅
- [x] I-22: 将生成结果写入 content artifact，类型固定为 `image`，metadata 记录 `providerId/modelId/prompt/revisedPrompt/size/quality/outputFormat/requestId` ✅
- [x] I-23: 为 artifact 列表与详情补充图片元数据读取，确保工作区和侧边状态都能消费 ✅
- [x] I-24: 为失败场景补结构化错误：provider 不支持、模型未启用、参数非法、OpenAI 错误透传裁剪 ✅

#### Gateway 设计约束
- 首期不要把图片生成强塞进 `stream.ts` 的通用流式文本回合；走独立 route，更容易保证幂等与可测性。
- provider 选择优先走 `activeSelection.image`，若缺失则降级报错，不默默借用 `chat` 模型。
- OpenAI 官方 base URL 才允许 `gpt-image-2` Images API；代理/镜像若不兼容，应在服务层显式拒绝或标记“不保证支持”。
- 生成结果不要只存文件路径；必须同步创建内容型 artifact，复用 `ArtifactContentType = 'image'` 和现有 artifact 工作区。

#### Route 响应契约（首期必须冻结）
- `POST /sessions/:sessionId/images/generations` 成功响应至少返回：
  - `artifact`: `{ id, title, type, mimeType, metadata }`
  - `revisedPrompt`（若上游返回）
  - `parameters`: `{ providerId, modelId, size, quality, outputFormat, background }`
  - `messageSummary`：给前端直接落 assistant 摘要消息用的简短说明文本
- 失败响应至少返回：
  - `error.code`
  - `error.message`
  - `error.retryable`
- 前端不得猜测 artifact 内部结构；Release 1 的 UI 联动全部建立在这个响应契约之上。

#### Artifact 最小契约
- 每个图片 artifact 至少具备：`type='image'`、`mimeType`、`fileName/title`、`byteSize`、`providerId`、`modelId`、`prompt`、`revisedPrompt`、`size`、`quality`、`outputFormat`、`requestId`。
- 产物写入后必须支持**刷新页面后仍可预览**；这项能力需要进入验收标准，而不是只验证当前内存态能看到图片。

### Phase 3 — Web/桌面 Chat 交互改造
- [x] I-30: `apps/web/src/components/chat/ChatComposer.tsx` 增加“对话 / 生图”模式切换入口 ✅
- [x] I-31: `apps/web/src/pages/ChatPage.tsx` 新增图片模式状态、图片默认值读取与专用提交链 ✅
- [x] I-32: 生图模式下展示 prompt + 图片参数（size/quality/outputFormat），保留附件入口但首期隐藏“以图编辑”能力 ✅
- [x] I-33: 成功生成后，在聊天流中写入 assistant 摘要消息，并联动 artifact 工作区/右侧栏显示图片产物数量与最近结果 ✅
- [x] I-34: 为图片生成中的 loading / empty / error 三态提供完整反馈 ✅

#### Chat UI 交互建议
- 主推荐：在 composer 顶部加入一个轻量模式切换器：`对话` / `生成图片`。
- 生图模式下：
  - 发送按钮文案改为“生成”
  - 显示图片规格选项
  - 关闭与当前功能无关的噪音控件（例如 `thinkingEnabled` 对图片模式默认隐藏或禁用）
- 保留 `/image` slash 命令作为增强入口，但不把它作为唯一入口。
- 结果展示首期以“assistant 说明 + artifact 预览卡片/工作区入口”实现；第二阶段再升级为一等公民的 transcript image part。

#### Chat 记录语义约束
- Release 1 的 assistant 摘要消息需要**持久化恢复**，否则刷新后聊天上下文会丢失“本轮已经生成过图片”的事实。
- 即使摘要消息缺失，artifact 工作区仍然是最终真值源；UI 不得只依赖聊天内存态保留图片结果。

### Phase 4 — 二阶段能力：图片编辑 / 多模态输入 / Responses 对齐
- [x] I-40: 扩展 `UnifiedMessage` 与 `message-v2`，允许用户消息携带 `input_image`/artifact 引用 ✅
- [x] I-41: 扩展 `render-responses-api.ts`，对用户图片输入渲染为 `input_image` ✅
- [x] I-42: 复用 `look-at-tools.ts` 的多模态拼装范式，支持图像编辑、参考图再生成 ✅
- [x] I-43: 把“上传附件后转文本摘要”的旧行为拆成两条：普通文件仍摘要，图片可进入真实多模态路径 ✅

### Phase 5 — Mobile 后置补齐
- [x] I-50: 扩展 `apps/mobile/src/store/providerPersistence.ts`，新增图片模型档与图片默认值 ✅
- [x] I-51: `apps/mobile/src/screens/SettingsScreen.tsx` 暴露图片提供商/模型配置 ✅
- [x] I-52: `apps/mobile/src/screens/ChatScreen.tsx` 新增图片模式与图片结果预览 ✅
- [x] I-53: Mobile 附件流从“artifact 摘要拼文本”演进到真正的图片输入路径（跟随 Phase 4） ✅

#### Mobile 兼容性约束
- Release 1 不改 Mobile UI，但 settings schema 扩展不能导致当前 `providerPersistence.ts` 在保存 provider 配置时抹掉 image 相关字段。
- Release 1 结束时，移动端允许“未暴露图片功能”，但不允许“因为看不懂新 schema 而破坏已保存配置”。

### Phase 6 — 测试与验收
- [ ] I-60: Settings 回归：provider 保存、image selection 保存、defaults 保存/读取一致
- [ ] I-61: Gateway 路由测试：owner 校验、参数校验、artifact 创建、OpenAI 错误映射
- [ ] I-62: Web 交互测试：模式切换、生成中状态、成功后 artifact 可见、失败后错误提示
- [ ] I-63: 手动验收：Web 与 Desktop 从设置 → Chat 生图 → artifact 工作区全链路闭环

## File Impact Matrix

### 必改（首期）
- `packages/agent-core/src/provider/types.ts`
- `services/agent-gateway/src/provider-config.ts`
- `services/agent-gateway/src/routes/settings.ts`
- `services/agent-gateway/src/routes/artifacts.ts`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/settings/connection-tab-content.tsx`
- `packages/shared-ui/src/ProviderSettings.tsx`
- `apps/web/src/pages/ChatPage.tsx`
- `apps/web/src/components/chat/ChatComposer.tsx`

### 必增（首期）
- `services/agent-gateway/src/image-generation/image-generation-schema.ts`
- `services/agent-gateway/src/image-generation/image-generation-service.ts`
- `services/agent-gateway/src/image-generation/image-generation-openai.ts`
- `services/agent-gateway/src/routes/session-images.ts`（或并入现有 route plugin，但建议独立）
- `apps/web/src/pages/chat-page/use-image-generation.ts`（或同级 hook）
- `apps/web/src/pages/chat-page/image-generation-options.ts`

### 第二阶段（多模态输入）
- `services/agent-gateway/src/message-to-model-messages.ts`
- `services/agent-gateway/src/render-responses-api.ts`
- `services/agent-gateway/src/message-v2-schema.ts`
- `apps/web/src/pages/chat-page/attachment-upload.ts`
- `apps/mobile/src/screens/ChatScreen.tsx`

## Acceptance Criteria
- 设置页可单独保存“图片模型档”，不会影响现有 chat/fast 默认模型。
- Web/桌面 Chat 可显式进入生图模式，并使用设置页中的图片模型默认值。
- 生成请求会创建 `type='image'` 的内容型 artifact，artifact 工作区可预览、列表可见。
- 生图失败时，用户能看到结构化错误提示，而不是静默失败或普通聊天错误。
- 首期不要求移动端同步具备图片生成；文档中必须明确其后置状态。
- 第二阶段开始前，不把“上传图片附件”误宣称为真正的图像编辑能力。
- 旧客户端或 Mobile 再次保存 `/settings/providers` 时，不会抹掉已存在的 image 相关配置。
- `POST /sessions/:sessionId/images/generations` 会返回足以驱动前端联动的 artifact 摘要与参数回显，而不是只回一个空成功状态。
- artifact 在页面刷新后仍可预览，且归属到正确的 session / owner。
- Desktop sidecar 场景完成“设置 → 生图 → artifact 预览”闭环验收。
- 不支持 Images API 的 provider/base URL 会在设置或调用阶段被明确拒绝，而不是运行时含糊失败。

## Risks
- 如果继续复用 `activeSelection.chat`，会把普通聊天模型与图片模型语义混在一起，导致配置和成本认知失真。
- 如果首期直接改 `/stream` 主链，范围会膨胀到 message-v2、run events、前端 transcript 和恢复逻辑，极易超出一次迭代可控范围。
- 如果仍沿用“图片附件摘要成文本”，用户会误以为系统支持图片理解/编辑，实际只是在做文本旁路。
- Mobile 若被误算入首期，将因独立设置和聊天实现显著拉长交付时间。

## Recommended PR Order
1. PR-1：provider/schema/settings 支持 `image` selection + image defaults（不改 Chat）
2. PR-2：gateway 图片生成 route + OpenAI adapter + image artifact 落库
3. PR-3：Web/Desktop Chat 生图模式 UI + artifact 联动
4. PR-4：多模态输入与图片编辑（扩 `UnifiedMessage` / Responses renderer）
5. PR-5：Mobile 设置与 Chat 跟进

## Notes
- 现有 `look-at-tools.ts` 已证明仓库内具备多模态请求体拼装能力，后续 Phase 4 应复用它的 protocol 分发模式，而不是另起一套。
- 现有 `attachment-upload.ts` 与 `apps/mobile/src/screens/ChatScreen.tsx` 都把附件上传结果拼成 `[附件]` 文本摘要；这是首期必须承认的边界，而不是可以忽略的细节。
- Desktop 不需要单独设计设置页与 Chat 页，因为它直接复用 Web 页面；但验收仍需覆盖桌面 sidecar 场景。
- PR-1 当前进度：Phase 1 已实现并完成验证（provider/settings 测试通过、workspace `pnpm typecheck` 通过、`@openAwork/web` build 通过）。
- PR-2 当前进度：Phase 2 已实现并完成验证（新增 session image generation route、OpenAI image service、content artifact 落库与 Artifacts 页面图片预览适配；gateway 相关 49 条测试通过、`provider-manager` 回归通过、workspace `pnpm typecheck` 通过、`@openAwork/web` build 通过）。
- PR-3 当前进度：Phase 3 已实现并完成验证（Chat 生图模式 toggle、参数面板、`/sessions/:sessionId/images/generations` 前端接线、成功后的本地 assistant 摘要消息与内容型 artifact 计数刷新；apps/web 25 条测试通过、workspace `pnpm typecheck` 通过、`@openAwork/web` build 通过）。
- PR-4 当前进度：Phase 4 已实现并完成验证（正常聊天流 `input_image`、message-v2/shared schema 扩展、Responses/Chat Completions/Anthropic 三协议图片输入渲染、参考图编辑走 `images/edits`、Web 聊天用户图片渲染与恢复保留；gateway 相关 49 条 targeted tests 通过、apps/web 27 条测试通过、workspace `pnpm typecheck` 通过、`@openAwork/web` build 通过）。
- PR-5 当前进度：Phase 5 已实现并完成验证（移动端图片模型设置与默认参数持久化、保存时同步到 gateway `/settings/providers`、ChatScreen 图片模式与参考图编辑、普通聊天流 `input_image` 发送、移动端消息恢复与图片渲染；apps/mobile 74 条测试通过、`@openAwork/mobile typecheck` 通过。EAS 远端构建未在本地容器执行）。
- 移动端范围说明：本轮未接入远端 EAS build，也未扩展本地 SQLite `session-store.ts` 的离线多模态持久化结构；当前覆盖的是在线会话主链、恢复渲染与设置同步闭环。
- PR-5 收口修复：已补上真实 Expo Router 入口委托、移除 SQLite 中的 provider `apiKey`、移动端 gateway 安全校验、WS Authorization header 认证，以及非图片附件 `artifactId/preview` 不再进入聊天正文；修复后 `apps/mobile` 测试通过 74/74，移动端复查 5/5 通过。
- Memory sync: completed.
