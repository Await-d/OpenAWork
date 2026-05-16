# TeamPage V2 功能加强方案

## Task Overview

TeamPage V2 重构后比旧版更简陋——旧版有 8 个功能 Tab + 完整会话管理 + 模板系统 + 团队管理 + 3D Office 全屏，新版只剩对话区 + 右侧 3 Tab 面板。需要把丢失的功能按优先级补回来，同时保持新布局的"对话中心"设计理念。

## 核心原则

**不是回退到旧版，而是把旧版功能融入新布局**：
- 旧版：Tab 切换 = 功能平铺
- 新版：对话永驻 + 右侧面板 + 底部抽屉 = 信息分层

## 丢失功能清单 + 融入方案

### P0 — 功能性缺失（用户无法完成基本操作）

| # | 丢失功能 | 融入位置 | 实现方式 |
|---|---------|---------|---------|
| 1 | 会话创建 | 对话区顶部 / 左侧列表顶部 | "+" 按钮 → NewTeamSessionModal |
| 2 | 会话删除 | 左侧列表右键 / 长按 | 右键菜单 → 确认删除 |
| 3 | 会话搜索 | 左侧列表顶部 | 搜索输入框 + 实时过滤 |
| 4 | 模板入口 | 右侧面板设置 Tab / 顶部快捷入口 | "模板管理"按钮 → 模板列表/编辑 |

### P1 — 功能降级（功能存在但体验明显下降）

| # | 丢失功能 | 融入位置 | 实现方式 |
|---|---------|---------|---------|
| 5 | 3D Office 全屏 | OfficeCompactBar 全屏按钮 | 点击 ⛶ → 全屏 3D 场景覆盖层 |
| 6 | Overview 概览 | 右侧面板团队 Tab 顶部 | 紧凑仪表盘（活跃任务数/完成率/平均耗时） |
| 7 | Messages 消息流 | 底部抽屉 / 右侧面板任务 Tab | 消息时间线（合并到 Session 树节点展开） |
| 8 | Review 评审 | 底部抽屉 d 层 Tab | ReviewReportView 已有，需接入展示 |
| 9 | 工作空间切换 | 左侧列表顶部下拉 | workspace selector dropdown |

### P2 — 体验增强（旧版有但可延后）

| # | 丢失功能 | 融入位置 | 实现方式 |
|---|---------|---------|---------|
| 10 | Teams 团队管理 | 右侧面板团队 Tab | 角色绑定编辑 + 成员状态 |
| 11 | Templates 模板页 | 独立子路由或右侧面板 | 模板列表 + CRUD |
| 12 | Footer 视图模式 | 右侧面板任务 Tab 顶部 | 切换按钮（列表/树形/紧凑） |
| 13 | 会话暂停/恢复 | 左侧列表 + 状态栏 | 会话卡片上的暂停图标 |

## 详细设计

### P0-1: 会话创建按钮

```
位置：左侧 TeamSessionListSidebar 顶部
样式：
  ┌─────────────────────────┐
  │ [+ 新建会话]  [🔍 搜索] │  ← 顶部操作栏
  ├─────────────────────────┤
  │ 会话列表...              │
  └─────────────────────────┘
行为：
  点击 → 打开 NewTeamSessionModal
  Modal 内可选择 workflow 包 / 模板
```

### P0-2: 会话删除

```
触发：右键会话卡片 / 长按（移动端）
菜单：
  ┌─────────────────────┐
  │ 重命名               │
  │ 复制会话 ID          │
  │ ─────────────────── │
  │ 🔴 删除会话          │
  └─────────────────────┘
确认：弹出确认对话框（"删除后不可恢复"）
```

### P0-3: 会话搜索

```
位置：左侧列表顶部搜索框
行为：
  输入关键词 → 实时过滤会话列表（匹配标题/内容）
  空输入 → 显示全部
  Ctrl+K → 聚焦搜索框
```

### P0-4: 模板入口

```
位置 1：右侧面板设置 Tab 底部
  [📋 模板管理] 按钮 → 展开模板列表

位置 2：NewTeamSessionModal 内
  "从模板创建" 选项 → 模板选择器

位置 3：左侧列表顶部
  [+ 新建会话 ▼] 下拉 → "从模板创建"
```

### P1-5: 3D Office 全屏

```
触发：OfficeCompactBar 右上角 ⛶ 按钮
行为：
  点击 → 全屏覆盖层（z-index: 100）
  覆盖层内：完整 3D Office 场景 + 关闭按钮
  ESC / 点击关闭 → 退出全屏
  全屏内可点击 agent 节点 → 查看该层详情
```

### P1-6: Overview 概览仪表盘

```
位置：右侧面板团队 Tab 顶部
样式：
  ┌─────────────────────────────┐
  │ 📊 团队概览                  │
  │                             │
  │ 活跃任务: 3    完成: 12     │
  │ 平均耗时: 4.2min            │
  │ 成功率: 89%                 │
  │ ████████████░░ 本周进度     │
  └─────────────────────────────┘
数据源：useHandoffStore 聚合计算
```

### P1-9: 工作空间切换

```
位置：左侧列表顶部（搜索框上方）
样式：
  ┌─────────────────────────┐
  │ [当前工作空间 ▼]         │  ← dropdown
  │ [+ 新建会话]  [🔍]      │
  ├─────────────────────────┤
  │ 会话列表...              │
  └─────────────────────────┘
行为：
  点击 → 下拉显示所有工作空间
  切换 → 刷新会话列表
```

## Implementation Plan

