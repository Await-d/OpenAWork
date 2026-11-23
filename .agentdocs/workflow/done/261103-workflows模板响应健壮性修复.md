# 261103-workflows 模板响应健壮性修复（无校验强转 → 契约不符降级）

> 状态：✅ **已完成并归档**（2026-11-03）。触发：收口清扫时把「`/workflows` 在 mock 环境下整页崩溃」从「已登记的环境限制」翻案重查 —— **它其实是真实缺陷**。

## Task Overview

此前在无障碍专项的真机走查里发现 `/workflows` 整页落进错误边界，当时按「mock 网关未提供 workflow 接口」记为走查环境限制。本轮用 `agent-browser errors` / `console` 抓到真实异常后定位到**取数边界的无校验强转**：

```
TypeError: templates.find is not a function
  at use-workflow-studio.ts:101  →  templates.find((t) => t.id === selectedTemplateId)
  ←  packages/web-client/src/infra/workflows.ts:423
     templates: (await response.json()) as WorkflowTemplateRecord[]
```

`packages/web-client/src/infra/workflows.ts` 把响应体**直接 `as` 成数组**塞进类型化状态。一旦响应不是数组（空对象、错误包装、中间层截断），坏数据进入页面状态 → `templates.find(...)` 抛 TypeError → `AppErrorBoundary` 接住 → **整页白屏**。也就是说：**不是环境问题，是「契约不符时没有降级」**。

## Complexity Assessment

| 评分信号 | 判定 | 分值 |
| --- | --- | --- |
| 原子步骤数 | 4 项（定位 / 边界修复 / 回归测试 / 真机复验） | **+1** |
| 并行独立流 | 无 | 0 |
| 涉及 3+ 模块 | web-client 源码 + 其 dist + apps/web 消费页 | **+1** |
| 任一步骤 >5 min | 定位真实异常 + dist 重建与复验 | **+1** |
| 结果需持久化供审阅 | 是（截图 + 报告） | 0 |
| **合计** | | **+3** |

**Chosen mode**：`Lightweight orchestration`（workflow 文档 + 索引登记 + 截图证据，不建执行状态表）。

## 实施

| 项 | 内容 |
| --- | --- |
| 修复点 | `packages/web-client/src/infra/workflows.ts` 的 `listTemplatesResult`：读响应后先 `Array.isArray(payload)` 校验 |
| 降级策略 | 非数组 → `{ ok: false, retryable: true, errorMessage: '工作流模板响应格式异常（预期数组）。', status, templates: [] }` |
| 为什么**不**静默返回空列表 | 静默空列表会把「网关契约坏了」伪装成「你还没有模板」，用户与排查者都看不到线索；返回结构化失败后页面显示错误条（hook 本来就有 `runWorkflowActionOnce` 的 catch 路径），问题可见且不崩页 |
| 测试 | `workflows.test.ts` 新增回归用例：非数组响应 → `ok:false` + `retryable:true` + 该文案 + `templates:[]`，且 `listTemplates()` 走拒绝路径 |
| dist | web-client 是**共享客户端**（mobile/desktop 也消费），已重建 `dist` 并确认其中含 `Array.isArray` 校验（dev 侧 `apps/web` 的 vite 是 alias 到 src，故 HMR 即时生效） |

## 验证证据

| 项 | 结果 |
| --- | --- |
| 真机（修复前） | `console` 抓到 `templates.find is not a function` → `AppErrorBoundary`；页面只剩「界面渲染出错」 |
| 真机（修复后，mock 网关同条件） | `errorBoundary=false`、`main=1`、`h1=1`、标题「工作流工作台」、模板错误条出现、`agent-browser errors` **为空** |
| 截图 | `runtime/261103-workflows模板响应健壮性修复/evidence/workflows-degraded.png` |
| web-client 测试 | ✅ **55 文件 / 481 用例** 全绿（含新增回归用例） |
| web-client build | ✅ exit 0 |
| apps/web `tsc --noEmit` | ✅ `pages/workflows` / `infra/workflows` 范围 0 错 |
| `eslint`（改动文件） | ✅ exit 0 |

## 同类模式盘点（**未修，留待专项**）

扫描 `packages/web-client/src` 发现同类「对响应体做无校验 `as` 强转」共 8 处：

```
session/agents.ts:136          as { agents?: ManagedAgentRecord[] }        （带 ? 且下游多有 ?? []，风险低）
session/commands.ts:131        as { commands?: CommandDescriptor[] }        （同上）
session/capabilities.ts:167    as { capabilities?: CapabilityDescriptor[] } （同上）
team/team-phase-a.ts:690       as { templates: ConstitutionTemplate[] }
team/team-phase-a.ts:920       as { layers: LayerCapabilitySummary[] }
team/team-workflows.ts:207     as { workflows?: TeamWorkflowWithDbId[] }    （同上）
team/team-handoffs.ts:387      as { handoffs?: HandoffRecord[] }            （同上）
team/team.ts:1094              workspaces: (await response.json()) as TeamWorkspaceSummary[]   ← 与本次同形态，风险最高
```

**为什么不顺手全改**：只有 workflows 这一处有「崩页」实证；其余要么下游已 `?? []` 兜底，要么缺「能被构造出非数组响应」的证据。跨 4 个域改 8 处、每处都要配测试与真机复验，属于独立专项。**建议**：下次做「网关响应契约校验」专项时，用同一手法（`Array.isArray` + 结构化失败）统一处理，并从 `team.ts:1094` 开始。

## 沉淀

- **对网络响应只用 `as T` 是隐藏炸弹**：TS 的断言不会校验运行时形状，而类型化 state 一旦收到坏形状，崩点是**下游任意一个数组方法**，报错栈指向使用处而不是取数处（本次栈顶是 `find`，根因在 423 行）。
- **判定「环境限制」前必须先抓真实异常**：上一轮把它归因为「mock 未提供接口」，实际是「契约不符未降级」。`agent-browser console` / `errors` 一行就能看到 `templates.find is not a function` —— 归因前先取证，否则会把真实缺陷写进「遗留」后永久尘封。

## 遗留

- 无（本次范围内）。同类强转 8 处见上表，建议单独立项。
- 之前那条「`/workflows` 在 mock 下崩溃属走查环境限制」的旧结论**已作废**（见 `workflow/done/261103-应用级无障碍专项.md` 同处更新）。
