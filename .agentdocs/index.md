# OpenAWork Agent Docs 索引

## 已完成的任务

### ✅ 260921-权限暂停全批收集改造 - 批量工具权限暂停不再丢失兄弟调用
**状态**: 已完成（2026-09-21）——T-01…T-18 全部交付并验证；复杂度 **Full orchestration**（score +6）
**归档位置**: [workflow/done/260921-权限暂停全批收集改造.md](workflow/done/260921-权限暂停全批收集改造.md)

**成果总结**:
- ✅ 批量工具权限暂停语义改为「**只读兄弟放行 + 整批收集 + 批末统一 pause**」：`isPermissionSafeSiblingTool` 白名单内的只读工具在待批期间继续执行；其余兄弟被扣住并入 pending payload 的 `blockedToolCalls`；批准后按 `tool_use` 顺序整批恢复，仅当无残留 pending 才续轮。
- ✅ 修掉三个硬阻塞：① 移除 `continueFromApprovedToolResult` 的 `truncateSessionMessagesAfter`（原先会删除暂停轮写入的兄弟结果，幂等改由确定性 `clientRequestId`+`replaceExisting` 承担）；② pending payload 由单 `toolCallId` 升级为 `blockedToolCalls[]`（向后兼容旧 payload）；③ 多 pending 用残余闸门收口（级联 reject 裁决为无需收窄）。
- ✅ 前端：`utils/permission/pending-permission-state.ts` 收口「等待审批」marker；批次卡聚合计数排除 pending 并显示「N 待审批…」；`copied-tool-card.ts` 同源引用。
- ✅ 验证：新增 `verify-batch-permission-collect.ts`（真实 `executeToolCalls` + 真实 resume：门控兄弟未执行 → 批准后整批按序恢复且只跑一轮上游）；新增单测 8 例；既有 4 文件 27 例 + 权限目录 35 例 + R7 清单 12 例全绿；改动文件 ESLint 0 error。
- ℹ️ 裁决记录：`.NET` 网关官方声明不维护、无需同步；opencode 的阻塞 await 模型因 run/请求承载不同而未照抄。
- 🔧 修复轮次（潜在问题 1–4，2026-09-21）：① 按 opencode 式加「**已续写则不再重跑模型轮**」守卫（`hasTurnContinuationAfterPause`），晚到审批只就地追加结果；**拒绝**「定向 truncate」方案（仍保留按轮次重放且会删数据）。② 门控先于 doom-loop guard 为**有意设计**，补注释不改行为。③ 新增 `verify-batch-permission-multi-pending.ts` 覆盖**多 pending 顺序审批**（两次暂停、0/0/1 次上游）。④ 导出 `resolveBlockedCalls` 并补真实工具名/legacy 回退两条单测。验证：`test:batch-permission` 2 脚本 ok、单测 10/10、R7 27/27、ESLint 0 error。
- 🧭 深对齐（轮次重放降级为历史驱动，2026-09-21）：新增 `deriveResumeRound()` 从持久化投影推导下一轮（`${clientRequestId}:assistant:<n>` → `max+1`），`payload.nextRound` 降级为**兜底**（正常路径值相同、行为不变；异常路径不再复用已存在轮次 id）。修正认知：`payload.nextRound` 实为暂停时的 `round + 1`（`stream.ts:3115`），并非重放点。验证：单测 12/12、2 验收脚本 ok、R7 六套件 39/39、ESLint 0 error。

### ✅ 260916-层级可视化重构 - 层级流动（泳道轨迹）+ 历史层级（追踪瀑布）
**状态**: 已完成（T-01…T-08 全部交付并验证）
**完成日期**: 2026-09-16
**归档位置**: [workflow/done/260916-层级可视化重构.md](workflow/done/260916-层级可视化重构.md)

**成果总结**:
- ✅ 「层级流动」改为泳道轨迹画布：5 层泳道全量保留（修复旧流水线在活跃密度下的断裂箭头）、handoff 按 updatedAt 切等宽时间槽、SVG 连线从源层指向目标层（打回 / 重试可见回折）、活跃连线流动动画、打开自动滚到最新；删除被替代的静态流水线与交接记录列表共 9 个文件。
- ✅ 「历史层级」改为追踪瀑布：每层一条轨道 + 每个层级会话一条时间条（区间由 handoff 的 startedAt/endedAt/updatedAt 聚合，范围退化切等宽轴）、跨轨连线、substate 阶段标记、时间跨度胶囊；详情复用原跨层线程上下文工作区，移除 ASCII 假树缩进与双栏 / 线程切换。
- ✅ 复用与约束：零后端与 store 改动；`CrossLayerConversationView` 保留给层级流动的线程详情；样式集中 `team-runtime-layer-viz.css`（E · Nebula token，无硬编码色值）。
- ✅ 验证：模型单测 9 + 8、视图 3 + 7；对话 tab + 中间路由 11 文件 / 48 测试；team 全量 129 文件 / 877 测试；`tsc --noEmit` 0 错误；`vite build` 通过（3m17s）。

### ✅ 260916-会话权限阶梯 - 会话级三档权限阶梯（ask / auto-edit / yolo）
**状态**: 已完成（T-01…T-16 全部交付并验证）
**完成日期**: 2026-09-16
**归档位置**: [workflow/done/260916-会话权限阶梯.md](workflow/done/260916-会话权限阶梯.md)

**成果总结**:
- ✅ 以 `permissionMode` 规范键（`ask` / `auto-edit` / `yolo`）替换布尔 `yoloMode`，后者降级为派生投影；deny-first 不变量保证中间 / 最高档只能跳过 `ask`、绝不放行被显式 `deny` 的调用。
- ✅ 覆盖 shared / agent-core / 网关（持久化 + 执行 + 子会话继承）/ Web 控件 / 桌面 e2e 五层；并修复 legacy 单向棘轮、快照短路、浮层锚点、dev-harness token 缺失与 e2e 冷启动等陷阱。
- ✅ 验证：网关 48 / agent-core 13 / Web 控件 18 / Web 组合 284 / 真浏览器 e2e 4 全通过（含 5 次连续冷启动）。开放项：`fusion-layout.spec.ts` 并发失败、`.NET` 子树不编译、`pnpm typecheck` 因外部改动为红——均与本特性无关。

> **归档审计补充登记（2026-09-16）**：以下 6 条为此前已完成但未归档的方案的补登记，归档文档均已移入 `workflow/done/`。

### ✅ 260916-agentdocs归档审计与runtime清理 - 知识库归档一致性与 runtime 残留治理
**状态**: 已完成（任务本身即知识库维护，直接落位于 done/）
**完成日期**: 2026-09-16
**归档位置**: [workflow/done/260916-agentdocs归档审计与runtime清理.md](workflow/done/260916-agentdocs归档审计与runtime清理.md)

**成果总结**:
- ✅ 补归档 8 个已完成方案（`workflow/` 根 14 → 5）；`done/` 累计 84。
- ✅ 修复 index 3 类一致性问题：补登记、删幽灵条目 `260814-migrate-opencode-llm-library`、修 10 个悬空 runtime 链接（复验 **0 悬空**）。
- ✅ 清理 53 个 runtime 残留目录（62 → 9），并明确 4 条保留规则与 5 个转人工确认目录。

### ✅ 260905-tool-context - 工具结果上下文治理
**状态**: 已完成（归档审计补登记）
**完成日期**: 2026-09-05
**归档位置**: [workflow/done/260905-tool-context.md](workflow/done/260905-tool-context.md)

**成果总结**:
- ✅ 只读分析指定本地会话；模型投影统一短预览 + 可读取引用；累计结果预算覆盖全部工具；保留错误、配对与近期图像。
- ✅ 真实会话离线重放验证通过；未改动用户会话与既有工作区改动。

### ✅ 260905-tool-context-optimization - 工具上下文深度优化
**状态**: 已完成（归档审计补登记）
**完成日期**: 2026-09-05
**归档位置**: [workflow/done/260905-tool-context-optimization.md](workflow/done/260905-tool-context-optimization.md)

**成果总结**:
- ✅ 8 项交付全部完成：动态预算与指标、索引化回读、统一上游终门禁、附件结构化关联、集中策略、分页单次扫描优化、模块拆分、结构化工具输出协议；旧会话兼容保持。

### ✅ 260906-chat-order-followup - Chat 消息顺序问题第二轮定位
**状态**: 已完成（归档审计补登记）
**完成日期**: 2026-09-06
**归档位置**: [workflow/done/260906-chat-order-followup.md](workflow/done/260906-chat-order-followup.md)

**成果总结**:
- ✅ 以 `clientRequestId + durable seq` 作为唯一重放身份，修复实时事件归并/消息分组阶段的顺序错乱；终态结论已并入 `260906-chat-tool-ordering`（已归档）。

### ✅ 260814-session-recovery-enhancement - 会话恢复功能增强
**状态**: 已完成（归档审计补登记）
**完成日期**: 2026-08-14
**归档位置**: [workflow/done/260814-session-recovery-enhancement.md](workflow/done/260814-session-recovery-enhancement.md)

**成果总结**:
- ✅ 中断恢复 / 粘贴内容管理 / 技能状态持久化三模块落地，6 个目标文件均在 `services/agent-gateway/src/session/`；曾产出 `COMPLETE_VERIFICATION_REPORT.md` 与 `FINAL_VERIFICATION_REPORT.md`。
- ⚠️ 文档正文任务框从未同步勾选（保留历史原貌，已在归档文档顶部补记说明）。

### ✅ 260817-提交前收口 - 一次性提交收口
**状态**: 已完成并过期（归档审计补登记）
**完成日期**: 2026-08-17
**归档位置**: [workflow/done/260817-提交前收口.md](workflow/done/260817-提交前收口.md)

**成果总结**:
- ✅ 对应提交 `611a105e chore(repo): 收口本地未提交改动`；方案描述的 127 文件工作树状态已不复存在，**不再具备可执行性**，仅作历史记录。

### ✅ 260914-grill-clarification-enhancement - Grill 分层澄清增强方案（A+B+C 三层全部落地）
**状态**: 已完成（T-00…T-15 / V-01…V-16 全部落地；复审发现 6 个缺陷已修复）
**完成日期**: 2026-09-14（设计与评审）｜2026-09-16（B/C 层实现 + 全量验证）
**归档位置**: [workflow/done/260914-grill-clarification-enhancement.md](workflow/done/260914-grill-clarification-enhancement.md)

**成果总结**:
- ✅ **B 层（agent-core frontier 引擎）**：`context/clarification-tree.ts`（`computeFrontier` / `applyAnswer` / `isFrontierEmpty` / `needsConfirmation` / `confirmGrill`，纯函数 + 不可变）+ `clarification-recommendation.ts`；`routing.ts` 保留 legacy API 并加 `@deprecated` 指向新引擎，`CLARIFICATION_TEMPLATES` 中文化（首项即推荐为跨消费方契约）。
- ✅ **A 层（前台 question 管道）**：`question-tools` 增 `recommended` / `nodeId` / `round`；`clarify` 提示词改为 frontier 纪律（一轮问整个 frontier、每题带推荐、frontier 空才收口、结束需用户显式确认）；轮次态持久化到 `sessions.metadata_json.clarificationState`；面板推荐徽标 + 轮次分组。
- ✅ **C 层（team 层多轮）**：reception 增 `grilling` / `awaiting_confirmation` 白名单 + `reception-grill-runner`；**pm1** 新增 `pm1-grill-runner`，由 `artifact-chain` 驱动 frontier 多轮 + 确认门控（frontier 空 → `awaiting_confirmation`，未确认**禁止**进入 `drafting_plan`）。
- ✅ **SSOT 铁律落实**：frontier 算法只在 agent-core 实现一次；`shouldGrillIntent` 下沉 `handoff/capability/grill-intent.ts` 供 b/c 两层共用（避免 c 层直连 b 层 runner 触发跨层 ESLint 禁令）；触发条件 = spec 标记 `[NEEDS CLARIFICATION]` 或原始/改写意图命中高影响（对齐 §8 R5「仅高影响触发」）。
- ✅ **复审修复 6 个缺陷**（其中 2 个会真实破坏 G6 确认门控）：① 确认轮超时静默放行 → 改抛 `PlanningFailure`（未确认视为未完成）；② 确认题稳定 id 被前端按 id 去重致驳回后无法再确认 → 传输 id 轮次化 `__grill_confirm__@r<n>`；③ `awaiting_confirmation` 未计入等待态集合（人工等待污染 `progress_interval` 延迟指标）；④ 触发漏查 `sourceIntent`；⑤ 持久化是死写（G5 未真正落地）→ 改为运行开始恢复已答节点、同意图已确认则跳过、质量退回不重复 grill 但沿用原答案；⑥ 题面英文 + 确认题只能手打 → 模板中文化 + 面板选项按钮（推荐徽标）。
- ✅ **验证**：agent-core **33 文件 / 397** · 网关全量 **456 文件 / 3248**（2 skipped，0 失败）· `test:grill` + `test:grill-reception` + `test:grill-pm1` 三条端到端 ok · 团队面板/store **36** · web-client team **62** · 网关 typecheck 与 ESLint exit 0。
- ⚠️ **未做**：V-06 的「活体 LLM + 浏览器」人工视觉走查——本机 `.env` 的 `AI_API_KEY` 为空，模型无法真实发起 `AskUserQuestion`，故不可执行（**可自动化的契约部分已补齐断言**：pending 列表 ≥2 题、每题 ≥1 `recommended`、每题带 `nodeId`）；`ClarificationDimension` 维度扩展（tradeoff/risk/scope）按原决议单独立项。

### ✅ 260916-终端面板-vscode布局对齐 - 终端面板升级为 VS Code 集成终端布局（面板页签 + 右侧操作区 + 分屏 + 端口页）
**状态**: 已完成（T-01…T-15 全部交付并验证；用户 4 项诉求全部满足）
**完成日期**: 2026-09-16
**归档位置**: [workflow/done/260916-终端面板-vscode布局对齐.md](workflow/done/260916-终端面板-vscode布局对齐.md)
**最终报告**: [runtime/260916-终端面板-vscode布局对齐/final_output.md](runtime/260916-终端面板-vscode布局对齐/final_output.md)

**成果总结**:
- ✅ **VS Code 式分层**：第 1 行面板级页签（`终端`/`端口`）+ 收起；**tab 条下沉到每个 pane（组）**；每 pane 右侧操作区 `＋` / `⊟拆分` / `⋯更多`（重命名、清屏、关闭其他/全部、向右/向下拆分、合并到分屏）；激活态改 accent + 下划线（移除违反 token 的绿色）；五态 + ARIA（tablist/tab/roving tabindex/方向键）。
- ✅ **分屏（对齐 VS Code）**：**二元 split 树**，叶子是「组」`{terminalIds[], activeTerminalId}`（不是单终端——否则要发明 tab↔pane 映射）；嵌套任意方向拆分、分隔条拖拽、tab 拖拽重排/合并/拖出、**源组折叠**；每 pane 一条 SSE、**不因失焦 unmount**；pane 上限 4；`<768px` 仅允许上下。
- ✅ **端口页（方案 C）**：`TerminalPortsPanel` 列「端口 / 进程 / 绑定地址（标注仅本机·全网可达）」+ 行内「在浏览器打开」（同机 → `http://localhost:<port>` + `rel="noopener"`；远端 → 禁用并说明需反向代理）；四态齐全；数据走 web-client（不直接 `fetch`）；网关侧 `GET /sessions/ports/listening` 跨平台枚举（三策略隔离 + 超时降级 + 缓存单飞 + 过滤自身/Redis 端口；**故意落在 nginx 白名单 `/sessions/` 内，不需改 nginx**）。
- ✅ **验证**：web 全量 **411 files / 3538 passed** · 网关全量 **3219 passed / 2 skipped** · 双侧 typecheck exit 0 · web-client 18/135 · **三轮真机验收累计 133 条断言**（分屏几何 47 / 拖拽 42 / Fix1·Fix2·T-15 + 回归 44）。
- ✅ **发现并修复 5 个缺陷**，其中 **3 个只有真机几何/交互断言能发现**：① 隐式 pane 终端内容溢出抽屉（底部 243px 永久不可达；`.terminal-pane` 在 block 容器下 `height:auto` 被 xterm fit **自持放大**）② **点 tab 不切换、双击不重命名**（`setPointerCapture` 把 click/dblclick 重定向到捕获元素，jsdom 不实现该重定向）③ FitAddon 用**含 padding 的** `clientHeight` 取整 → 最后一行被切 ④ 分隔条拖拽后源组不折叠（与 VS Code 不一致）⑤ 桌面无 `column` 拆分入口。
- ⚠️ **未做/后续可选**：`Ctrl+Shift+5` 快捷键 · 端口页自动刷新 · `nginx.conf:15` 的 `Connection: upgrade` 破坏非 WS keepalive · per-terminal SSE 多路复用（仅在 pane 上限不够时）。
- ❌ **暂缓**：真端口转发（T-16~T-19）。**真转发在 Web 面不可实现 VS Code 同款**（浏览器无法打开本地 TCP；唯一真形式是 Tauri 壳内隧道 = 纯桌面且同机无收益）；路径前缀代理与主应用**同源** → 被代理应用 XSS 可读 `localStorage` 主会话令牌。安全评审 **4 blocker / 9 should-fix，不通过**；若重启须先选「独立 origin」或 `CSP sandbox`。

### ✅ 260915-终端-vscode-能力对齐 - 终端工具对齐 VS Code 集成终端体验
**状态**: 已完成（13/13 任务 T-00a…T-13 执行完毕；验收发现 3 个缺陷全部修复）
**完成日期**: 2026-09-15
**归档位置**: [workflow/done/260915-终端-vscode-能力对齐.md](workflow/done/260915-终端-vscode-能力对齐.md)
**最终报告**: [runtime/260915-终端-vscode-能力对齐/final_output.md](runtime/260915-终端-vscode-能力对齐/final_output.md)
**冻结契约**: [runtime/260915-终端-vscode-能力对齐/contract.md](runtime/260915-终端-vscode-能力对齐/contract.md)

**成果总结**:
- ✅ **Phase 1 前端交互**：13 个新模块——xterm 插件装配（search / web-links / unicode11 + webgl 失败回退 DOM renderer、主题响应式跟随）、剪贴板与快捷键矩阵（Ctrl/⌘+Shift+C/V、Ctrl+F/K/L；Ctrl+C/D/Z 正确放行）、16ms 输入合并队列（单飞保序 + 失败回排队首）、seq 去重流回放、搜索条/右键菜单/粘贴确认/滚底按钮/浮层 CSS。
- ✅ **Phase 2 真 PTY 后端**：`pty-backend.ts` 采用 **Bun 原生 `Terminal` API**（零原生依赖，不引 node-pty / bun-pty，能力探测降级管道）；`persistent-terminals.ts` PTY 化（`StringDecoder` 跨 chunk carry、`resize` 真正下发 SIGWINCH）；输出通道从「8KB 累积快照 + 字节 diff」升级为**增量字节流 + `seq` + 512 KiB ring buffer**。
- ✅ **Phase 3 传输与恢复**：stdin 通道决策维持 HTTP 批合并（`/stdin` 无路由级限流是决定性依据，WS 双向列为独立决策项）；scrollback 重连回放 7 断言全绿；真实浏览器端到端验收。
- ✅ **验证**：后端全量 449 files/3146 通过 · 前端全量 388 files/3152 通过 · shared 32 / web-client 602 · 三处 typecheck + 生产构建 exit 0 · 真实 PTY 矩阵 10 PASS/0 FAIL/3 SKIP（isatty / SIGWINCH / Ctrl+C SIGINT / 作业控制 / less / top / Python REPL / 中文跨 chunk / seq 节流）· sidecar 编译产物 20/20 PASS（内含 `TTY` + resize 100×30）· 浏览器 12 PASS/1 FAIL→已修 · 本任务文件 ESLint exit 0。
- ✅ **修复 3 个缺陷**：① SSE 快照竞态（先发快照后订阅 → 增量语义下事件永久丢失；改为先订阅→缓冲→发快照→按序 flush，红→绿）② 右键菜单 5ms 自我关闭（xterm 自身触发 scroll 被误判为用户滚动）③ **D-1【高】建第 2 个终端抽屉自动收起**（hook 层身份 effect 误含 `reloadNonce`，拆分后红→绿）。
- ⚠️ **唯一未处理项 — 待产品决策**：D-3（375px 下终端入口被移动端底部 tab bar 遮挡：在流 rail `height:36px` 被 `position:fixed` 且 `z-index` 更高的 `.fusion-mobile-bottom__tab`（strip 48px）覆盖；修法需在融合移动壳层为在流内容让出 48px，或把入口并入 tab bar）。**收口阶段已修复**：D-1、D-2、D-4（含补齐 `computeTerminalChipPosition` 纯函数测试覆盖，原为零覆盖）、`--text-1` 悬空 token（终端域 3 处 → `var(--fg-default)`，并纠正了原先 `--fg-strong` 的错误建议）、T-07 SSE 快照竞态；证据 `runtime/.../results/`。
- ⚠️ **已知边界**：Node/Windows 仍降级为 pipe（`resize` 为 no-op、交互式 TUI 不提升，契约明确）；真实 Tauri 打包启动未覆盖（sidecar 载荷已证）；D-1 复验到 hook 层回归 + 全量单测，未重跑浏览器验收。另建议给 `TerminalPanel` 的「运行中归零即收起」加防抖——该规则对任何上游虚假 0 均无防御。

