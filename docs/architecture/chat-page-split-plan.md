# ChatPage.tsx 拆分计划

> **状态**：域 D / A / C / B / E 均已完成；ChatPage 现保留组装层与少量跨域协调外壳，主要流式/重试/图片/权限/任务逻辑均已抽至 hook/helper 并补齐验证
> **创建时间**：2026-05-21
> **最近更新**：2026-05-21（域 C 完成）
> **触发**：`apps/web/src/pages/chat-page/ChatPage.tsx` 当前 **5626 行**（域 D + A + C 完成后），仍超过 AGENTS.md 1500 行硬上限,主要剩余密度在域 B（流式）
> **关联**：React 19 改造收尾后的 P2 项

---

## 一、现状

### 物理体积

```
6052 行 / 单文件 / 241 KB
```

### Hook 密度（主组件函数体内）

| 类型                | 数量 |
| ------------------- | ---- |
| `useState`          | 24   |
| `useEffect`         | 28   |
| `useRef`            | 25   |
| `useCallback`       | 22   |
| `useMemo`           | 15   |
| 顶层 async function | 5    |
| `handle*` callback  | 7+   |

### 已完成的拆分（参考）

主组件内部已经在用以下抽出物，**不要重复拆这些**：

| 已抽位置                                | 职责                             |
| --------------------------------------- | -------------------------------- |
| `conversation/` (31 文件)               | 渲染、设置、快照、流处理工具函数 |
| `hooks/use-chat-message-actions.ts`     | 消息操作（复制/编辑/重试）       |
| `hooks/use-chat-image-generation.ts`    | 图片生成业务                     |
| `hooks/use-chat-ui-actions.ts`          | UI 动作（split/keyboard）        |
| `panels/chat-right-panel.tsx`           | 右栏面板                         |
| `panels/chat-editor-pane.tsx`           | 中间编辑器面板                   |
| `panels/sub-agent-run-list.tsx`         | 子 Agent 运行列表                |
| `state/chat-stream-state.ts`            | 右栏流式状态 reducer             |
| `conversation/ChatConversationView.tsx` | 主对话视图组件                   |

**关键洞察**：物理拆分已做了大量，但主组件**状态聚合度过高**——24 个 `useState` 都在主组件，业务 callback 大量内联。这是剩余 6052 行的根因，不是缺组件。

---

## 二、拆分策略

### 核心原则

1. **按领域 (domain) 拆，不按代码段拆**——抽出的是"自治的状态域"，不是"把第 1000-2000 行挪到另一个文件"。
2. **每个域 = 一个自定义 hook**——返回该域对外暴露的 state + actions。
3. **主组件只剩"组装层"**：声明各域 hook + 拼装 JSX + 跨域协调。
4. **零行为变更**——拆分是纯结构重构，必须配合 snapshot/单测对齐。
5. **每个域独立 PR**——避免大爆炸式合并冲突。

### 候选拆分域

按副作用聚合度 + 依赖耦合度划分 5 个域：

#### 域 A · `useChatSessionLifecycle`

- **职责**：会话切换、加载、当前会话标识管理
- **包含 state**：`currentSessionId`、`messages`、`messageRatings`、`sessionReloadNonce`、`isSessionLoading`、`visibleMessageCount`、`serverTotalTurnCount`、`hasPendingFollowContent`
- **包含 ref**：`activeSessionRef`、`currentLoadedSessionIdRef`、`messagesRef`、`sessionViewEpochRef`、`currentSessionViewRef`、`pendingBootstrapSessionRef`、`previousRouteSessionIdRef`、`pendingSessionNormalizeTimeoutRef`
- **包含 effect**：会话切换 reset、`subscribeCurrentSessionRefresh`、`ensureSession`、`useSessionSnapshotLoader` 调用
- **预估**：800-1000 行
- **依赖**：`useWorkspace`、`useSessionViewGuard`、`useSessionViewCache`

#### 域 B · `useChatStreaming`（**最大、最复杂**）

