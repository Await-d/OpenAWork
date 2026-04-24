# Permission Flow Alignment Plan (opencode → OpenAWork)

## Architecture Constraint
opencode 是同步 Deferred 阻塞模型，OpenAWork 是异步中断+恢复模型。
以下方案均在 OpenAWork 现有异步架构内实现，不改变 stream 中断/恢复机制。

---

## P0: 高优先级（直接影响用户体验和安全）

### 1. Reject 级联 — 拒绝一个权限时级联拒绝同 session 所有 pending
**动机**: opencode reject 时会 `for (const [id, item] of pending.entries()) { if (item.info.sessionID !== existing.info.sessionID) continue; ... reject }`. 这防止用户需要逐个拒绝多个堆积的权限请求。

**实现位置**: `services/agent-gateway/src/routes/permissions.ts` — `POST /sessions/:sessionId/permissions/reply`

**改动**:
- 当 `decision === 'reject'` 时，额外查询同 session 所有 `status = 'pending'` 的请求
- 批量更新为 `rejected`，逐个发布 `permission_replied` 事件
- 前端 `ChatPage.tsx` 已能处理多个 `permission_replied` 事件，无需改动

**估计改动量**: ~20 行后端

### 2. Reject with Feedback — 拒绝时附带用户反馈文本
**动机**: opencode 的 `CorrectedError({ feedback })` 让 LLM 知道用户拒绝的原因并可调整策略。当前 OpenAWork reject 只返回固定字符串 `'权限已拒绝，工具未执行。'`

**实现位置**:
- 后端: `permissions.ts` reply 路由 — `replyPermissionSchema` 增加 `feedback?: string`
- 后端: `stream-runtime.ts` — reject 场景下将 feedback 写入 tool result
- 前端: `ChatPage.tsx` — `applyPermissionDecisionToLocalAssistantMessages` 传递 feedback
- 前端: Permission UI — 增加可选的文本输入框

**改动**:
- `replyPermissionSchema` 增加 `feedback: z.string().optional()`
- reject 时 tool output 改为 `'权限已拒绝。用户反馈: ${feedback}'`（有 feedback 时）
- 前端 `handleInlinePermissionDecision` 增加 feedback 参数
- Permission UI 增加 textarea（仅 reject 时显示，可选填写）

**估计改动量**: ~40 行后端 + ~30 行前端

### 3. Doom Loop 检测 — 同工具同参数连续 N 次时暂停
**动机**: opencode 在 processor.ts 检测同一工具同一参数连续 3 次调用，自动触发权限请求，防止 LLM 陷入无限循环。

**实现位置**: `services/agent-gateway/src/routes/stream.ts` — `executeToolCalls` 后处理

**改动**:
- 新文件: `doom-loop-detector.ts`
- 在 stream loop 中维护最近 N 次 tool call 的 `{toolName, inputHash}` 记录
- 连续 3 次 (DOOM_LOOP_THRESHOLD) 相同时，自动创建 permission_request
- 等待用户审批后继续（复用现有 permission 中断/恢复机制）

**估计改动量**: ~60 行新文件 + ~15 行 stream.ts

---

## P1: 中优先级（提升效率但不影响核心安全）

### 4. 自动审批 (Auto-Accept) — per-session / per-directory 级别
**动机**: opencode 前端有完整的自动审批系统：`permission-auto-respond.ts` 支持 per-session 和 per-directory 开关，`permission.tsx` 监听 `permission.asked` 事件并自动回复 `once`。对于频繁使用工具的高级用户，逐个审批极其低效。

**实现方案** (前端为主):
- 新文件: `apps/web/src/pages/chat-page/permission-auto-respond.ts`
  - `autoAccept: Record<string, boolean>` 存储在 localStorage
  - `acceptKey(sessionId)` / `directoryAcceptKey(workspaceRoot)` 生成 key
  - `shouldAutoRespond(permission, autoAccept, sessionId)` 判断是否自动回复
- `ChatPage.tsx`:
  - `permission_asked` 事件处理中，若 `shouldAutoRespond()` 为 true，自动调用 `permissionsClient.reply(... 'once')`
  - 新增 toggle UI（session 级别的 "自动审批" 开关）
- 可选: session lineage 继承（task 子 session 继承父 session 的自动审批设置）

**估计改动量**: ~80 行新文件 + ~40 行 ChatPage.tsx + UI 组件

### 5. Continue Loop on Deny — 拒绝后可配置是否继续对话循环
**动机**: opencode 的 `experimental.continue_loop_on_deny` 配置。当前 OpenAWork reject 后直接设 session 为 idle，LLM 无法继续。但某些场景下用户只想拒绝特定操作，LLM 应该可以换一种方式继续。

**实现位置**: `services/agent-gateway/src/routes/stream-runtime.ts`

**改动**:
- `resumeApprovedPermissionRequest` 的 reject 分支：不直接设 idle，而是将 reject 结果作为 tool_result 传回并继续 stream loop
- 需要新的恢复路径: `continueFromRejectedToolResult`
- 后端配置: 环境变量 `OPENAWORK_CONTINUE_ON_DENY=true`

**估计改动量**: ~50 行后端

---

## P2: 低优先级（增强功能，可后续迭代）

### 6. 规则引擎 — Wildcard Pattern 匹配 + allow/deny/ask 三态
**动机**: opencode 的 `config.permission` 支持细粒度规则（如 `bash: { "~/safe/*": "allow", "*": "ask" }`）。OpenAWork 当前是硬编码 `PERMISSION_GATED_TOOLS` 白名单。