### ✅ 260915-文件提及索引架构 - `@` 提及可达任意深度 + 网关索引缓存 + 前端按输入检索
**状态**: 已完成并提交（`b88bb115` … `7f322881`）
**完成日期**: 2026-09-15
**归档位置**: [workflow/done/260915-文件提及索引架构.md](workflow/done/260915-文件提及索引架构.md)

**成果总结**:
- ✅ `@` 提及可达任意深度：网关侧 BFS 递归扁平索引（无层数限制）+ 进程内缓存（TTL 15s / 上限 16 根 / 写路径显式失效），检索与排序移到服务端（目录逐级 / 相关性排序），删除零生产消费者的全量清单端点。
- ✅ 忽略规则改为**按工作区根隔离**的 manager 实例，并修正 `ensureIgnoreRulesLoadedForPath` 为「根变了就重载」，消除多工作区根互相污染（实测泄漏 1007 → 0）。
- ✅ 前端改为防抖 + 中止 + 迟到响应守卫的按输入检索，只映射服务端命中的小结果集，并补齐 loading / empty / error 三态。
- ✅ 验证：网关 15 文件 / 133 测试、web-client 292 测试、web composer 全域 688 测试全绿；三处 typecheck 干净；真实仓库冷/热 1023ms → 0.01ms，单次查询 68B–1.3KB（全量 301KB）；真实浏览器 `@apps/`、`@ChatPage` 弹窗与插入行为正确。
- ⚠️ 已知边界：团队页输入框的 `@` 仍为空（团队 composer 未注入检索函数，非本次回归；注入点已具备）。

### ✅ 260906-opencode-context-pruning-parity - OpenCode 上下文剪枝语义对齐
**状态**: 已完成
**完成日期**: 2026-09-06
**归档位置**: [workflow/done/260906-opencode-context-pruning-parity.md](workflow/done/260906-opencode-context-pruning-parity.md)
**最终报告**: 原 `runtime/260906-opencode-context-pruning-parity/final_output.md`（runtime 属临时目录，2026-09-16 已按 cleanup-policy 清理）

**成果总结**:
- ✅ 移除正常请求固定 48K 字符工具预算和统一 8,192 字符结果截断。
- ✅ 按最近 40K 工具 token 保护区、旧结果 20K 回收门槛持久化剪枝。
- ✅ 完整压缩按最终 `system + messages + tools` 估算，128K 默认阈值对齐为 108K。
- ✅ 27 个测试文件 196 个测试、Gateway typecheck/build、格式和 diff 检查全部通过。

### ✅ 260906-chat-tool-ordering - Chat 工具消息顺序修复
**状态**: 已完成
**完成日期**: 2026-09-06
**归档位置**: [workflow/done/260906-chat-tool-ordering.md](workflow/done/260906-chat-tool-ordering.md)

**成果总结**:
- ✅ 修复实时 parts 与完整/终态快照对账时的文本、工具顺序错位。
- ✅ 取消会隐藏或上移后续工具的跨消息合并，保持原消息位置。
- ✅ 修复旧 V1→V2 迁移随机 UUID 排序，并对可完整匹配的既有数据安全重排且留存备份。
- ✅ Web 全量 1741 测试、类型检查、构建及真实浏览器顺序验证通过。

### ✅ 260830-auto-compaction-presets - 自动压缩上下文挡位与聊天统计刷新
**状态**: 已完成
**完成日期**: 2026-08-30
**归档位置**: [workflow/done/260830-auto-compaction-presets.md](workflow/done/260830-auto-compaction-presets.md)
**成果总结**:
- ✅ 模型支持自动、272K、400K、1M、自定义上下文窗口挡位，并通过独立 `contextWindowOverride` 保存。
- ✅ 网关按模型能力、用户挡位、运行时发现值和环境覆盖解析有效窗口，自动压缩阈值与目标预算实际生效。
- ✅ 聊天输入框内可直接保存挡位，Token、上下文窗口、百分比和 tooltip 即时刷新，Team 输入框同步支持。
- ✅ 375/768/1280 三种视口完成真实浏览器交互与视觉验收。

### ✅ 260814-tool-prompt-system - 工具提示词系统优化
**状态**: 核心实施完成  
**完成日期**: 2026-08-14  
**归档位置**: [workflow/done/260814-tool-prompt-system.md](workflow/done/260814-tool-prompt-system.md)  
**最终报告**: 原 `runtime/260814-tool-prompt-system/results/final-archive-report.md`（runtime 属临时目录，2026-09-16 已按 cleanup-policy 清理）

**成果总结**:
- ✅ 创建 4 个核心工具的完整提示词系统（2,785行代码）
- ✅ 实现系统提示词构建器和工具章节生成器
- ✅ 完成 agent-core 和 agent-gateway 两层集成
- ✅ 代码质量优秀：0 错误，0 警告
- ⏳ 待完成：性能优化、完整测试、代码审查

**核心交付物**:
1. LSP 工具提示词（10个工具，884行）
2. Web 搜索工具提示词（9个提供商，466行）
3. 哈希编辑工具提示词（原子性保证，489行）
4. Lint 工具提示词（自动反馈，419行）
5. 系统提示词构建器（支持动态组装和缓存）
6. 完整的文档和测试框架

---

### ✅ 260816-team-lightweight-routing - Team 简单任务轻量路由优化
**状态**: 已完成
**完成日期**: 2026-08-16
**归档位置**: [workflow/done/260816-team-lightweight-routing.md](workflow/done/260816-team-lightweight-routing.md)
**最终报告**: 原 `runtime/260816-team-lightweight-routing/final_output.md`（runtime 属临时目录，2026-09-16 已按 cleanup-policy 清理）

**成果总结**:
- ✅ 只读了解、解释、查看、检索、对比输入走 `light`，直接留在 reception stream。
- ✅ 明确开发、修复、重构、设计、执行和部署意图继续走完整 handoff 链。
- ✅ LLM `LIGHT` 协议与风险敏感 fallback 已接入，4 个目标测试文件 57/57 通过。
- ✅ gateway typecheck exit 0，light 路径实测 0 条 PM1 handoff，复杂任务 handoff 回归保持通过。

### ✅ 260816-team-routing-safety-hardening - Team 路由安全与取消优化
**状态**: 已完成
**完成日期**: 2026-08-16
**归档位置**: [workflow/done/260816-team-routing-safety-hardening.md](workflow/done/260816-team-routing-safety-hardening.md)
**最终报告**: 原 `runtime/260816-team-routing-safety-hardening/final_output.md`（runtime 属临时目录，2026-09-16 已按 cleanup-policy 清理）

**成果总结**:
- ✅ fallback 按明确只读/明确修改/意图不明分别进入 `light`/`orchestrate`/`clarify`。
- ✅ 高风险动作词覆盖配置改写、生产操作、排查诊断等场景。
- ✅ 路由 AbortSignal 已透传到底层 workflow LLM，reception 只读工具契约已固定。

## 未完成与近期收口任务（明细）

> 本节保留「未完成 / 阻塞」任务，以及**已完成但细节量大、不重复搬入上方登记区**的任务明细。已完成条目的权威登记见上方「已完成的任务」。

### 🟡 260921-opencode-v2能力对齐 - 对照 opencode v2.0.12 补齐工具与设计缺口
**状态**: 🟢 **Phase 1/2 已交付并验证**（2026-09-21，多并发实施）；**Phase 3（CodeMode）未开始**
**复杂度**: Full orchestration（score +6）
**开始日期**: 2026-09-21
**方案文档**: [workflow/260921-opencode-v2能力对齐.md](workflow/260921-opencode-v2能力对齐.md)
**附录 A**: [workflow/260921-opencode-v2能力对齐-附录A-browser操作面.md](workflow/260921-opencode-v2能力对齐-附录A-browser操作面.md) —— 上游 `browser.*` 43 个操作逐条对照 + T-06 两批划分
**附录 B**: [workflow/260921-opencode-v2能力对齐-附录B-codemode解释器选型.md](workflow/260921-opencode-v2能力对齐-附录B-codemode解释器选型.md) —— 解释器 5 方案对比，首选移植上游自研解释器
**运行计划**: `.agentdocs/runtime/260921-opencode-v2能力对齐/master_plan.md`（临时目录）

**目标**: 以 `@temp/opencode`（tag `v2.0.12`，commit `2670273`）为基线，补齐本仓在工具面与设计面上的缺口，分三阶段交付。

**关键结论（已双向核实）**:
- **完全缺失**：`execute`（CodeMode 受限 JS 运行时 + 目录预算 + `search` + 资源限额）。
- **有机器未接线**：`read` 读时注入最近 AGENTS.md（`DirectoryAgentsInjectorImpl` 仅被 `/init-deep` 调用）；`browser` 的 `evaluate`/`console`/`network` 底层已有但未暴露为工具动作。
- **无模型可见工具**：`opencode.models` / `session_rename`（仅 HTTP 路由）；`session_move` 本仓**已有底层能力**（`PATCH /sessions/:sessionId/workspace`）但无工具，D-3 已核实可行。
- **缺中间层**：`ToolInputRepairPlugin`（本仓已有 `tool.execute.before` 钩子总线，缺内置 schema 修复层）；`webfetch` 缺 Cloudflare 挑战换 UA 重试。
- **明确不落后（勿误判为缺口）**：`edit` 多级模糊匹配本仓 **9 级策略** > 上游 3 级；模型自适应工具裁剪、输出截断+引用回读均已具备；本仓另有桌面控制/媒体生成/21 渠道/codegraph/10 个 LSP 等上游没有的能力。

**Gate 0 决策（2026-09-21）**: D-1 CodeMode **全量立项**；D-2 **扩展现有 `desktop_automation`**（evaluate/console/network/find/tabs）；D-3 `session_move` **已核实可行**——本仓已有 `PATCH /sessions/:sessionId/workspace`（`routes/sessions.ts:3252`，`{workingDirectory, force}` + immutable-lock + `force` warp + `workspaceWarpHistory` 审计 + SSH 解绑），缺的只是模型可见工具与安全边界语义；D-4 AGENTS.md 注入**按会话 + 文件路径去重**。

**分阶段路线**: Phase 0 Gate 0 已完成 → Phase 1 低成本高收益（T-01 `models` / T-02 read 注入 AGENTS.md / T-03 webfetch 重试 / T-04 `session_rename` / T-13 `session_move`，可独立发版）→ Phase 2 中间层与检查面（T-05 输入修复 / T-06 desktop_automation 动作 / T-07 目录增量指令化）→ Phase 3 CodeMode 全量立项（T-08…T-12）。

**交付结果（2026-09-21，多并发）**: Phase 1/2 全部落地——`models`（模型搜索）、`read` 读时注入 AGENTS.md（会话+路径去重）、`webfetch` Cloudflare 换 UA 重试、`session_rename`、`session_move`（复用 workspace warp）、schema 驱动工具输入修复（落 `ToolRegistry.execute`）、`desktop_automation` 新增 7 个检查动作。验证：agent-core / agent-gateway typecheck ✅；网关工具测试 **63 文件/470 测试**、agent-core 权限+工具 **9 文件/229 测试** 全通过；改动文件 ESLint 0 error。

**复查跟进（2026-09-21 第二轮）**: 修复 #2 路由标题 trim 语义回归（trim 下沉到工具侧）、#3 webfetch 首次请求恢复零行为变更（仅重试换 UA）、#4 `models` 加入 clarify 只读允许集、#6 补齐 `desktop_automation` 的 `network_list`/`network_get`（有界环形捕获 200 条、请求体 ≤8KB、响应体默认不捕获）；#9（T-07 工具目录增量指令化）分析后确认**延后至 Phase 3**（本仓无「工具目录指令面」，无消费者，不做投机基建）。第二轮验证：网关定向 7 文件/50 测试、browser-automation 15 测试通过，双包 typecheck ✅、ESLint 0 error。**复查后收口**：仅处理本轮新增代码（network 查询改为返回快照副本、明确 `truncated` 语义），既有 `restart()` 死代码按「只管理本轮调整」原则不动。

**Phase 3（CodeMode）未开始**。

**范围边界**: 不含本轮已单独交付的 `openai-chat.ts` 空 assistant 报文兼容修复；不照抄上游的权限 defect 隧道与 tree-sitter shell 解析（语义/依赖差异，属独立议题）。

### ✅ 260922-子代理对标opencode改造方案 - 子代理结果回流收敛为 Job → 合成消息 → 唤醒 单闭环
**状态**: ✅ **已归档（2026-09-22）→ `workflow/done/`**。T-01…T-32 全部完成：Phase 1 ✅（519/3974）；**Phase 2 ✅**（523/3993）；**Phase 3 ✅**（Notice 契约下沉 `packages/shared`、`SubagentNoticeRow`、Web 数据层、**Web 渲染交错 T-16b**、移动端接入 + 实时通道 T-29）；**Phase 4 ✅**（T-18 · T-22 · T-23 · **T-23b** · T-19b-1…5 全链）；**T-27 ✅**；**T-31 ✅**（旧 auto-resume 机制按正确边界清理）；**T-32 ✅**（补回自动唤醒预算，关闭 Q3/R-12）。**收口复盘 SR-1…SR-10 已完成**：**SR-3 与 SR-10 为真实回归/险情并已修**（前者：`task` 误入 legacy 重写表致子会话不再创建；后者：差点删掉 `task-parent-auto-decision` 仍在消费的上下文表）。**三视口验收 T-30 已以组件级真实浏览器通过**（真实 Chromium，**61 断言 × 3 视口**，含两条真实祖先链路与**兜底/主题两条色彩链**；资产 `apps/web/harness/`）。**最终验证**：网关全量 **532 文件 / 4069 用例 EXIT=0** · **9 条 task 验收脚本单次连续全 ok** · web **513 / 4972 EXIT=0** · mobile **13 / 273** · shared/shared-ui **9/9 · 18/18** · `check:fastify-alignment` **exit 0**。**唯一未覆盖**：T-30 的**端到端**变体（真实 LLM 驱动的数据路径）——`AI_API_KEY` 为空，属**环境阻塞且已明确处置**（探针证据 + 就绪步骤已记录），非待办。⚠️ 环境：bun 迁移进行中
**复杂度**: Full orchestration（score +6）
**开始日期**: 2026-09-22
**方案文档**: [workflow/done/260922-子代理对标opencode改造方案.md](workflow/done/260922-子代理对标opencode改造方案.md)（附录 A 同目录）
**运行计划**: `.agentdocs/runtime/260922-子代理对标opencode改造方案/master_plan.md`（临时目录，`.gitignore` 已含 `.agentdocs/runtime/`）

**目标**: 以 `temp/opencode-v2.0.12` 的 `subagent` 实现为基线，把本仓「子代理结果回流」从**五套并行通道**（工具返回值 / `task_update` run event / assistant 提醒消息 / 自动 resume 请求 / 任务图持久化）收敛为 opencode 式的**单一闭环**：`TaskJob 注册表 → synthetic 合成消息注入父会话 → 显式唤醒（resume）`；并为此在消息模型引入 `synthetic` role。

**关键结论（双向核实）**:
- **上游骨架**：`job.ts`（统一 Job API + KV 持久化 + 25 条消费历史）、`subagent.ts`（前台 `jobs.block` / 后台占位文案 / 失败保留 sessionID / depth 限制默认 1）、`subagent-completion.ts`（`synthetic` 注入 + `id=notificationID` 幂等 + `resume` 默认唤醒）、`restart.ts`（重启恢复续跑或补投）。
- **本仓缺口**：① 无 synthetic role（`MessageRole` 仅 `user|assistant|tool|system`），`appendSessionMessageV2` 只写库不跑模型；② 无 `wakeSession` 原语，唯一自动续跑靠 `scheduleDrain` **伪造新用户请求** + 800/1500ms 重试；③ `state_status` 仅三态，无法表达「已入队未唤醒」；④ 无子代理深度硬上限。
- **本仓更强（不照抄）**：空响应警告、连续回流上限 10、结果含工具结果拼装、子代理中途替决策（`task-parent-auto-decision.ts`）、`task_*` 任务图。
- **前缀爆炸半径可控但有 role 爆炸半径**：前端**不引用** `task-reminder:` / `task-auto-resume:` / `task-parent-decision:` 三个前缀（风险在 `handoff-store.ts` 内部键注册表与守卫测试）；但 D-1 决策后新增 role 触及 **shared / 模型上下文 / 前端白名单 / 移动端渲染四层**。

**Gate 0 结论（2026-09-22，按「上游对齐优先」定档）**: D-1 **新增 `synthetic` role**（上游本就是独立 synthetic 类型）｜D-2 **拆分 `runSessionInBackground`**（admit / wake 分离）｜D-3 **canonical 改 `subagent` + 保留 `task` 别名**（上游本身做过 `task→subagent` 迁移）｜D-4 配置键 **`subagent_depth` 默认 `1`**｜D-5 **`.NET` 已废弃，不纳入**｜D-6 身份改用 **`notificationID`**（前缀降级为内部键兼容）｜D-7 采纳 `resume` 布尔，不引入 `steer/queue`｜D-8 结果文本**保留本仓富抽取**（有意偏离）｜D-9 **前端渲染对齐上游 Notice 契约**。

**详细复查（R-01…R-14，最重要的 5 条）**:
- 🔴 **R-01/R-02**：新增 role **不会**自动让模型看到——`toModelMessages`（`message-to-model-messages.ts:456-587`）**无 else、无 assertNever**，synthetic 会被**静默丢弃**；且 `message-v2-adapter.ts:571-591` 的 `else → system` 会把 synthetic **静默改写成 system**。
- 🔴 **R-03**：全链路**零编译期保护**；唯一 `assertNever` 网作用在 `UnifiedMessage` 上（`native-message-bridge.ts:143-146`）→ 强制任务 T-09 把 synthetic 加入该联合，把静默失效转成编译失败。
- 🟠 **R-06**：`shared-ui/ChatMessage.tsx:20` 与 `apps/mobile/chat-message-bubble.tsx:44` 的 `isUser` 二元判断会把 synthetic **渲染成 assistant 气泡**。
- 🟠 **R-13（新增）**：前端渲染契约此前未纳入设计——上游把 synthetic 子代理结果渲染为**可点击跳转子会话的一行 Notice**（`session-timeline-row.tsx:333-353,406-432`），本仓此前只有 `assistant_event` 卡片 → 已补 `## 前端渲染与展示设计` + Phase 3。
- 🟠 **R-11（未决，阻塞 Phase 4）**：拆分 `runSessionInBackground` 对 team resume（`teamResumeRootSessionId`）的影响未验证。

**分阶段路线（5 phase / 28 task）**: Phase 1 Job 骨架（T-01…T-04，只增不改行为）→ **Phase 2 `synthetic` role 全链路（T-05…T-13）** → **Phase 3 前端渲染展示（T-14…T-17，上游 Notice 契约）** → Phase 4 单通道交付与上游命名对齐（T-18…T-24）→ Phase 5 切换、恢复与清理（T-25…T-28）。

**范围边界**: 只动 `task/` + `session/` + `message/` + shared 类型 + 前端 role 白名单与 Notice 组件；不含子代理模型选择策略、team 层编排、`.NET` 镜像（已废弃）；结果抽取丰富度**有意保留本仓更强实现**。

### 🟡 260921-ChatPage组装层瘦身方案 - 把 7347 行的 ChatPage 降到 1500 硬上限内
**状态**: 🏁 **阶段性收尾（用户决定，2026-09-21）** — P0…P4c 全部提交；ChatPage **7347 → 3973（−45.9%）**，零行为变更；**未达 <1500 目标**（仍 4203 行），原因与后续路径见方案文档「阶段性收尾」节
**复杂度**: Full orchestration（score +6）
**开始日期**: 2026-09-21
**方案文档**: [workflow/260921-ChatPage组装层瘦身方案.md](workflow/260921-ChatPage组装层瘦身方案.md)

**目标**: `apps/web/src/pages/chat-page/ChatPage.tsx` **7347 行**（超 AGENTS.md 1500 硬上限 **4.9 倍**）→ 压至硬上限内（目标 600–900），并消灭「双份 150+ prop surface」，**零行为变更**。

**关键前提纠正**: `docs/architecture/chat-page-split-plan.md` 的**域抽取阶段（D/A/C/B/E）已全部完成**（B = `conversation/render/use-chat-streaming.ts` :474 接线、E = `hooks/use-chat-retry-and-edit.ts` :4011 接线）——该旧计划的序列已走完，本方案针对**残留组装层**，非其续作（旧文档状态已按事实修正）。

**实测事实（一手核实）**:
- 残余 hook：**34 `useState` / 33 `useEffect` / 34 `useCallback` / 26 `useMemo` / 25 `useRef`**（常引用的 35/36/36/27/26 是含 import/注释的裸 token 计数，已校准）
- 最大耦合块：**会话切换巨型 effect `:1817`**（重置几乎每个簇）+ `:809` resetToWelcome + `:1140` 按会话重置 + `:4026` 附着 effect（26 deps）+ `sendMessage`（约 :2806–3805）
- 双份 prop 面：`<ChatConversationView` 于 **`:6318`（融合）/ `:6774`（经典）**，prop 行数 **218 / 234**
- **无任何 ChatPage 级回归测试**（`ChatPage.test.tsx` 不存在；仅 `desktop/src/App.tsx:22` 与 `preloadable-route-modules.ts:64` import）→ 纯 rewiring 回归会整包静默通过