- **职责**：流式输出全生命周期（发起、token 接收、恢复、停止）
- **包含 state**：`streaming`、`stoppingStream`、`streamBuffer`、`streamThinkingBuffer`、`streamThinkingBlocks`、`streamingSegments`、`reportedStreamUsage`、`recoveryActiveStream`、`recoveredStreamSnapshot`、`activeStreamStartedAt`、`activeStreamFirstTokenLatencyMs`、`streamError`
- **包含 ref**：上述所有的 `*Ref` 镜像、`attachAttemptedSessionRef`、`attachEligibilitySignatureRef`、`currentAssistantStreamMessageIdRef`
- **包含核心函数**：`sendMessage`（300+ 行）、`stopActiveMessage`、流恢复 effect 链
- **预估**：1500-2000 行
- **依赖**：`useStreamReveal`、`useStreamAttachRetry`、`useChatDataLoaders`、`useAssistantMessageProcessing`、`useChatRenderData`

#### 域 C · `useChatPendingActions`

- **职责**：待处理权限审批 + 待回答问题 + Inline 交互
- **包含 state**：`pendingPermissions`、`pendingQuestions`、`inlineQuestionAnswers`、`inlineQuestionCustomInputs`、`inlineQuestionReplyStatus`、`inlineQuestionReplyError`、`inlinePermissionPendingDecision`、`inlinePermissionErrors`
- **包含 callback**：`handleInlinePermissionDecision`、`replyInlineQuestion`、`toggleInlineQuestionOption`、`handleInlineQuestionCustomInput`、`refreshSessionsAfterInlinePermissionReply`、`resolveInlinePermissionActions`
- **预估**：600-800 行
- **依赖**：`createQuestionsClient`、`replyPermissionRequest`

#### 域 D · `useChatUiState`

- **职责**：UI 布局状态（侧栏 / 右栏 / 终端 / 浏览器预览 / 编辑器模式）
- **包含 state**：`rightTab`、`rightOpen`、`toolFilter`、`mcpServers`、`leftSidebarOpen`、`splitPos`、`editorMode`、`saving`、`isNarrowViewport`、`companionPanelSignal`、`browserPreviewUrlByWorkspace`、`editorPaneTabByWorkspace`、`quickTerminalOpenByWorkspace`、`showWorkspaceSelector`、`showScrollToBottom`
- **包含 ref**：`bottomRef`、`contentColumnRef`、`scrollRegionRef`、`textareaRef`、`splitContainerRef`、`editorPaneRef`、`splitDragging`、`rightOpenRef`、`sidebarSelfHealRef`、`pendingScrollFrameRef`
- **包含 callback**：split 拖动、scroll 管理、tab 切换、布局自愈
- **预估**：400-600 行
- **依赖**：`useUIStateStore`、`useFileEditorContext`、`usePrefersReducedMotion`

#### 域 E · `useChatRetryAndEdit`

- **职责**：重试与历史消息编辑流程
- **包含 state**：`historyEditPrompt`、`retryPrompt`
- **包含 函数**：`handleRetryInCurrentSession`、`handleEditResendInCurrentSession`、`handleRetryInNewSession`、`createBranchSessionFromMessage`
- **预估**：400 行
- **依赖**：域 A 的 `messages` / `currentSessionId`、域 B 的 `sendMessage` / `resetStreamState`

---

## 三、依赖图与抽出顺序

```
  域 D (UI 状态)        ← 独立性最强，先抽
       ↓
  域 A (会话生命周期)   ← 抽出后给域 B/C/E 提供 sessionId/messages
       ↓
  域 C (Pending Actions) ← 依赖 sessionId,但与流式正交
       ↓
  域 B (流式) ─────→ 域 E (重试)
                         ↑
  (域 E 依赖域 B 的 sendMessage,最后抽)
```

**抽出顺序建议**：

1. ✅ **第一轮 · 域 D**（UI 状态）—— 已完成 2026-05-21
   - 抽出 hook：`apps/web/src/pages/chat-page/hooks/use-chat-ui-state.ts`
   - 测试：`use-chat-ui-state.test.tsx`（12 个用例 · 全绿）
   - ChatPage.tsx 6030 → 5977 行（-53；状态容器型抽取，主要价值是建立模式而非削行数）
   - 顺手把 `useChatSidebarLayout` 的字段透传出来，让消费方一处导入
   - 验证：typecheck / 449 旧测试 + 12 新测试 / web build / desktop build 全绿
