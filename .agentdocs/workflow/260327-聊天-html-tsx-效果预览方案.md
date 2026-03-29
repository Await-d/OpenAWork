# .agentdocs/workflow/260327-聊天-html-tsx-效果预览方案.md

## 任务概览

目标是为 OpenAWork 的聊天界面制定一份 **HTML / TSX 文件效果预览** 的最优方案。
方案必须优先满足“在聊天中低摩擦看效果”，而不是把 Chat 做成完整在线 IDE；同时要兼顾 Web 与 Desktop 复用同一套页面的现实约束。

## 当前分析

- 当前聊天消息正文走 `MarkdownMessageContent`，代码块只做 Markdown + 高亮展示，没有真实渲染入口。
- 当前 Chat 已有右侧 `FileEditorPanel`（Monaco）作为源码编辑承载位，但没有 Preview Pane。
- 当前 `ArtifactPreview` 仅支持图片 `<img>`、文本/代码 `<pre>` 与“暂无预览”，`packages/artifacts` 只提供 `preview?: string` 级别的轻量预览元数据。
- 仓库内尚未引入 `sandpack`、`react-live`、`esbuild-wasm`、`@babel/standalone` 等浏览器端运行/编译依赖。
- `apps/desktop` 复用 `apps/web` 页面，且 `tauri.conf.json` 当前 `csp: null`，意味着预览能力不能只按 Web 浏览器安全模型思考。
- Metis 校准结论：真正优先级是“聊天中的效果证据”而非 IDE 级环境，且必须把 **受信 / 不受信内容** 作为一等边界。
- 历史方案已把 Chat 的能力承载位收敛为 **输入区 / 消息区 / 右侧运行面板**，新预览能力应复用这些挂载位，而不是在前端另起影子系统。
- 历史 Artifacts 设计与当前实现都只覆盖 **文本 / 图片 / Markdown** 级轻量预览，说明 HTML / TSX 效果预览是新增能力层，不是现成功能开关。
- Web 端 `artifact-platform-adapter` 不能直接打开本地文件路径，只能打开 http(s) 链接或复制分享目标，因此 Web 场景不能把“本地文件打开”作为主预览路径。
- 当前仓库存在 **两套 Artifact 类型模型**：`packages/artifacts/src/types.ts` 的运行时 Artifact（`file_created/file_modified/document/log/summary`）与 `packages/shared-ui/src/ArtifactList.tsx` / `packages/agent-core/src/artifacts/artifact-manager.ts` 的前端展示型 Artifact（`text/code/image/file`）。若新预览能力落到 Artifact 层，必须先统一或建立清晰映射，避免类型语义冲突。
- 当前仓库没有现成 `DOMPurify` / `sanitize-html` / Trusted Types 依赖；现有清洗逻辑仅停留在 `GenerativeUIValidator.ts` 与 `web-tools.ts` 的字符串级 `<script>` 过滤，不能视为足够的 HTML/TSX 预览安全边界。

## 方案设计

### 核心原则

1. **聊天优先，不做 IDE 级首版**：MVP 只解决“在消息或右侧面板中直接看效果”。
2. **信任分级先行**：必须显式区分受信工作区文件、AI 生成临时代码、用户粘贴任意片段三类来源。
3. **强隔离优先于丰富能力**：任何不受信内容都不能进入主 React Tree 直接执行。
4. **双承载位设计**：聊天消息内承载“结果证据”，右侧编辑器侧承载“持续调试/刷新”。
5. **平台最小公共集**：先保证 Web / Desktop 共用实现可运行，再谈平台增强能力。

### 推荐方向（待外部调研结论最终冻结）

- **HTML**：优先走受限 iframe 沙箱预览，作为第一阶段能力。
- **TSX**：不直接进入“任意依赖 + 任意运行”的 IDE 模式；优先在 `Sandpack` 与“自建 iframe + 编译链”之间二选一，先满足聊天侧小型预览。
- **Artifacts**：将“可预览结果”升级为一等 Artifact/Preview 引用，而不是只在消息里做瞬时渲染。
- **运行模型**：消息区展示最近一次预览结果，右侧面板负责刷新、错误、版本绑定与生命周期管理。

### Oracle 复核后的主推荐路线

1. **Phase 1 / MVP：HTML 预览走 `iframe + srcdoc + sandbox`**
   - 首选接入点：`apps/web/src/components/chat/markdown-message-content.tsx`
   - 原因：零新依赖、对现有聊天代码块链路最小侵入、Web/Desktop 共用实现、隔离边界清晰
2. **Phase 2：结构化 HTML Preview 卡片**
   - 接入点：`ChatPageSections.tsx` + `GenerativeUI.tsx` + `GenerativeUIValidator.ts`
   - 目标：让 Agent 可以主动输出 preview 卡片，而不是仅被动消费 fenced code block
3. **Phase 3：TSX 预览走 `Worker + esbuild-wasm + iframe`**
   - 原因：比 Sandpack 更贴近本仓库后续自控需求，不会把聊天页绑到外部 bundler/CDN 形态上