**主策略（Oracle 定）**: 分层组合——**粗粒度「会话作用域编排 hook」+ 单一 props-builder + 区域容器（Fusion/Classic）**，页面退化为薄 JSX。**否决**：单个 `useChatPageAssembly`（只是搬成 god hook）、纯渲染区域拆分（命中不了 1500）、继续加细粒度 domain hook、`ChatConversationView` 的 "Step 4d 状态下移"。

**分阶段（每阶段一 PR、单一提交边界）**: P0 tripwire（**必须先建**，否则无守卫）→ P1 props-builder+区域容器（预期 −700~−900 行）→ P2 会话 hook 原样搬家 → P3 reset 解耦（`use-session-reset` + epoch）→ P4 composer/弹窗 → P5 `sendMessage`/`ensureSession`（最高风险，必须最后）→ P6 收尾至 <1500。

**投资估算**: Large（3d+），含测试约 2–4 周。

**范围边界**: 只动 `ChatPage.tsx` + `chat-page/{hooks,conversation,layout,state}` 新文件；`panels/` 三大文件（1219 / 1166 / 1099）当前**均未违规**，本轮只读。

### ✅ 260921-GUI-Agent集成方案 - 借鉴 UI-TARS 为 OpenAWork 补齐 GUI Agent（computer-use）闭环
**状态**: **已归档**（2026-09-22）——Phase 0 / Phase 1 / Phase 2 全部完成并验证通过；**T-16 真实端到端验证待用户环境**（本机缺 `xdotool` / `AI_API_KEY` / grounding 模型）
**归档位置**: [workflow/done/260921-GUI-Agent集成方案.md](workflow/done/260921-GUI-Agent集成方案.md)
**复杂度**: Full orchestration（score +6）
**开始日期**: 2026-09-21 ｜ **归档日期**: 2026-09-22
**门禁**: typecheck 22/22 · lint fail 0 · agent-core 589 · gateway 4056 · web 2956 · cargo check + 12 单测
**交付要点**: 三个工具（`desktop_control` / `computer_use` / `desktop_automation`）全链路注册 + 插件 UI；新增 `agent-core/src/gui/` 7 模块 + `gateway/tools/gui/` 6 模块 + 前端时间线卡片；实施中发现并修复 7 个真实缺陷（坐标语义断裂 / 屏幕尺寸硬编码 / 输入修复层静默失效 / Rust camelCase / 用量未入账 / GUI 模型来源不一致 / 沙箱缺 try/catch），均带回归测试

**目标**: 借鉴 `bytedance/UI-TARS-desktop`（Apache-2.0，已 sparse checkout 至 `temp/UI-TARS-desktop/`）的 GUI Agent 能力，补齐「自然语言 → 视觉决策 → 多步操作 → 结果」闭环。

**关键结论**:
- **控制层不换**：UI-TARS 用 nut.js 原生插件进程内直调；OpenAWork 的 Tauri loopback 桥 + 系统命令在 Linux 覆盖、零第三方依赖、安全边界上更优。
- **借鉴三件套**：动作解析器（纯逻辑零依赖）+ 坐标归一化数学（0–1000 → 0–1 → 像素）+ GUI 主循环骨架（**须去 `globalThis` 单例**）。
- **移植基线取旧代** `packages/ui-tars/sdk`（自包含）；新代 `multimodal/gui-agent/*` 依赖 `@tarko/agent`，与自有状态机/网关冲突，仅抄其动作别名归一化表。
- **核心障碍**：模型层 `supportsVision` ≠ grounding 能力，需新增 `supportsGuiGrounding` 能力位；GUI 内循环与 `runModelRound` 轮次模型语义冲突，必须封装。
- **动作面差距**：`desktop_control` 缺 `drag` / `mouse_move` / `press` / `release` / `long_press`，且不支持归一化坐标输入（**命名已被 C-2 修订为 `mouse_down` / `mouse_up`**）。
- **基线校准（2026-09-21 追加）**：外部批次（`260921-opencode-v2能力对齐`）已引入 6 处交叉，**C-1 硬冲突**——本方案 T-13 拟注册的客户端工具 `computer_use` 与 `opencode-llm` 协议层已暴露的 hosted 工具名**撞名**（`openai-responses.ts:618`，`providerExecuted: true`），须改名或改协议层；另有 `press` 同名异义（浏览器键盘 vs OS 鼠标）、`look_at` 既有视觉上行通路未纳入设计、`desktop_control` 超时实为 **120s**（非原文 30s）。详见方案文档「基线校准与冲突台账」。

**分阶段路线**: Phase 0 能力补齐（T-01…T-07，低风险可独立发版）→ Phase 1 `computer_use` 工具（T-08…T-16，内嵌循环）→ Phase 2 GUI Runner 子会话（T-17…T-21，事件流 + 可视化）。

**Gate 0 决策记录（2026-09-21）**:
- ✅ **② 目标环境 = 本地桌面优先**：复用现有 Tauri 桥；远端沙箱列为后续独立立项（不在本方案范围）。
- ✅ **③ 权限 = 沿用现有权限体系**：复用 `permissionMode`（默认 `ask`）+ 现有插件门控，**不新增权限机制**。
- ✅ **④ 依赖 = 复用现有图像库**，不新增 `jimp` 等依赖。
- ✅ **⑤ Phase 0 先行独立交付**（低风险、可独立验证）。
- ⏸️ **① GUI 模型路径 → ✅ 已定：路径 A 复用现有 Provider**（GPT-4o / Claude / Gemini 等视觉模型按 UI-TARS prompt 约束输出；精度不足再切 B/C）。三路径均**不需自建部署**、均**不改架构**：
  - **A 复用现有 Provider**：用 GPT-4o/Claude 等按 UI-TARS prompt 格式约束输出 → 精度低-中、零成本、零部署（**✅ 已定，起步路径**）
  - **B 接云端 GUI 模型 API**：配置 OpenAI 兼容 grounding endpoint（如 Doubao-UI-TARS）→ 精度高、按调用计费、零部署（**精度不足时切**）
  - **C 本地部署开源权重**：UI-TARS-1.5-7B + vLLM/Ollama → 精度高、需 GPU、复杂度高（**仅离线场景**）
  - 关键：`supportsVision` ≠ grounding 能力；UI-TARS 新代 SDK 本身即支持 prompt-engineering 路线，证明不接专用模型亦可运行（仅精度打折）。真正难点在模型质量与截图成本/延迟，不在代码。
- ✅ **⑥ 工具命名 = 保留 `computer_use`**：本方案客户端工具沿用该名；撞名问题改由**协议层 hosted 暴露名** `computer_use` → `computer_use_preview` 解决（新任务 T-22）。
- ⏸️ **开发时机**：待 Gate 1 显式批准（Gate 0 已 6/6）。

### ⛔ 260921-多模态媒体引用通路 - 为图片补齐官方协议的「引用通路」（provider file_id）——**已终止**
**状态**: **已终止（2026-09-21，用户决策）**。原因：平台上游多为第三方中转/自建，**不保证实现 Files API**，引用通路在中转场景不可靠。已写代码**手工回退**（禁止 git 回滚指令），仅保留与功能解耦的 `protocols/index.ts` 常量命名导出；回退验证：`opencode-llm` 488/488、`agent-gateway` typecheck EXIT=0、全仓无残留引用
**开始日期**: 2026-09-21
**方案文档**: [workflow/260921-多模态媒体引用通路.md](workflow/260921-多模态媒体引用通路.md)
**运行计划**: `.agentdocs/runtime/260921-多模态媒体引用通路/master_plan.md`（临时目录，`.gitignore` 已含 `.agentdocs/runtime/`）

**目标**: 在现有「一律 base64 内联」之外补引用通路——OpenAI Responses `input_image.file_id` / Anthropic `source.type='file'`（Files API）——使长多轮对话不再每轮重传图片字节，并让超过内联上限的图片可用而非必然失败。

**范围红线**: 文档（非图片）通路、Gemini/Bedrock 引用路径、S3 上传器**均不在本方案**，需另行立项。

**关键前置结论（已核实）**:
- 网关协议可达面仅 `chat_completions | responses | anthropic_messages`（`routes/upstream-protocol.ts:1`）；`opencode-llm` 内的 `gemini.ts` / `bedrock-converse.ts` **未接线**，其引用路径今日不可达。
- 官方核对：OpenAI Chat Completions 的图片 part **没有 `file_id`**（仅 Responses 有）；Anthropic 官方**明确推荐**大文件 / 长多轮走 Files API，且已转正、无需 beta header。
- schema 内已有 `fileId` 字段但全链路无生产者也无解析者（死字段）→ 复用它承载「网关生成的 provider 文件 id」属**加法扩展**，客户端协议无需改动。
- 协议适配器为 `if (part.type === …)` 顺序链、**无 `assertNever`**，新增 part 变体不会触发编译错误；靠 `shared.ts:355-368` 的 `supportsContent`/`unsupportedContent` 白名单兜底（T-02 逐协议核对）。

**安全硬约束**: Anthropic 上传文件对整个 workspace 可见、不按用户隔离 → **绝不接受客户端传入的 `file_id`**，只由网关上传产生；`provider_files` 表带 `user_id`，默认不跨用户复用。

### 🟢 260921-移动端图片查看器方案 - 移动端自建图片查看器（可点击放大 + 图集左右切换 + 缩放旋转）
**状态**: **代码层完成，待真机验收**（Gate 0/1 已放行并实施完毕；23 个 T-XX 中 T-12 取消、T-18/19 未纳入、**T-13/T-17 待用户真机走查**；**未归档**，TODO 未全勾）
**门禁**: `mobile typecheck` exit 0 ｜ `mobile test` **12 文件 / 252 例全绿**（基线 7/35）｜ ESLint 0 ｜ **两道静态审查 PASS/PASS** ｜ **零新增依赖**（`package.json`/锁文件未改）｜ 范围红线 PASS（`app/**` 未触碰）
**开始日期**: 2026-09-21
**方案文档**: [workflow/260921-移动端图片查看器方案.md](workflow/260921-移动端图片查看器方案.md)（文末含**交付状态 + 9 条真机走查清单 + 跨会话沉淀**）
**运行计划**: `.agentdocs/runtime/260921-移动端图片查看器方案/master_plan.md`（临时目录，`.gitignore` 已含 `.agentdocs/runtime/`）

**目标**: 让 `apps/mobile` 能点击图片放大（含缩放/旋转/下载/关闭），并在**同一条消息的多张图片**之间左右切换。Web 端同名能力已交付，但实现基于 DOM（`createPortal`/CSS/键盘/`getBoundingClientRect`），**RN 无法复用**，故单独立项——只复用其**行为契约**（A/B 组共 40 条对齐条目）与 3 个测试基线。

**现状核实（已确认，含两个"看不见图"的根因）**:
- 全应用**唯一光栅图片渲染点**是 `src/components/chat-message-bubble.tsx:73` 的 `<Image>`（180×180，**无点击处理**）。
- 根因①：`imageUrl` 唯一来源是本地 `file://`（`attachment.localUri`）；**从网关历史加载的消息只有 `artifactId`** → 气泡永远只显示占位符「图片已附加」。
- 根因②：assistant 生成的图片产物**不进气泡**，只进文字 chip；`app/artifacts.tsx` 只用 Ionicons 图标，不加载图片内容。
- 按 artifactId 取内容的客户端能力**已存在但从未被调用**：`web-client` 的 `createArtifactsClient().get(token, artifactId)`（`GET /artifacts/:id`，图片含 base64）。
- **零手势依赖**：无 `gesture-handler`/`reanimated`/`expo-image`/`image-viewing`；且 `apps/mobile` **无 `babel.config.js`** → 引依赖需 babel 插件 + 原生重建（高风险）。
- 图集数据前提**已满足**：`collectInputImages()` 保序、不去重、不限量；气泡按数组顺序渲染。
- 测试基建：`vitest run --passWithNoTests`，7 个**纯逻辑**测试；**无 `@testing-library/react-native`** → 组件级测试今日不可用，UI 须真机/EAS preview 走查。
- 文档漂移：实际活路由是 **Expo Router**（`app/_layout.tsx`），而 `src/navigation/AppNavigator.tsx` 与 `src/utils/artifact-platform-adapter.ts` 均为**孤儿代码**，但 `apps/mobile/AGENTS.md` 仍声称使用手动状态机。

**待用户拍板（Gate 0）**: D-1 手势依赖路线（**A 零依赖 · 推荐** / B 引入 gesture-handler+reanimated）；D-2 覆盖范围（**1 仅聊天 · 推荐** / 2 +产物页 / 3 +图片工作台）；D-3 取数策略（**落盘临时文件+LRU · 推荐** / `data:` URI 直显）；D-4 是否顺带修正 `apps/mobile/AGENTS.md` 导航漂移（**建议是**）。

**范围红线**: 移动端文档内嵌图、HTML/CSV/SVG 产物预览、图片编辑、网关新缩略图端点**均不在本方案**，需另行立项。

- **独立待办（本方案承诺记录，原先缺跟踪）**: `apps/mobile` **无 `@testing-library/react-native`、无 jest** → 全部 UI/手势接线**无自动化回归**，正确性只能靠真机走查（方案 T-20 明确要求"记为独立待办"，此前仅在「现状核实」记了事实、未列为待办）。若要补：须先做**原生/构建链探针**（`apps/mobile` 目前**无 `babel.config.js`**，引测试库会牵动 Metro/babel → 可能需原生重建）；风险与取舍见方案文档 §验证策略 + R4。

### ✅ 260915-澄清完成自动切换编程模式 - 澄清模式设计完成后自动切到编程模式（+ 方案文档对齐 agentdocs 规范）
**状态**: 已完成并归档（2026-09-16）——T-01…T-15 全部完成并验证；**代码变更仍在工作树中待提交**
**开始日期**: 2026-09-15
**归档位置**: [workflow/done/260915-澄清完成自动切换编程模式.md](workflow/done/260915-澄清完成自动切换编程模式.md)

**目标**: 两件事——① 澄清模式（`dialogueMode='clarify'`）此前只提示用户"请手动切换到编程模式"，本次让"设计已完成"的机器可判定门控（grill 确认节点 `confirmedAt` / `ExitPlanMode` 批准）在回复响应前同步切换到编程模式；② 澄清模式产出的方案文档改为按内置 skill `agentdocs-orchestrator` 的工作流规范组织（`.agentdocs/workflow/` 落盘路径 + 复杂度评估 + `T-XX` 原子任务 + 验证契约）。

**关键架构决策**:
- 切换 SSOT 在网关：`POST /sessions/:id/questions/reply`（自动门控）与 `POST /sessions/:id/clarify/confirm`（顶栏「确认转换」按钮手动确认）都走 `switchSessionDialogueModeToCoding()` 同步改写 `sessions.metadata_json.dialogueMode = 'coding'` + 审计字段 `dialogueModeSwitch`，前端只做同步展示。
- 不新增 `DialogueMode` 枚举值、不新增表、不新增 RunEvent 类型；新模式经回复响应字段 `dialogueMode`（web-client `QuestionReplyResult`）回传，web 用 window 事件广播给持有模式状态的页面。
- 确认题固定 `nodeId: __grill_confirm__`，模型给出的选项文案先同步进引擎确认节点再判定（避免"确认"被误判为驳回）；终局确认轮允许只带确认题、不新增决策节点。
- team reception 的 `clarificationIntent` 澄清链条不参与自动切换（仍由 handoff 编排器推进）。
- 澄清模式仍**只读**：方案文档先在对话定稿（章节/命名/`T-XX` 均按 agentdocs 规范），落盘 `.agentdocs/workflow/YYMMDD-<中文任务名>.md` + 登记 `index.md` 由切换到编程模式后的第一步执行。

**验证**: 网关路由单测 15/15、工具可见性 20/20、提示词契约 4/4、agent-core 32 文件/384 测试、网关全量单测 448 文件/3136 测试、`test:grill` + `test:grill-reception` 端到端（真实 SQLite + HTTP，含切换与驳回断言）、web-client 84 文件/590 测试、web 定向测试（session 工具/chat hooks/conversation/team/layout）、网关 typecheck 与 ESLint 全通过。

**复查（2026-09-15）**: 复查发现并修复 4 项——① 确认题选项无条件采纳模型 `recommended` 会双向误判（否定项被当确认 / 漏标导致确认被判驳回）→ 改为肯定文案归一化；② 恢复轮"澄清提示词 + 写工具"错配 → 工具面按本轮有效模式收敛（live + resume）；③ 空 `clarificationIntent` 误拦截切换 → 收紧为非空判定；④ A/C 两层重复的肯定确认正则 → 下沉 agent-core SSOT。保留风险：客户端 PATCH 竞态（毫秒窗口）、确认题措辞落在肯定模式外时保守漏确认（详见 workflow 文档 §9）。

**界面便利化（2026-09-15 · Phase 5）**: chat 顶栏新增「确认转换」CTA（仅澄清模式渲染，E·Nebula token + 全交互态 + 窄屏图标态），走 `POST /sessions/:id/clarify/confirm`：同一次写入完成 `dialogueMode → coding`、审计 `reason: 'user_confirmed'` 与澄清确认门控结算；切换落库模块泛化为 `session/dialogue-mode-switch.ts`（三来源共用），审计字段更名 `dialogueModeSwitch`。

### ✅ 260915-浏览器预览功能增强 - 浏览器预览开发调试便利化
**状态**: ✅ 全部完成并验证（2026-09-16）——P0a / P0b / P1（T-15 可停靠面板、T-16 拖拽原语、T-17 设备预设、T-18 保存自动刷新、T-19 快捷键）/ P2（T-20 瀑布+HAR、T-21 DOM·a11y 检查器、T-22 sourcemap 栈、T-23 QA）/ P3-core / T-24 / in-app 浏览器引导下载器 均已实现并验证。工作流文档已归档至 `workflow/done/`，并已按最终事实回填（原先"T-21..T-24 挂起"的记载系 2026-09-15 的历史决策，已注明后续实施）。**唯一遗留：人工观感走查**（375/768/1280 的机械走查已由真实浏览器 9/9 完成，但"好不好看"需人看）
> ⚠️ **记录冲突更正**：本条状态行曾被一个并发会话改写为"T-21/T-22/T-23/T-24 已按用户指示挂起（本轮不执行本方案）"，该结论**与事实不符**——四个任务均已落地并通过 `acceptance-backend` 22/22、`acceptance-ui` 8/8、`ui-inspector-verify` 13/13、`ui-stack-verify` 9/9、`ui-sourcemap-verify` 3/3 与 1092 个测试。并发写入的**探测本身是对的**（本方案前端文件域确有另一会话在改，例如 `BrowserConsolePanel.tsx`），但应对方式是"分阶段施工 + 逐一复核"，而非挂起。
**开始日期**: 2026-09-15
**归档位置**: [workflow/done/260915-浏览器预览功能增强.md](workflow/done/260915-浏览器预览功能增强.md)
**执行计划**: 已随归档清理（原 `runtime/260915-浏览器预览功能增强/master_plan.md`；任务完成归档后按 runtime 清理策略删除，同步移除本引用以避免悬空链接）

**目标**: 把前端内置浏览器从「能看网页」升级为「能开发调试」——拆引擎 + 一键喂 Agent（P0a）→ CDP/Playwright 实时通道（P3-core）→ 跨域元素拾取（P0b）→ 可停靠面板/响应式/自动刷新（P1）→ 网络瀑布/HAR/DOM 检查器（P2）→ 多引擎收口（P3-remainder）。

**关键架构决策**:
- 调试引擎唯一采用 **Playwright + CDP live view**（chromium），按运行时能力协商；**否决 dev-server 同源反代**（解决不了跨域、HMR/绝对路径/CSP 全需重写、扩大 SSRF 面）。
- 实时传输用 **WS**（screencast 为 ack 驱动，需双向 + 背压）；SSE 仅只读低频降级；HAR/截图走 HTTP。
- Tauri 原生 `Webview` 仅保留 view 模式——它是独立原生子窗口，**无法承载拾取 overlay / 高亮**；debug 模式统一用 CDP screencast 渲染在 DOM 内。
- 顺序纠偏：`sandbox=allow-same-origin` 不等于同源 → 跨域拾取/截图受引擎阻塞，故 **P0a 先发，P3-core 先于 P0b**。

**进度**: ✅ **全部完成并归档**——P0a / P0b / P1（T-15 可停靠面板、T-16 拖拽原语、T-17 设备预设、T-18 保存自动刷新、T-19 快捷键）/ P2（T-20 瀑布+HAR、T-21 DOM·a11y 检查器、T-22 sourcemap 栈、T-23 QA）/ P3-core / T-24 / in-app 浏览器引导下载器；**累计发现并修复 10 个真实缺陷**（全部由真实网关 / 真实浏览器抓出，mock 测不到；账本见下）；T-14 的 375/768/1280 机械走查已由真实浏览器 9/9 完成，**仅剩人工观感复核**