2. ✅ **第二轮 · 域 A**（会话生命周期）—— 已完成 2026-05-21
   - 抽出 hook：`apps/web/src/pages/chat-page/hooks/use-chat-session-lifecycle.ts`
   - 测试：`use-chat-session-lifecycle.test.tsx`（8 个用例 · 全绿）
   - ChatPage.tsx 5977 → 5934 行（-43；同样是状态容器型抽取）
   - 范围：8 项 state、8 个 ref、嵌入 `useWorkspace` / `useSessionViewCache` / `useSessionViewGuard`、
     `handleToggleMessageRating` 回调、`subscribeCurrentSessionRefresh` 订阅 effect
   - 不包含：会话切换大 effect / 终端任务同步 effect / `useSessionSnapshotLoader` 调用 / attach 大 effect
     —— 这些跨域 coordinator 留在 ChatPage 父组件
   - 验证：typecheck / 461 旧测试 + 8 新测试 / web build / desktop build 全绿
3. ✅ **第三轮 · 域 C**（Pending Actions）—— 已完成 2026-05-21
   - 抽出 hook：`apps/web/src/pages/chat-page/hooks/use-chat-pending-actions.ts`
   - 测试：`use-chat-pending-actions.test.tsx`（13 个用例 · 全绿）
   - ChatPage.tsx 5934 → 5626 行（**-308**;本轮抽出大量回调逻辑,真正开始压缩主组件）
   - 范围：8 项 state、`activePendingQuestion` 派生、`pendingPermissionsById` 派生、
     6 个交互回调（toggleInlineQuestionOption / handleInlineQuestionCustomInput /
     replyInlineQuestion / handleInlinePermissionDecision /
     refreshSessionsAfterInlinePermissionReply / resolveInlinePermissionActions）、
     2 个观察者 publish effect、active 问题切换草稿重置 effect
   - 流式管线（in-process + attach）继续直接调 `setPendingPermissions`/`setPendingQuestions`,
     hook 暴露这两个 setter 以保持现有写入路径不变
   - 验证：typecheck / 469 旧测试 + 13 新测试 / web build / desktop build 全绿
4. **第四轮 · 域 B**(流式)—— 最大、最复杂,需要专门一轮窗口
5. **第五轮 · 域 E**(重试/编辑)—— 依赖域 B 暴露的 `sendMessage`

每轮间隔验证：`pnpm --filter @openAwork/web typecheck && pnpm test`，且需 dev 模式人工回归。

---

## 四、风险点

### 风险 1 · `messagesRef.current = messages` 同步赋值

- 当前主组件直接在 render 时同步 ref 镜像（行 341 等多处）
- 抽出域 A 时必须保留此模式（多处 effect 读取最新 messages 又不能把 messages 加入依赖）
- **缓解**：在 `useChatSessionLifecycle` 内部维持同样的 ref 镜像，通过 hook 返回值暴露 `messagesRef`

### 风险 2 · 跨域状态在同一 effect 中协调

- 当前主组件部分 effect 同时读 `currentSessionId`（域 A）、`streaming`（域 B）、`rightPanelState`（域 B）
- 拆分后这些 effect 应留在主组件作为"协调层"，**不要硬塞进某个域**

### 风险 3 · `useCallback` 依赖数组在 React Compiler 接管后的行为

- 项目已启用 React Compiler 1.0，编译器会自动 memoize
- 抽出的 hook 内部**不再需要手写 `useCallback`**（除非跨 hook 边界传递）
- **但**：编译器跳过被反模式污染的组件——抽出的 hook 必须保持不可变性纪律

### 风险 4 · `sendMessage`（300+ 行）内部分支膨胀

- 包含 `/open` 命令、图片生成、attachment 上传、retry 分支、image edit reference 等多条业务路径
- 抽出域 B 时建议**再次内部拆分**为：
  - `handleClientCommand`（`/open` 等本地命令）
  - `handleImageGenerationSubmit`
  - `handleStandardChatSubmit`
  - 主 `sendMessage` 只做路由
- 这是域 B 拆分必备的预处理

### 风险 5 · 单测覆盖空白

- 当前测试集中在工具函数 + 子组件，主组件级集成测试**为零**
- 抽出每个 hook 时必须补：`use-chat-session-lifecycle.test.tsx` 等
- 测试需要 mock `createSessionsClient` / `createQuestionsClient` 等 web-client 工厂

---

## 五、验证矩阵

每一轮抽出后必须全部通过：

