# 260921-ChatPage组装层瘦身方案

## Task Overview

把 `apps/web/src/pages/chat-page/ChatPage.tsx`（**7347 行**，超 AGENTS.md 1500 行硬上限 **4.9 倍**）降到硬上限之内，并消灭其「双份 150+ prop surface」。本方案**只覆盖 ChatPage.tsx 及其新增模块**，不改行为。

**先纠正一个前提**：`docs/architecture/chat-page-split-plan.md` 的域抽取阶段（D/A/C/B/E）**已全部完成**（B = `conversation/render/use-chat-streaming.ts`、E = `hooks/use-chat-retry-and-edit.ts`，均已接线）。因此本方案**不是**旧计划的续作——旧计划序列已走完，本方案针对的是**残留的组装层**。

## Current Analysis（2026-09-21 实测，一手核实）

### 体积与残余 hook 数

| 项 | 值 |
| --- | --- |
| `ChatPage.tsx` | **7347 行** |
| `conversation/ChatConversationView.tsx`（直接子视图） | 943 行 |
| `conversation/use-chat-conversation-state.ts` | 920 行 |
| 残余 hook 调用（**实测**） | **34 `useState` / 33 `useEffect` / 34 `useCallback` / 26 `useMemo` / 25 `useRef`** |

> 校准说明：常被引用的「35 / 36 / 36 / 27 / 26」是**裸 token 匹配数**，含 import 行与注释（`import` 行 5 处 + 注释 3 处）。以上为扣除后的真实声明数。

### 已抽出（**禁止重复抽取**）

`hooks/`（19 个 domain hook）、`conversation/`（state hook 920 + `ChatConversationView` 943 + `composer/` + `render/` + `settings/` + `snapshot/` + `views/` + `data/`）、`panels/`、`state/chat-stream-state.ts`(944)、`layout/`、`mode/`、`history/`。测试面：`chat-page/` 内 **77 文件 / 493 例**。

### 残余状态簇（34 个 `useState`）

| 簇 | 内容（行号） |
| --- | --- |
| C1 模型/Provider | `activeProviderId`(439) `activeModelId`(440) `providers`(443) |
| C2 composer | `input`(444) `companionComposerActivity`(445) `manualAgentId`(464) `permissionMode`(465) `webSearchEnabled`(468) `thinkingEnabled`(469) `reasoningEffort`(470) |
| C3 对话模式 | `dialogueMode`(461) |
| C4 右栏/审查 | `rightPanelState`(473) `reviewRefreshRevision`(530) |
| C5 会话运行时 | `childSessions`(591) `selectedChildSessionId`(592) `sessionTodos`(593) `sessionTasks`(598) `workflowRuntime`(610) `sessionStateStatus`(623) `isSessionSnapshotReady`(624) `showSkeletonAfterDelay`(627) |
| C6 图片生成 | `latestGeneratedImageResult`(611) `sessionImageEditReferenceArtifacts`(616) `selectedImageEditReferenceArtifactId`(619) |
| C7 弹窗 | `historyEditPrompt`(629) `retryPrompt`(630) `showTemplatePanel`(638) |
| C8 元数据 | `sessionModesHydrated`(632) `sessionMetadataDirty`(633) `workspaceFileItems`(634) |
| C9 工作区/SSH 选择器 | `workspacePickerCreateMode`(5130) `workspacePickerSource`(5132) `sshPickerConnections`(5133) `sshPickerConnectionsLoading`(5134) |

### 耦合阻塞点（实测）

1. **会话切换巨型 effect `:1817`** —— 体内重置/写入**几乎每个簇**（messages、ratings、rightPanel、todos、childSessions、tasks、workflowRuntime、permissions、questions、sessionStateStatus、recovery、dialogueMode、manualAgentId、permissionMode、webSearch、thinking、reasoning、activeProviderId、activeModelId、modesHydrated、snapshotReady、metadataDirty）。**最大单一耦合块。**
2. **`:809–833` `resetToWelcomeSignal` effect** —— 跨全簇重置约 20 项，带 `// eslint-disable-line react-hooks/exhaustive-deps`。
3. **`:1140`（`[currentSessionId]`）** —— 重置 usage/ratings/图片结果/artifacts/devserver。
4. **`:4026` 附着至活跃流 effect** —— 26 个依赖（`:5086–5112`）；跨 stream/permissions/childSessions/tasks/rightPanel/errors/follow 写入。
5. **`sendMessage`（约 `:2806–3805`）** —— 跨 composer/图片/server command/streaming/permissions/子会话/tasks/右栏读写。
6. **`ensureSession`（约 `:2645–2771`）** —— 写 providers/models/thinking/reasoning/metadata。
7. **双份 prop surface** —— `<ChatConversationView` 出现于 **`:6318`（融合）** 与 **`:6774`（经典）**，prop 赋值行数 **218 / 234**，近乎重复。
8. **跨簇镜像 ref** —— `rightPanelStateRef`(517–529)、stream 镜像 5 个、`devServerDetectedTerminalIdsRef`、`openBrowserPreviewRef`、`sessionMetadataDirtyRef`。
9. **跨簇同步 effect** —— `:532`(stream→review) `:1024` `:1110` `:1120` `:1347` `:1374` `:1463` `:1709` `:2363`(metadata→PATCH) `:5518`(model→thinking)。