### Wave 1: P0 功能性缺失（必须立即修）
- [ ] T-01: TeamSessionListSidebar 加"新建会话"按钮 + 接入 NewTeamSessionModal
- [ ] T-02: TeamSessionListSidebar 加右键菜单（重命名/删除）+ 确认对话框
- [ ] T-03: TeamSessionListSidebar 加搜索框 + 实时过滤
- [ ] T-04: 右侧面板设置 Tab 加"模板管理"入口 + NewTeamSessionModal 加"从模板创建"

### Wave 2: P1 功能降级修复
- [ ] T-05: OfficeCompactBar 全屏覆盖层（点击 ⛶ → 全屏 3D + ESC 关闭）
- [ ] T-06: 右侧面板团队 Tab 加 Overview 概览仪表盘
- [ ] T-07: 底部抽屉完善（消息时间线 + ReviewReportView 接入）
- [ ] T-08: 左侧列表顶部加工作空间切换 dropdown

### Wave 3: P2 体验增强
- [ ] T-09: 右侧面板团队 Tab 加角色绑定编辑
- [ ] T-10: 模板 CRUD 完整流程（列表/新建/编辑/删除）
- [ ] T-11: 任务 Tab 加视图模式切换（列表/树形/紧凑）
- [ ] T-12: 会话卡片加暂停/恢复图标 + 状态指示

## 验收标准

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter @openAwork/web build` 通过
- [ ] 可以新建会话（从空白 / 从模板）
- [ ] 可以删除会话（右键 + 确认）
- [ ] 可以搜索会话
- [ ] 3D Office 可全屏查看
- [ ] 右侧面板团队 Tab 有概览数据
- [ ] 工作空间可切换
- [ ] 模板管理有入口

## Notes

- 估时：1-2 周（P0 3天 + P1 4天 + P2 3天）
- 核心策略：把旧版功能融入新布局，不是回退到旧版
- TeamSessionListSidebar 是改动最大的组件（加创建/删除/搜索/工作空间）
- 右侧面板团队 Tab 需要从"只看状态"升级为"可操作"

## 下一步：左侧会话列表视觉优化（待新对话执行）

当前 TeamSessionListSidebar.tsx（654 行）已有基础功能，但视觉太简陋。需要增强：

1. **会话卡片升级**：加相对时间（"2分钟前"）+ 最后消息预览 + hover 阴影 + active 缩放 + 选中态左侧 accent 竖条（部分已完成：ITEM_STYLE 已加 borderLeft + borderRadius + transition）
2. **按时间分组**：今天/昨天/更早（比较 session.updatedAt）
3. **空态/加载态**：骨架屏 shimmer + "还没有会话" + 搜索无结果
4. **右键菜单升级**：加 📌置顶 / 📋复制ID / ⏸暂停 菜单项
5. **折叠动画**：width transition 200ms ease（280px → 48px）

### 新建会话流程优化（v2 新增需求）

当前问题：
- 新建会话按钮只在 `teamWorkspaceId && onSubmitDraft` 都存在时才显示
- 工作区切换与新建会话的关联不够紧密
- 用户需要先切换工作区再新建，流程不直观

需要优化：
1. **新建会话流程**：
   - 新建按钮始终可见（不依赖 teamWorkspaceId 条件）
   - 点击新建 → 如果有多个工作区，先让用户选择工作区 → 再打开 NewTeamSessionModal
   - 或在 NewTeamSessionModal 内集成工作区选择步骤
2. **工作区切换体验**：
   - 切换工作区后自动刷新会话列表
   - 当前工作区名称显示更醒目
   - 工作区为空时显示引导（"在此工作区创建第一个会话"）
3. **整体布局优化**：
   - 顶部操作栏层次更清晰：工作区选择器 → 搜索框 → 新建按钮
   - 会话列表与操作栏之间有明确的视觉分隔
   - 折叠态下仍能看到"新建"入口（图标按钮）

文件位置：`apps/web/src/pages/team/runtime/TeamSessionListSidebar.tsx`
相关文件：`apps/web/src/pages/team/runtime/NewTeamSessionModal.tsx`

## 进展记录（260516 收尾轮）

### 已完成

**左侧会话列表**
- T-A 时间分组渲染（今天 / 昨天 / 更早），单工作空间时不冗余显示 workspace label
- T-B 骨架屏加载态：`@keyframes team-v2-shimmer` + 5 行 shimmer 占位，由 `loading` prop 控制
- T-C 折叠动画：`grid-template-columns 200ms ease` 已在主 grid 生效；`loading` 由 `workspaceState.loading || workspaceSnapshotState.loading` 注入

**整体布局优化（D-2 / D-3 / D-5）**
- D-2 IdleHint 信息层级：主标题 13→16、流程文本改 pills + 箭头分步、加底部 "↓ 在下方输入框开始" 引导
- D-3 a11y 状态可读：新增 `statusLabel(status)`，会话按钮 aria-label 包含 "运行中/已暂停/已完成/失败"
- D-5 a11y 键盘 + 状态：选中态 `aria-current="true"`；contextMenu 加 ArrowUp/Down/Home/End 键盘导航 + focus 同步背景色

### 已推迟（按 karpathy 准则）

- D-1 全量 design token 化：纯重构、零视觉变化、无 bug 证据
- D-4 响应式细节：当前 mobile/tablet 分支已就位，无具体问题报告
- D-6 性能复核：无 profiler / timing 测量数据，盲调风险高

### 验证

- LSP diagnostics: 我改动的 3 个文件 0 错误
- `pnpm --filter @openAwork/web typecheck`: 我改动文件 0 新错误（ChatPage / WorkflowEditor / team-runtime-settings-panel 的错误是预存在）
- `pnpm --filter @openAwork/web build`: 通过（首轮 6.79s）

### 改动文件

- `apps/web/src/pages/team/runtime/TeamSessionListSidebar.tsx`
- `apps/web/src/pages/TeamPageV2.tsx`
- `apps/web/src/index.css`

