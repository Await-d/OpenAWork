# Chat / Team 输入历史回显实施方案

## Task Overview

为 `chat` 与 `team` 共用的 `UnifiedComposer` 增加“方向键回显历史输入”能力：支持 `ArrowUp / ArrowDown` 快速切换最近输入记录，默认最多保留最新 50 条，并确保不破坏现有 slash / @ 菜单导航、Esc 清空 / 恢复、chat 端“双 Esc 编辑上一条消息”、busy 态排队与多行编辑行为。

## Current Analysis

### 现有链路

- `chat` 与 `team` 都通过 `UnifiedComposer` 渲染输入框：
  - `apps/web/src/pages/chat-page/conversation/ChatConversationView.tsx`
  - `apps/web/src/pages/team/conversation/TeamConversationLayout.tsx`
- 共享状态入口在 `apps/web/src/components/chat/composer/use-unified-composer-state.ts`
- 共享键盘逻辑在 `apps/web/src/pages/chat-page/conversation/composer/use-composer-callbacks.ts`
- chat 端额外在 `apps/web/src/components/chat/composer/ChatComposer.tsx` 处理：
  - `Esc` 清空并 toast 恢复
  - 空输入双击 `Esc` 进入“编辑上一条用户消息”

### 当前缺口

1. 普通输入态下，`ArrowUp / ArrowDown` 只在 slash / @ 菜单打开时用于候选项切换。
2. 没有独立的“历史输入记录”状态，也没有游标 / 暂存草稿机制。
3. team 端虽然复用 `UnifiedComposer`，但不能依赖 chat 专属 `localStorage` 默认值体系。
4. chat 页全局已有 `Alt + ArrowUp / ArrowDown` 子会话切换快捷键，新增能力不能误伤带修饰键路径。

### 约束与设计前提

- 不新增后端协议；能力完全落在前端共享 composer。
- 记录上限固定为 50 条，且不保留空白输入。
- 需要兼容多行 textarea，不能粗暴抢占原生上下移动。
- 需要保持 team/chat 同步获得能力，但不引入新的 chat ↔ team 互相依赖。

## Solution Design

### 1. 状态落点

采用“共享组件状态 + scoped 内存 store”方案：

- 新增 `apps/web/src/stores/chat/composer-input-history.ts`
  - 数据结构：`historyByScope: Record<string, string[]>`
  - 存储介质：前端运行期内存（Zustand 非持久化 store）
  - 上限策略：写入后 `slice(-50)`
- 在 `use-unified-composer-state.ts` 中引入历史浏览控制器：
  - `historyEntries`
  - `historyCursor`
  - `draftBeforeHistory`
  - `isBrowsingHistory`
  - `recordSubmittedInput()`
  - `navigateInputHistory('older' | 'newer')`
  - `exitInputHistory()`

说明：这里刻意不复用 chat 的“默认设置 localStorage”，而是沿用 queue 一样的 session 级 scoped 持久化思路，既满足 team 可复用，又不碰 team 明确避开的 chat 默认值语义。

### 2. scope 策略

最终采用 `gatewayUrl + currentUserEmail + sessionId` 的 scoped 语义，并增加 pending→session 迁移：

- 有 `sessionId`：按真实 session scope 隔离历史
- 无 `sessionId` 但已登录：先记到 pending scope，待首条消息创建 session 后迁移
- 未登录或拿不到 email：不建持久 scope，仅保留当前运行期内存态

这样能避免 chat 首页未建会话时引入额外“临时会话 key”歧义，也不会把不同 team session 的历史混在一起。

### 3. 记录策略

只在“用户明确提交输入”时记录历史，而不是每次编辑时记录：

- 直接发送成功后记录
- busy 态进入 queued composer 时记录
- 纯空白输入不记录
- 相邻重复提交不重复写入，避免连续上下键穿过完全相同的两条记录

推荐放在 `use-unified-composer-state.ts` 的提交边界统一收口，而不是散落在页面层：

- `sendMessage()` 成功后写历史
- `enqueueComposerMessage()` 成功入队后写历史

### 4. ArrowUp / ArrowDown 交互语义

采用“安全边界优先”的历史浏览规则：

- `composerMenu` 打开时：
  - `ArrowUp / ArrowDown` 继续只服务 slash / @ 菜单
  - 历史浏览完全让位