### 最关键约束：**没有任何 ChatPage 级回归测试**

- 实测：`ChatPage.test.tsx` **不存在**；页面组件仅被 `apps/desktop/src/App.tsx:22` 与 `apps/web/src/routes/preloadable-route-modules.ts:64` import；`ChatConversationView.tsx` 亦无直接测试。
- 现有安全网：`chat-page/` 493 例（仅覆盖已抽模块）、`components/conversation-runtime/` ~530 例、桌面 Playwright **7 例**（`fusion-layout.spec.ts` 3 / `permission-mode-visual.spec.ts` 4，需构建 Tauri，仅覆盖布局与权限档位）。
- **含义：纯 rewiring 引入的行为回归会整包静默通过。** 故本方案 P0 必须先建立 tripwire。

## Solution Design

### 主策略（Oracle 已定）——**分层组合**

1. **会话作用域编排 hook**：承接跨簇生命周期逻辑（C5 + C8 + `:1817`/`:809`/`:1140`），按**粗粒度**划分，不做细粒度 domain 化。
2. **单一 props-builder**：一个 hook 返回 `ChatConversationViewProps` 公共子集，收敛双份 prop 面。
3. **区域容器组件**：`FusionChatRegion` / `ClassicChatRegion` 消费同一 props 对象，只负责本区域 slot。
4. **页面退化为薄 JSX**（目标 ~600–900 行）。

**理由**：残余 ~5000+ 行在函数体内（`sendMessage` 单函数约 1000 行），纯渲染拆分命中不了 1500；残余簇被同一生命周期整体重置，细粒度 hook 会产出 50+ 参数的巨型签名；React 19 Compiler 禁 `Context.Provider`/`forwardRef`，**props 是唯一通道**，单一对象最合规（编译器自动 memo 对象身份）。

### 明确否决

- ❌ **单个 `useChatPageAssembly()`**：把 7347 行搬成 ~6000 行 god hook，零复杂度下降、无可测边界。
- ❌ **纯渲染区域拆分（两容器各自持状态）**：状态双份或上提，命中不了 1500。
- ❌ **继续加细粒度 domain hook 作主策略**（仅作战术补充）。
- ❌ **`ChatConversationView.tsx` 头注释的 "Step 4d：把 ChatPage 的 ~25 个 useState 搬进本组件"**：会重造 god view，与双区域目标冲突。
- ❌ **不用 `key={sessionId}` 强制重挂来"免费"重置**：会重挂 streaming/scroll 协议层，破坏 stream attach、composer 焦点与 `resolveGroupHeight` 实测高度复用。

## Complexity Assessment

- Atomic steps: 6 阶段 / 20+ 原子任务 → **+2**
- Parallel streams: P1 与 P4 可并行、P0 内部 4 项测试可并行 → **+2**
- Modules/systems/services: `chat-page/{hooks,conversation,layout,state}` + 只读依赖 `components/conversation-runtime`（≥3）→ **+1**
- Long step (>5 min): 是（`sendMessage` 抽取 + 设备/浏览器验证）→ **+1**
- Persisted review artifacts: 是 → **+1**
- OpenCode available (Mode A): 是 → **−1**
- **Total score**: **+6**
- **Chosen mode**: **Full orchestration**
- **Routing rationale**: 跨 4 个子域、可并行流、最高风险阶段需严密验证门；Full orchestration 的 workflow 成本可由分阶段/并行收益覆盖。

## Gate 0 待拍板（未拍板前不进入实施）

- **D-1 是否先补 tripwire（P0）**：本方案强主张**必须**——否则纯 rewiring 回归静默通过。**推荐：是。**
- **D-2 是否接受"先搬家、后解耦"的中间态**（P2 先原样搬出 `:1817` 并保留 `eslint-disable`，P3 再下放 reset 所有权）：**推荐：接受。** 否则必须一次性重写巨型 effect，风险不可控。
- **D-3`sendMessage` 抽取是否单列 Phase**（Oracle：最高风险、放最后）：**推荐：是（P5，且必须最后）。**
- **D-4 是否同步处理 `panels/` 三个大文件**：三者当前**均未违规**（1219 / 1166 / 1099 全 < 1500）→ **推荐：不在本轮**，另行立项。