**实现方案**:
- 新文件: `services/agent-gateway/src/permission-rules.ts`
  - 移植 opencode 的 `evaluate()` + wildcard matching
  - 规则来源: workspace config file (`.openawork.permissions.json` 已存在，扩展其 schema)
- `tool-sandbox.ts`: 替换 `PERMISSION_GATED_TOOLS.has(toolName)` 为 `evaluate(toolName, scope, ruleset).action`
- 支持 `deny` 动作：直接拒绝，不创建权限请求

**估计改动量**: ~100 行新文件 + ~30 行 tool-sandbox.ts

### 7. Session Lineage 自动审批继承
**动机**: opencode 的 `sessionLineage()` 沿 parent chain 查找自动审批设置，使得 task 子 session 自动继承父 session 的审批偏好。

**依赖**: P1.4 (Auto-Accept) 先实现

**实现位置**: `permission-auto-respond.ts` 中增加 parent session 查询逻辑

**估计改动量**: ~30 行

---

## 不需要调整的

| 功能 | 原因 |
|---|---|
| Deferred 同步阻塞模型 | OpenAWork 异步模型已工作良好，改为同步需重构整个 stream 架构 |
| `permanent` 决定级别 | OpenAWork 已有，优于 opencode |
| `expires_at` 超时 | OpenAWork 已有，opencode 无此功能 |
| `session` 决定级别 | OpenAWork 已有 (同 user 同 tool+scope 查已有 approved 记录) |

---

## 实施顺序建议

```
Phase A (P0): Reject 级联 → Reject Feedback → Doom Loop          ✅ 已完成
Phase B (P1): Auto-Accept → Continue on Deny                      ✅ 已完成
Phase C (P2): 规则引擎 → Session Lineage                          ✅ 已完成
```

每个 Phase 完成后跑 `tsc --noEmit` + 全量测试验证。

---

## 已完成变更清单

### P0.1: Reject 级联
- `services/agent-gateway/src/routes/permissions.ts` — reject 时查询并批量 reject 同 session 所有 pending 请求，逐个发布 `permission_replied` 事件

### P0.2: Reject with Feedback
- `services/agent-gateway/src/routes/permissions.ts` — `replyPermissionSchema` 增加 `feedback?: string`
- `services/agent-gateway/src/session-permission-events.ts` — `createPermissionRepliedEvent` 增加 `feedback` 字段
- `packages/shared/src/index.ts` — `StreamPermissionRepliedChunk` 增加 `feedback` 字段
- `packages/web-client/src/permissions.ts` — `PermissionsClient.reply` payload 增加 `feedback`
- `apps/web/src/pages/chat-page/support.ts` — `applyPermissionDecisionToLocalAssistantMessages` 增加 `feedback` 参数，reject 时输出包含用户反馈
- `apps/web/src/pages/ChatPage.tsx` — 所有 3 处调用传递 `feedback`

### P0.3: Doom Loop 检测
- `services/agent-gateway/src/doom-loop-detector.ts` — 新文件，per-session 历史记录 + `checkDoomLoop()` + `resetDoomLoopHistory()`
- `services/agent-gateway/src/routes/stream.ts` — 导入 doom loop detector，executeToolCalls 中检测连续 3 次相同调用返回错误，新用户消息时重置历史

### P1.4: Auto-Accept
- `apps/web/src/pages/chat-page/permission-auto-respond.ts` — 新文件，localStorage 管理 per-session 自动审批开关
- `apps/web/src/pages/ChatPage.tsx` — 两处 `permission_asked` 处理中，若 `isAutoAcceptEnabled` 为 true 则自动回复 `once`

### P1.5: Continue on Deny
- `services/agent-gateway/src/routes/stream-runtime.ts` — 新函数 `resumeRejectedPermissionRequest`，将 rejection 作为 tool error 传入 stream loop 继续
- `services/agent-gateway/src/routes/permissions.ts` — `OPENAWORK_CONTINUE_ON_DENY=true` 时调用 `resumeRejectedPermissionRequest`

### P2.6: 规则引擎
- `services/agent-gateway/src/permission-rules.ts` — 新文件，wildcard 匹配 + `evaluatePermissionRules()` + workspace 规则加载
- `services/agent-gateway/src/workspace-safety.ts` — 导出 `getSessionWorkspaceRoot`
- `services/agent-gateway/src/tool-sandbox.ts` — `PermissionState` 增加 `denied` kind；`ensurePermissionForTool` 集成规则引擎（allow 跳过权限、deny 直接拒绝、ask 走现有流程）；caller 增加 `denied` 处理

### P2.7: Session Lineage
- `services/agent-gateway/src/tool-sandbox.ts` — `findApprovedPermission` 扩展：当直接查询无结果时，查询 `sessions.parent_id` 获取父 session，继承父 session 的 `session` 级别审批
- 利用已有的 `parent_id` 列（V2 event-sourcing 投影已填充），无需额外 schema 变更

---

## .openawork.permissions.json 规则配置示例

```json
{
  "permanentGrants": [],
  "rules": [
    { "permission": "bash", "pattern": "ls *", "action": "allow" },
    { "permission": "bash", "pattern": "rm *", "action": "deny" },
    { "permission": "edit", "pattern": "*/node_modules/*", "action": "deny" },
    { "permission": "*", "pattern": "*", "action": "ask" }
  ]
}
```

规则按顺序评估，最后匹配的规则生效。`permission` 匹配工具名，`pattern` 匹配 scope。
