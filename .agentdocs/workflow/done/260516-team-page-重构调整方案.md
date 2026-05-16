# TeamPage 重构调整方案

## Task Overview

基于差距分析报告，将 TeamPage 从"左侧 Sidebar + Tab 工作台"重构为设计文档定义的"对话中心 + 右侧可收起面板 + 顶部固定状态栏"布局。

**关联文档**：
- `docs/team-page-layout-draft.md`（设计目标）
- 差距分析报告（10 项差距）

## Complexity Assessment

- Atomic steps: 15 → +2
- Parallel streams: 5 → +2
- Modules/systems: 2 → +1
- Long step (>5 min): 是 → +1
- Persisted review artifacts: 是 → +1
- OpenCode available: 是 → -1
- **Total score**: +6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 页面骨架替换 + 5 条并行工作流

## Solution Design

### 核心策略：渐进替换（不破坏现有功能）

```
Step 1: 新建 TeamPageV2 组件（新布局骨架）
Step 2: 把现有组件逐个迁移到新骨架中
Step 3: 用 feature flag 切换 TeamPage → TeamPageV2
Step 4: 验证后删除旧组件引用
```

### 新布局骨架结构

```tsx
<TeamPageV2>
  {/* 顶部固定状态栏 */}
  <TeamStatusBar fixed />

  {/* 主内容区（flex row） */}
  <main className="flex flex-1 overflow-hidden">
    {/* 左侧主区域 */}
    <section className="flex-1 flex flex-col">
      {/* 3D 动画（紧凑模式，可折叠） */}
      <OfficeCompactBar collapsed={collapsed} onToggle={toggle} />

      {/* 对话区（永驻，flex-1 占满剩余空间） */}
      <ConversationArea />

      {/* 输入框 */}
      <MessageInput />
    </section>

    {/* 右侧可收起面板 */}
    <RightPanel collapsed={panelCollapsed}>
      <TabBar tabs={['任务', '团队', '设置']} />
      <TabContent />
    </RightPanel>
  </main>

  {/* 底部抽屉（层级对话查看器） */}
  <LayerConversationDrawer />
</TeamPageV2>
```

## Implementation Plan

### Wave 1: 页面骨架（P0，最高优先级）
- [x] T-01: 新建 `TeamPageV2.tsx` 骨架组件（flex 布局：顶部状态栏 + 主区域 + 底部抽屉）
- [x] T-02: 新建 `RightPanel.tsx`（可收起三 Tab 面板：任务/团队/设置）
- [x] T-03: 新建 `ConversationArea.tsx`（从 ConversationTab 提升为永驻主区域）

### Wave 2: 顶部状态栏常驻（P1，依赖 Wave 1）
- [x] T-04: 改造 `TeamStatusBar` 为固定顶部（position: sticky/fixed + 始终渲染，无 handoff 时最小化）
- [x] T-05: 集成 `LayerStatusIndicator` + `TaskProgressBar` + `EstimatedTimeLabel` 到状态栏

### Wave 3: 右侧面板内容（P1，依赖 Wave 1）
- [x] T-06: 任务 Tab — 迁移 `SessionTreeView` + 任务卡片列表
- [x] T-07: 团队 Tab — 3D 全屏入口 + 角色状态 + 编制配置
- [x] T-08: 设置 Tab — 迁移 `team-runtime-settings-panel` + `AdapterConfigPanel` + `ForceApplyButton`

### Wave 4: 3D 动画紧凑模式（P2，依赖 Wave 1）
- [x] T-09: 新建 `OfficeCompactBar.tsx`（180px 高度 + 折叠到 0 + 全屏切换）
- [x] T-10: 3D 动画与 handoff 状态联动（节点高亮/灰色/闪烁）
- [x] T-11: `BuddyCard.tsx`（3D 折叠后的浮动状态卡替代）

### Wave 5: 收尾（P2-P3，依赖 Wave 2-4）
- [x] T-12: 移除旧组件引用（TabRow / MainWorkspace / FooterBar / 左侧 SessionSidebar）— 拆为以下两阶段：
    - [x] T-12a: 把 `TeamPageDispatcher` 默认改为 V2，旧 TeamPage 通过 `localStorage['teamV2.enabled']='0'` 显式回退（已完成 / 见 `TeamPageDispatcher.tsx`）
    - [ ] T-12b: 1-2 周观察期后物理删除 `TeamPage.tsx` + 4 个旧组件 + dispatcher fallback 分支（延后执行）
- [x] T-13: 三态流转（无任务/有任务/暂停）页面级状态切换
- [x] T-14: 响应式适配（桌面 ≥1024 / 平板 768-1023 / 移动 <768）
- [x] T-15: Feature flag 切换 + 验证

#### T-12b 物理删除清单（待执行）

观察期后需要删除的文件：
- `apps/web/src/pages/TeamPage.tsx`
- `apps/web/src/pages/team/runtime/TabRow.tsx`
- `apps/web/src/pages/team/runtime/MainWorkspace.tsx`（含命名导出 `FooterBar`）
- `apps/web/src/pages/team/runtime/TopTeamHeader.tsx`
- `apps/web/src/pages/team/runtime/TeamSessionSidebar.tsx`