## Implementation Plan

> **状态：零实现。** Gate 1 未放行前不得开工。每阶段一个 PR、单一提交边界。

### Phase 0：Tripwire（仅测试，必须先于一切改动）
- [ ] T-01 `apps/web/src/pages/chat-page/ChatPage.test.tsx`：jsdom 冒烟渲染 + 稳定 `data-testid` 断言（已有锚点 `classic-chat-workbench`，~`:6754`）+ seeded 会话消息条数 + `layoutMode` classic↔fusion 容器 testid 互换 + 无 unhandled rejection
- [ ] T-02 `conversation/ChatConversationView.test.tsx`：fixture props 渲染，锁住子视图契约
- [ ] T-03 会话切换行为测试：seed 两内容不同会话，切换后断言 messages/rightPanel/todos 反映 B 且**无 A 陈旧数据**（唯一能抓住 `:1817` 被拆坏者）
- [ ] T-04 mock 接线：`vi.mock('@openAwork/web-client')` + `components/conversation-runtime` factory（**见验证策略的 alias 陷阱**）
- [ ] T-05 基线门禁：上述新增测试**在未改动 HEAD 上全绿**，且 `chat-page/` 493 例 + `conversation-runtime` ~530 例全绿

### Phase 1：props-builder + 区域容器（第一刀，零状态迁移）—— ✅ **已完成 2026-09-21**
- [x] T-06 ✅ `conversation/use-chat-conversation-view-props.ts`（144 行）：`ChatConversationViewCommonProps = Omit<ChatConversationViewProps,'topBar'|'compact'>` + `chrome` 分组；单一输入对象，不手写 memo
- [x] T-07 ✅ `layout/FusionChatRegion.tsx`（149 行）：消费 `model`，只负责 fusion 的 `topBar`（density=compact + `ChatTerminalToggle` + `sessionInfo`）与 `compact`
- [x] T-08 ✅ `layout/ClassicChatRegion.tsx`（148 行）：消费同一 `model`，只负责 classic 的 `topBar`（density=normal + 编辑器/浏览器入口 + `QuickTerminalToggle`，**无 `sessionInfo`**）与 `compact={false}`
- [x] T-09 ✅ 两处调用点（`:6318` / `:6774`）改为 `<FusionChatRegion model={conversationViewModel}/>` / `<ClassicChatRegion model={conversationViewModel}/>`；公共 props 在 `ChatPage.tsx` 只组装一次
- [x] T-10 ✅ `conversation/use-chat-conversation-view-props.test.tsx`（5 例）：默认填充 + 同引用透传 + **源码去重不变量**（ChatPage 不再直接渲染 `<ChatConversationView>`；两区域各渲染一次；`compact` 取向相反）。类型经 `Omit` 派生 + `tsc` 门禁强制，无 `as any`
- [x] T-11 ✅ **门禁全绿**：scoped **82 文件 / 537 例**；`apps/web` 全量 **508 文件 / 4890 例**；`tsc --noEmit -p apps/web/tsconfig.json` **EXIT=0**
- **实测行数：7347 → 6854（净 −493）**，低于预计 −700~−900。原因：两分支 `topBar` 确已外移，但公共块（`beforeMessages`/`afterMessages`/`composerRightSlot` 等）只省一份，且页内包装 JSX（`SessionPanelFrame`/workbench div）仍留在 ChatPage。**去重目标已达成（单一来源），行数下降为次要收益。**
- **偏差记录（须保留）**：① `chrome.workflowRuntime` 类型由非空放宽为 `WorkflowRuntimeState | null`（对齐 `WorkflowRuntimeStatusStrip` 契约，否则 `tsc` 失败）；② 清理 8 个因 `topBar` 外移而失效的 import。

### Phase 2：会话切换 effect 搬家（原样，零顺序变化）—— ✅ **已完成 2026-09-21（方案有偏差，见下）**
- [x] T-12 ⛔ **未执行（有意偏差）**：未把 C5+C8 状态搬进 hook。原因：搬迁 state 需重写 ChatPage 内约 28 个状态域的**所有读写点**（blast radius 大），属方案里更危险的 B 路线。改为先搬 effect，收益相近、风险更低。
- [x] T-13 ✅ 巨型 effect（原 `:1807–2265`，**459 行**）逻辑体已搬至 `hooks/run-chat-session-switch-effect.ts`（619 行）。**关键设计偏差**：不是搬进一个 `use*` hook，而是**保留 ChatPage 原位的 `useEffect`**，只把逻辑提为纯函数 `runChatSessionSwitchEffect(deps)` 由该 effect 调用。
  - 为什么：依赖对象若在组件体（`:1807`）急切构造，会触发 `restoreScrollTop` 的 **TDZ**（`used before declaration`）；且若改为在组件末尾构造，会**改变 effect 执行顺序**。改为在 **effect 回调内部**构造依赖对象 → 延迟求值（无 TDZ）且 **effect 顺序零变化**。