**真实端到端验收成果（2026-09-15）**:
- 方法：本机起真网关（`DESKTOP_AUTOMATION=1` + 真 chromium）＋`POST /auth/desktop-default` 换真 JWT ＋ `Bun.serve` 测试页 ＋ WS 全链路；脚本 `/tmp/opencode/browser-live-e2e.ts`（裸 WS）与 `client-seam.ts`（**已构建的 `@openAwork/web-client`**，即 UI 真正使用的客户端）。
- 通过：status/hello/navigate（标题正确）/console/network/screencast 帧/pick（`[data-testid="e2e-btn"]`，unique）/ping-pong/error 信封/信用门控；`client-seam.ts` 亦验证 getStatus/connect/hello 分发/navigate/帧/ack/close+onClose 无 onError。
- **抓到 4 个 mock 测不到的缺陷**：① 线路「帧唯一标识」不唯一（CDP 的 `sessionId` 是**会话级**而非帧级，hub 原样透传 → 客户端按 id 去重会**丢弃第二帧起的所有帧、实况停在首帧**）——已修（fanout 单调 id + 映射回真实 CDP id ack）；② `availability()` 无热会话时误报 `engine:null,screencast:false`——已修（改为探针派生，幂等）；③ `hello.viewport` 恒 null——已修（改为省略字段）；④ `POST /browser-live/screenshot` 不校验 `sessionId` → 外键炸成 500——修复中。
- 未验证面已从"整条链路"缩小到**仅 React 渲染层**；该层随后也用临时 harness（`apps/web/browser-live-harness.html`，**验完删除**）+ 真实浏览器像素采样补齐，并再抓出 3 个缺陷（见下）。

**完整缺陷账本（7 个，全部由真实端到端抓出，mock 测不到）**:
| # | 缺陷 | 用户可见症状 | 状态 |
|---|---|---|---|
| 1 | 线路「帧唯一标识」不唯一（CDP `sessionId` 是**会话级**且被原样透传）| UI 按 id 去重 → 第二帧起全丢、实况**卡死首帧** | ✅ 已修+验证 |
| 2 | `availability()` 无热会话时误报 `engine:null`/非幂等 | 全新启动误报"无实时引擎"，破坏能力门控 | ✅ 已修+验证 |
| 3 | `hello.viewport` 恒为 `null` | 握手信息错误 | ✅ 已修+验证 |
| 4 | 截图端点不校验 `sessionId` → 外键炸成 500 | "截图进对话"拿不到可行动错误 | ✅ 已修+验证（404 + 真实会话 happy path）|
| 5 | hook `send` 未连接时**静默丢弃**（`connectionRef.current?.send`）+ 引擎 screencast 效应无 phase 门控 | **实时预览永久白屏、从不导航到目标地址** | ✅ 已修+验证（像素命中目标页）|
| 6 | `web-client.stop()` 设 JSON content-type 却不发 body → Fastify 400 | **"停止实时预览"永远失败** | ✅ 已修+验证（含全客户端同类审计）|
| 7 | 切设备预设后帧尺寸**不收敛**（停在布局中间态，静态页不重绘就不产新帧）| 切到手机预设画面没反应 / 尺寸不对 | ✅ 已修+验证（**连续 3 次走查 9/9**）|
| 8 | `NetworkWaterfall` 用 **11 个未定义 CSS 类**（过滤器无选中态、shimmer 不动画）| 分不清当前选中哪个过滤项 | ✅ 已修+验证（真实浏览器 14/14，含"active pill 计算背景色 ≠ inactive"）|
| 9 | `BuiltInBrowser` **不填满宿主**（根 `flex: 0 1 auto` 按内容定高）→ 窄面板下纵向 chrome 145px 把内容区压到 **0** | 停靠面板里预览**一片空白** | ✅ 已修+验证 |
| 10 | 引擎在**可用盒子退化为 0** 时渲染"空"（有合法帧却不画，还继续兜底 ack）| 帧在流、带宽在烧、画面全白 | ✅ 已修+验证（不变式：**只要帧存在就必须画出来**）|

> **缺陷 9 的教训（已固化）**：**jsdom 不做布局**，`getBoundingClientRect` 恒为 0 → 组件测试**天然测不到**"容器高度塌陷"这类缺陷。T-15 的 11 个新组件测试全绿，但真实浏览器里内容是空白。**凡涉及布局/尺寸的行为，必须用真实浏览器验证**——这与"`<img>` 解码成功 ≠ 画面是对的"、"视觉估计 ≠ 测量"是同一条方法论的三面。

**三套 E2E 脚本（可复跑）**：`/tmp/opencode/browser-live-e2e.ts`（裸 WS 后端全链路，20/20）、`client-seam.ts`（**已构建的 `@openAwork/web-client`**，12/12）、`ui-verify2.ts` + `ui-walkthrough.ts`（真实浏览器 + **像素采样**，4/4 与 9/9）。
**方法论教训（已固化）**：`<img>` 解码出真实尺寸 ≠ 画面是对的。首轮"UI 渲染成功"的结论被**像素采样**推翻（全是白屏 `rgb(255,255,255)`）。DOM 断言必须配合**内容级**校验。同理，**视觉模型的描述只能产生假设、不能当结论**——它报的"无状态芯片""对比度偏低"两个"缺陷"都被 DOM 断言与 canvas 客观测量推翻（芯片 testid 找错；实测对比度 ≥4.5 达 AA）。

**最终验收（2026-09-16）**:
- **5 套真实端到端脚本 55/55**：`acceptance-backend` 22/22（auth/status/建会话/hello/navigate/console+栈/screencast+ack 信用/reload/pick 唯一选择器/重复 testid 降级/device 375/ping/dom.tree/a11y.tree/node.styles 451/sourcemap 映射/截图 artifact/404 类型化/非法指令）、`acceptance-ui` 8/8（引擎帧真解码 + 像素命中 / 375·768·1280 帧尺寸精确 / 瀑布 + 真下载合法 HAR 1.2）、`ui-inspector-verify` 13/13、`ui-stack-verify` 9/9、`ui-sourcemap-verify` 3/3
- **测试合计 1092**：web 296 · gateway 44 · browser-automation 124 · web-client 602 · shared 32
- **门禁 exit 0**：`apps/web` 生产构建、`tsc -b tsconfig.build.json`、gateway / browser-automation / shared typecheck
- **文档**：新增 `docs/browser-preview.md`（298 行：能力矩阵含 Chromium-only screencast、浏览器解析顺序与 `PLAYWRIGHT_BROWSERS_PATH` 语义、5 个 reason token 提示与修法、协议摘要含帧背压 credit/ack、已知限制、5 个真实故障排查）

**收尾已完成**：临时 harness（`apps/web/browser-live-harness.html` + `src/browser-live-harness.tsx`）已删除且删除后 `tsc -b`/测试仍绿；我起的进程（vite:5199 / 网关:3099）已停止、端口释放。

**剩余待办（均非本次可完成）**:
1. ✅ **T-15 预览可停靠面板（2026-09-16 完成）**：在 Fusion 右侧停靠面板新增第 4 个 tab「浏览器预览」（`SidePanelTabId` 扩 `'browser'` + `PANEL_TAB_ORDER` + 键盘循环）；新增自持状态的 `panels/FusionBrowserTab.tsx`（119 行，读 `browserPreviewUrlByWorkspace`、空态可粘贴 URL）；`FusionSessionSidePanel` 加分支。**关键：单一浏览器互斥**——`FusionBrowserTab` 挂载即 `setBrowserPreviewSurface('dock')`、卸载归还 `'editor'`，`EditorBrowserWorkspace` 据同一标记 `!browserHostedByDock` 拒绝挂载第二份 `BuiltInBrowser`（否则两实例各自建网关实时会话，controller 选举与 ack 额度互相抢占）。
2. ✅ **T-18 保存后自动刷新（2026-09-16 完成）**：`workspace-file-index.ts` 新增**独立于缓存条目**的单调版本（`indexVersionByRoot` + `globalIndexVersion`；因为失效是 delete 条目，版本不能存条目里）并在失效/重建时递增 + `getWorkspaceFileIndexVersion()`；新增只读端点 `GET /workspace/files/index-version?path=`（镜像既有的 `files/search` 鉴权与校验风格，O(1) 不扫盘）；`web-client` 加 `getFileIndexVersion()`；新 hook `use-workspace-index-refresh.ts`（101 行，仅预览可见时轮询 ~2.5s、跳过首帧建基线、版本**变小也视为变化**以兼容网关进程内计数器重启归零、错误不抛）；`BuiltInBrowser` 3 行接线复用既有 `refreshKey`。
   - **拓扑风险（已记录待评估）**：并发会话的 `routes/ports.ts` 记录 `apps/web/nginx.conf` 只转发 `/api/`、`/auth/`、`/sessions/`，故 `/workspace/*` 的可达性取决于部署形态。新端点刻意**镜像今天 Web 确实在用的 `/workspace/files/search`**，与既有能力同生共死。
   - **设计取舍（非缺陷）**：失效逻辑会**连带推进目标路径的所有已登记祖先**的版本（注释已写明理由：前端轮询的是工作区根）。因此**两个互为嵌套的工作区根**（如 `/tmp` 与 `/tmp/opencode`）会因内层写入而**多触发一次外层刷新**；单根场景无影响。实测已确认"真正无关（非祖先）的根不受影响"。
   - **真实浏览器验收（2026-09-16，16/16 PASS）**：临时重建 harness 后验证——停靠面板空态→填址→打开→**实时画面真的渲染**；**互斥成立**（停靠与编辑器同时在时全应用仅一个浏览器实例）；对照组（仅编辑器）正常；**T-18 因果链闭合**——只翻页面颜色不写工作区**不刷新**，写入工作区文件后根版本 2→3 且预览**自动刷新到新内容**。据此还抓出并修复了缺陷 9/10（见上表）。
3. ✅ **in-app 浏览器引导下载器（2026-09-16 完成并真实验证）**：`services/agent-gateway/src/browser-live/browser-installer.ts`（446 行）——**调用 Playwright 官方安装器**（`node <playwright>/cli.js install chromium`），**不自造 CDN 下载/解压**（Node/Bun 均无 zip 容器 API、`unzip` 仅 POSIX，手写严格更差；官方 CLI 顺带把 revision/平台映射/解压/`INSTALLATION_COMPLETE` 全做对）。安全约束：`requireAuth` + 桌面运行时门控 + **固定 argv（不走 shell，用户输入不入 argv/env）**；**单飞**（并发第二次 → 409 `browser_install_in_progress`）；有界日志环（40 行 × 300 字符）+ 10 分钟超时 + 处理子进程 `error` 事件；`browsersPath` 规则与桌面 `lib.rs` 一致（外部 `PLAYWRIGHT_BROWSERS_PATH` 优先，否则 `<数据目录>/browsers`）；成功后 `resetLiveBrowserAvailabilityCache()` 让 `/status` 立刻翻转。CLI 解析不到 → 独立 `unavailable` 状态 + 手动命令提示（**打包成单二进制 sidecar 时预期如此**，诚实降级）。UI：`InstallBrowserProgress.tsx` + `hooks/use-browser-install.ts`——仅在可安装 reason 下给按钮、轮询显示下载进度、成功后**免刷新**复检可用性（`recheckAvailability`）。
   - **真下载 E2E（我自己复现）**：空目录起网关 → `{available:false, reason:"browser-missing", installable:true}` → POST 202 `running` → 并发第二次 409 → **真实下载 `100% of 110.9 MiB` → `chromium_headless_shell-1208`** → `succeeded` → `/status` 翻转 `{available:true, engine:"chromium", screencast:true}`。**整链闭合**。
   - **诚实缺口**：安装器的 UI 交互（按钮/进度/失败回退）由 5 个新组件测试覆盖，**未在真实浏览器里点过**（临时 harness 已删）；且**真下载只在有网络时可行**。
4. ✅ **桌面 sidecar 形态已实测（2026-09-16，本欠账关闭）**：用真实 `build:binary` 产物（`bun build --compile` → 121MB / 2949 模块，正是 Tauri 内嵌的那个二进制）按 sidecar 真实形态运行，并注入 `PLAYWRIGHT_BROWSERS_PATH`（模拟 `lib.rs` 行为）：
   - **正向**：完整后端全链路 **22/22 通过**（含 screencast 帧 + ack 信用、`dom.tree`/`a11y.tree`/`node.styles`、**sourcemap 映射**、截图 artifact + 类型化 404）→ **Playwright 在编译后的 sidecar 中确实可用**，`PLAYWRIGHT_BROWSERS_PATH` 注入有效。
   - **负向（诚实降级）**：把受管浏览器目录置空（且本机无系统 Chrome/Edge）→ `{ available: false, engine: null, screencast: false, reason: "browser-missing", installable: true }`，**不谎报可用**，UI 会给出可操作指引。
   - **仍未做**：人工视觉走查（375/768/1280 已用真实浏览器 + 像素采样 + WCAG 客观测量覆盖，但未由人眼确认观感）与真实桌面应用内的整体联调。
5. ℹ️ 既有仓库问题（非本次引入）：`packages/browser-automation/tsconfig.json` 未排除测试 → 被 project reference 构建时把测试编进 `dist`（`multi-agent`/`skill-registry` 同样）；`agent-gateway` 的 `test:unit` 有 9 个失败属用户进行中的 SSH 特性

**P0a 成果（2026-09-15）**:
- `BuiltInBrowser.tsx` 1230 → **692** 行，拆为 `browser/hooks/use-tauri-webview.ts` + `browser/BrowserToolbar.tsx` + `browser/engines/browser-content-area.tsx`。
- 新增 `browser/hooks/use-engine-capability.ts`（引擎能力矩阵 + 限制原因）与 `browser/error-digest.ts`（一键把错误/失败请求发给 Agent）。
- `发送错误` 按钮接入 composer；`元素拾取` 入口按能力置灰并给出原因（功能属 P0b）。
- 验收：`vitest run src/components/chat/misc/browser src/components/chat/misc/BuiltInBrowser.test.tsx` 7 文件/74 测试全绿；`pnpm --filter @openAwork/web typecheck` exit 0。

**P3-core 成果（2026-09-15）— CDP/Playwright 实时预览通道**:
- 先以**真实 CDP 探针**验证技术路径（chromium 启动 / `Page.screencastFrame` / `screencastFrameAck` / `DOM.getNodeForLocation` / `CSS.getComputedStyleForNode`（需先 `DOM.enable`+`CSS.enable`）/ `Emulation.setDeviceMetricsOverride` / `Input.dispatchMouseEvent` / screenshot），再据此实现。
- **契约**：`packages/shared/src/browser-live.ts`（`BrowserLiveEnvelope` + 下行 `hello/frame/console/network/nav/node/screenshot/device/error/pong` + 上行 `input/ack/device/control` + 背压/路径常量）。**不放 `browser-automation`**——web-client 不能依赖 Playwright。
- **包层**：`packages/browser-automation/src/live-session.ts`（+types），`DesktopBrowserAutomation` 新增 `getCurrentPage()`；**未建 `live-proxy.ts`**（网关进程内直持 session）。
- **网关层**：`browser-live/{manager,hub}.ts`（per-user 单例 + 懒加载 playwright + refcount + idle TTL 回收 + **单帧信用背压 + 4s 看门狗 force-ack** + 超限丢帧 + 控制器选举）、`routes/browser-live.ts`（WS `GET /browser-live` + REST `status/start/stop/screenshot`）、`/desktop-automation/status` 增 `liveView`。
- **客户端**：`packages/web-client/src/infra/browser-live.ts`（WS + REST，复用 `gateway/http.ts`）。
- **UI**：`engines/cdp-live-engine.tsx`（含等比重排 / 按 `deviceWidth`·`deviceHeight` 换算坐标 / `img onLoad` 后 ack / mount-unmount screencast 控制）、`hooks/use-browser-live-session.ts`（含 500ms→4s 退避重连并重发 `screencast.start`）、`live-console-bridge.ts`（事件并入既有 `ConsoleEntry`/`NetworkExchange`）、`use-cdp-live-pick.ts`（拾取 → composer）。
- 验收：`browser-automation` 10 个真实 chromium 集成测试；`agent-gateway` browser-live 19 测试；`web-client` 292 测试；`apps/web` 浏览器域 99 + 下游 68 测试；`tsc -b` 0 错误；`apps/web` 生产构建 exit 0。
- **遗留缺口**：① 未做真实端到端联调（sidecar + chromium + UI 同跑）；② 视觉自查未做；③ 分发阻塞**已缓解**（见下）；④ `BuiltInBrowser.tsx` 706 行（略超 700）。

**分发加固成果（2026-09-15）— 浏览器从哪来**:
- **决策（Oracle）**：**拒绝把 chromium 打进安装包**（体积 140–180MB × 6 矩阵；macOS 嵌套 app 签名/公证 + JIT 授权风险；**Linux 打包不解决 libnss3 等系统库**，故打包甚至不充分；与 pinned playwright 版本强耦合）。采纳：受管目录 → 系统 Chrome → 系统 Edge → 才引导下载。
- **地雷 1**：`bun install` 根本不会装浏览器——根 `package.json` 的 `trustedDependencies` 不含 `playwright`（bun 只对白名单内的包执行安装脚本）。
- **地雷 2**：`"playwright": "^1.54.2"` 是静默破坏区间（实测 1.58.2 = chromium revision **1208**，升 1.62 = 1234 会静默失效）。**已精确锁定 `1.58.2`**。
- **去风险实测**：用与真实 `build:binary` 相同参数编译独立二进制并运行 → probe 命中、screencast 收帧、ack、`nodeAtPoint`、screenshot 全通过 → **bun 打包 playwright 不构成问题**，无需改构建命令。
- **已落地**：探测契约（21 用例）+ 系统 Chrome/Edge 有序回退（手写候选路径，因 playwright-core `exports` 屏蔽内部 registry；用显式 `executablePath` 而非 `channel`）+ `lib.rs` 注入 `PLAYWRIGHT_BROWSERS_PATH`（外部优先，否则 `<effective_data_root>/browsers`，**同时修掉既有 `desktop_automation` 同类问题**）。
- **验证**：browser-automation 62、gateway browser-live、web 浏览器域测试全绿；`cargo check` **exit 0**（亲手复跑 29.56s）。`cargo check` 需绕开两个环境问题：`target/` 属 root 不可写、缺自动生成 sidecar 产物 → 用独立 `CARGO_TARGET_DIR` + 文档化 `TAURI_CONFIG` 覆盖（不落盘 workspace 文件）。
- **未做**：in-app 引导下载（Oracle 排序为最后一步）；Linux `.deb` 的 `Depends` 运行时库声明（与下载器同期）。

**P0b 成果（2026-09-15）— 跨域元素拾取**:
- **T-12**：唯一性校验选择器，**落在包层 `live-session.ts`**（非计划的 `apps/web/browser/element-context.ts`——唯一性校验必须调用 Playwright `page.locator()`，只有能访问 Page 的包层可靠）。顺序 `data-testid` → `id` → `role=[name=""]` → `:nth-of-type` CSS path（经 `document.elementFromPoint` 单次 `page.evaluate` 生成），取首个唯一者；全不唯一则返回 css-path 并诚实置 `selectorUnique: false`。新增 `BrowserLiveSelectorStrategy`，并在 `@openAwork/shared` 以**可选字段**加法扩展 + 网关转发。
- **T-13**：拾取 overlay（十字光标 + "拾取模式：点击页面元素，Esc 退出" + Esc 捕获阶段解除武装 + 拾取态点击**不透传**远端 + 命中反馈含 ambiguous 警告）；composer 上下文块改为 **computed styles 白名单**（15 项）而非 400+ 条全量。
- **验收**：browser-automation **14 个真实 chromium 测试**（含"重复 testid 必须降级"）；web 浏览器域 **119 测试**；`tsc -b tsconfig.build.json` exit 0；`apps/web` 生产构建 exit 0。
- **T-14 部分完成**：测试已完成，**视觉走查 375/768/1280 未做**（需完整 gateway + 认证 + 预览站点）。