4. **Phase 4：Artifacts / 编辑器侧预览统一收口**
   - 接入点：`FileEditorPanel.tsx`、`ArtifactPreview.tsx`、`packages/artifacts/src/types.ts`

### 候选路线排序（当前冻结）

| 排名 | 方案 | 结论 |
| --- | --- | --- |
| 1 | `iframe/srcdoc`（HTML） | **主 MVP 路线** |
| 2 | `esbuild-wasm + iframe`（TSX） | **主升级路线** |
| 3 | Sandpack | 可作为备选，不作为首选 |
| 4 | WebContainer | 明显过重，后置 |
| ❌ | react-live 同上下文 | 禁止采用 |

### HTML 预览最佳实践结论

- **能力分三级**：
  1. 纯静态：`sandbox=""`，禁止脚本，适合大多数聊天侧 HTML 效果预览
  2. 允许脚本：`sandbox="allow-scripts"`，适合少量动效/脚本场景
  3. 受控通信：`sandbox="allow-scripts"` + `MessageChannel`，适合父页面控制 iframe 的高级场景
- **主推荐**：聊天侧 MVP 优先采用 **纯静态** 版本；只有明确需要脚本行为时，才升级到 `allow-scripts`
- **关键属性**：`srcDoc`、`sandbox`、`referrerPolicy="no-referrer"`、`<base target="_blank">`
- **Tauri 注意项**：若后续收紧 CSP，应在 `tauri.conf.json` 中显式允许 `frame-src 'self'`

### HTML 安全红线（冻结）

- 禁止组合 `allow-scripts` + `allow-same-origin`
- 禁止把不受信 HTML 通过 `innerHTML` 注入主页面
- 若必须父子通信，优先 `MessageChannel`，不要把裸 `postMessage('*')` 当默认方案
- `srcdoc` 中若含内联脚本，必须转义 `<\/script>`，避免模板提前闭合
- 纯静态预览场景优先固定高度或比例容器，不为“自动高度”牺牲隔离边界

### TSX 路线中间结论

- **明确不推荐：`react-live`** —— 与主页面同上下文执行，安全边界不满足聊天场景。
- **明确不推荐：`WebContainer`** —— 形态过重，偏完整在线 IDE，与首版“低摩擦看效果”目标不匹配。
- **候选 1：Sandpack** —— 多文件支持成熟、隔离好、与 Monaco 可集成，适合首版受限 TSX 预览，但依赖外部 bundler/CDN。
- **候选 2：自建 iframe + esbuild-wasm/编译链** —— 可控性更高、可逐步贴合本仓库模型，但实现复杂度与初始化成本更高，更适合作为第二阶段或替代路线。

### 预计落点

- `apps/web/src/components/chat/ChatPageSections.tsx`：新增消息区 Preview Card 挂载逻辑
- `apps/web/src/components/FileEditorPanel.tsx`：扩展右侧编辑器为 Edit / Preview 双视图或分栏视图
- `packages/shared-ui/src/ArtifactPreview.tsx`：从文本/图片预览扩展为带类型分发的 Preview 容器
- `packages/artifacts/src/types.ts`：补 Preview 元数据与能力分级字段
- `apps/web/src/utils/artifact-platform-adapter.ts` 与 `apps/desktop/src/utils/artifact-platform-adapter.ts`：补齐平台差异策略

## Complexity Assessment

- Atomic steps: 5+ → +2
- Parallel streams: 内部链路核查 / 外部方案调研 / 历史方案回收 → +2
- Modules/systems/services: web + shared-ui + artifacts + desktop/WebView + chat/editor → +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: yes → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 该方案横跨 UI 承载位、运行隔离、安全模型、产物体系与跨平台兼容，且用户明确要求高强度并行检索与最优规划，必须以完整工作流冻结边界与阶段顺序。

## Implementation Plan

### Phase 1：冻结边界与验收口径（P0）
- [ ] T-01：明确“聊天效果证据”与“IDE 级预览”的产品边界，并冻结不做项
- [ ] T-02：输出信任分级矩阵（受信 / 半受信 / 不受信）与对应能力白名单
- [ ] T-03：定义 HTML / TSX / 图片 / Markdown / 普通文本的预览能力矩阵

### Phase 2：HTML MVP 方案（P0）
- [x] T-04 ✅：已确定 HTML MVP 走 `markdown-message-content.tsx` 代码块级 `iframe + srcDoc + sandbox`，消息区先承载效果证据，右侧编辑器与 Artifacts 后置
- [x] T-05 ✅：已将首版降级策略冻结为“默认源码视图 + 手动切换静态预览 + 禁用脚本执行”，并在预览面板内显式提示安全边界
- [x] T-05a ✅：已在 `markdown-message-content.tsx` 落地 HTML 预览切换交互，未改 gateway / artifact 类型
- [x] T-05b ✅：HTML MVP 已冻结为 `sandbox=""` 纯静态沙箱，并在 `markdown-message-content.test.tsx` 加入断言

