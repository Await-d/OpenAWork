# .agentdocs/workflow/260813-chat-right-panel-completion.md

## Task Overview

补全聊天页面右侧面板（`ChatRightPanel`，Classic 布局；Fusion 布局下同源数据也
供侍审查侧栏 Context tab 的 `overview`/`runtimeSummary` 使用）中多个 tab 的
未完成功能：MCP 重试连接接线遗漏、Plan 面板空状态缺失、DAG 节点点击未启用、
工具面板筛选缺数量与搜索。目标是把"组件已经支持但调用方没接上"的功能补齐，
以及补上明显缺失的空状态/交互反馈，不引入新架构、不改动 Fusion 布局结构。

## Current Analysis

审计（3 轮 subagent 调研 + 人工代码核实）确认的现状：

1. **MCP tab（`chat-right-panel.tsx:631`）**：`MCPServerList` 组件已完整实现
   "重试连接"交互（`onRetry?` prop，pending/ok/fail 三态反馈 UI），后端路由
   `POST /settings/mcp-servers/:id/retry` 与 `web-client.retryMcpServer()` 均已
   就位，`apps/web/src/pages/settings/connection/use-mcp-servers.ts` 里有可参考
   的完整实现（`onRetryMcp` 回调）。但聊天页调用组件时未传 `onRetry`，按钮整列
   不渲染。另外 `use-chat-data-loaders.ts` 拉取 `/settings/mcp-status` 时把
   `toolCount` 硬编码为 `0`，且没有传 `includeTools: true`，导致 `tools` /
   `disabledTools` / `error` 字段全部缺失，工具数徽章永远显示 "0 tools"。

2. **Plan tab（`packages/shared-ui/src/agent/PlanPanel.tsx:35`）**：
   `if (tasks.length === 0) return null;`——空任务时直接不渲染，没有统一风格的
   空状态提示，与其它面板（bookmarks/terminals 等）的空态设计不一致。该组件
   目前是纯只读展示（无 `onToggle` 等回调），`planTasks` 数据来自 agent 自身
   进度的 WS 推送（`task_update` 事件），本质是执行过程的只读时间线而非用户
   任务清单，因此本次不新增"可勾选"交互（不匹配数据语义，且需要新后端路由），
   只补空状态。

3. **viz tab（`chat-right-panel.tsx:563`）**：`AgentDAGGraph` 组件已支持
   `onNodeClick?: (nodeId: string) => void`（点击节点矩形上叠加的透明按钮触发），
   但调用处未传该 prop，节点完全不可交互。无缩放/居中（本次不做，工作量大且
   非当前诉求焦点）。

4. **tools tab（`chat-right-panel.tsx` `renderToolsPanel`，约 897-1020 行）**：
   筛选按钮（全部/LSP/文件/网络/其他）只有中文文案没有数量，且没有搜索框；
   `right-panel-sections.tsx` 里"流式诊断历史"区块已有现成的 `<input
   type="search">` 样式模式可以复用。

5. **terminals / bookmarks / agent（`SubSessionDetailPanel`）tab**：功能齐全
   （loading/error/empty 三态、操作按钮都在），不纳入本次改动范围。

## Solution Design

四条改动线均为前端展示层改动，不新增后端路由：

- **MCP 修复线**：`use-chat-data-loaders.ts` 改用
  `getMcpStatus(token, { includeTools: true })` 并正确读取
  `toolCount`/`tools`/`disabledTools`/`error`；`ChatPage.tsx` 或
  `chat-right-panel.tsx` 内新增 `handleRetryMcp` 回调（复用
  `use-mcp-servers.ts` 里 `onRetryMcp` 的 pending→回写 模式），通过
  `setMcpServers` 更新状态，传给 `<MCPServerList onRetry={handleRetryMcp} />`。

- **Plan 修复线**：`PlanPanel.tsx` 空任务时渲染统一风格空状态（参考同文件里
  已有的卡片/文案调性，不引入新的 UI 基础组件）。

- **viz 修复线**：`chat-right-panel.tsx` 给 `<AgentDAGGraph onNodeClick={...} />`
  接上回调，点击节点后用一个轻量提示条（参考 `RequestScopeEffectNote` 的视觉
  模式）展示该节点的类型/状态；`AgentVizPanel` 事件列表按选中节点 id 做一次
  简单过滤（如果事件里能关联节点，否则只展示节点自身信息，不强行关联）。

- **tools 修复线**：筛选按钮文案改为带数量格式（如"全部 (12)"），基于当前
  `toolCallCards` 数组按类别预先计数；新增一个轻量文本搜索框（按工具名 /
  requestId 过滤），复用 `right-panel-sections.tsx` 里搜索框的样式模式。