**P1 成果（2026-09-15）— 开发调试便利化**:
- **T-17 响应式/设备预览**：`browser/device-presets.ts`（6 预设：375×812@2、430×932@3、768×1024@2、1280×800、1920×1080、自适应）＋缩放档位＋设备 UA；`BrowserToolbar` 增设备/缩放控制条，**Tauri 原生 webview 下自动隐藏该条**（原生 webview 无法按 CSS 定尺寸，避免无效控件）。zoom 语义定为**纯客户端 CSS `transform: scale`**，输入坐标除以缩放系数；自适应预设发送容器实测尺寸，不新增"清除"协议消息；协议仅在 `BrowserLiveDeviceMessage` 上加法新增可选 `userAgent?`。
- **T-19 快捷键**：`BROWSER_PREVIEW_SHORTCUTS` 作为**单一事实来源**（匹配逻辑与 UI 提示同源，`browser-shortcut-hints.tsx` 内注明禁止手写字面量）；`Ctrl/⌘+R` 刷新、`+Shift+J` 控制台、`+/-/0` 缩放、`+Shift+D` 循环设备预设；三道硬闸门——预览不可见时惰性、输入框内不触发、**修饰键精确匹配且 `Alt` 组合永不认领**，非预览焦点时不劫持原生快捷键。
- **T-16 统一拖拽原语**：发现存在两个原语（`PanelResizeHandle` / `resize-handle`），采纳后者 `ResizeHandle`（pointer capture + 键盘 + ARIA）；`EditorBrowserWorkspace`(-83) + `WorkspaceEditorOverlay`(-98) 共删 125 行手写拖拽，纯约束抽到 `file-editor/workspace-resize.ts`(+test)。**持久化契约原样保留**（文件树宽度仅内存 140–480px；编辑器分屏 20–80 百分比）。
- **验收**：browser + BuiltInBrowser + file-editor **174 测试**全绿；`tsc -b tsconfig.build.json` exit 0；`apps/web` 生产构建 exit 0；无硬编码色值、无新增 `any`；`BuiltInBrowser.tsx` 811 → **750** 行。
- **⛔ T-15 可停靠面板阻塞**：宿主 `ChatPage.tsx` 与 `conversation/**` 正被用户并行大改（`apps/web/src` 下 82 文件修改态）。
- **⛔ T-18 自动刷新推迟**：全仓无文件变更/watch 信号，而用户正在并行构建 `workspace/workspace-file-index.ts` + `WorkspaceFileTreePanel`（文件索引/监听）；应等其事件源落地后对接。

---

**最终状态（归档定稿 2026-09-16，**取代上文所有过程态描述**）**:

上文出现的"T-15 阻塞""T-18 推迟""P1 可做部分""T-14 未做""17/24"等均为**施工过程记录**，最终全部完成：
- **全部交付**：P0a / P0b / P1（T-15 可停靠面板、T-16 拖拽原语、T-17 设备预设、T-18 保存自动刷新、T-19 快捷键）/ P2（T-20 瀑布+HAR、T-21 DOM·a11y 检查器、T-22 sourcemap 栈、T-23 QA）/ P3-core / T-24 / in-app 浏览器引导下载器。
- **验收**：合并版 5 套脚本 **55/55**（`acceptance-backend` 22/22、`acceptance-ui` 8/8、`ui-inspector-verify` 13/13、`ui-stack-verify` 9/9、`ui-sourcemap-verify` 3/3）；真实浏览器走查 375/768/1280 **9/9**；安装器**真下载 E2E**（110.9 MiB → `available:true`）；测试合计约 **1100+**；`apps/web` 生产构建与各包 typecheck 全 exit 0。
- **缺陷账本**：累计 **10 个真实缺陷**（见上文表格），全部由真实网关/真实浏览器抓出并修复——mock 一个都测不到。

**归档后遗留（备忘，非本任务未完成）**:
1. 👁 **人工观感走查**（375/768/1280 机械走查已由真实浏览器完成，仅"好不好看"需人看）。
2. ⚠️ **WS 鉴权硬化**：`routes/browser-live.ts` 现为"先完成 101、再发 `UNAUTHORIZED` + close 1008"，存在"未认证也能完成握手"的窗口（**非数据泄露**：不发送任何数据即关闭）。建议改为 `{ websocket: true, onRequest: [requireAuth] }`（生产先例 `services/agent-gateway/src/lsp/router.ts:157`；Fastify 的 `onRequest` 对 Upgrade 请求同样执行）。**改它会变更已文档化协议 + WS 测试 + `docs/browser-preview.md`，故未在归档时动手。**
3. ℹ️ **嵌套工作区根会过度通知**：失效逻辑为让"被轮询的根"反映子路径变化，会连带推进目标路径的所有已登记祖先版本 → `/tmp` 与 `/tmp/opencode` 这类嵌套根会因内层写入多触发一次外层刷新（单根无影响）。
4. ℹ️ **`/workspace/*` 的 nginx 可达性**：`apps/web/nginx.conf` 只转发 `/api/`、`/auth/`、`/sessions/`；T-18 新端点刻意镜像今天在用的 `/workspace/files/search`（同生共死），未解决部署拓扑问题。
5. ℹ️ **安装器 UI 未真机点击验证**（按钮/进度/失败回退由 5 个组件测试覆盖；临时 harness 已删）；且**真下载依赖网络**。
6. ℹ️ **仓库既存问题（非本任务引入）**：`packages/browser-automation/tsconfig.json` 未排除测试 → 被 project reference 构建时把测试编进 `dist`（`multi-agent`/`skill-registry` 同样）；`agent-gateway` 的 `test:unit` 有 9 个失败属用户进行中的 SSH 特性。
7. ℹ️ **全程零提交**：所有改动仍在工作树（`git status` 可见），是否提交由用户决定。

### ✅ 250109-opencode-llm-full-migration - OpenCode LLM 完整迁移续作（已归档，未做项放弃）
**状态**: 已归档（2026-09-16，用户决定）——代码与 fixture 全部完成；方案文件已从 `workflow/` 删除；**未做项按用户决定放弃**（T-41 / T-48 / T-50 / T-52 / T-53 五项真实 provider·隔离部署·负载 gate，以及发布验收清单 14 项：响应时间 / 吞吐 / 内存 / 覆盖率 / 文档 / 监控 / 回滚）
**复核日期**: 2026-08-15
**工作流文档**: 已删除（删除前最后提交 `e486c615`；原文可 `git show e486c615:.agentdocs/workflow/250109-opencode-llm-full-migration.md` 追溯）
**运行时证据**: 原 `runtime/250109-opencode-llm-resume-20260815`（runtime 属临时目录，2026-09-16 已按 cleanup-policy 清理）
**Effect 原生终态证据**: 原 `runtime/250815-opencode-llm-effect-native-final`（同上已清理）

**当前结果**:
- gateway 已移除 `ai`、全部 `@ai-sdk/*`、`streamText`、`generateText`、`LanguageModelV4`、`AsyncGenerator` 生产残留；源码/manifest/lockfile residue scan = 0。
- Responses reasoning metadata replay 已完成 `thinking_end.itemId → ReasoningPart → AssistantReasoning → providerMetadata.openai.itemId` 链路，完整 `test:responses` exit 0。
- gateway `test:v2-runtime`、typecheck、build、replay bookend、cancellation/stall 聚焦验证通过；完整 `@openAwork/opencode-llm` 套件最终复跑为 25 files / 399 tests / 0 errors。
- T-27/T-31/T-42 已完成 Effect 边界收紧：native upstream 无 async/Promise 包装，Fastify/SSE/WS 与文件/数据库/plugin hook async 作为明确边界保留；路由矩阵 6 files/30 tests、replay race 1/1 通过。
- 当前未达到发布条件的原因只剩：真实 provider/隔离部署/LLM 负载/回滚由用户执行，以及本续作 exact-SHA 五路独立 review gate 尚未取得 PASS；不得把 synthetic fixture 结果当作真实供应商验证。
- 用户提供代理的真实 native Effect 验证已补齐：OpenAI Chat/Responses (`gpt-5.6-terra`) 及 Anthropic Messages (`grok-4.6`) 的非流式、SSE 流式、usage 与 `stop` 终止均通过；该单代理验证不替代部署、负载和全供应商 gate。

> ℹ️ **已删除的幽灵条目（2026-09-16 归档审计）**：本处原有 🔵 `260814-migrate-opencode-llm-library`（移植 OpenCode LLM 库，标称 0/18）。经核查 **`workflow/260814-migrate-opencode-llm-library.md` 与 `runtime/260814-migrate-opencode-llm-library/` 均不存在**，该任务已并入上方的 `250109-opencode-llm-full-migration`，故移除以免误导。

### ⚪ 2026-09-16 批量归档（用户决定）—— 4 个历史方案删除

> 以下 4 个方案经用户确认后归档：**方案文件已从 `workflow/` 直接删除**（未移入 `done/`）。原文按"删除前最后提交"用 `git show <sha>:<path>` 可完整追溯。其未完成项一律标注「**用户决定放弃**」，不再作为待办跟踪。

#### ⚪ 250815-opencode-llm-effect-native-final - OpenCode LLM 原生 Effect 终态迁移
**状态**: 代码侧已完成；方案文件已删除（最后提交 `e486c615`）
**放弃的未做项**: N-12（真实隔离部署 + LLM 流负载 + 回滚演练 + 临时资源清理 + exact-SHA 五路独立审查 + 最终状态同步）——本地代码与 fixture gate 已通过，剩余部分为外部/人工 gate

#### ⚪ 260704-opencode-ui-layout-borrow-plan - OpenCode UI 布局借鉴升级方案
**状态**: W1/W2/W3/W5 主体已落地；方案文件已删除（最后提交 `c154fea5`）
**放弃的未做项**: T-W3-07（diff 行内评论 → 自动注入 prompt context）、T-W4-05/T-W4-07（抽取 `MessageTimeline.tsx`，全仓无此文件）、T-W6-01/T-W6-02（会话列表拖拽排序，`@dnd-kit` 未安装）
**补充核实（2026-09-16，纠正历史误标）**: 计划中标注"未实施 / 阻塞"的 **T-W3-04 与 T-W6-07 实际已完成**——T-W3-04 的阻塞条件（无可消费的 web-client 会话 diff API）已解除，`useReviewPanelFileChanges` 现走 `createSessionsClient` + `SessionFileChangesProjection`；T-W6-07 已实现，`command-palette.tsx` 含 `groupByCategory` + 分类渲染 + 分类参与搜索匹配。计划内多处 `tsc --noEmit` 未勾项属并行改动期的历史快照，不作为待办。

#### ⚪ 260706-fusion-layout-t1-s2-refactor - 融合布局重构 T1(纯标签栏) + S2(项目头像 Rail)
**状态**: F1–F5 全部落地（58/58 勾选）；方案文件已删除（最后提交 `c154fea5`）
**说明**: 文档头部残留的"进行中（F4 仅剩移动端侧面板适配）"系 2026-07-14 旧状态；其后 F4 六项已全部勾选，移动端"Rail 隐藏 + Panel 抽屉"亦已落地，故按已完成归档
**放弃的未做项**: 无

#### ⚪ 260814-team-communication-enhancement - Team 通信层优化（P0 方案）
**状态**: P0 四项**零实现**；方案文件已删除（最后提交 `9f62d031`）
**放弃的未做项**: `ConversationContextManager`（对话上下文管理）、`HandoffProtocol`（交接协议完善）、`request/response`（请求-响应模式）、`CollaborationPattern`（协作模式抽象）——全仓（`packages/` / `services/` / `apps/`）无任何实现或引用，按用户决定放弃

---

## 项目记忆

### 已知陷阱补充
- [2026-09-21] **批量工具权限暂停的 resume 会「删兄弟结果」** → `continueFromApprovedToolResult` 的 `truncateSessionMessagesAfter(messageId=本工具结果, inclusive:false)` 会连带删除暂停轮已写入的兄弟 tool_result（因本工具结果消息 id 更早），且 pending payload 只存单个 `toolCallId` → 修复：payload 增 `blockedToolCalls[]` 整批保序恢复 + 移除该 truncate（幂等改由确定性 `clientRequestId`+`replaceExisting` 承担）。
- [2026-09-06] 实时聊天重复/Thinking 错位 → 标准 WS/SSE 只保存 `lastSeq:0`，重挂载 attach 从头 replay → Gateway 在持久化事件后附加 `clientRequestId + seq`，Web 分发前推进并持久化游标；文本内容指纹不应替代协议游标。
- [2026-09-21] **切勿据「源码 TODO/FIXME 字面量」给缺口定级** → 扫标记会得出错误的 P0。实证两项均为误判，**不要重复当待办**：① `packages/opencode-llm/src/index.ts:42` 的 `TODO: 错误处理模块需要更新以适配 Effect 4.0 API` 是**过期注释**——仓库依赖本就是 `effect@4.0.0-beta.83`（`pnpm-lock.yaml` 唯一版本，无 stable 4.0），`tsc --noEmit` **EXIT=0**、`vitest run src/error` **4 文件 38 例全绿**，且**零生产消费者**（唯一引用者是包内集成测试 `src/__tests__/integration/e2e-simple.test.ts`），子路径 `./error` 仍经 `package.json` exports 可用；② `packages/skill-registry/src/installer.ts:130` 的 `Signature verification not implemented in MVP` 属**不可适用控制**——全仓无签名产物/公钥/`cosign`/`gpg`/`createSign`（`SkillManifest` 无 signature 字段），`skipSignatureVerification` 7 处调用点**全为 `true`/`?? true`**，抛错分支运行时不可达。**判缺口必须先验证前提（版本/消费者/可复现失败），再定级。**