### Phase 3：TSX 受限预览方案（P1）
- [ ] T-06：比较 TSX 编译/运行技术路线，冻结首版只支持的依赖边界与文件边界
- [ ] T-07：定义 TSX 预览的错误映射、刷新机制、版本绑定与资源回收策略
- [ ] T-07a：评估 `Worker + esbuild-wasm` 的懒加载、初始化时延与失败回退策略

### Phase 4：Artifacts 与平台整合（P1）
- [ ] T-08：设计 Preview Artifact / 预览任务结果的持久化与分享方式
- [ ] T-09：定义 Web / Desktop 差异处理与禁止能力清单

### Phase 5：测试与 rollout（P0/P1）
- [ ] T-10：先写安全/隔离/性能验收用例，再进入实现
- [ ] T-11：制定按阶段推进的原子提交策略与回滚边界

### 预期测试落点

- `apps/web/src/components/chat/markdown-message-content.test.tsx`：可直接扩展 HTML/TSX 预览 tab、降级与复制行为测试
- `apps/web/src/components/FileEditorPanel.tsx`：当前无配套测试，若在编辑器层新增 Preview，需要补新的定向测试文件
- `packages/shared-ui/src/ArtifactPreview.tsx`：当前无配套测试，若将 Preview 提升到 Artifact 层，需要新增 shared-ui 级单测
- 若引入 iframe 沙箱或运行时编译链，最终还需要 Web 端 Playwright/E2E 覆盖隔离、失败回退与多实例性能边界

## Notes

- 当前文档先冻结问题空间、边界与分阶段骨架；待内部 explore / 外部 librarian / Oracle 复核完成后再补最终推荐路线。
- 当前已确认三条硬约束：① 不能把不受信代码挂进主 React Tree；② 不能把首版做成完整在线 IDE；③ 不能忽略 Web 与 Desktop 的安全模型差异。
- 当前已确认的内部接入点：`markdown-message-content.tsx`（最小侵入代码块预览）、`ChatPageSections.tsx` + `GenerativeUI.tsx`（结构化 preview 卡片）、`FileEditorPanel.tsx`（编辑器侧持续预览）、`ArtifactPreview.tsx` + `packages/artifacts/src/types.ts`（预览结果持久化）。
- Oracle 当前已明确两条红线：① 禁止同上下文执行不受信 HTML / TSX；② 禁止在 `iframe` 中同时开启 `allow-scripts` 与 `allow-same-origin` 形成隔离失效。
- HTML 最佳实践外部调研已补充：`srcdoc + sandbox` 是聊天侧最匹配路径；默认推荐纯静态沙箱，脚本能力按需升级，不建议先上通信通道与复杂高度同步机制。
- 2026-03-27 实装进度：已完成聊天 Markdown `html` fenced code block 的静态安全预览，含“查看预览 / 返回代码”切换、`sandbox=""`、`referrerPolicy="no-referrer"`、`<base href="about:srcdoc" target="_blank">` 模板，以及定向单测。
- 2026-03-27 扩展进度：已将代码块预览扩展到 `css` 与 `javascript/js`。其中 CSS 继续走纯静态沙箱并使用固定示例骨架承载样式效果；JavaScript 走 `sandbox="allow-scripts"` 的隔离 iframe，仅在沙箱内操作演示 DOM，不获得宿主页同源权限。`typescript/jsx/tsx` 仍保持普通代码块展示，等待后续编译链方案。
- 2026-03-27 文件级入口补充：已在右侧文件编辑器的已打开文件 tabs 中新增“预览”跳转按钮，并为 `FileEditorPanel` 增加代码/预览双模式切换。当前文件级预览支持 `html/css/js` 文件，直接复用共享 preview 文档构造逻辑；`typescript/jsx/tsx` 仍保持仅源码模式。
- 2026-03-27 预览布局修复：已重构 `FilePreviewPane` 的高度策略，改为真正的 flex 拉伸布局；说明头与 iframe 被收口到同一张预览卡片内，iframe 使用 `flex: 1` + `minHeight: 320px`，避免 padding 容器下的 `height: 100%` 造成可视高度挤压或溢出。
- 2026-03-27 聊天预览高度修复：聊天代码块里的 HTML/CSS/JS 预览 iframe 已从固定 280px 提升到 `height: 460px`，并保留 `minHeight: 360px` 与 `maxHeight: 70vh`，解决预览区只占很小一条的问题。
- 2026-03-27 验证说明：`EditorTabBar.test.tsx`、`FileEditorPanel.test.tsx`、`markdown-message-content.test.tsx` 共 12 个测试已通过；本轮相关 TS/测试文件 LSP diagnostics 为 0。最新一次 `pnpm --filter @openAwork/web build` 被工作区内 `apps/web/src/pages/ChatPage.tsx` 的无关 `taskRuntimeLookup` 类型错误阻断，未在本任务内继续处理。
- Memory sync: completed