四条线彼此独立（不同函数/不同文件片段），可并行开发验证，最后统一跑
typecheck + lint + 现有测试 + dev server 手动过一遍交互。

## Complexity Assessment

- Atomic steps: 5+（MCP 数据修复、MCP onRetry 接线、Plan 空状态、viz
  onNodeClick 接线+详情展示、tools 数量徽标+搜索框，共 5 个独立子任务）→ +2
- Parallel streams: yes（四条修复线互不依赖，可并行实现）→ +2
- Modules/systems/services: 3（`apps/web` 聊天页数据加载层、
  `packages/shared-ui` 组件层、既有 `web-client` MCP 客户端方法复用）→ +1
- Long step (>5 min): yes（改完后需要 typecheck + 现有测试 + dev server 手动
  验证四个交互，预计单次验证 >5 分钟）→ +1
- Persisted review artifacts: yes（用户明确要求"创建详细的实施方案"，需要
  可复核的文档）→ +1
- OpenCode available: no（当前运行环境是 Claude Code CLI，非 OpenCode，无
  `task()` 原生并行工具，只有 Agent 子代理可用）→ 0
- **Total score**: 2 + 2 + 1 + 1 + 1 + 0 = **7**
- **Chosen mode**: **Full orchestration**
- **Routing rationale**: 4 条独立并行修复线、跨 3 个模块、需要持久化可复核的
  实施方案文档，总分 7 分明显超过 Full orchestration 阈值（≥3）。执行方式选
  Mode B（当前上下文内顺序执行，非 OpenCode 环境无法用 `task()`），必要时用
  Agent 工具做只读调研/独立验证，但代码改动由本会话直接完成并写入
  `runtime/.../results/` 归档。

## Implementation Plan

### Phase 1: MCP tab 修复
- [x] T-01 ✅: `use-chat-data-loaders.ts` 改用 `includeTools: true`，修正
      `toolCount`/`tools`/`disabledTools`/`error` 字段映射
- [x] T-02 ✅: 新增 `handleRetryMcp` 回调（pending→回写状态机），接到
      `<MCPServerList onRetry={...} />`

### Phase 2: Plan tab 空状态
- [x] T-03 ✅: `PlanPanel.tsx` 补充空任务状态 UI，移除裸 `return null`

### Phase 3: viz tab 节点交互
- [x] T-04 ✅: `chat-right-panel.tsx` 接上 `AgentDAGGraph onNodeClick`，渲染
      选中节点的轻量详情提示条（新增 `DagNodeDetailStrip`）

### Phase 4: tools tab 筛选增强
- [x] T-05 ✅: 筛选按钮文案加数量徽标（预计数分类，`renderToolsPanel` 重构为
      `ToolsPanel` 组件以持有搜索 state）
- [x] T-06 ✅: 新增工具名/requestId 文本搜索框

### Phase 5: 验证与收口
- [x] T-07 ✅: `pnpm typecheck`（web + shared-ui）、`eslint`、现有测试
      （web 214 + shared-ui 64，共 278 项）、生产构建全部通过
- [x] T-08 ✅（部分）: dev server 冷启动验证通过（200 响应，无启动期报错）；
      **四个交互未能在真实浏览器中逐一点击验证**——当前会话无浏览器自动化工具，
      仅完成代码层静态验证（typecheck/lint/单测/构建）。建议用户后续手动过一遍
      MCP 重试、Plan 空态、DAG 节点点击、工具筛选+搜索四个交互作为最终确认。
- [x] T-09 ✅: 状态同步（workflow 勾选 + master_plan 收口）+ 归档

## Notes

- 本次任务范围严格限定在 `ChatRightPanel`（Classic 布局可见组件树）本体；
  Fusion 布局的侍审查侧栏结构（`fusionDockSplitPos` 百分比分栏等）已在本会话
  更早阶段单独完成，不在本文档范围内，两者互不冲突。
- `PlanTask`（agent 执行进度只读时间线）与用户可编辑任务清单是两套不同语义，
  本次不引入"可勾选"交互，避免误用数据模型。
- 若后续验证发现某条修复线需要联动改动超出预期范围（如 MCP 状态需要 WS 推送
  而非一次性拉取），应在此处补记 drift 说明并同步 master_plan，而不是静默扩大
  改动范围。

### 执行完成记录（2026-08-13）

- 全部 9 个任务（T-01~T-09）已完成，详见
  [runtime/260813-chat-right-panel-completion/final_output.md](../runtime/260813-chat-right-panel-completion/final_output.md)。
- 唯一的验证缺口：T-08 浏览器手动交互验证未能在本会话完成（无浏览器自动化
  工具），已在 T-08 行内注明，建议用户后续自行验证一遍。
- 未发现需要补记的 drift；实际改动范围与最初方案一致，未新增后端路由，未触碰
  Fusion 分栏结构。