### 架构决策
- [2026-09-22] **自动唤醒必须有预算上限，且只统计「真正发生的唤醒」**：单通道交付的唤醒是**事件驱动**的（子代理结算 → 投递通知 → 唤醒父会话），若被唤醒的父会话又委派新的后台子代理，其完成会再次唤醒它 → **无界自激**。落点 `services/agent-gateway/src/task/task-wake-budget.ts`（上限 10，与旧机制同值）：由 `deliverTaskCompletion` 在**决策为「要唤醒」之后**才消费预算（`resume:false` / 父会话在飞 / 父会话 paused 均不计入），耗尽时**仍然投递通知**（已落库 ⇒ 用户下次自然发言模型依然看得到，**不丢信息**），只返回 `wake:'skipped'` + `deferReason:'budget-exhausted'`；计数只在**非网关内部请求**时重置（复用 `isGatewayInternalRequestKey`——否则唤醒自身会把计数清零，上限永远触发不了）。进程内存储，重启即清零（可接受：重启后首次唤醒总是允许的）。
- [2026-09-22] **包管理器全量由 pnpm 切到 bun（bun@1.4.2）**：`bun.lock` 为唯一事实来源（`pnpm-lock.yaml` / `pnpm-workspace.yaml` 已删，workspace 用根 `package.json` 的 `workspaces` 字段）。`pnpm.onlyBuiltDependencies` → 顶层 `trustedDependencies`、`pnpm.patchedDependencies` → 顶层 `patchedDependencies`（playwright-core 补丁实测生效）；`peerDependencyRules` / `allowedDeprecatedVersions` / `.npmrc auto-install-peers` 无等价物已删。CI（7 个 workflow）、两个 Dockerfile、桌面脚本、活跃文档同步切换；**测试运行器仍是 Vitest**（23 包、692 处 `vi.*`），bun 只替代「装包」这一层。网关/客户端里「识别第三方项目包管理器」的探测列表（lsp root markers、repo-overview、bash-arity、ERR_PNPM 提示、workspace 根标记）**保留 pnpm 项并新增 bun 项**——产品需同时支持两种仓库。方案与实测数据见 `workflow/260922-pnpm全量迁移bun.md`。
- [2026-09-21] **批量工具权限暂停语义 = 只读兄弟放行 + 整批收集 + 批末统一 pause**：`isPermissionSafeSiblingTool` 白名单（read/list/glob/grep/webfetch/websearch/look_at/lsp）内的只读工具在待批期间继续执行；其余兄弟被扣住并入 pending payload 的 `blockedToolCalls`；批准后按 `tool_use` 顺序整批恢复，且仅当无残留 pending 才续轮。理由：上游 `tool_result` 顺序 + 整批 barrier 保证 prompt cache 前缀稳定，同时不丢只读兄弟。落点：`services/agent-gateway`（`routes/stream.ts` / `routes/stream-runtime.ts` / `tools/tool-sandbox.ts` / `permission/permission-contract.ts`）。**不照抄 opencode 的阻塞 await**——其 run 与请求解耦（durable drain），OpenAWork 的 run 绑在 SSE 请求上。
- [2026-09-15] `@` 文件提及的**索引与检索放在网关**：BFS 递归扁平索引（无层数限制）+ 进程内缓存（15s TTL / 16 根上限 / 写路径失效），检索排序（目录逐级 / 相关性）也在服务端，前端只渲染命中小结果集、不做全量加载与本地匹配；全量清单端点因零生产消费者被删除。理由：本仓约 1.28 万文件，全量扁平清单 301KB，单次查询命中仅 68B–1.3KB。
- [2026-09-15] 工作区忽略规则必须**按工作区根隔离**（`getWorkspaceIgnoreManager(root)` 的 per-root 实例），不能依赖 `defaultIgnoreManager`：它把 `projectRoot` 存为进程全局单值，多根并发时后服务的根会顶掉先前根的规则，锚定 `.gitignore` 项静默失效（实测泄漏 1007 条 → 修复后 0）。同一缺陷也存在于 `/workspace/tree` 等既有消费方。
- [2026-09-15] 澄清模式"设计已完成"由两个机器门控判定（grill 确认节点 `confirmedAt` 首次落库 / `ExitPlanMode` 批准），另有手动逃生口（顶栏「确认转换」按钮 → `POST /sessions/:id/clarify/confirm`）；三条来源都走 `switchSessionDialogueModeToCoding()` 在响应前同步把 `sessions.metadata_json.dialogueMode` 切到 `coding` 并写审计字段 `dialogueModeSwitch`（reason 区分来源）；前端只同步展示（回复响应字段 + window 事件），元数据为 SSOT。
- [2026-09-15] 同一份会话元数据的多处修改必须**合流为一次读-改-写**（`switchSessionDialogueModeToCoding` 的 `metadataPatch` 参数就是为此存在）：`questions.ts` / `session-dialogue-mode.ts` 里各自独立读改写会互相覆盖字段（先写的审计字段会被后写的 `clarificationState` 快照抹掉）。
- [2026-09-15] 澄清模式方案文档统一按内置 skill `agentdocs-orchestrator` 规范产出：目标路径 `.agentdocs/workflow/YYMMDD-<中文任务名>.md`，必备章节含复杂度评估（Direct / Lightweight / Full orchestration）与 `T-XX` 原子任务（含验证项）；澄清轮只读，落盘与 `index.md` 登记由切换到编程模式后的第一步执行。
- [2026-09-15] 终端 PTY 化选定 **Bun 原生 `Terminal` API**（`Bun.spawn` 的 `terminal` 选项，需 Bun ≥ 1.3.5，仅 POSIX）：已实测 runtime 与 `bun build --compile` 产物均满足 `isatty=yes` 且 `resize` 生效 → 不引入 node-pty / bun-pty；Windows 与 Node（dev/CLI）运行路径显式降级管道，能力探测切换。
- [2026-09-15] 终端输出通道 SSOT（契约见 `runtime/260915-终端-vscode-能力对齐/contract.md`）：后端事件 `terminal_output` 携带 `seq`（= 该终端累计字节数，从 1 起单调）与**增量** `data`，另保留 `outputTail`/`outputBytesTotal` 必填。`seq?`/`data?` 是**可选加法扩展**，因此 `use-session-terminals`、`run-background-bash-tools`、`packages/web-client` 全部零改动——跨前后端改造优先用「可选字段加法扩展」代替破坏性改字段。
- [2026-09-15] 单终端 SSE 流必须**先订阅、再发 snapshot**：D3 增量语义下，snapshot 与订阅之间丢失的 `terminal_output` 无法自愈（旧的累积 tail + 字节 diff 会自愈）。正确做法是订阅回调在 snapshot 上线前把事件缓冲、上线后按**原始顺序** flush；去重交给前端 `seq <= lastSeq`，后端不重排不去重。
- [2026-09-15] `apps/web` 终端交互层拆分基线（单文件均 < 500 行，纯逻辑全部可单测）：`use-terminal-session.ts`（编排/SSE/尺寸）+ `terminal-input-queue.ts`（16ms 合并 + 单飞保序 + 失败重排回队首）+ `terminal-key-handlers.ts`（纯判定矩阵，Ctrl+C/D/Z 必须放行）+ `terminal-stream-replay.ts`（seq 去重 + 旧后端 tail-diff 兼容）+ `terminal-xterm-options.ts`（插件装配 + webgl 失败回退 DOM）。
- [2026-09-16] **VS Code 式终端面板的分层**：第 1 行 = 面板级页签（`终端`/`端口`）+ 面板操作；**tab 条属于每个 pane（组）而不是全局**（VS Code 的真实模型），因此分屏接入时把原「全局 tab 条」下沉进 pane，直接复用既有 tab 组件。分屏布局是**二元 split 树**：叶子是「组」`{ terminalIds[], activeTerminalId }`（不是单个终端——否则要发明 tab↔pane 映射，制造第二套真相），`split` 节点 `{ direction:'row'|'column', children:[A,B], ratio∈[0.1,0.9] }`。**三套真相收敛**：`terminals` 是唯一「存在性」真相 / `TerminalLayout` 是纯排布描述（只引用 `terminalId`，永不决定终端是否存在）/ tab 条是**派生值**（不在树里的终端 → tab，在树里的 → pane）。
- [2026-09-16] 分屏布局持久化的**两条铁律**：① 归一化只在**渲染路径**发生，且**上游集合不可信时必须传 `null`**——`normalizeLayout(layout, liveIds: ReadonlySet<string> | null, …)` 把「还不知道有哪些终端」编码成 `null`（原样返回），从**类型层**堵住「切会话瞬间的空集合 → 判定终端都没了 → 清空布局 → 一旦落盘就每次切会话永久销毁用户布局」；② **持久化只有「用户主动操作」一条路径**，严禁任何 effect 在归一化后自动落盘。
- [2026-09-16] **split 的种子陷阱**：新建终端的 `POST` 返回后，该 id 在上游终端 store 里**往往还没同步**；此时用上游集合归一会把它当死终端立即摘除 → **刚拆出来的 pane 下一次渲染就消失**。修法：拆分时把新终端 id 作为 `seedTerminalId` 传给纯函数层，并在 hook 侧把 seed 视为存活。
- [2026-09-16] **每 pane 一条 SSE，不因失焦而 unmount**（unmount 会丢 scrollback 并触发 `term.reset()`，只靠 ring buffer 回放会花屏）；pane 上限 4（硬顶 6），抽屉收起时整体卸载构成天然上界。拖拽/缩放期间只更新瞬态比例，**`pointerup`/`drop` 才落盘**，且不得重建 xterm 实例或 SSE 流。
- [2026-09-16] **「真端口转发」在 Web 面不可实现 VS Code 同款**：浏览器无法打开本地 TCP 端口；唯一真形式（Tauri 壳内 TCP 监听 + WS 隧道）是纯桌面特性，而同机拓扑下直接打开 `localhost:PORT` **就是完整功能**。路径前缀式代理与主应用**同源** → 被代理应用的 XSS 可读 `localStorage` 主会话令牌（HttpOnly/Path 隔离只保护 pf cookie，保护不了 localStorage）；且 `forwardId` 生成时机与 dev server 的 `base`/HMR WS 前缀天然冲突。安全评审结论：**4 blocker / 9 should-fix，不通过**；若重启必须先在产品层选定「独立 origin」或 `CSP sandbox`。
- [2026-09-16] Fastify 的 **`onRequest` 钩子对 WebSocket `Upgrade` 请求同样执行**（`@fastify/websocket` 的 `onUpgrade` 会把 Upgrade 请求送进 `fastify.routing()`，源码注释明写「so that it will invoke hooks」），生产先例：`services/agent-gateway/src/lsp/router.ts:157` 写作 `{ websocket: true, onRequest: [requireAuth] }`。因此 WS 鉴权**应放 `onRequest`**（未认证直接 401、不发 101），**不要**照抄 `browser-live.ts` 的「先完成 101 再发 UNAUTHORIZED」handler 内校验（那有「未认证也能完成握手」的窗口）。
- [2026-09-16] **委派子代理的执行纪律**（本轮两个代理被 30 分钟空闲超时强杀）：必须在任务里强制「每条 `bash` 加 `timeout` 前缀」「禁止 `bun run dev`/`vite`/无 `run` 的 `vitest` 等常驻命令」「禁止跑全量套件（由协调者统一复跑）」「单命令 >6 分钟无输出即放弃并上报」。清理进程时**禁用 `pkill -f "vitest run"` 这类会匹配到自身命令行的模式**（会自杀并让工具等到超时），改用精确 PID。
- [2026-09-16] **可调尺寸面板的高度策略**（Fusion 终端抽屉）：① 边界由**视口派生的纯函数**给出（默认 ≈35% 视口、上限 ≈72% 视口并留 ≥28% 给主区、绝对封顶 900），不要写死 px——同一个默认值不可能在 768 与 1440 上都合理；② 用 `xxxCustomized: boolean` 区分「用户拖过」与「没拖过」：**没拖过就按当前视口给默认高**（老数据视为未自定义，可自动享受新默认），拖过则尊重持久化值；③ **resize 时只在渲染期钳制，不写 store**（否则 resize 会持续落盘）；④ 分屏等「结构性变化需要更大高度」时做**派生抬升且不落盘**，取消后自动恢复用户原高度；⑤ **改动钳制域时必须同步放宽持久化域**，否则拖拽写入会被旧 setter 打回（本轮 360 就是这个问题）。
- [2026-08-30] 上下文挡位使用独立 `contextWindowOverride`，有效窗口取模型能力、用户覆盖、运行时发现值与环境覆盖的最小值；保留原始模型能力，避免设置值超过供应商上限。
- [2026-08-30] 压缩后目标值作为近期上下文保留预算与工具输出截断目标，不承诺摘要严格精确 Token 数；真实分段价格留待独立价格阶梯字段实现。
- [2026-08-16] Team 路由 fallback 采用三态安全策略：明确只读才 `light`，明确修改/执行才 `orchestrate`，不确定则 `clarify`；避免故障时把未知请求误放入轻量路径。
- [2026-08-16] 路由超时必须通过 AbortSignal 贯穿 `routeByLlm → requestWorkflowLlmCompletion`，仅停止等待不能停止底层 provider 请求。
- [2026-08-16] Team reception 对只读了解/解释/检索采用 `light` 直接回答路径；仅检测到明确修改、执行或高风险意图时创建 PM1 handoff，避免简单问题展开完整层级。
- [2026-08-15] agent-gateway 的 LLM upstream 统一使用 `@openAwork/opencode-llm` 的 Effect `LLMClient`/`RequestExecutor`；禁止重新引入 AI SDK 兼容层。
- [2026-08-15] native Stream/Effect 的执行终止点允许保留 Fastify/SSE/WS 的 `async` 与单一 `Effect.runPromise`；只有 upstream 业务契约必须保持 lazy Effect，不能为“全 Generator”形式改写 700 行路由编排。
- [2026-08-15] Responses reasoning replay 必须同时携带 output item `itemId` 与 encrypted content；仅保存 encrypted content 会使 `lowerReasoning` 丢弃整个 reasoning item。
- [2026-08-15] 入口通过单一 Effect `ManagedRuntime` + `ConfigService`/`LoggerService`/`Metric` 接入 Fastify；`/metrics` 使用 Prometheus exposition，关闭时释放 runtime。
- [2026-08-15] native OpenAI/Anthropic provider 的 `baseURL` 必须是完整 API 前缀；本代理应传至 `/v1`，而 gateway 的 OpenAI 模型路由会在根地址场景规范化补齐 `/v1`。
- [2026-08-14] 采用 Claude Code 的工具提示词模式：每个工具独立 prompt.ts 文件，通过系统提示词构建器动态组装
- [2026-08-14] 使用 SYSTEM_PROMPT_DYNAMIC_BOUNDARY 分隔静态和动态内容，静态部分可被 LLM 缓存
- [2026-08-14] 实施分层架构：agent-core（数据层）+ agent-gateway（业务层）
- [2026-09-16] **浏览器预览的调试引擎唯一采用 Playwright + CDP live view**（screencast **仅 Chromium**；console/network/DOM/a11y/computed styles/拾取/设备模拟全来自它），按**运行时能力协商**（网关与浏览器同机时才有意义）；iframe / Tauri 原生 webview 仅作**展示降级**。**否决 dev-server 同源反代**：解决不了跨域、需重写 HMR WS/绝对路径/`base`/CSP/`X-Frame-Options`、并把任意本地端口暴露成 SSRF 面。传输用 **WS + 单帧信用 ack（4s 看门狗兜底）**，SSE 仅只读低频降级。**否决把 chromium 打进安装包**（体积 140–180MB × 6 CI 矩阵；macOS 嵌套 app 需签名+公证+JIT 授权；Linux 打包**不解决** libnss3 等系统库；与 pinned playwright 版本强耦合）。
- [2026-09-16] **预览浏览器必须单实例互斥**：`BuiltInBrowser` 内部持有网关实时会话（一条 WS），全应用同一时刻只能挂载一个实例。用 `uiState.browserPreviewSurface: 'editor' | 'dock'` 标记所有权——停靠面板挂载即置 `'dock'`、卸载归还 `'editor'`，`EditorBrowserWorkspace` 据 `!browserHostedByDock` **拒绝挂载第二份**。两实例共存会各自建会话，**争抢同一 per-user 会话的 controller 选举与 ack 额度** → 画面抽搐/卡顿。
- [2026-09-16] **浏览器获取顺序**：受管目录（`PLAYWRIGHT_BROWSERS_PATH`，**外部值优先**，否则 `<数据根>/browsers`，由桌面 `lib.rs` 注入）→ 系统 Chrome → 系统 Edge → **in-app 引导安装**（调用 **Playwright 官方安装器**，不自造 CDN 下载/解压——Node/Bun 均无 zip 容器 API、`unzip` 仅 POSIX）。CLI 解析不到时诚实报 `unavailable` + 手动命令（打包成单二进制 sidecar 时预期如此）。
- [2026-09-16] **`playwright` 必须精确锁版本**（`packages/browser-automation` = `1.58.2`，对应 chromium revision **1208**）：`^` 区间一旦被 `bun update` 推到 1.62（revision 1234），本机已装的 1208 会**静默失效**、可用性翻成 outdated。另：**`bun install` 不会安装浏览器**——根 `package.json` 的 `trustedDependencies` 不含 `playwright`。
- [2026-09-16] 会话权限阶梯以 `permissionMode: 'ask'|'auto-edit'|'yolo'` 为**规范键**，布尔 `yoloMode` 降级为**派生投影**（`yoloMode === (permissionMode === 'yolo')`），使 legacy 读方 / 写方零改动；写入侧 canonicalizer 必须 patch-aware 并采用 5 级优先级（patch 规范键 > patch 布尔 > 合并后规范键 > 合并后布尔 > 保持缺席），否则 legacy 客户端 PATCH 布尔会被丢弃、session 卡在 `yolo`，形成向更不安全方向的**单向棘轮**。
- [2026-09-16] 权限阶梯的 **deny-first 不变量**：`auto-edit` / `yolo` 的免审批快捷分支只能在**通配符 allow/deny 与作用域级 allow/deny 之后**执行，故这两档仅跳过 `ask`、永不放行被显式 `deny` 的调用；唯一执行点是 `ensurePermissionForTool`（`services/agent-gateway/src/tools/tool-sandbox.ts`），category 计算须上提以便中间档测试解析后的类别。

- [2026-09-21] **不做「提供商文件引用（Files API / file_id）」通路**：上游多为第三方中转/自建，不保证实现 Files API；且该通路会把用户图片**持久化到第三方服务端**（OpenAI 默认长期保留、Anthropic 对整个 workspace 可见），与「内联 base64、请求即走」是本质不同的数据姿态。已对照 `temp/opencode`（github-v1.2.25-2014）验证：其原生协议层**零上传、零 file_id、100% 内联 base64**，且**刻意不支持公网 URL 图片**（`validateMedia` 只收 base64；session 入口 switch 只处理 `data:`/`file:`）——无 URL 抓取即无 SSRF 面。
- [2026-09-21] **opencode 媒体上行基线（可对齐目标）**：图片=data URL 内联 + 服务端缩放(5MiB/2000×2000)；文本文件=经 `read` 工具**内联正文**(2000 行/50KB/单行 2000 字符)，不是只发路径；PDF=**不抽文本**、整份 base64 交给原生支持 `pdf` 模态的模型，不支持则降级为「让模型转告用户」的文本；docx/xlsx/pptx=**明确拒绝**(binary)；能力位 `modalities.input` 含 `image`/`pdf`，自定义/openai-compatible provider **默认 image/pdf=false、text=true**。**差距在非图片文件（文本内联 / PDF 直传 / 二进制明确拒绝），不在图片引用。**

- [2026-09-21] **GUI Agent 集成：控制层保留自研 Tauri loopback 桥 + 系统命令，不采用 UI-TARS 的 nut.js 原生插件**（方案结论，待 Gate 0 批准）。理由：UI-TARS 走 `@computer-use/nut-js` → `libnut` 原生 N-API 进程内直调（macOS CGEvent / Windows SendInput / Linux XTest），OpenAWork 现有 Tauri 桥 + 系统命令（`osascript` / PowerShell / `xdotool`）在 Linux 覆盖、零第三方依赖、安全边界与可审计性上更优；且其官方桌面产物不含 Linux。落点：`apps/desktop/src-tauri/src/desktop_control_*.rs`。参考实现 `temp/UI-TARS-desktop/`（`.gitignore` 忽略）。
- [2026-09-21] **GUI Agent 移植基线取 UI-TARS 旧代 `packages/ui-tars/sdk`，不取新代 `multimodal/gui-agent/*`**（方案结论，待 Gate 0 批准）。理由：旧代自包含（依赖仅 `openai`/`jimp`/`async-retry` + 同仓 shared/action-parser），`while(true)` 循环可整体嵌入 OpenAWork 工具执行层；新代建在 `@tarko/agent` 框架上（事件流/会话/ToolCallEngine），会与 OpenAWork 自有状态机 + 网关 + SSE 体系形成双真相。仅单独抄录新代的**动作别名归一化表**（`multimodal/gui-agent/shared/src/utils/actions.ts:46-137`）。
- [2026-09-21] **GUI Agent 借鉴范围 = 动作协议 + 坐标归一化 + 视觉闭环循环三件套**（方案结论，待 Gate 0 批准）。核心可移植资产：① `action-parser`（通用 `^(\w+)\((.*)\)$` 语法解析，**无动作枚举**，词表由 prompt/operator 决定）；② 坐标数学 `0–1000 → 0–1 → 像素中心`（`DEFAULT_FACTOR=1000`、`IMAGE_FACTOR=28`、`MAX_IMAGE_LENGTH=5`、`MAX_LOOP_COUNT=100`）；③ `GUIAgent` 主循环（**移植时必须去除 `globalThis` 单例**，否则并发多任务互相覆盖）。核心障碍：模型层 `supportsVision` ≠ grounding 能力，需新增 `supportsGuiGrounding` 能力位。方案文档已归档至 `.agentdocs/workflow/done/260921-GUI-Agent集成方案.md`。
- [2026-09-21] **`computer_use` 是已占用的工具名，且已定「保客户端名、改协议层」**：`packages/opencode-llm/src/protocols/openai-responses.ts:618` 已把 OpenAI hosted `computer_call` 暴露为工具名 `computer_use`（`providerExecuted: true`，测试 `__tests__/openai-responses-hosted-tools.test.ts` 锁定）。**Gate 0 决策 6（2026-09-21）：本仓客户端工具保留 `computer_use`，把协议层 hosted 暴露名改为 `computer_use_preview`**（与 OpenAI wire 工具名一致，新任务 T-22）——避免同名两义污染工具目录、权限映射与 `providerExecuted` 结果路由。同理 **`press` 在 `desktop_automation` 已表示键盘按键**，OS 级鼠标按下/抬起应命名 `mouse_down` / `mouse_up`——新增动作前先查这两个工具的动作表（`desktop-control.ts` 的 `clickAction: down/up` 已覆盖鼠标按下/抬起，不必重复造 `press`/`release`）。
- [2026-09-22] **`tool-input-repair` 曾对 12+ 个工具静默失效**（已修）：`readWrapperInner` 不拆 `ZodEffects`（`refine`/`superRefine`/`transform`），且 `repairUnion` 见某成员 `rootKind` 与输入同为 object 就提前返回、从不递归进 discriminated union 成员。后果：`workspace-tools` / `web-tools` / `look-at` / `desktop_control` 等所有**顶层挂 refine** 的工具，其「字符串化 JSON、数字/布尔字符串」修复能力全部失效且无任何报错。修法：① `ZodEffects` 拆包注意 **zod v3 用 `_def.schema`、v4 才叫 `innerType`**（只读 `innerType` 会拿到 undefined，修复静默不生效）；② discriminated union 按判别键 `_def.discriminator` + 成员 `shape[key].value` 锁定唯一成员后再递归。**判据**：给 schema 加一个 `ZodEffects` 包装就会让整条修复链断掉，新增顶层 `refine` 的工具须回归 `tool-input-repair.test.ts`。
- [2026-09-22] **跨语言 serde 契约必须用测试锁定**：`apps/desktop/src-tauri` 的响应结构体若漏写 `#[serde(rename_all = "camelCase")]`，会序列化成 snake_case（`from_x`），而网关 `desktop-control.ts` 按 camelCase（`fromX`）读取 → **字段静默丢失、无任何报错**。既有 `ScrollResponse` 带该属性、新增的 `DragResponse` 曾漏掉。修法：在 `desktop_control_native_models.rs` 用 `serde_json::to_value` 断言 camelCase 键存在 + snake_case 键不存在（已补 5 条契约测试）。
- [2026-09-22] **GUI 坐标语义是「三段式」，跨模块必须严格对齐**：① 模型输出 **0–1000**；② `parseActionVlm` 归一化成 **0–1 比例**（`action_inputs.start_box`），同时另存绝对像素到 `start_coords`；③ operator 用 `boxToPixelCenter`/`pointToPixel` 从比例换像素。**踩坑**：把 ② 的 `start_box`（已是 0–1）当 0–1000 再换算一次 → 坐标缩小 1000 倍、点击落到左上角；`buildRawAction` 若把坐标渲染成 JSON 数组 `[0.5,0.5]`，`parseSingleAction`（按「引号外逗号」切分参数）会解析出垃圾键而取不到坐标。**修法**：数组渲染成 `'(a,b,c)'` 引号形态 + operator 优先读 `start_coords` + 退化 box 按单点处理。回归测试 `gui-runner-operator-integration.test.ts`。
- [2026-09-22] **内层调用（look_at / computer_use）的输出上限本来就跟随用户配置**：`resolveModelRouteFromProvider` 是 `mergedOverrides.maxTokens ?? request.maxTokens`，而 `buildRequestOverrides` 按 **模型级 > Provider 级** 合并 `requestOverrides.maxTokens` → 调用方传入的 `maxTokens` 只是**兜底默认值**。排查「某处硬编码 2048 是否覆盖了配置」时，先看这条合成链，别急着改代码。补充规则：模型声明的 `maxOutputTokens`（catalog 中为 65536 / 128000 / 131072）**大于 `ModelRequest.maxTokens` 的 schema 上限 16384**，把它用作请求值必须先收敛，否则 Zod 直接拒绝。
- [2026-09-22] **给被 `vi.mock` 的模块新增具名导出会让测试整体报错**：`look-at-*` 系列测试 `vi.mock('../../provider/model-router.js')` 用的是显式工厂（非 `importOriginal`），新增 `import { X } from` 会让该 mock 缺字段，报 `No "X" export is defined on the mock`。取舍：**优先用本地常量 + 测试守护数值一致性**，避免改动多个测试文件。
- [2026-09-22] **`desktop_control` 桥的 `ScreenshotResponse` 不含宽高**（仅 `success`/`mediaType`/`data`/`byteLength`/`driver`），而 GUI 归一化坐标必须换算到真实屏幕尺寸——硬编码 1920×1080 会让点击**整体偏移**。修法：网关侧从截图字节流解码（PNG 走 IHDR `readUInt32BE(16/20)`、GIF 小端、JPEG 扫 SOFn、WebP 三种块），见 `services/agent-gateway/src/tools/gui/screenshot-size.ts`；解码失败才回退兜底。
- [2026-09-22] **桌面端 `cargo check` 的三个环境陷阱**（Tauri 本仓）：① `apps/desktop/src-tauri/target/` 可能整体归 **root** 所有（遗留），非 root 用户无法写入 → 用 `CARGO_TARGET_DIR` 指向 `/tmp`；② 裸跑 `cargo check` 会因 Tauri `externalBin` 找不到 `binaries/agent-gateway-<triple>` 而失败，且 bundler 还要求配套 `.gz` —— 需先 `pnpm --filter @openAwork/agent-gateway build:binary` 再放置（该目录被 `.gitignore:15` 忽略，属构建产物）；③ 多个 cargo 进程共享 `CARGO_HOME` 时，被 `kill -9` 的进程会留下 `.package-cache` 陈旧锁，使后续进程**静默卡在 `futex_wait`**（表现为 CPU 时间不增长、target 目录不创建）→ 换独立 `CARGO_HOME` 可绕开。

- [2026-09-21] **不为 `opencode-llm` error 模块做 Effect 迁移，也不实现技能签名校验**（2026-09-21 用户确认，作为纠正记录）：前者前提不成立（已通过编译 + 38 例测试，无消费者）；后者**无信任根可锚定**——`docs/development/SKILL_DEVELOPMENT.md` 描述的 `opkg pack` / `opkg publish` / `.agentskill` 在 `packages/skill-registry/src/cli/opkg.ts` 中**根本不存在**（仅 registry/install/update/remove/search/info/list），官方源 `https://registry.openwork.ai/v1` 只是 `source.ts` 里的硬编码字符串 → 单独实现 `verifySignature()` 是安全表演。**签名流水线仅在「上线公共市场并分发可执行产物」时再立项。**
- [2026-09-21] **技能安装链路的真实短板不是签名，是「校验未接线 + 进程无约束」**（若将来加固，按此顺序，属低优先级非签名）：① `packages/skill-registry/src/security/manifest-validator.ts` 的强校验器**从未被 import、也未从 index 导出**，实际走 `installer.ts:230` 的弱校验；② 技能 manifest 可声明 `mcp:{transport:'stdio',command,args}`，`services/agent-gateway/src/skill/skill-mcp-connection-pool.ts` 会**直接 spawn 本地进程**且只剔除 npm/pnpm/yarn 变量（其余环境继承），无 OS 级隔离、无命令白名单——唯一门控是 `tools/tool-sandbox.ts` 的权限阶梯（非隔离）；③ gateway 安装路径把 `granted_permissions_json` 硬编码 `'[]'`，使「安装时展示权限并授权」模型**空转**；④ `packages/skill-registry/AGENTS.md` 宣称的「`src/security/` 强制沙箱」与代码不符（该目录仅有上述未接线的校验文件），需随加固一并修正文档。

