# 会话权限决策审计读取接口契约

`GET /sessions/:sessionId/permissions/decisions`

读取指定会话的**权限决策审计流水**（`permission_decision_logs` 表）。该表此前只有写入侧
（人工作出的审批决定 + 权限阶梯自动决定），本接口是配套的只读读侧。

- 实现：`services/agent-gateway/src/routes/permissions.ts`（`permissionsRoutes` 内）
- 数据访问：`services/agent-gateway/src/session/permission-decision-log-store.ts` 的
  `listPermissionDecisionLogs`（该表的 SQL 归它所有）
- 表结构：`services/agent-gateway/src/infra/db.ts`

## 鉴权

- 必须通过 `requireAuth`：请求头 `Authorization: Bearer <JWT>`。
- **无 token / token 无效 → `401`**（由认证插件统一处理）。

## 归属与 404 语义

表中的行**没有 `user_id` 列**，归属只能经 `sessions.user_id` 判定（`ownsSession`：
`SELECT id FROM sessions WHERE id = ? AND user_id = ?`）。

- 会话不存在 → `404 {"error":"目标会话不存在。"}`
- 会话存在但**不属于当前用户** → `404`，**同一文案、同一响应体**
- 其余任何情况都不会返回 `404`；会话存在但没有决策行时返回 `200` 与空数组

不存在的会话与越权会话的响应**逐字节相同**，调用方无法据此判断会话是否存在；越权请求
的响应体里不出现任何决策行（不含 `requestId` / `toolName` / `scope` 等字段）。

## 查询参数

| 参数       | 类型 | 默认 | 上限  | 说明                                                           |
| ---------- | ---- | ---- | ----- | -------------------------------------------------------------- |
| `limit`    | 数字 | `50` | `200` | 本页最多返回行数                                               |
| `beforeId` | 数字 | 无   | —     | 游标：只返回 `id < beforeId` 的行（取下一页时传上一页末尾 id） |

`limit` 的解析规则：

- 缺省 / 空串 → `50`
- 非数字、非有限数、`<= 0` → 回落为 `50`（**不会**退化成全表扫描，也不会拼进 SQL）
- 大于 `200` 的值 → **截断为 `200`**（不报错）

> 上限策略选择「截断」而非「400 拒绝」：越界请求的意图明确是「要多一些」，返回最大页长
> 既不破坏分页语义，也避免调用方因一个边界值拿到整次请求失败。硬上限保证单次响应有界。

`beforeId` 的解析规则：

- 缺省 / 空串 / 非数字 → 视为无游标，返回第一页
- 合法数字 → 只返回 `id < beforeId` 的行

分页以自增主键 `id` 为唯一排序与游标依据：`created_at` 是**秒级 TEXT**
（`datetime('now')`），同秒的行无法区分先后，用 `created_at` 分页会重复或漏行。
排序固定为 `id DESC`（最新在前）。因为游标是严格 `<`，相邻两页不会重复；
最后一页返回少于 `limit` 行时即表示没有更多数据。

## 返回

`200 OK`

```json
{
  "decisions": [
    {
      "id": 1234,
      "requestId": "7f1c…",
      "sessionId": "sess-abc",
      "toolName": "bash",
      "scope": "ls -la",
      "decision": "approved",
      "reason": "user_approved",
      "workspaceRoot": "/workspace/demo",
      "createdAt": "2026-11-02 09:31:07"
    }
  ]
}
```

下划线列名统一转为 camelCase：

| 字段            | 类型             | 说明                                                                                 |
| --------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `id`            | `number`         | 自增主键，同时是分页游标                                                             |
| `requestId`     | `string`         | 审批请求 id；阶梯自动决定为 `ladder:<reason>`                                        |
| `sessionId`     | `string`         | 所属会话 id                                                                          |
| `toolName`      | `string`         | 被判定权限的工具名                                                                   |
| `scope`         | `string`         | 判定作用域（命令 / 路径等）                                                          |
| `decision`      | `string`         | 结果：`not_needed` / `approved` / `denied` / `pending`，或人工决定值                 |
| `reason`        | `string \| null` | 可枚举理由；**历史行为 `null`**（`reason` 列经 `ensureColumn` 事后新增，旧记录无值） |
| `workspaceRoot` | `string \| null` | 判定时的工作区根，未记录时为 `null`                                                  |
| `createdAt`     | `string`         | `YYYY-MM-DD HH:MM:SS`（UTC，秒级）                                                   |

`reason` 的取值词表见 `PERMISSION_DECISION_REASONS`（`user_approved` / `user_rejected` /
`rule_denied` / `rule_allowed` / `mcp_denied` / `mode_yolo` / `mode_auto_edit` /
`team_background` / `delegation_unattended` / `reception_readonly` / `channel_policy` /
`workspace_rule` / `saved_approval` / `awaiting_user` / `plugin_denied` /
`channel_no_approval`）。`null` 只会出现在历史行上，读侧原样透出 `null`，**不做**任何补全。

## 只读性

本接口**严格只读**：不写库、不触发保留期裁剪（`deleteRowsBeyondMostRecent`）、不改变
`permission_decision_logs` 的任何行。重复调用（含相同游标）结果幂等。行的删除只有两个来源，
都不在本接口内：会话删除的 `ON DELETE CASCADE`，以及写入路径按「保留最近 N 行」的定期裁剪。

## 错误响应

| 状态码 | 场景                        | 响应体                         |
| ------ | --------------------------- | ------------------------------ |
| `401`  | 未认证                      | 认证插件统一格式               |
| `404`  | 会话不存在 / 不属于当前用户 | `{"error":"目标会话不存在。"}` |

## 参考

- `docs/api/` 下其余接口契约采用同样的形态。
- 回归测试：`services/agent-gateway/src/__tests__/routes/permission-decisions-list.test.ts`
