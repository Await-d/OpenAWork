# .agentdocs/workflow/260420-message-runtime-assistant-trace-协议下沉实施.md

## Task Overview
- 目标：继续处理剩余高价值协议漂移点，把 `assistant_trace` 的编解码从 `apps/web` 本地逻辑下沉成更稳定的共享协议 helper，减少页面层自定义协议空间。
- 范围：`packages/shared`、`apps/web`，必要时考虑 `services/agent-gateway` 的兼容读取点，但本轮优先完成共享 helper 下沉与前端接线。
- 非目标：不重写整套聊天状态机，不改 transport 协议，不一次性删除所有 legacy fallback。

## Current Analysis
- 当前前端第二真相源已经做过一轮收口：assistant message 内部读取改为 `parts-first`，`assistant_trace` JSON 降级为 fallback。
- 但 `assistant_trace` 的 codec 仍主要留在 `apps/web/src/pages/chat-page/support.ts`，这意味着：
  - 协议定义仍在页面层
  - 如果未来 gateway / shared-ui / web-client 也要读写该结构，仍会再次出现复制实现
  - 协议 helper 还没有真正下沉到共享层

## Solution Design
- 目标不是改变 `assistant_trace` wire format，而是把它的 **types + encode/decode + parts transform** 下沉到共享层。
- 预期方向：
  1. 找到 `packages/shared` 中最适合放置 assistant trace 协议 helper 的位置
  2. 把 `AssistantTracePayload`、tool call 结构、parts↔trace 转换、content codec 下沉
  3. 让 `apps/web` 改成消费共享 helper，而不是继续本地定义协议
  4. 保持与现有 fallback/兼容读取一致，确保 web build/test 继续通过

## Complexity Assessment
- Atomic steps: 5+（共享协议 helper 设计、shared 出口、apps/web 接线、兼容 fallback、回归验证）→ +2
- Parallel streams: 是（apps/web、packages/shared、可能的 gateway 兼容点）→ +2
- Modules/systems/services: 3+（shared、web、gateway）→ +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 这是 sender/read/tool-state/compaction/前端 runtime 协议收口之后的下一层协议治理，必须把共享 helper 设计、兼容边界与回归矩阵记录下来，避免再出现页面层私有协议。

## Implementation Plan

### Phase 1: assistant_trace 共享协议边界钉死
- [x] T-01: 确定 assistant_trace 在 `packages/shared` 的目标位置与最小公开 API ✅
- [x] T-02: 盘点 apps/web 与可能的 gateway 读写点，确认需要下沉的 helper 集合 ✅

### Phase 2: 共享 helper 下沉
- [x] T-03: 实施 `assistant_trace` 类型与 codec/helper 的 shared 下沉 ✅
- [x] T-04: 实施 apps/web 对共享 helper 的接线与本地定义收缩 ✅

### Phase 3: 验证与归档
- [x] T-05: 跑 web 定向与全量测试 ✅
- [x] T-06: 跑相关 build/test 并同步 agentdocs ✅

## Notes
- Can split? 可以，至少可拆成两条流：A) shared helper 设计与出口；B) apps/web 接线与兼容回归。
- Should split? 应该拆。这样能先稳定共享协议，再验证页面层不再自定义消息协议。
- Dependency order:
  - T-01/T-02 → T-03/T-04
  - T-03/T-04 → T-05 → T-06
- 当前用户已明确要求继续执行，不停留在分析层。
- canonical 结论：
  - `assistant_trace` 的协议 helper 最适合下沉到 `packages/shared/src/assistant-trace.ts`；
  - shared 公开 API 只负责协议 types + codec + parts transform；
  - `apps/web` 保留业务接线、permission/tool status 修补与 UI 辅助，不再继续定义协议本体。
- 本轮已落地的最小下沉：
  - 新增 `packages/shared/src/assistant-trace.ts`，下沉：
    - `AssistantTraceToolCall`
    - `AssistantTracePayload`
    - `AssistantTracePart` 及子类型
    - `createAssistantTraceContent`
    - `parseAssistantTraceContent`
    - `partsFromAssistantTrace`
    - `readAssistantTracePayloadFromParts`
    - `contentFromAssistantTraceParts`
  - `packages/shared/src/index.ts` 已导出上述 shared helper。
  - `apps/web/src/pages/chat-page/support.ts` 改为消费 shared helper，只保留：
    - `hasActivePendingPermissionRequest` 这类 web 业务判断
    - `parseModifiedFilesSummaryContent / parseFileDiffContent / parseToolCallObservability` 这类本地 parse 依赖适配
    - 各种本地消息修补/权限反馈/业务接线函数
- 本轮修改文件：
  - `packages/shared/src/assistant-trace.ts`
  - `packages/shared/src/index.ts`
  - `apps/web/src/pages/chat-page/support.ts`
- 本轮验证证据：
  - `pnpm --filter @openAwork/shared build` ✅
  - `pnpm --filter @openAwork/web build` ✅
  - `pnpm --filter @openAwork/web exec vitest run` ✅

## Completion
- T-01 ~ T-06 已全部完成。
- 这轮完成后，assistant_trace 已经从页面层私有协议推进成 shared 协议 helper；页面层保留业务接线，但不再持有协议本体。