- [2026-09-22] **子代理结果交付 = 单通道（synthetic 合成消息 + 显式唤醒）**，取代旧「伪造用户请求 + 800/1500ms 定时重试」双路径：`deliverTaskCompletion`（`services/agent-gateway/src/task/task-job-delivery.ts`）先幂等准入（`injectSyntheticSessionMessage`，`notificationId` 同时作消息 id 与唤醒请求键），再由纯函数 `resolveTaskJobWakeDecision` 决策（`resume:false` / 父会话在飞 / 父会话 paused 一律「留库待消费」而非定时重试），最后 `continueSessionFromHistory` 唤醒。**通知已落库 ⇒ 延后永不丢**（用户下一次自然发言时模型仍能看到它），这是去掉重试风暴的根本依据。
- [2026-09-22] **本仓原先不存在「不落用户轮跑一轮」的能力**：`routes/stream.ts` 的 `persistStreamUserMessage` 在非 team-resume 路径下无条件落用户轮，且 `streamRequestSchema.message` 必填（`:571`）。解法是给 `handleStreamRequest` 加 `continueFromHistory` 模式（三处守卫：跳过落用户轮 / 跳过用户消息插件事件 / 不计入「用户手动交互」）+ 独立入口 `continueSessionFromHistory()`。**默认路径逐字节不变**（回归文件数与用例数与改前一致得证）。
- [2026-09-22] **`synthetic` 消息角色契约**（对齐 opencode）：`role: 'synthetic'` 对模型**可见**（`toModelMessages` 保留，`native-message-bridge` 降级为上游 `user`），客户端**不得**按用户输入渲染；`Message.description` + `metadata = { source:'subagent', childID, agent, state }` 是客户端 notice 契约。可见性规则：非空 `description` 才成形，`failed` 即使无描述也强制可见。**读路径必须回传 `description`/`metadata`**（`v2ToV1Message` 曾漏，属静默缺陷）。

- [2026-09-22] **Web 端渲染网关注入内容时，扩「群组协议」而不是扩 `ChatMessage.role`**：`ChatMessage.role` 只有 `user|assistant` 两值且全仓有 **101 处** role 分支，扩它必然产生静默错位（非 user 即按 assistant 渲染）；而 `ChatRenderGroup` 的消费者只有渲染层约 6 处，且把 `kind` 设为**必填判别字段**后所有访问 `.entries`/`.role` 的消费者都被编译器强制窄化。落点：`apps/web/src/components/chat/message/chat-message-group-list.tsx` + `conversation-runtime/messages/subagent-notice-groups.ts`。通知按 `createdAt` **时间位置**插入消息群组之间（同时间戳排在消息之后）。

### 编码约定
- 所有提示词使用中文编写
- 提示词文件命名: `<tool-name>-prompt.ts`
- 导出常量命名: `<TOOL>_USAGE_GUIDE` 和 `<TOOL>_TOOLS_LIST`
- 遵循统一的导出规范，便于维护和扩展

### 已知陷阱
- [2026-09-22] **验收脚本里「父会话空闲」会让同步唤醒与脚本收尾竞态**：单通道交付在父会话空闲时**同步唤醒**（`deliverTaskCompletion` → `continueSessionFromHistory`），唤醒产生的**后台流**可能比脚本活得久——脚本关掉测试库后，该流 flush 运行事件时报 `Database has closed` / `Cannot use a closed database`，**断言其实已全过（日志有 `: ok`）但退出码为 1**。判定要点：先看日志里有没有 `: ok`，有则属**收尾竞态而非断言失败**。处置：与唤醒无关的脚本把父会话插入为 `state_status='paused'`（唤醒按设计「留库待消费」，通知照常注入、断言不受影响），见 `verify-task-tool-auto-run.ts` 既有手法；唤醒本身由 `verify-task-job-wake.ts` 专门验收。**不要**靠放宽断言或忽略退出码来"修"。
- [2026-09-22] **「AGENTS.md」在跨包仓库里是多份文件，按名检索必须先确认是哪一份**：根 `AGENTS.md` 之外还有 `services/agent-gateway/AGENTS.md`、`apps/web/AGENTS.md`、`apps/web/src/pages/team/AGENTS.md`、`apps/web/src/pages/team/conversation/AGENTS.md` 等。任务描述里的「更新 AGENTS.md 的 X 章节」若只 grep 根文件，会得出**「该章节不存在」的错误结论**（本会话即因此误记了一条勘误，后被指令注入的真实内容纠正）。检索用 `grep -rn "关键词" --include=AGENTS.md .` 一次覆盖全部。
- [2026-09-22] **「组件级真实浏览器验收」不需要桌面端浏览器工具——别把 Playwright 与 `browser.tabs.*` 混为一谈**：本会话曾据 `browser.tabs.list({})` 返回 `No desktop browser is connected to this session` 判定「组件级三视口验收也不可行」，**该判定是错的**：`browser.tabs.*` 依赖桌面端连接，而仓库自带 **Playwright + Chromium**（`PLAYWRIGHT_BROWSERS_PATH` 指向 `00-new-property/.playwright-browsers`，含多个 chromium 版本），可在无桌面端的情况下跑真实引擎。可复现资产见 `apps/web/harness/`（README 含运行命令），用于一切 jsdom 测不到的真实布局行为。
- [2026-09-22] **bun 对 workspace 包内的文件做严格依赖解析，且拒绝相对路径穿越 `node_modules`**：`apps/web` 不依赖 playwright 时，脚本里写裸 `import 'playwright'` 会报 `Cannot find package 'playwright' from <file>`（即使该包在别的 workspace 里存在、根 lockfile 认识它）；**相对路径指向 `../../packages/<x>/node_modules/...` 同样被拒**（`Cannot find module`），只有**绝对路径**才放行（但那不可提交）。可行解：运行时用 `NODE_PATH=<仓库相对路径>/packages/browser-automation/node_modules bun <script>`，脚本侧把裸导入放进 `try/catch` 并在 catch 里打印该命令。**推论**：harness/验收脚本不要放进「不声明该依赖」的 workspace 包内，或必须显式提供 `NODE_PATH`。
- [2026-09-22] **`white-space: nowrap` 会把元素的 `min-content` 抬到整行文本宽度**：若祖先链里出现 **row 方向 flex 且缺 `min-width: 0`**，该元素会把整条链路撑到视口之外，`text-overflow: ellipsis` **完全失效**（实测容器被撑到 955px ≫ 375px 视口）。`apps/web` 当前两端都安全（chat 端群组在 `position:absolute; left/right:0` 定位层内——绝对定位元素不是 flex 项；team 端 `SPLIT_INNER_STYLE → CONVERSATION_STREAM_STYLE`（显式 `minWidth: 0`）→ `scrollRegionStyle → contentColumnStyle` 全为 column flex），但**改布局时必须回归**——守卫用例已固化在 `apps/web/harness/notice-3viewports-entry.tsx` 的两条「真实链路」用例里。
- [2026-09-22] **bun 版本现在是单一来源 `/.bun-version`**：CI 用 `oven-sh/setup-bun@v2` 的 `bun-version-file: .bun-version`（15 处），Dockerfile 用「全局 `ARG BUN_VERSION` + 独立 `bun-runtime` stage」——**BuildKit 不支持 `COPY --from` 里的变量展开**（报 `variable expansion is not supported for --from`），必须先 `ARG BUN_VERSION=1.4.2` 再 `FROM oven/bun:${BUN_VERSION} AS bun-runtime`，然后 `COPY --from=bun-runtime`。升级 bun 要同步三处：`.bun-version`、两个 Dockerfile 的 ARG 默认值、`package.json` 的 `packageManager`（`engines.bun` 只写最低版本）。
- [2026-09-22] **bun 迁移的 5 个实测坑**：① `bun run <script>` **默认用 Node 执行脚本**（除非显式 `--bun`），不能用 `process.versions.bun` / `npm_execpath` 判断调用者——`bundle-sidecar.mjs` 曾因此把 `node run build` 当 bun 调起（正确做法：只有脚本本身跑在 bun 运行时下才复用 `process.execPath`，否则回退 `BUN_INSTALL/bin/bun` 或 PATH 上的 bun）。② `bun install --production` 对**已存在**的 node_modules 是 no-op（不裁 devDependencies）→ 裁剪必须用 **`bun prune --production`**（实测 1.7G→1.5G，better-sqlite3 绑定与 ffmpeg 二进制保留）。③ 隔离式布局下**依赖级 bin 只在包自身 `node_modules/.bin`**（如 better-sqlite3 的 `prebuild-install`）→ 手工重跑生命周期脚本必须补 PATH，否则退出码 127；已封装为 `scripts/rebuild-native-packages.mjs`（替代 `pnpm rebuild`，支持 `--arch/--platform` 跨架构）。④ `bun run --filter <pkg> <bin>` **不支持任意 bin**（只认 script 名）：`bun run --filter <pkg> vitest …` 会报 `Script "vitest" not found`，正确写法是 `bun run --filter <pkg> test <args>`（参数会透传）。⑤ Docker 只拷部分 workspace 清单时 bun 会 `note: skipped N workspaces`，但**已包含 workspace 的 workspace 依赖必须同时在磁盘上**，否则报 `depends on workspace … listed in bun.lock but not on disk`。
- [2026-09-22] **`check:fastify-alignment` 已改为解析 `bun.lock`**：JSONC 去尾逗号 + 取 `packages` 值首项 `name@version`（键是提升路径，可能形如 `@fastify/swagger/fastify-plugin`）；旧的 `^  dep@version` YAML 正则不再适用，`lint-staged` 的锁文件 glob 已改 `bun.lock`。
- [2026-09-22] **本地 `format:check` 的失败大多来自未跟踪的 `@temp/`**（vendored opencode 源码树，368 个文件）与用户未提交改动（29 个文件）；两者都不在 CI 的 checkout 里（`@temp` 未被 git 跟踪），与迁移无关。`prettier --check .` 会扫到 `@temp/`，`.prettierignore` 目前未排除它。
- [2026-09-22] **两处迁移前既有缺陷已顺带修掉**：① 根 `lint:rules` 指向不存在的 `scripts/eslint-rules/no-cross-layer-runner.test.mjs`（实际文件名带 `-import`）→ 根 `bun run lint` 必然失败（CI 只跑各包 lint，故一直未暴露）；② `apps/web/Dockerfile` 缺 `apps/desktop` 源码与根 `scripts/`（`AboutPage.tsx` 直接引用 desktop、`vite.config.ts` 引用 `scripts/build/*.mjs`）→ web 镜像本来无法构建。
- [2026-09-16] **根 `lint` 的 `&&` 链会掩盖后续阶段的错误**：根 `lint:eslint` 是 `eslint packages && eslint services && eslint apps/mobile && eslint apps/desktop && eslint scripts eslint.config.js` —— **`packages` 里任何一个错误都会让 `services` 及其后从未被检查**（表现为「lint 只报 1 个错误」，修掉后突然冒出十几个）。**判断 lint 真实状态时不要只跑 `bun run lint`**：应分别对 `packages` / `services` / `apps/mobile` / `apps/desktop` 各跑一次，或直接把路径合成**一次** eslint 调用（`eslint packages services apps/mobile apps/desktop scripts eslint.config.js`，保留非零退出码）。**切勿改成 `;` 分隔**——那会让最后一个命令的退出码决定成败，等于让 lint 静默通过。
- [2026-09-16] **`eslint --fix` 的 `no-unnecessary-type-assertion` 可能移除 tsc 需要的断言**：在「上下文推断依赖该断言」的代码里（如 `const body = res.json() as T` 之后用 `body.items.map((x) => …)`），规则判定「断言不改变类型」而删除它，随之回调参数失去上下文类型 → **`tsc` 报 TS7006 隐式 any**（lint 绿、typecheck 红）。修法不是把断言加回去，而是**给变量显式类型标注**（`const body: T = res.json()`）——同时满足 lint 与 tsc。另注：若被改的那一行属于**未提交的新增块**，`git diff` 只会显示为 `+` 行，**看不出断言被删**，容易误判为「非我所改」。
- [2026-09-16] **`apps/web` 的 spacing token 命名是「索引 × 4px」，不是像素值**：`--spacing-12` 的值是 **48px**（定义在 `apps/web/src/styles/layout-tokens.css`），而 **`--spacing-48` 并不存在**。按名字猜值会写出**未定义 token** → 声明被浏览器丢弃、静默失效（与 `--text-1` 同一类）。**用任何 CSS 变量前先 grep 它的定义**。同理 `--spacing-3`=12px、`--spacing-4`=16px、`--spacing-5`=20px。
- [2026-09-16] **jsdom 不做布局**：`getBoundingClientRect()` 恒为 0 → 组件测试**天然测不到**"容器高度塌陷"类缺陷。实测：停靠面板 11 个新组件测试全绿，真实浏览器里预览**完全空白**（根节点 `flex:0 1 auto` 不拉伸 → 纵向 chrome 145px 把 `flex:1` 内容区压到 0 → 引擎因"可用盒子非正"拒绝渲染）。**凡涉及布局/尺寸的行为必须用真实浏览器验证**；同时引擎侧应保证"**只要帧存在就必须画出来**"（退化盒子走显式降级分支而非渲染空白）。
- [2026-09-16] **"有画面" ≠ "画面是对的"**：`<img>` 解码出真实尺寸（`naturalWidth>0`、`complete=true`）只证明"画了一张图"，证明不了"画的是对的页面"。首轮"UI 渲染成功"的结论被 **canvas 像素采样**推翻（像素全是白屏 `rgb(255,255,255)` 而目标页是蓝色）。同理**视觉模型对截图的描述只能产生假设、不能当结论**——它报的"无状态芯片""对比度偏低"两个"缺陷"都被 DOM 断言与 canvas 逐层合成背景的**客观测量**推翻。**结论必须来自 DOM 断言 / computed style / 像素采样，不能来自观感描述。**
- [2026-09-16] **`pkill -f 'tsx src/index.ts'` 匹配不到 tsx 的真实 cmdline**（实际是 `node --require .../preflight.cjs --import .../loader.mjs src/index.ts`）→ 旧网关进程杀不掉，新代码"看似没生效"（实测被一个 21:51 启动的旧进程占着端口）。改用 `pgrep -f 'index\.ts'` 取 PID 精确 kill。另：**`pkill -f <模式>` 会匹配到执行该命令的 bash 自身**（自杀 → 工具等到超时），必要时用字符类（`index[.]ts`）规避。
- [2026-09-16] **CDP `Page.screencastFrame.sessionId` 是"会话级"而非帧级**：同一 screencast 会话内所有帧**恒定不变**，只有重新 `startScreencast` 才递增。若把它当"帧唯一标识"透传给客户端，客户端按 id 去重会**丢弃第二帧起的所有帧**（实况永久卡死首帧）。正确做法：扇出侧自行合成单调序号作为线路 id，另存真实 CDP id 供 ack 映射。
- [2026-09-16] **`.agentdocs` 会被并发会话改写**：本轮我的条目两度被另一会话写成与事实不符的结论（"T-21..T-24 已按用户指示挂起"），工作流文档也被提前归档成陈旧副本，索引条目被移出/改写。**动手归档或改记录前先复核 mtime 与勾选状态**；发现失实要**按事实回填并保留决策沿革**（注明"后续已实施"），不要静默覆盖对方，也不要让陈旧结论留在归档里。
- [2026-09-16] **移动端固定 48px 底部 tab 条会遮挡终端面板的两个状态**：`.fusion-mobile-bottom__strip`（`position: fixed`、`bottom: 0`、`height: 48px`、`z-index: 401`）会盖住落在文档流底部的 ① 收起态 rail ② **展开态的 inline 抽屉**（曾只修了 ①，② 的末 ~2 行含提示符不可见且不可点击）。修法：两者都在 `@media (max-width: 767px)` 内让出 `var(--spacing-12)`（=48px）；**不要用抬 `z-index` 的方式"修"**——那只是把缺陷转移给 tab bar。
- [2026-09-16] **nginx 的 `events{}` 上下文无法被 `conf.d/*.conf` 覆盖**：`worker_connections` / `worker_rlimit_nofile` 必须通过主配置（`/etc/nginx/nginx.conf`）下发，因此仓库需自带一份主配置并在 Dockerfile 显式 `COPY`（只 `COPY` conf.d 会静默退回镜像默认 1024）。另外：对**混合流量**前缀（既有 WS 又有普通请求）无条件下发 `Connection: "upgrade"` 会打断 upstream keepalive（实测非 WS 请求被转发成 `conn=[upgrade] upgrade=[]`）；正解是 `map $http_upgrade $connection_upgrade { default upgrade; '' ''; }` + `upstream { keepalive N }`，**空串分支必须用 `''` 而非官方 WebSocket 示例里的 `close`**（`close` 同样强制关连接、继续打断 keepalive）。
- [2026-09-16] **构建"失败但没有任何错误输出"优先怀疑 OOM**：`apps/web` 的 `build` 脚本写死 `NODE_OPTIONS=--max-old-space-size=8192`，在可用内存不足（本机 19GB、并发负载下常只剩 5–8GB）时 `vite build` 会被 OOM killer **静默杀掉**（`tsc -b` 已通过、无报错、pnpm 报 exit 1）。用更低堆上限（如 3072）可正常构建成功。另：`timeout` 切断父进程后 **`vite build` 子进程会存活并持续占数 GB**，收尾时按 PID 清理并确认无孤儿。
- [2026-09-16] **xterm 挂载容器不能带 `padding`**：FitAddon 用父元素的 `clientHeight`（**含 padding**）按行高取整，padding 会让 `.xterm-screen` 底部越界最多 ≈ padding 总量（实测 4px、行高 14px → **最后一行被切一半**；基线单 pane 也有 +1px）。修法：把视觉内缩从 xterm 的挂载容器移到它的外层（本例 `.terminal-surface` → `.terminal-root`），**零 JS 改动**；不要靠改 fit 计算绕。
- [2026-09-16] **`setPointerCapture` 会把 `click`/`dblclick` 重定向到捕获元素**：为实现拖拽而在 tab 容器上 `setPointerCapture` 后，子元素（tab label）上的单击切换 / 双击重命名处理器**永远收不到事件**（jsdom 单测不会暴露，因为 jsdom 不实现 pointer capture 的事件重定向）。修法：拖拽用 pointer 事件自行判定「是否发生位移」并在拖后抑制一次 click，而**不要**把 capture 设在承载 click 语义的元素上；**必须真机验证点击/双击**。
- [2026-09-16] **flex/block 混合下 xterm 会自持放大**：`.terminal-pane`（`flex:1 1 auto`）若成为 `display:block` 容器的**直接子元素**，`height` 退化为 `auto` → 由 xterm 的固有高度撑开，而 fit 结果又来自「上一次容器尺寸」，形成正反馈（实测 pane 374px vs 抽屉 127px，内容越过抽屉且页面不可滚动 → 底部永久不可达）。修法：给该路径补 `height:100%; min-height:0`（分屏路径因 `.terminal-split{height:100%}` 天然有确定高度，所以**只有默认单 pane 态命中**）。
- [2026-09-16] 常驻角标类浮层（如右下角 `position: fixed` 的版本徽标）的**容器**必须设 `pointer-events: none`，交互子元素（链接）再单独恢复 `auto`。只给内部 `<span>` 设 `none` **不能**让容器穿透——容器的盒模型仍参与命中测试并压住同区其他浮层（实测拦截了终端「滚动到底部」按钮的真实鼠标点击，表现为 Playwright 报 `element intercepts pointer events`）。且此类缺陷**无法**用 DOM 断言（元素存在/可见）发现，必须用 `document.elementFromPoint` + **真实鼠标点击**做命中测试。
- [2026-09-16] 「命令式刷新」与「身份重置」必须是**两个独立 effect**：把刷新用的 `reloadNonce` 放进承担身份重置的 effect 依赖里，一次普通刷新就会清空本地快照，使下游对「数量归零」敏感的 UI（终端抽屉自动收起）出现瞬时误判（D-1）。修法：身份 effect 只依赖 `[sessionId, gatewayUrl, token]` 并保留逐字重置；刷新效果独立消费 nonce，只用 ref 记已消费值以避免身份变化时重复拉取。
- [2026-09-15] 祖先带 `contain: content` / `contain: layout style` 时，`position: fixed` 的**包含块会从视口变成该祖先** → 浮层位置与按 `window.innerWidth` 的边界夹取同时失准（实测右键菜单右移 353px 并溢出视口 57px）。修法：用 `createPortal(menu, document.body)` 让 `fixed` 重新相对视口。
- [2026-09-15] xterm 的 `rightClickHandler` 会移动 helper textarea 并 focus，浏览器随之对终端滚动容器触发一次 `scroll`；全局捕获期 `scroll` 监听若把它当作「用户滚动」，刚弹出的右键菜单会在 ~5ms 内被关掉（用户只见一闪）。修法：打开后加短静默窗口（用 `useState(() => performance.now())` 只取一次，写在 effect 里会随重渲染不断续期）。
- [2026-09-15] SSE 增量流通道必须**先订阅事件、再写出 snapshot**，并把 snapshot 写出前到达的事件按到达序缓冲、snapshot 上线后按序 flush（保持「snapshot 第一个上线」不变式）：D3 的增量 `seq` 语义不像旧的累积 tail 那样能自愈，落在「订阅 ↔ snapshot」间隙的事件会**永久丢失**（表现：终端渲染缺一段，高吞吐时必现）。前端以 `seq <= lastSeq` 去重，天然兼容这层缓冲。参考 `routes/session-terminals.ts:464-501`。
- [2026-09-15] 澄清链路确认题必须用保留 `nodeId: __grill_confirm__`。`applyAnswer` 只认字面量 `confirmed` 或该节点 `recommended: true` 的标签，所以**不能原样采纳模型给的确认选项**：必须用 `isConfirmAffirmative`（agent-core）把 `recommended` 归位到肯定文案选项上，整题无肯定文案则保留引擎默认选项——否则漏标 recommended 会把"确认"静默判成"驳回"（`confirmedAt` 不落库、自动切换失效），而把 recommended 标在"需修改"上会让驳回被当成确认。确认轮只带确认题（无新决策节点）也是合法轮次，不能在 `updateSessionClarificationState` 里提前返回。
- [2026-09-15] 对话模式的工具面必须按**本轮有效模式**收敛（`filterEnabledGatewayToolsForDialogueMode`，live 路径在 `stream.ts`、恢复路径在 `stream-runtime.ts`），不能只按会话元数据过滤：澄清完成会在回复响应前把元数据切成 `coding`，而恢复中的那一轮沿用原始请求模式（`clarify`）——只按元数据过滤会让澄清轮拿到写/执行工具（提示词与工具面错配）。另注意团队 reception 的 `dialogueMode` 默认就是 `clarify`（`DEFAULT_DIALOGUE_MODE_BY_ROLE_LAYER`）。
- [2026-09-15] **命令式 `reload()` 不得复用「身份重置」的 effect**：把一个 effect 同时用于「会话切换必须清空本地快照」与「`reloadNonce` 触发重新拉取」时，自增 nonce 会连带清空快照，使依赖快照计数的下游出现一次**瞬时 0**；`TerminalPanel` 的「运行中数量 >0 → 0 即收起抽屉」这类规则会把瞬时 0 当成真值 → 建第 2 个终端时整个抽屉自动折叠（D-1）。修法：身份 effect 只依赖 `[sessionId, gatewayUrl, token]` 承担清空，另建一个消费 nonce 的 effect（用 ref 记录已处理的 nonce，避免首次挂载与身份变更重复触发）只做 `runSync`。通用教训：**任何「由计数/集合推导的 UI 状态机」都不能容忍上游的虚假瞬时空值**。
- [2026-09-15] 固定在浮层上的「滚动即关闭」监听会被 xterm 自己触发：xterm 的 `rightClickHandler` 会把 helper textarea 移到鼠标下并 focus，浏览器随之对终端的可滚动容器触发一次 `scroll`；若菜单/浮层在 `window` 捕获期监听 `scroll` 立刻关闭，菜单会在弹出后 ~5ms 被自己关掉（表现为「右键菜单只闪一下」）。修法：打开后的 ~200ms 静默窗口内忽略 scroll，且挂载时刻要用 `useState(() => performance.now())` 只取一次（写在 effect 里会随父级重渲染不断续期）。
- [2026-09-15] **CSS `contain` 会改变 `position: fixed` 的包含块**：宿主链上任何 `contain: content / layout / paint` 的祖先都会让 fixed 后代相对该祖先而非视口定位，于是「JS 按 `window.innerWidth` 夹取 + fixed 定位」会同时失准（实测菜单右移 353px、溢出视口 57px）。修法：把浮层用 `createPortal(node, document.body)` 挂到 body，使 fixed 重新相对视口；纯 CSS 夹取无法同时覆盖两种包含块。
- [2026-09-15] 终端降级路径的能力边界：`resizeTerminal` 在管道后端（Node dev/CLI 与 Windows）**不产生 SIGWINCH**（`TerminalProcess.resize` 返回 `false`，`detectTerminalBackend().supportsResize === false`），`{ ok: true }` 仅代表「请求已被接受」。前端尺寸同步不得把 resize 成功当作重排生效的承诺；交互式 TUI（vim/top）只在 Bun 运行时可用。
- [2026-09-15] 终端 stdin 通道决策：`/sessions/:id/terminals/:tid/stdin` **没有任何路由级限流**（网关限流只覆盖登录、workspace 文件检索、team-phase-a force-apply），故 16ms HTTP 批合并已足够收口，**不引入 WS 双向**。若未来改 WS，必须同时补齐 WS 上的 JWT 鉴权、重连重放与背压/信用窗口，并重新定义与 SSE 的职责边界（当前二者会争抢同一份输出的单一事实来源）。
- [2026-09-06] 不要给正常 Provider 请求设置固定工具字符总预算或统一单结果截断；这会把稳定前缀加工具预算压成约 50K 天花板。工具结果应按最近 40K token 保护区和旧结果 20K 回收门槛持久化剪枝，完整压缩按最终 `system + messages + tools` 请求估算。
- [2026-09-06] Chat parts 顺序不能通过“本地位置按 ID 替换”或随机 UUID + `ORDER BY id` 合并；完整快照负责补齐缺失顺序，终态快照只更新已知 part 数据，跨消息工具不得通过隐藏消息改变时间位置。
- `effect@4.0.0-beta.83` 下 `Stream.async`、旧 `Runtime.runPromise/defaultRuntime` 等 API 漂移会使 gateway 启动/类型检查失败；必须按实际 beta API 逐项迁移，不可仅凭包级测试宣称全局通过。
- Responses `store:false` 回放失败时，先检查真实第二轮 wire body 是否包含 `type=reasoning`、`id`、`encrypted_content`；单元测试中的手工 native message 不能替代完整 gateway verifier。
- 全包测试 353/393 通过仍不代表迁移完成；需同时验证 gateway typecheck/build、完整 verification matrix、真实 `/health`/`/metrics` 和部署回滚。
- Vitest fake-timer 重试测试必须在推进 timers 前注册预期 rejection observer；否则会把中间态 rejection 误报为 unhandled error，或让最终拒绝断言悬空。
- 真实 provider、隔离部署、LLM 负载和回滚不能由本地 synthetic HTTP fixture 代替；缺少凭据时必须保留为 human/external gate，并把 exact SHA 与文件 hash 作为回滚锚点。
- 提示词过长会影响性能 → 使用动态边界分隔静态和动态内容
- 工具提示词需要定期更新 → 每次工具更新时同步更新提示词
- tool-sections.ts 需要手动添加新工具 → 未来可考虑自动发现机制
- [2026-09-16] 会话元数据快照漏字段会让 PATCH **静默跳过**：`createSessionMetadataSnapshot`（`apps/web/src/pages/chat-page/conversation/render/chat-page-utils.ts`）只跟踪布尔 `yoloMode` 时，`ask → auto-edit` 产生完全相同的快照 → dirty 检查短路、中间档永不落库；快照必须纳入 `permissionMode`。
- [2026-09-16] 权限浮层的两个视觉定位坑 → ① flip-up 曾用 composer shell 顶边当锚点（把 *limit* 误当 *anchor*），菜单飘到触发按钮上方很远处，锚点必须取**触发按钮**；② 桌面 dev/e2e harness 未引入 web token 样式表 → `var(--token)` 解析为 unset（背景 / 描边不可见、焦点框退回 UA 默认），截图曾导致评审误判真伪。
- [2026-09-16] 桌面 e2e 冷启动会把 Vite 按需编译算进首个用例 → 偶发超时；修法是把冷编译移入 `beforeAll` 预热。残留：高并发负载下（例如并行跑全仓 typecheck）Chromium 渲染器可能报 `Protocol error: Page crashed`，勿与重活并发跑该 spec。

