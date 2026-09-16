# OpenAWork Agent Docs 索引

## 已完成的任务

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

### ✅ 260914-grill-clarification-enhancement - Grill 分层澄清增强方案（A 层已被 260915 方案承接）
**状态**: 已收口（归档审计补登记）
**完成日期**: 2026-09-14
**归档位置**: [workflow/done/260914-grill-clarification-enhancement.md](workflow/done/260914-grill-clarification-enhancement.md)

**成果总结**:
- ✅ 设计与开放问题已拍板（评审通过）；A 层（question 管道）实现由 `260915-澄清完成自动切换编程模式` 承接并完成，B/C 层未立项；本文档转为设计参考。

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
**状态**: ✅ 计划内全部完成并归档（2026-09-16；未勾选的 4 项系用户决定挂起，1 项为人工视觉走查）——P0a / P0b / P1（含 T-15 可停靠面板、T-16 拖拽原语、T-17 设备预设、T-18 保存自动刷新、T-19 快捷键）/ P2（T-20 瀑布+HAR、T-21 DOM·a11y 检查器、T-22 sourcemap 栈、T-23 QA）/ P3-core / T-24 均已实现并验证；仅 in-app 浏览器引导下载器按 Oracle 排序后置
> ⚠️ **记录冲突更正**：本条状态行曾被一个并发会话改写为"T-21/T-22/T-23/T-24 已按用户指示挂起（本轮不执行本方案）"，该结论**与事实不符**——四个任务均已落地并通过 `acceptance-backend` 22/22、`acceptance-ui` 8/8、`ui-inspector-verify` 13/13、`ui-stack-verify` 9/9、`ui-sourcemap-verify` 3/3 与 1092 个测试。并发写入的**探测本身是对的**（本方案前端文件域确有另一会话在改，例如 `BrowserConsolePanel.tsx`），但应对方式是"分阶段施工 + 逐一复核"，而非挂起。
**开始日期**: 2026-09-15
**归档位置**: [workflow/done/260915-浏览器预览功能增强.md](workflow/done/260915-浏览器预览功能增强.md)
**执行计划**: [runtime/260915-浏览器预览功能增强/master_plan.md](runtime/260915-浏览器预览功能增强/master_plan.md)

**目标**: 把前端内置浏览器从「能看网页」升级为「能开发调试」——拆引擎 + 一键喂 Agent（P0a）→ CDP/Playwright 实时通道（P3-core）→ 跨域元素拾取（P0b）→ 可停靠面板/响应式/自动刷新（P1）→ 网络瀑布/HAR/DOM 检查器（P2）→ 多引擎收口（P3-remainder）。

**关键架构决策**:
- 调试引擎唯一采用 **Playwright + CDP live view**（chromium），按运行时能力协商；**否决 dev-server 同源反代**（解决不了跨域、HMR/绝对路径/CSP 全需重写、扩大 SSRF 面）。
- 实时传输用 **WS**（screencast 为 ack 驱动，需双向 + 背压）；SSE 仅只读低频降级；HAR/截图走 HTTP。
- Tauri 原生 `Webview` 仅保留 view 模式——它是独立原生子窗口，**无法承载拾取 overlay / 高亮**；debug 模式统一用 CDP screencast 渲染在 DOM 内。
- 顺序纠偏：`sandbox=allow-same-origin` 不等于同源 → 跨域拾取/截图受引擎阻塞，故 **P0a 先发，P3-core 先于 P0b**。

**进度**: 17/24 任务完成（P0a ✅ + P3-core ✅ + 分发加固 ✅ + P0b ✅ 除视觉走查 + P1 可做部分 ✅ + P2 网络瀑布/HAR ✅）；另有**首次真实端到端验收**发现并修复 7 个真实缺陷（全部 ✅ 已修+验证）；T-14 视觉走查 375/768/1280 待做（开发机 chromium 环境已确认可用）

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
3. ⏸ **in-app 浏览器引导下载器**——Oracle 排序为最后一步（需自实现 CDN 下载 + 解压 + `INSTALLATION_COMPLETE` 标记）；在此之前"受管目录 → 系统 Chrome → Edge → 明确命令提示"已覆盖绝大多数场景
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
- **地雷 1**：`pnpm install` 根本不会装浏览器——根 `package.json:77-83` 的 `onlyBuiltDependencies` 不含 `playwright`。
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

### 🔵 250109-opencode-llm-full-migration - OpenCode LLM 完整迁移续作
**状态**: 分阶段完成，保留明确阻塞；未达到发布条件
**复核日期**: 2026-08-15
**工作流文档**: [workflow/250109-opencode-llm-full-migration.md](workflow/250109-opencode-llm-full-migration.md)
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

---

## 项目记忆

### 已知陷阱补充
- [2026-09-06] 实时聊天重复/Thinking 错位 → 标准 WS/SSE 只保存 `lastSeq:0`，重挂载 attach 从头 replay → Gateway 在持久化事件后附加 `clientRequestId + seq`，Web 分发前推进并持久化游标；文本内容指纹不应替代协议游标。

### 架构决策
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
- [2026-09-16] **委派子代理的执行纪律**（本轮两个代理被 30 分钟空闲超时强杀）：必须在任务里强制「每条 `bash` 加 `timeout` 前缀」「禁止 `pnpm dev`/`vite`/无 `run` 的 `vitest` 等常驻命令」「禁止跑全量套件（由协调者统一复跑）」「单命令 >6 分钟无输出即放弃并上报」。清理进程时**禁用 `pkill -f "vitest run"` 这类会匹配到自身命令行的模式**（会自杀并让工具等到超时），改用精确 PID。
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

### 编码约定
- 所有提示词使用中文编写
- 提示词文件命名: `<tool-name>-prompt.ts`
- 导出常量命名: `<TOOL>_USAGE_GUIDE` 和 `<TOOL>_TOOLS_LIST`
- 遵循统一的导出规范，便于维护和扩展

### 已知陷阱
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
│   ├── done/             # 已完成任务归档
│   │   └── 260814-tool-prompt-system.md
│   └── [活跃任务].md
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