- [x] T-14 ⛔ **未执行**：`:809` resetToWelcome 与 `:1140` 按会话 reset 两个小 effect 未搬（收益小，留待后续）。
- [x] T-15 ⛔ **N/A**：状态未搬，镜像 ref 未迁移。
- [x] T-16 ✅ **门禁全绿**：scoped **82 文件 / 537 例**；`apps/web` 全量 **508 文件 / 4890 例**；`tsc --noEmit` **EXIT=0**。专用单测未新增（该函数为薄透传，逻辑已由 P0 `ChatPage.session-switch.test.tsx` 端到端覆盖）。
- **实测行数：6854 → 6484（ChatPage 净 −370）**；新增依赖接口 **69 字段**（由 TypeScript Compiler API 从 ChatPage 真实类型**代码生成**，非手写）。
- **未达成**：ChatPage 仍 **6484 行**（超上限 4.3 倍），目标 <1500 需 P3–P6 继续。

### Phase 2 原始计划（保留沿革）
- ~~T-12 新建 `hooks/use-chat-session-runtime.ts`，原样搬入 C5+C8 状态~~（见上，未执行）
- ~~T-13 原样搬入 `:1817` 巨型 effect~~（已以纯函数形式完成）
- ~~T-14 原样搬入 `:809` / `:1140` reset effect~~（未执行）
- ~~T-15 镜像 ref 同 hook 迁移~~（N/A）

### Phase 3：reset 解耦（默认不重写，只下放所有权）
- [ ] T-17 新建 `state/use-session-reset.ts`（`useSessionReset(scopeKey, resetFn)`）+ session epoch（`sessionId` + 单调递增）
- [ ] T-18 逐簇把 reset 所有权下放到持有该 state 的 hook
- [ ] T-19 保留**极小** `useSessionSwitchCoordinator()`，仅承载跨 hook 的**真实顺序/前置依赖**（如 `sessionMetadataDirty` → `:2363` PATCH、`snapshotReady`）
- [ ] T-20 删空 coordinator 残留；切换测试 + **PATCH 调用次数断言**（防重复触发）

### Phase 4：composer + 弹窗簇（可与 P1 并行）
- [ ] T-21 新建 `hooks/use-chat-composer-state.ts`（C2 + C7）
- [ ] T-22 门禁：P0 + 新 hook 单测

### Phase 5：`sendMessage` / `ensureSession`（最高风险，必须最后）
- [ ] T-23 新建 `hooks/use-chat-send-pipeline.ts`；与 attach effect 经 streaming refs 交织，**不得与 P2 同期**
- [ ] T-24 门禁：P0 + 新单测 + 桌面 E2E

### Phase 6：剩余簇收尾
- [ ] T-25 抽取 C4（团队/子会话）+ C6（图片生成）+ C9（工作区/SSH 选择器）
- [ ] T-26 页面压至 **< 1500**（目标 600–900 行）
- [ ] T-27 更新 `apps/web/AGENTS.md` 查找指引 + 在旧计划 `chat-page-split-plan.md` 交叉引用本方案

## 依赖 DAG

```
P0(tripwire) ─> P1(props-builder/区域) ─> P2(会话 hook 搬家) ─> P3(reset 解耦) ─┬─> P5(send pipeline) ─> P6(收尾)
                                    └─> P4(composer/弹窗) ────────────────────┘
```

- **硬前置**：P1 必须先于 P2（props 对象是后续 hook 的输出面）；P2 必须先于 P3；**P5 必须最后**。
- **可并行**：P4 与 P1「可并行」指**设计可先行**，落地仍建议排在 P2 之后（避免同文件多 PR 冲突）。

## 验证策略

| 层 | 命令 / 内容 | 是否 tripwire |
| --- | --- | --- |
| 单元（新增） | P0 的 T-01…T-03 + 各阶段新 hook 测试 | ✅ 是 |
| 单元（存量） | `pnpm --filter @openAwork/web test`（`chat-page/` 493 例 + `conversation-runtime` ~530 例） | ✅ 回归网 |
| 类型 | `pnpm --filter @openAwork/web typecheck` | ✅ |
| E2E | `pnpm --filter @openAwork/desktop test:e2e`（7 例） | ❌ **非 tripwire**（需构建 Tauri、粒度粗，仅作每阶段放行参考） |