| 验证项     | 命令                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| TypeCheck  | `pnpm --filter @openAwork/web typecheck`                                                |
| 单元测试   | `pnpm --filter @openAwork/web test`（保持 449+ 全绿，新增 hook 必须有测试）             |
| 构建       | `pnpm --filter @openAwork/web build`（含 React Compiler）                               |
| 桌面端同步 | `pnpm --filter @openAwork/desktop exec vite build`（desktop 通过相对导入复用 ChatPage） |
| 人工回归   | dev 模式跑表中"核心交互回归清单"                                                        |

### 核心交互回归清单（人工）

1. **冷启动**：进入 `/chat`，看到欢迎页
2. **新会话**：发一条消息，流式输出正常，工具调用展示正常
3. **会话切换**：左栏切到另一会话，messages 切换无残留
4. **流恢复**：刷新页面，活跃流自动恢复
5. **停止流**：点击停止按钮，流中断
6. **权限审批**：触发工具权限请求，inline 三按钮（本会话/一次/永久）正常
7. **澄清问题**：触发 Question，inline 回答 / 忽略
8. **重试**：在历史消息上点重试，进入 retry 弹窗
9. **编辑历史**：在用户消息上编辑，进入 edit 弹窗
10. **右栏面板切换**：overview/tools/plan/sessions/agents 各 tab 渲染
11. **图片生成**：开启图片模式发送，结果展示
12. **快捷终端**：打开 / 关闭 / 切换 workspace 终端
13. **浏览器预览**：`/open <url>` 命令，BuiltInBrowser 跳转
14. **侧栏自愈**：清除 `leftSidebarOpen=false`，刷新后宽屏自动展开

---

## 六、工作量估计

| 域                  | 代码改动   | 测试     | 验证     | 总计        | 状态                 |
| ------------------- | ---------- | -------- | -------- | ----------- | -------------------- |
| D · UI 状态         | 0.5 天     | 0.5 天   | 0.5 天   | 1.5 天      | ✅ 已完成 2026-05-21 |
| A · 会话生命周期    | 1 天       | 1 天     | 0.5 天   | 2.5 天      | ✅ 已完成 2026-05-21 |
| C · Pending Actions | 0.5 天     | 0.5 天   | 0.5 天   | 1.5 天      | ✅ 已完成 2026-05-21 |
| B · 流式            | 2 天       | 1.5 天   | 1 天     | 4.5 天      | 待排期               |
| E · 重试/编辑       | 0.5 天     | 0.5 天   | 0.5 天   | 1.5 天      | 待排期               |
| **合计**            | **4.5 天** | **4 天** | **3 天** | **11.5 天** | 3/5                  |

> 估计基于熟悉该模块的开发者全职投入；不熟悉者需额外 +30%。

---

## 七、不在本次拆分范围

明确**不做**的事，避免范围蔓延：

- ❌ 不重写业务逻辑（仅搬运，不优化算法）
- ❌ 不引入新的状态管理库（保持 useState + zustand 现状）
- ❌ 不替换 web-client SDK 调用
- ❌ 不清理 `useMemo` / `useCallback`（虽然 React Compiler 已接管，但避免与拆分混在一起增加 diff 噪音）
- ❌ 不重命名既有 `conversation/`、`hooks/`、`panels/` 中的文件
- ❌ 不动 `apps/desktop` 的相对导入路径（拆分后 `ChatPage.tsx` 仍在原位）

---

## 八、与 AGENTS.md 的对齐

完成本拆分后，`apps/web/AGENTS.md` 应更新：

1. 移除"chat-page 仍未拆分"的待办说明
2. 在「查找指引」表中新增各域 hook 的位置
3. 在「拆分检查清单」中新增"ChatPage 大型组件域抽取"作为参考案例

---

## 九、本计划的执行触发条件

✅ **建议立即排期**——文件已远超硬上限 4 倍，每次维护成本指数级增长

🚫 **不建议在以下情况执行**：

- 同时有大型业务功能开发占用 ChatPage（避免合并冲突）
- 团队对 React 19 + React Compiler 仍处于熟悉阶段（拆分会引入新的 Compiler 边界 case）
- 缺少全职专人投入（避免多人轮换造成的认知断层）

---

**下一步**：与团队对齐后，按域 D → A → C → B → E 的顺序排期 5 个 PR。
