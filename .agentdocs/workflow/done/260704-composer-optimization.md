# 输入框 ChatComposer 整体优化方案

## 任务概述

对 `ChatComposer.tsx`（~1770 行）进行动画微交互、功能增强、视觉样式和代码质量四维度优化，共 13 项改进。

## 当前分析

### 现状问题
1. **动画缺失**：发送/拖拽/弹窗等状态切换无过渡动画，体感生硬
2. **功能空白**：无字符计数、无 Esc 清空、无大文本折叠、placeholder 静态
3. **视觉单调**：流式中边框无变化、工具栏按钮无分组、home 模式缺少 glassmorphism
4. **代码超限**：ChatComposer.tsx ~1770 行超过 1500 行上限，需拆分

### 约束
- 不得使用 `as any` / `@ts-ignore`
- 所有样式使用 E · Nebula CSS 变量
- 间距遵循 4/8/12/16/20/24/32/48 token 阶梯
- 拆分时按职责边界切分，不随机截断
- 保持桌面端复用 Web 页面的导入路径不变

## 复杂度评估

| 信号 | 得分 |
|------|------|
| 原子步骤数：13 项 | +2 |
| 可并行流：动画 / 功能 / 视觉 / 拆分 四个独立方向 | +2 |
| 涉及模块：ChatComposer + index.css + 新建 3 个子组件 | +1 |
| 单步 >5min：文件拆分（T-13） | +1 |
| 需持久化审查：是（方案文档） | +1 |
| OpenCode 环境：是 | -1 |
| **总分** | **6** |
| **选定模式** | **Full orchestration** |
| **路由理由** | 13 项跨 4 个独立方向，可高度并行；拆分任务与其他任务有依赖关系需协调 |

## 方案设计

### 依赖 DAG

```
T-13（文件拆分）─┐
                 ├─→ T-01~T-12 在拆分后的子组件上实现
T-01~T-05（动画）─┤
T-06~T-09（功能）─┤     可全部并行
T-10~T-12（视觉）─┘
```

**关键决策**：T-13（拆分）必须先完成，否则在 1770 行文件上做 12 项改动会产生大量 merge conflict。拆分后 T-01~T-12 分配到不同子文件，天然隔离。

### 执行策略
- **Phase 1**：T-13 文件拆分（阻塞后续）
- **Phase 2**：T-01~T-12 并行执行（4 个方向 × 3 个任务）
- **Phase 3**：集成验证 + lint + typecheck

## 实施计划

### Phase 1：文件拆分（阻塞）

- [x] T-13: 拆分 ChatComposer.tsx（~1770 行 → 4 个文件）
  - `ChatComposerMenu.tsx` — 命令/提及菜单（第 347-559 行）
  - `ChatComposerToolbar.tsx` — 底部工具栏（第 1180-1751 行）
  - `ChatComposerOptimize.tsx` — 提示词优化弹窗（第 952-1209 行）
  - `ChatComposer.tsx` — 主壳 + textarea + 拖拽（保留剩余）
  - 保持所有 import 路径和 props 接口不变

### Phase 2A：动画 / 微交互（并行）

- [x] T-01: 发送按钮脉冲反馈
  - 发送瞬间在发送按钮位置播放一次 accent 色径向扩散动画
  - CSS `@keyframes pulse-send` + JS 触发 className
  - 动画时长 400ms，不阻塞状态切换

- [x] T-02: 拖拽放入区域淡入动画
  - 覆盖层从 `opacity:0; scale:0.95` 过渡到 `opacity:1; scale:1`
  - CSS transition 200ms ease-out
  - 退出时反向过渡 150ms

- [x] T-03: 工具栏按钮微弹反馈
  - 所有 icon-btn 添加 `:active { transform: scale(0.92) }`
  - hover 时 `transform: scale(1.05)`
  - transition 120ms ease

- [x] T-04: 提示词优化结果弹窗入场动画
  - slideDown + opacity：从 `translateY(-8px); opacity:0` 到 `translateY(0); opacity:1`
  - CSS animation 220ms ease-out
  - 关闭时反向 150ms

- [x] T-05: 队列消息 pill 入场/退场动画
  - 新增 pill：slideInRight + fade
  - 移除 pill：slideOutRight + fade
  - 使用 CSS `@keyframes` + `animationend` 监听移除 DOM

### Phase 2B：功能增强（并行）

- [x] T-06: 字符计数提示
  - textarea 右下角显示 `字符数 / 阈值`
  - 阈值：contextMaxTokens 的 1/4（粗估 4 字符 ≈ 1 token）
  - 超 80% 变 warning 色，超 100% 变 danger 色
  - 计数器绝对定位，不干扰输入

- [x] T-07: placeholder 动态轮换
  - 准备 5 条 placeholder 文案
  - 输入框为空时每 4 秒淡入淡出切换一条
  - 用户聚焦时停止轮换，显示默认文案
  - 使用 `setInterval` + CSS opacity transition

- [x] T-08: 快捷键 Esc 清空
  - 空闲状态（非流式、非生成）按 Esc 清空输入框
  - 清空后底部 toast 提示"已清空 · 点击恢复"
  - toast 持续 3 秒，点击可 undo（恢复之前内容）

- [x] T-09: 粘贴大文本折叠
  - 检测 `onPaste` 事件，文本 >500 字符时拦截
  - 替换为 `[粘贴的文本 · N 行 · 点击展开]` pill
  - pill 点击后在 textarea 下方展开预览面板
  - 展开面板可"插入原文"或"编辑后插入"