> ⚠️ **vitest alias 陷阱（必须知道）**：`apps/web/vitest.config.ts` 把 `@openAwork/shared-ui` alias 到 `src/test/mocks/shared-ui.tsx`，但 **`@openAwork/web-client` 指向真实源码**（非替身）——不显式 `vi.mock` 会真的发网络请求。`components/conversation-runtime` 亦未 alias，需 `vi.mock` factory。

## 风险与缓解

| # | 风险 | 缓解 |
| --- | --- | --- |
| R1 | **纯 rewiring 回归无自动化守卫**（现状零 ChatPage 测试） | P0 必须先建 tripwire；T-03 会话切换断言是唯一能抓住 `:1817` 拆坏者 |
| R2 | **reset 顺序/epoch 竞态**（最易静默出 bug） | reset 必须幂等且互不依赖；有依赖者留在 coordinator；异步回填用 epoch 守卫丢弃过期响应 |
| R3 | **镜像 ref 陈旧一帧** | state 与 mirror ref 同 hook 同迁并导出；不得改变同步 effect 类别 |
| R4 | **重复触发**（hook 与残留调用点都 reset → `:2363` PATCH 翻倍） | T-20 断言 PATCH 次数 |
| R5 | `exhaustive-deps` disable 扩散 | **禁止**把 `:809` / `:5086–5112` 的 disable 复制到新 hook；建模或集中隔离 |
| R6 | React 19 Compiler 规则 | 新代码不手写 `useMemo/useCallback/React.memo`、不用 `Context.Provider`/`forwardRef`；旧手写 memo 不在搬家 PR 顺手删 |
| R7 | 触碰协议层不变量 | 流式/滚动/attach 只在 `components/conversation-runtime/` 改并通知；不得改 `data-collapsed`/`data-testid` 语义与 `resolveGroupHeight` 复用 |
| R8 | 工作树并发改动（`chat-page/` 下有未提交改动） | 开工前先复核目标文件未被并发修改；**本仓禁止 git 回滚**，回退走 PR 反向操作并需用户授权 |

**升级触发**：若发现 `:1817` 的重置项之间**真实跨 hook 先后依赖 > 2 个**，放弃纯 self-reset，改为显式 `useSessionSwitchCoordinator()` 编排（仍在本策略内升级）。

## 明确不在范围（需另行立项）

- `panels/chat-right-panel.tsx`(1219) / `right-panel-sections.tsx`(1166) / `sub-session-detail-panel.tsx`(1099) —— **当前均未违规**，本轮只读，仅在 prop 名变化时改其签名。
- `components/conversation-runtime/**` 的内部重构（协议层，独立立项）。
- `ChatConversationView` 的 "Step 4d 状态下移"（已明确否决）。
- 任何行为变更 / 新功能 / 视觉调整。

## Notes

- 本方案由 Oracle 架构咨询产出（2026-09-21），基础是一手实测清单（非 grep 猜测）。
- **投资估算：Large（3d+）**，含测试约 2–4 周；P0/P1 各 Short，P2–P4/P6 Medium，P5 Large。
- 全程**禁 `as any` / `@ts-ignore`**；props 类型派生用 `Pick/Omit`。
- 本仓**严禁 git 回滚指令**，每阶段单一提交便于 PR 反向操作（需用户授权）。

## 交付状态（2026-09-21 更新）

- ✅ **Gate 0 四项决策 + Gate 1 已批准**（用户 2026-09-21）。
- ✅ **P0 tripwire 已完成并提交**：`fe0b5cf2 test(web): 新增ChatPage组装层回归护栏与mock接线`（3 文件 / 22 例）。
- ✅ **P1 已完成并提交**：`230a649a refactor(web): ChatPage 组装层 P1 收敛双分支 prop 面`（净 −493 行：7347 → 6854；新增 4 文件）。
- ✅ **P2 已完成（未提交）**：ChatPage 6854 → **6484（净 −370）**；新增 `hooks/run-chat-session-switch-effect.ts`（619 行，含 69 字段依赖接口，由 Compiler API 代码生成）。门禁 scoped 82/537 + 全量 508/4890 + typecheck EXIT=0。
- ⏸️ **P3 未开始**（reset 解耦 / 引入 `useSessionReset` + epoch）。
- **未提交**：P2 的 `ChatPage.tsx` + `run-chat-session-switch-effect.ts` 在工作树。