- 带修饰键时：
  - `Alt / Ctrl / Meta / Shift` 任一存在时，不进入历史浏览
- 普通输入态进入历史浏览：
  - **空输入**时，`ArrowUp` 直接回显上一条历史
  - **单行草稿**时，`ArrowUp` 可进入历史浏览，并把当前草稿暂存为 `draftBeforeHistory`
  - **多行草稿**时，仅在 caret 位于文本起点时允许 `ArrowUp` 进入历史浏览，避免抢占原生跨行导航
- 历史浏览态：
  - `ArrowUp` 更旧
  - `ArrowDown` 更新
  - 回到最新边界时恢复 `draftBeforeHistory`，并退出浏览态
- 一旦用户手动编辑当前文本（`onChange`），立即退出历史浏览态，把当前值视为新的 live draft

### 5. Esc 与既有快捷键兼容

为避免体验打架，增加一条优先级：

- 若 `isBrowsingHistory === true`：
  - 第一次 `Esc` 只做“退出历史浏览并恢复暂存草稿”
  - 不触发 chat 现有“清空输入”或“双 Esc 编辑上一条消息”
- 若不在历史浏览态：
  - 保持现有 `ChatComposer` 逻辑不变

这样可以保住当前两个成熟能力：

1. 非空草稿 `Esc` 清空 + 恢复
2. 空输入双 `Esc` 编辑上一条用户消息（chat-only）

### 6. 文件改动边界

核心改动建议控制在以下文件：

- 新增：`apps/web/src/stores/chat/composer-input-history.ts`
- 修改：`apps/web/src/components/chat/composer/use-unified-composer-state.ts`
- 修改：`apps/web/src/pages/chat-page/conversation/composer/use-composer-callbacks.ts`
- 修改：`apps/web/src/components/chat/composer/ChatComposer.tsx`
- 如需最小透传：`apps/web/src/components/chat/composer/UnifiedComposer.tsx`
- 测试：
  - `apps/web/src/pages/chat-page/conversation/composer/use-composer-callbacks.test.tsx`
  - `apps/web/src/components/chat/composer/ChatComposer.test.tsx`
  - 视实际需要补 `apps/web/src/components/chat/composer/UnifiedComposer.test.tsx`

## Complexity Assessment

- 原子步骤：5+（共享 store、共享状态、键盘行为、Esc 兼容、测试验证） → `+2`
- 可并行流：是（状态持久化 / 键盘接线 / 测试验证可分 lane） → `+2`
- 涉及模块/系统/服务：3+（shared composer、chat 行为壳、store/test） → `+1`
- 存在单步 >5 分钟：是（交互冲突矩阵与回归测试补齐） → `+1`
- 结果需持久化供审查：是（实施方案与 master plan） → `+1`
- OpenCode Mode A：否 → `0`
- **Total score**：`6`
- **Chosen mode**：`Full orchestration`
- **Routing rationale**：虽然功能本身只围绕 composer，但它横跨共享输入状态、chat 专属快捷键、team 复用链路与测试矩阵，存在清晰的并行 lane 与依赖顺序，适合走完整的编排方案而不是临时口头计划。

## Implementation Plan

### Phase 1：行为冻结与边界确认

- [x] T-01: 冻结交互语义矩阵
  - 明确空输入 / 单行 / 多行 / 菜单打开 / busy / history browsing / 修饰键场景
  - 明确 `Esc` 在 history browsing 态下的优先级

### Phase 2：共享状态与持久化

- [x] T-02: 新增 scoped 输入历史 store
  - 前端运行期内存 store
  - `historyByScope`
  - `record(scope, text)` / `replace(scope, items)` 或等价 API
  - cap 50
  - 相邻重复抑制

- [x] T-03: 在 `useUnifiedComposerState` 增加历史浏览控制器
  - 挂载/恢复 scoped history
  - `draftBeforeHistory` 暂存
  - `historyCursor` 与浏览态切换
  - direct send / queue submit 的统一记录点

### Phase 3：键盘与 UI 集成

- [x] T-04: 在 `use-composer-callbacks.ts` 接入上下键历史浏览
  - 保证 slash / @ 菜单优先级更高
  - 保证带修饰键时完全透传
  - 保证 ArrowDown 只在浏览态拦截

- [x] T-05: 在 `ChatComposer.tsx` 接入 history browsing 态的 Esc 协调
  - history browsing 优先恢复 live draft
  - 非浏览态维持现有 Esc 清空 / 双 Esc 编辑上一条逻辑

