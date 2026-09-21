# team 规划失败：`planning-generation-failed`（PM1 规划中止且诊断无法关闭）

## 错误信息

team 对话中出现以下一种或多种提示：

```
规划
❌ pm1 层任务执行失败：planning-generation-failed: 项目调查返回无效 JSON：<模型原始输出摘录>
```

（**瞬时类**失败不带 `；需要用户介入` 尾注，可重试；**需人工介入类**失败会带该尾注，如下：）

```
规划
❌ pm1 层任务执行失败：planning-generation-failed: 调查证据不足：…；需要用户介入
```

```
⚠️ PM1 规划未能完成，已停止自动重试。
**原因**：…
_技术详情：planning-generation-failed: …_
```

以及会话流尾部的「错误诊断简报」条目：

```
其他异常 1 项
[PM1] planning-generation-failed: 项目调查返回无效 JSON：…；需要用户介入        [关闭]
```

用户的典型描述：「team 对话提示其他异常 1 项，然后就不动了，而且这个提示一直消不掉。」

## 问题原因

PM1 在正式规划前先跑一轮**只读项目调查**（`services/agent-gateway/src/handoff/runner/planning-investigation.ts`）：每轮要求模型只回一个 JSON 动作对象，用来决定下一个要读的文件。

1. 模型某一轮回复**不是合法 JSON**（少引号、被截断、夹带解释文字等），旧实现会立刻抛 `PlanningFailure('项目调查返回无效 JSON')`——**一次畸形输出即终态，不重试**，且非法原文被直接丢弃。
2. `PlanningFailure`（`services/agent-gateway/src/handoff/capability/planning-failure.ts`）会给消息强制追加 `；需要用户介入`，该子串命中 `services/agent-gateway/src/handoff/store/handoff-store.ts` 的 `UNRECOVERABLE_FAILED_HANDOFF_REASON_SUBSTRINGS`，于是：
   - `isRecoverableFailedHandoff()` 恒为 false → `retryFailedHandoff` 与 `team/team-runtime-remediation-policy.ts` 的自动补救**全部跳过**；
   - `handoff/runner/watcher.ts` 又把 `planning-generation-failed:` 前缀**显式排除**出 PM1→PM2 降级链，并把接待层 substate 推回 `idle`，写入「已停止自动重试」。
3. 结果：这一轮既不重试、也不降级，handoff 进入**终态 `failed`**；前端错误简报由 failed handoff 列表驱动，所以该条目会一直挂着。旧的 `cancelHandoff` 又明确拒绝 `failed`，用户当时**没有任何出口**。

结论：报错**不是**「项目本身有问题」，绝大多数情况只是**模型一次格式抖动**。

## 解决方案

### 1. 直接消除这条诊断（推荐，无需重启）

在对话流的「错误诊断简报」里展开「其他异常」，点该条目右侧的 **关闭**：

- 只对**不可自动恢复**的失败开放（`需要用户介入` 类），不会抢走自动重试；
- 关闭只是把该 handoff 从 `failed` 收敛为 `cancelled`，**不删除任何审计行**，`failure_reason` 与 `completed_at` 原样保留（见 `docs/architecture/adr-turn-rollback-hard-delete.md` 的「附」节）；
- 同一分组失败项超过 5 条时，折叠行会出现 **关闭其余 N 项** 批量入口（可关闭项会被优先排到前 5 条）；
- classic 工作台（经典布局）的失败卡上也有 **关闭**；
- 找**不到**关闭按钮时说明：该失败**仍可重试**（原因层面可恢复，且失败重试预算 `failed_retry_count` 未耗尽 —— 此时应改用「一键重试」），或它是 `executor`/`reviewer` 失败且 PM2 正在裁决（等 PM2 出结论后会转成可关闭 / 可在评审里处置）。

### 2. 继续推进这一轮

**瞬时类失败可以直接重试**：若接待层提示「PM1 规划遇到可重试的瞬时失败」，说明这轮失败被判定为**可恢复**（模型输出形状畸形 / 未交付完整正文），点击「一键重试」即可让 PM1 重新规划。重试预算为 **3 次**（`MAX_FAILED_HANDOFF_RETRY_COUNT`，全生命周期计数，见 §技术细节），耗尽后该项会自动转为可「关闭」。

**需人工介入类失败**：关闭只清诊断，**不会复活这一轮**。请按会话里的提示**重新发送该需求**，接待层会重新派发 PM1。