- [2026-09-21] **`opencode-llm` 的性能计时断言在高并发下必然假失败**：`packages/opencode-llm/src/stream/__tests__/integration.test.ts:227`（1000 事件 <1000ms）单独复跑 3/3 通过、`vitest run --no-file-parallelism` 全量 495/495 通过，但与其他测试文件并行时测出 1087ms / 2923ms 而失败。**判断该包改动是否引入回归必须串行复跑**，不要据并行失败下结论。
- [2026-09-21] **网关消费 `@openAwork/opencode-llm` 的 `dist/` 而非 `src`**：`services/agent-gateway/tsconfig.json` 里没有该包的 `paths` 别名，只有 `tsconfig.build.json` 指向 `dist/index.d.ts`，运行时经 `workspace:*` → 包 `exports` → `dist/`。因此改完 `packages/opencode-llm/src` 必须 `pnpm --filter @openAwork/opencode-llm build`，否则网关与 dev 仍用旧产物，表现为「改了没生效」。

- [2026-09-22] **`apps/web` 的 vitest 把 `@openAwork/shared-ui` 整体别名到测试 mock**（`apps/web/vitest.config.ts:16-17` → `src/test/mocks/shared-ui.tsx`）→ 需要被 Web 测试覆盖的**纯逻辑绝不能放 `shared-ui`**（会得到 `xxx is not a function`）。正确落点是 `packages/shared`（该包已有 `parseAssistantTraceContent` 等同类纯函数先例，且三端都能复用）。
- [2026-09-22] **`packages/shared` 的包入口指向 `dist/`，而 CI 的 test job 只构建 `opencode-llm`**（`.github/workflows/ci.yml:80/111/134`）→ 消费方（如 `apps/mobile`）的纯逻辑测试若直接 import 会绑定构建顺序。解法：在消费方 vitest 配置里 alias 到 `packages/shared/src`（见 `apps/mobile/vitest.config.ts`）。
- [2026-09-22] **TS `interface` 没有隐式索引签名**：把 interface 类型的值赋给 `Record<string, unknown>` 会报「Index signature for type 'string' is missing」→ 改为 **type alias** 即可（type alias 允许隐式索引签名）。
- [2026-09-22] **zod 上链 `.transform()` 会让 schema 变 `ZodEffects`**，既有测试里的 `inputSchema.shape` / `inputSchema._def.schema.shape` 解包随之失效（typecheck TS2339）。修法是逐层解包并**在层数变化时显式抛错**，不要让解包失败静默返回空串。
- [2026-09-22] **内部请求键守卫有两个真实盲区（均已修）**：① `verify-team-turn-rollback-internal-keys.ts` 的 `SCAN_DIRS` 原先不含 `task/`——新前缀放进 `task/` 不会被发现；② 常量式前缀正则 `PREFIX\w*\s*=\s*'([a-z][a-z0-9_-]*)` **漏掉分隔符**，使 `task-parent-decision` 被扫成不带冒号、与注册表带冒号前缀的 `startsWith` 覆盖判定**永远不匹配**（即该守卫对常量式前缀一直失效）。**新增请求键前缀必须登记 `GATEWAY_INTERNAL_REQUEST_KEY_SHAPES`**；该守卫由 `test:turn-rollback` 间接执行，单独 `verify -- <该文件>` 是空跑（它只导出函数）。
- [2026-09-22] **验收脚本的「全局请求计数」断言会在行为变更时假失败**：`verify-task-tool-auto-run.ts` 用 `fetchCalls` 全局下标断言子侧行为；父侧一旦从「800ms 防抖」变为「同步唤醒」，新增的一次父侧上游请求不仅打破计数断言，还会让后续 `fetchCalls[2..5]` 读到**错位的 body**。处置原则：让被隔离的一侧进入非活跃状态（父会话置 `paused` 使唤醒按设计延后），并**补齐新契约的显式断言**，而不是放宽阈值。
- [2026-09-22] **`check:fastify-alignment` 的判定机制与一次真实修复**：脚本以 `services/agent-gateway/package.json` 为**唯一 canonical**，要求所有 workspace 包在 4 个依赖段里对 6 个依赖（fastify / fastify-plugin / @fastify/jwt / @fastify/swagger / @fastify/swagger-ui / @fastify/websocket）**字符串完全相等**，并要求 lockfile 唯一解析（fastify-plugin 除外）。曾因 `packages/logger` 的 peer `^5.11.3` 与 lockfile 的 `5.12.5` 不一致而红（触发源是工作树中其他工作的依赖 bump）；已修为 `^5.12.5` + lockfile 收敛。**任何改动 `package.json` 后都应先跑这条检查**；修 lockfile 时要做对照实验剔除无关 churn。

- [2026-09-22] **`vi.fn(impl)` 的推断类型由「初始实现」决定**：只在 `mockImplementation` 覆盖里出现的返回形状会让该覆盖报 **TS2345**（`Argument of type … is not assignable to parameter of type …`）。**正确修法是给初始实现加显式返回类型标注**（覆盖全部形状）——**不要**给初始实现加一个分支，那会改变其它用例的运行时行为（实测会打挂一个「插件未启用」用例）。
- [2026-09-22] **同一文件的多个 `edit` 不要放在同一个并行块里提交**：第二个 edit 会因第一个已改变文件内容而报「Could not find oldString」（或命中数变化）。**同文件编辑必须串行**；不同文件可以并行。

- [2026-09-22] **`legacy-tool-name-rewrite` 表只放「注册表已不认识、必须改名才能派发」的名字**：把仍是**运行期别名**的名字（如子代理工具的 `task`）放进去会改写 `incomingRequest.toolName`、改变沙箱派发路径，使工具**静默不执行**——实测 `task` 子会话不再创建（3 例权限继承单测 + `verify-task-tool-no-permission` 失败，而 typecheck 与其它单测全绿）。别名应交给运行期谓词（`isTaskToolName()`）判定，启用门禁侧的归一（`routes/tool-name-compat.ts`）只影响 enablement 检查、不影响派发。
- [2026-09-22] **删除生产者时必须同步清理消费方的断言**：移除 `assistant_event` 完成提醒（改为 synthetic 通知）后，3 个验收脚本的「父会话应持久化可见完成提醒」断言立刻陈旧并失败。改动生产者的同一批必须扫一遍 `verification/` 与 `__tests__/` 里断言该产物的位置。

- [2026-09-22] **删除表/模块前必须按「原始 SQL」而不只是 import 找消费方**：T-31 初版删掉 `task_parent_auto_resume_contexts` 表与唯一写入方时，唯一消费方 `task/task-parent-auto-decision.ts` 是**直接用 SQL 读该表**（`FROM task_parent_auto_resume_contexts`），既没有 import 也没有类型引用——只 grep 模块名会漏掉，结果是**自动决策路径静默退化**（读不到父上下文）。删除前必须：① grep 表名；② grep 模块名；③ grep 被删函数名；三者都清才算安全。

### 全局重要记忆
- [2026-09-16] **agentdocs 归档必须「移动 + index 同步」成对完成**：只 `mv` 到 `done/` 而不改 `index.md`，会产生悬空链接与幽灵条目（实测 index 仅登记 8/83，另发现 1 个幽灵方案 + 10 个悬空 runtime 链接）。`runtime/` 属临时目录（`.gitignore`），归档后应按 cleanup-policy 清理；**清理保护规则**：活跃方案对应目录、`index.md` 引用目录、近 60 分钟被改动目录（并发会话）、大体积/备份/演示类，一律保留。
- [2026-09-16] 归档审计期间实证并发写入：另一会话正实时归档 `260916-终端面板-vscode布局对齐` 并改写本文件 → 对本文件必须「最后读、唯一字符串锚点替换、改完复验」，**不得整文件覆写**。
- [2026-09-15] **本仓可能同时有多个 Agent 会话并行写入**：实测存在 3 个长驻 `opencode` 进程 + 既有 `gateway dev`(tsx watch) + `vite --port 5199`，且 `apps/web`（`BrowserConsolePanel.tsx` / `NetworkWaterfall.tsx` / `BuiltInBrowser.tsx` 等）在实施期间被并发修改。因此：① 动手前先做并发探测（`ps` 看进程 + `find -mmin` 看改动）并避开争用文件域；② 绝不 `pkill`/`killall`，只按 PID 结束自己启动的进程；③ 严禁任何 git 回滚类指令，也不得"整理"无关的工作树修改。
- Claude Code 源码位置: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 系统提示词构建参考: `src/constants/prompts.ts`
- 工具提示词参考: `src/tools/*/prompt.ts`
- 提示词总代码量: 2,785 行（截至 2026-08-14）

---

## 相关资源

### 外部参考
- Claude Code 源码库: `E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src`
- 项目 CLAUDE.md: `E:\01.Projects\OpenAWork\CLAUDE.md`
- Claude Prompt Caching 文档

### 内部文档
- 提交规范: `docs/commit-convention.md`
- 设计规范: `packages/shared-ui/DESIGN-TOKENS.md`
- 工具提示词 README: `packages/agent-core/src/tools/prompts/README.md`

---

## 使用说明

本目录用于 OpenAWork 项目的 Agent 工作流管理和知识积累。

### 目录结构
```
.agentdocs/
├── index.md              # 本文件：知识入口
├── workflow/             # 任务规划（持久化，提交到 git）
│   ├── done/             # 已完成任务归档（唯一归档位；根目录不再保留方案）
│   │   └── 260814-tool-prompt-system.md
│   └── [活跃任务].md     # 仅"进行中"方案可留此；归档一律移入 done/
└── runtime/              # 执行协调（临时，.gitignore）
    └── 260814-tool-prompt-system/
        ├── master_plan.md
        ├── agent_tasks/   # 5个开发者的详细任务
        └── results/       # 实施报告和质量报告
```

### Git 配置
请确保 `.gitignore` 包含：
```
.agentdocs/runtime/
```

### 更新记录
- 2026-08-14: 完成工具提示词系统核心实施，归档到 done/
- 2026-08-14: 创建工具提示词系统优化任务，完成详细规划
- 2026-09-16: **归档审计**——补归档 8 个已完成方案（→ `done/`，累计 83）、补齐 index 登记、删除幽灵条目 `260814-migrate-opencode-llm-library`、修复全部悬空链接、清理 53 个 runtime 残留目录（62 → 9）
- 2026-09-16: **批量归档（用户决定）**——`workflow/` 根目录 5 个历史方案（`250109` / `250815` / `260704` / `260706` / `260814`）全部归档并**直接删除文件**；未做项统一标注「用户决定放弃」；`260704` 顺带纠正 2 项历史误标（T-W3-04 / T-W6-07 实已完成）；修复 3 处外部文档悬空引用。`workflow/` 根目录自此不再保留 .md，方案一律落 `done/`
- 2026-09-21: **纠正两处待办误判并沉淀记忆**——经实证，`opencode-llm` error 模块「Effect 4.0 迁移」与 `skill-registry` 「签名校验」**均不是待办**（详见「已知陷阱补充」2026-09-21 条）；据此在「架构决策」新增 2 条（放弃/延后签名流水线 + 记录技能安装链路的真实短板），避免后续会话据 TODO 字面量再次将其列为 P0
- 2026-09-22: **子代理对标 opencode 改造（已交付）沉淀记忆**——「架构决策」新增 4 条（单通道交付 = synthetic + 显式唤醒 / 本仓原先无「不落用户轮跑一轮」能力及解法 / synthetic 角色契约含 `description`+`metadata` 与可见性规则 / **Web 渲染注入内容时扩群组协议而非扩 `ChatMessage.role`**）；「已知陷阱」新增 9 条（web vitest mock `shared-ui`、`shared` 的 `dist` 解析与 CI 构建顺序、TS interface 无隐式索引签名、zod `.transform()` 使 `.shape` 失效、内部键守卫两处盲区、验收脚本全局计数断言假失败、`check:fastify-alignment` 判定机制、`vi.fn` 初始实现决定推断类型、同文件编辑须串行）。方案见 `workflow/done/260922-子代理对标opencode改造方案.md` + 附录 A。
- 2026-09-22: **该方案收口（T-32 + T-30 + 归档）**——① **T-32 补回自动唤醒预算**（关闭开放问题 Q3 / 风险 R-12）：T-31 删除旧计数器后唤醒路径**无任何上限**，而唤醒是事件驱动的，被唤醒的父会话若再委派后台子代理即形成**无界自激**；新增 `task/task-wake-budget.ts`（上限 10，与旧值一致），由 `deliverTaskCompletion` 在**真正要唤醒时**消费，耗尽则**只投递不唤醒**（通知已落库 ⇒ 不丢信息），`routes/stream.ts` 仅在**非网关内部请求**时重置计数。② **T-30 三视口验收以组件级真实浏览器通过**（真实 Chromium，61 断言 × 3 视口）：新建可复现资产 `apps/web/harness/`；**推翻了此前「组件级也不可行」的判定**——该判定把「需要桌面端浏览器工具」当成了必要条件，实际仓库自带 Playwright + Chromium。③ **方案归档** → `workflow/done/`，`AGENTS.md` 架构说明新增「子代理结果交付（单通道）」条目。④ **收口自查又发现 1 处真实问题（SR-11）并修**：两条验收脚本断言全过但退出码 1——同步唤醒启动的父会话后台流与脚本收尾竞态（关库后 flush 报 `Database has closed`）；已按 `verify-task-tool-auto-run` 既有隔离手法（父会话 `state_status='paused'`）修复，并沉淀为已知陷阱。**唯一未覆盖**：端到端变体（`AI_API_KEY` 为空的环境阻塞，非待办）。