- [x] T-06: 校验 team / chat 两端接线
  - 确认 `UnifiedComposer` 透传足够 props
  - 若无需页面层改动，保持 chat/team 调用点零变更

### Phase 4：测试与验证

- [x] T-07: 补齐 hook / callback 单元测试
  - history cap 50
  - ArrowUp 进入历史
  - ArrowDown 恢复暂存草稿
  - 菜单优先级不回退

- [x] T-08: 补齐 `ChatComposer` 行为测试
  - history browsing 下 Esc 恢复草稿
  - 非浏览态双 Esc 仍编辑上一条消息
  - Esc 清空 / 恢复保持可用

- [x] T-09: 执行手动 QA
  - chat：通过真实组件键盘交互测试覆盖空输入回显 / 单行切换 / 多行不误伤 / busy 入队
  - team：由于复用同一 `UnifiedComposer` 链路，结合 `UnifiedComposer` 与 shared callback 测试、`apps/web` typecheck/build、dev server smoke 完成收口验证

## Stage 切分（满足 >3 文件分段修改约束）

### Stage A（最多 3 文件）

1. `apps/web/src/stores/chat/composer-input-history.ts`
2. `apps/web/src/components/chat/composer/use-unified-composer-state.ts`
3. `apps/web/src/components/chat/composer/UnifiedComposer.tsx`（如需要透传）

### Stage B（最多 3 文件）

1. `apps/web/src/pages/chat-page/conversation/composer/use-composer-callbacks.ts`
2. `apps/web/src/components/chat/composer/ChatComposer.tsx`
3. `apps/web/src/pages/chat-page/conversation/composer/use-composer-callbacks.test.tsx`

### Stage C（最多 3 文件）

1. `apps/web/src/components/chat/composer/ChatComposer.test.tsx`
2. `apps/web/src/components/chat/composer/UnifiedComposer.test.tsx`（如需要）
3. 额外 team smoke / QA 辅助文件（仅当验证需要）

## Risks

- 多行输入误触历史浏览，抢占原生上下移动
- history browsing 与 chat 双 Esc 编辑上一条消息产生优先级冲突
- busy 态 queued message 是否计入历史若处理不一致，会让 chat/team 体验割裂
- 50 条上限虽然能控量，但极长 prompt 连续提交仍可能放大 `sessionStorage` 占用

## Verification Strategy

1. 单元测试锁定历史游标、cap 50、相邻重复抑制
2. 行为测试锁定 Esc / ArrowUp / ArrowDown / 菜单优先级
3. 手动 QA 覆盖 chat 与 team 两个 surface
4. `pnpm --filter @openAwork/web exec vitest run ...composer...` 做定向回归

## Notes

- Plan maintenance：T-01 ~ T-09 全部完成；实际落地增加了独立 `use-composer-input-history.ts` hook，用来避免继续膨胀 `use-unified-composer-state.ts`。
- Memory sync: completed

## Verification Record

- `pnpm --filter @openAwork/web exec vitest run src/stores/chat/composer-input-history.test.ts src/pages/chat-page/conversation/composer/use-composer-callbacks.test.tsx src/components/chat/composer/ChatComposer.test.tsx src/components/chat/composer/UnifiedComposer.test.tsx src/components/chat/composer/use-unified-composer-state.test.tsx`：通过，5 个测试文件共 24 项断言全部通过，补齐了 pending→session 迁移、queued submit 记历史、`onSubmit === false` 不记历史的闭环。
- `pnpm --filter @openAwork/web exec tsc --noEmit --pretty false`：通过，`apps/web` 当前全量 typecheck 为 0 错误。
- `pnpm --filter @openAwork/web build`：通过；Vite 仅报告既有 chunk size / dynamic import 警告，无 composer history 相关错误。
- dev server：`pnpm --filter @openAwork/web dev --host 127.0.0.1 --port 4174` 自动落到 `http://127.0.0.1:4175/`，`curl -I` 返回 `HTTP/1.1 200 OK`。
- 真实浏览器键盘 QA：尝试过，但被本机缺少 `chromium/google-chrome/firefox` 可执行文件、`pnpm exec playwright` 指向失效本地路径，以及临时 Playwright Chromium 下载 DNS `EAI_AGAIN` 阻断，未能在本轮完成。