执行后续步骤：
- 修改 `TeamPageDispatcher.tsx` 移除 `TeamPage` import 和 fallback 分支，让 dispatcher 退化成纯 V2 lazy 入口（或考虑直接路由 `team` 指向 `TeamPageV2.js`，移除 dispatcher 间接层）
- 跑 `pnpm --filter @openAwork/web typecheck` + `pnpm --filter @openAwork/web build` 验证
- 备份位置：`.backup/team-page-v1/`（已建立，可作回滚锚点）

## 详细设计

### T-01 TeamPageV2 骨架

```
文件：apps/web/src/pages/TeamPageV2.tsx
职责：新布局的顶层容器
结构：
  - 全屏 flex column
  - TeamStatusBar（sticky top）
  - main flex row（左主区 + 右面板）
  - LayerConversationDrawer（底部条件渲染）
状态：
  - rightPanelCollapsed: boolean
  - officeCollapsed: boolean
  - drawerVisible: boolean
  - activeRightTab: '任务' | '团队' | '设置'
```

### T-02 RightPanel

```
文件：apps/web/src/pages/team/runtime/RightPanel.tsx
职责：右侧可收起三 Tab 面板
结构：
  - 收起/展开按钮
  - Tab 切换栏
  - 内容区（按 activeTab 渲染）
宽度：展开 320px / 收起 0px
动画：slide-in/out 200ms ease
```

### T-03 ConversationArea

```
文件：apps/web/src/pages/team/runtime/ConversationArea.tsx
职责：永驻对话区（从 ConversationTab 提升）
改造点：
  - 移除 Tab 容器依赖
  - 添加 SuggestionBar 渲染
  - 添加推送消息（🔴🟡🟢）渲染
  - 添加系统消息（MemoryWriteBadge / DegradedBadge）渲染
  - flex-1 占满剩余空间
```

### T-04 TeamStatusBar 常驻化

```
文件：apps/web/src/pages/team/runtime/TeamStatusBar.tsx
改造点：
  - position: sticky; top: 0; z-index: 50
  - 无 handoff 时：最小化为一行灰色提示（"AI 团队待命中"）
  - 有 handoff 时：完整展示进度条 + 层级指示 + 暂停按钮
  - 移除条件渲染包裹（始终渲染）
```

### T-09 OfficeCompactBar

```
文件：apps/web/src/pages/team/runtime/OfficeCompactBar.tsx
职责：3D 动画紧凑模式
结构：
  - 高度 180px（可折叠到 0）
  - 内嵌 OfficeThreeCanvas（缩放适配）
  - 折叠按钮 [▼] / 全屏按钮 [⛶]
  - 节点状态联动（从 useLayerStore 读取）
Props：
  - collapsed: boolean
  - onToggle: () => void
  - onFullscreen: () => void
```

### T-14 响应式适配

```
断点策略：
  桌面（≥1024px）：左主区 65% + 右面板 35%
  平板（768-1023px）：主区全宽 + 右面板覆盖式抽屉
  移动（<768px）：主区全宽 + 右面板底部上滑 + 3D 隐藏 + 状态栏精简

实现方式：
  - Tailwind 响应式类（md: / lg:）
  - useMediaQuery hook 控制面板行为
  - 3D 动画在移动端自动折叠
```

## 迁移映射表

| 旧组件 | 新位置 | 改造程度 |
|--------|--------|---------|
| ConversationTab → | ConversationArea（永驻） | 中（移除 Tab 依赖） |
| TeamStatusBar → | 顶部固定（sticky） | 小（加 sticky + 始终渲染） |
| SessionTreeView → | 右侧面板任务 Tab | 无（直接移位） |
| team-runtime-settings-panel → | 右侧面板设置 Tab | 无（直接移位） |
| OfficeThreeCanvas → | OfficeCompactBar 内嵌 | 中（加紧凑/折叠/全屏） |
| LayerConversationDrawer → | 底部（保留） | 无 |
| PauseResumeControls → | TeamStatusBar 内 | 无（已在） |
| TeamArtifactSection → | 右侧面板任务 Tab 或对话区 | 小 |

| 旧组件（移除） | 原因 |
|--------|--------|
| TabRow | 新布局无 Tab 切换 |
| MainWorkspace | 被新骨架替代 |
| FooterBar | 功能合并到状态栏 |
| TeamSessionSidebar | 功能合并到右侧面板 |
| TopTeamHeader | 被 TeamStatusBar 替代 |

## 验收标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter @openAwork/web build` 通过
- [ ] 对话区永驻（不在 Tab 中切换）
- [ ] 右侧面板三 Tab 可切换 + 可收起
- [ ] 顶部状态栏始终可见
- [ ] 3D 动画紧凑模式 + 折叠/全屏
- [ ] 底部抽屉可从 Session 树节点触发
- [ ] 响应式：桌面/平板/移动三种布局
- [ ] Feature flag 可切换新旧布局

## Notes

- 估时：2-3 周
- 核心风险：ConversationTab 提升为永驻时可能有状态管理依赖需要解耦
- Feature flag 保护：`OPENAWORK_TEAM_V2_LAYOUT=1` 环境变量控制
- 旧布局保留到新布局验证通过后再删除
