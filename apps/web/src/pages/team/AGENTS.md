# team/ — 团队页面前端模块

> 本文件是 `apps/web/src/pages/team/` 目录的 Agent 约束文档。
> 所有在此目录下新增、修改、移动文件的操作必须遵循以下规则。

---

## 目录结构（强制）

```
team/
├── runtime/                    # 团队运行时 UI（核心功能区）
│   ├── shell/                  # shell 框架 + 子区域
│   │   ├── session-view/       # 五层架构 session 视图（新 UI）
│   │   ├── sidebar/            # session 列表侧边栏
│   │   ├── header/             # 顶部导航 + 工作区布局
│   │   ├── controls/           # 交互控件（对话区 / 暂停 / 建议条）
│   │   └── modals/             # 弹窗组件
│   ├── data/                   # 数据流 + 类型 + mock
│   ├── hooks/                  # 自定义 hooks
│   ├── shared/                 # 跨 tab 共享组件
│   ├── tabs/                   # 中间区 tab 页面
│   │   ├── conversation/       # 对话 tab
│   │   ├── tasks/              # 任务 tab
│   │   ├── governance/         # 治理 tab（宪法 / 设置）
│   │   ├── metrics/            # 指标 tab
│   │   ├── office/             # 办公 tab
│   │   └── overview/           # 概览 tab
│   └── styles/                 # CSS 样式
├── team-page-sections.tsx      # 页面级 section 组件
├── use-team-collaboration.ts   # 协作 hook
├── use-team-workspace-snapshot-state.ts
└── use-team-workspace-state.ts
```

---

## shell/ 子目录职责边界

### session-view/ — 五层架构 session 视图

**放什么**：

- `TeamSessionView.tsx`：五层架构的 session 对话入口组件
- `TeamSessionHeader.tsx`：session 头部（roleLayer / substate / metadata）
- `TeamSessionEmptyState.tsx`：空态引导 + starter chips
- `TeamSubstateProgressBar.tsx`：substate 进度条（drafting_spec → completed）
- `LayerConversationDrawer.tsx`：层级对话抽屉（点击某层展开 session）
- 未来：`TeamClarificationPanel.tsx`（澄清问题面板）

**不放什么**：

- 与 session 无关的全局 UI（属于 header/）
- 列表/导航（属于 sidebar/）

**命名规范**：`Team*.tsx` / `Layer*.tsx`

### sidebar/ — 团队页文件树侧边栏

**放什么**：

- `TeamSidebarWithFileTree.tsx`：团队页左侧栏，仅渲染工作区文件树与「新建会话 / 工作区」入口。
  会话列表已不再在此渲染（由全局侧栏 AppSidebar / FusionSidebar 承载），相关
  `TeamSessionListSidebar.tsx` 组件已删除。
- `TeamSessionSidebar.tsx`：侧边栏外壳（含搜索 / 过滤）
- `SessionCard.tsx`：单条 session 卡片

**不放什么**：

- session 内部视图（属于 session-view/）
- 全局头部（属于 header/）

### header/ — 顶部导航 + 工作区布局

**放什么**：

- `TopTeamHeader.tsx`：顶部导航栏（仅 V1 旧布局 fallback 使用）
- `TeamTabBar.tsx`：统一 tab 切换栏。`variant="single"` 为 V2 默认的单条超级栏
  （工作区切换 + 主 tab + 状态栏 + 3D 合并为一行），子 tab 常驻第二行、主 tab 窄屏溢出「更多」
- `TeamStatusBar.tsx`：全局状态栏（V2 作为超级栏 centerSlot 内嵌）
- `MainWorkspace.tsx`：主内容区布局容器
- `WorkspaceSwitcher.tsx`：工作区切换下拉

**不放什么**：

- 具体 tab 内容（属于 tabs/）
- session 视图（属于 session-view/）

### controls/ — 交互控件

**放什么**：

- `ConversationArea.tsx`：对话输入区域
- `PauseResumeControls.tsx`：暂停/恢复按钮组
- `FailureFlowIndicator.tsx`：失败流指示器
- `SuggestionBar.tsx`：建议条（快捷操作）
- `TabRow.tsx`：tab 切换行

**不放什么**：

- 完整页面布局（属于 header/）
- 弹窗（属于 modals/）

### modals/ — 弹窗组件

**放什么**：

- 所有 Modal / Dialog 组件
- 确认对话框、创建表单弹窗

**命名规范**：`*Modal.tsx`

---

## 文件体积规则（继承根 AGENTS.md）

- **单文件上限 1500 行**，1300 行开始预警
- 超过 80 行的渲染块 → 提取为独立组件
- 超过 3 层嵌套 JSX → 提取为独立组件
- 拆分时按职责边界切分：
  - UI 渲染 → 独立子组件（放对应子目录）
  - 数据获取 / 副作用 → `hooks/use-*.ts`
  - 纯计算 / 格式化 → `data/*.ts`

---

## 新组件归类决策树

1. **是否是 session 内部视图？**（对话 / 进度 / 空态 / 层级抽屉）→ `session-view/`
2. **是否是 session 列表 / 导航？** → `sidebar/`
3. **是否是顶部 / 全局布局？** → `header/`
4. **是否是交互控件？**（按钮组 / 输入区 / 指示器）→ `controls/`
5. **是否是弹窗？** → `modals/`
6. **是否是跨 tab 共享的非 shell 组件？** → `shared/`
7. **是否是某个 tab 的专属内容？** → `tabs/<tab-name>/`
8. **是否是数据类型 / mock / 配置？** → `data/`
9. **是否是自定义 hook？** → `hooks/`

---

## shell 根目录文件（仅保留 4 个）

以下文件保留在 `shell/` 根目录，因为它们是 shell 框架本身：

| 文件                                     | 职责                            | 预警              |
| ---------------------------------------- | ------------------------------- | ----------------- |
| `team-runtime-shell.tsx`                 | shell 主入口（状态管理 + 路由） | 1292 行，接近预警 |
| `team-runtime-shell-frame.tsx`           | shell 框架布局（slot 组合）     | 1462 行，预警区间 |
| `team-runtime-shell-primitives.tsx`      | 原子组件（ChromeBadge 等）      | 正常              |
| `build-team-runtime-shell-view-model.ts` | view model 构建                 | 正常              |

**当 `team-runtime-shell.tsx` 或 `team-runtime-shell-frame.tsx` 超过 1500 行时**：

- 从中提取独立子组件到对应子目录
- 保持 shell 根文件只做"组合 + 状态分发"，不做具体渲染

---

## 跨目录依赖方向

```
session-view/ ──→ hooks/     ✅（视图消费 hook 数据）
session-view/ ──→ data/      ✅（视图读取类型 / 配置）
sidebar/      ──→ hooks/     ✅
header/       ──→ hooks/     ✅
controls/     ──→ hooks/     ✅
tabs/         ──→ hooks/     ✅
tabs/         ──→ shared/    ✅
tabs/         ──→ data/      ✅

hooks/        ──→ data/      ✅（hook 消费类型定义）
data/         ──→ (无依赖)   ✅（纯类型 / 配置 / mock）

session-view/ ──→ sidebar/   ❌ 禁止
sidebar/      ──→ session-view/ ❌ 禁止
controls/     ──→ session-view/ ❌ 禁止（通过 props 通信）
```

---

## 测试文件位置

- 测试文件与源文件**同目录**放置（前端约定）
- 命名：`<ComponentName>.test.tsx`
- 示例：`session-view/TeamSessionView.test.tsx`