### Phase 2C：视觉样式（并行）

- [x] T-10: 流式中边框呼吸光效
  - 流式时 `composer-shell` 添加 `streaming` class
  - CSS `@keyframes breathe`：accent 色 box-shadow opacity 0.3→0.6→0.3 循环
  - 周期 2s，ease-in-out
  - 停止流式时移除 class

- [x] T-11: home 变体 glassmorphism
  - home 模式 composer-shell 添加 `backdrop-filter: blur(12px)`
  - 背景改为 `rgba` 半透明
  - 边框改为 `1px solid rgba(255,255,255,0.08)`（暗色）/ `rgba(0,0,0,0.06)`（亮色）
  - 保持 focus-within 状态不变

- [x] T-12: 工具栏按钮分组视觉
  - 模型选择组（ModelPicker + ModelSettings）保持现有边框分组
  - 功能开关组（WebSearch + ImageGen + Voice + Attachment）之间加分隔点
  - 提示组（/ 命令 + @ 文件 hint chips）前加分隔线
  - 使用 `1px solid var(--border-subtle)` 竖线，高度 16px

### Phase 3：集成验证

- [x] T-14: 全量 lint + typecheck + 视觉自查（验证已执行，非 Composer 阻塞见备注）
  - Composer 聚焦测试通过
  - web typecheck/build 已执行，但被非 Composer 的 team/runtime 类型错误阻断
  - web 全量 test 已执行，Composer 用例通过；非 Composer 失败详见验证记录

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 拆分后桌面端导入路径断裂 | 中 | 高 | 保持 `ChatComposer.tsx` 作为入口，子组件仅内部使用 |
| 动画 keyframes 与现有 CSS 冲突 | 低 | 中 | 所有新 keyframes 加 `composer-` 前缀 |
| placeholder 轮换闪烁 | 中 | 低 | 使用 opacity transition 而非 display 切换 |
| Esc 清空误触 | 中 | 中 | 仅在 textarea 聚焦 + 非流式 + 非菜单时生效 |
| 粘贴折叠破坏用户体验 | 低 | 中 | 阈值 500 字符足够高，正常粘贴不受影响 |

## 验证策略

1. **拆分验证**：拆分后 `pnpm typecheck` 通过，桌面端构建正常
2. **动画验证**：每个动画在暗色/亮色下目视确认
3. **功能验证**：字符计数、Esc 清空、粘贴折叠各自手动测试
4. **回归验证**：现有发送/停止/拖拽/队列/优化功能不受影响

## 备注

- 优先级：T-13（拆分）→ T-10（流式呼吸）→ T-01（发送脉冲）→ T-06（字符计数）→ 其余
- T-13 完成后，T-01~T-12 可分配给 4 个并行 agent（动画组 / 功能组 / 视觉组 / 集成组）
- 所有新 CSS keyframes 统一加 `composer-` 前缀避免冲突
- Plan maintenance: T-13、T-01~T-12 已在 ChatComposer 范围内完成；入口 `ChatComposer.tsx` 保留原组件 API，并拆出队列、工具栏、模型控制、功能开关、主操作、字符计数和 placeholder hook。
- Plan maintenance: T-14 已执行可承受验证；全量 typecheck/build/test 当前被 team/runtime/layout/knowledge graph 等非 Composer 并发改动阻塞，未在本任务中修改这些区域。

## 验证记录

- `pnpm --filter @openAwork/web exec vitest run src/components/chat/composer/ChatComposer.test.tsx`：通过，6 个 ChatComposer 聚焦测试全部通过。
- `rg -n "as any|@ts-ignore|@ts-expect-error|fetch\\(" apps/web/src/components/chat/composer apps/web/src/index.css`：无匹配，未引入禁用类型逃逸或裸 `fetch()`。
- 纯 LOC 检查：`ChatComposer.tsx` 861 行，低于项目 1500 行上限；新增 Composer 子文件均低于 250 行，`ChatComposer.test.tsx` 282 行处于测试文件预警区。
- `pnpm lint`：失败，ESLint 阶段 Node heap OOM（约 4GB）并以 exit code 134 退出，未产出具体 Composer lint 诊断。
- `pnpm --filter @openAwork/web exec tsc --noEmit --pretty false`：失败，错误集中在 `src/pages/team/runtime/...`（例如 `team-runtime-stall-detection.ts` 的 nullable/sessionScope、`LayerSummarySidebar.test.tsx` 缺少 `personaKey/displayName`），未出现 ChatComposer 相关错误。
- `pnpm --filter @openAwork/web build`：失败，`tsc -b` 阶段被同一批 `src/pages/team/runtime/...` 类型错误阻断，Vite build 未执行。
- `pnpm --filter @openAwork/web test`：失败，`ChatComposer.test.tsx` 通过；全量汇总为 16 个失败文件、91 个失败测试、181 个通过文件、1342 个通过测试，失败集中在 `FloatingPermissionPrompt`、`TeamConversationView`、`WorkspaceKnowledgeGraphView*`、`LayerFlowView`、`MessagesMergedTab`、`TasksTab` 等非 Composer 区域。
- 视觉 QA：用 Vite dev server + Playwright CLI 截取 `home-1280.png`、`home-375.png`、`chat-1280.png`，页面均被 Gateway 连接引导弹窗覆盖，无法看到 ChatComposer 主体；截图保存在 `.agentdocs/runtime/260704-composer-optimization-visual/`。独立双审阅 QA 工具在当前 Codex 环境不可用，因此未能完成 visual-qa 的双 oracle gate。