### 3. 降低复发率

- 换一个指令跟随更好的模型（`AI_DEFAULT_MODEL`，或会话内的模型选择）。
- 减小项目调查的噪声：工作区里避免超大 / 无关目录。调查本身有读取守卫（跳过点文件与 `.pem`/`.key`/`credentials`/`secrets`，单文件最多读 8000 字节）。
- 先看**原文证据**：失败消息现在带模型原始输出摘录（≤300 字符），据此判断是模型跑偏还是工作区内容异常。

## 验证修复

1. 点击 **关闭** 后，简报条目应立即消失、计数归零（`refreshWorkspaceSnapshot` 会重新水合前端 store）。
2. 若关闭失败，前端会弹 toast 说明原因（409 会带当前状态），不再静默失败。
3. 数据库侧只读确认：

```bash
sqlite3 ~/.local/share/OpenAWork/agent-gateway/openAwork.db \
  "SELECT id, state, to_role_layer, substr(failure_reason,1,80), completed_at
     FROM handoff_records WHERE state IN ('failed','cancelled')
     ORDER BY updated_at DESC LIMIT 10;"
```

关闭成功后该行 `state` 由 `failed` 变为 `cancelled`，`failure_reason` 保持原值。

## 技术细节

- 修复后，调查 JSON 解析失败会先把「上次解析错误 + 上次原文摘录」回灌给模型，要求重发合法 JSON（`JSON_REPAIR_ATTEMPTS = 2`，即最多 1 + 2 次），仍然失败才抛终态。因此同样的格式抖动现在多数会被自动纠正，不再一次即终止。
- **失败按处置分级**：`PlanningFailure(reason, disposition)` 中 `disposition: 'requires-user' | 'recoverable'`，默认 `'requires-user'`（追加 `；需要用户介入`）。四个瞬时点标为 `'recoverable'`（调查 JSON 无效 / 调查动作不符合只读协议 / 收尾协议不完整 / 模型未交付完整正文），因而**可重试**；其余仍是需人工介入的终态（其唯一出口就是「关闭」）。
- **失败重试预算**：`handoff_records.failed_retry_count` + `MAX_FAILED_HANDOFF_RETRY_COUNT = 3`，由 `retryFailedHandoff` 递增与把关，**刻意独立于 `retry_count`**（后者喂给 `nextPlanningRound` 与 PM1 自动规划返工上限，不能挪用）。作用是给「原因可恢复但实际注定失败」的派发一个**有界终点**：预算耗尽 ⇒ 不可重试 ⇒ 转为可关闭，避免无限重试持续消耗额度。
- 顺带修掉一个无限空转：`heartbeat-timeout-max-retry-exceeded` 此前未被判为不可恢复，于是「重试 → 立刻再次超时 → 再次判上限」永不收敛；现已归入不可恢复前缀，可重试性关闭且可直接「关闭」。
- 关闭判定的**唯一事实来源**是 `handoff/store/handoff-store.ts` 的 `isDismissableFailedHandoff`；运行时投影以 `dismissableFailure` 把同一判定下发给前端，前后端不各存一份规则。
- 关闭走的接口是 `POST /team/handoffs/:handoffId/dismiss`。并发下（例如该 handoff 同时被自动重试翻回 `pending`）返回 false，不会发出与实际状态不符的 `handoff.cancelled` 事件。
- 失败动作（关闭 / 一键重试）的可见性由 `canActOnRuntimeFailures` 控制——**只反映归属与权限，不含会话运行状态**，因此「团队处于 `failed`」不会再反过来把清除它的按钮隐藏掉。

## 相关文件

- `services/agent-gateway/src/handoff/runner/planning-investigation.ts`
- `services/agent-gateway/src/handoff/capability/planning-failure.ts`
- `services/agent-gateway/src/handoff/store/handoff-store.ts`
- `services/agent-gateway/src/handoff/runner/watcher.ts`
- `services/agent-gateway/src/routes/team-handoffs.ts`
- `apps/web/src/pages/team/runtime/shell/controls/ErrorDiagnosticsPanel.tsx`
- `docs/architecture/adr-turn-rollback-hard-delete.md`（dismiss 语义登记）
- `docs/architecture/team-architecture-l1-3-streaming-handoff-spec.md`（状态机 `failed → cancelled`）
