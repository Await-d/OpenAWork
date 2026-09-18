# team/ — 团队页面前端模块

> 本文件是 `apps/web/src/pages/team/` 目录的 Agent 约束文档。
> 所有在此目录下新增、修改、移动文件的操作必须遵循以下规则。
>
> **维护约定**：本文件只描述「目录职责 + 规则 + 依赖方向」，**不枚举具体文件清单**。
> 文件会持续拆分/改名，枚举式清单必然过期（本文件曾因此严重失真）。
> 需要文件清单时请看实际目录，或看 `conversation/AGENTS.md` 等就近文档。

---

## 目录结构

`team/` 根目录**只放 `AGENTS.md`**，所有源码按职责下沉到下列子目录：

```
team/
├── AGENTS.md                # 本文件（根目录唯一文件）
├── conversation/            # team 对话装配层（视图 / 状态机 / 提交路由 / ops）
│   ├── extras/              #   对话视图的窗口墙、feed、消息卡片等展示单元
│   ├── ops/                 #   对话区内联运维卡片
│   └── submit/              #   提交路由（stream / inbound / handoff）
├── hooks/                   # 页面级 hook（协作、工作区状态、视图状态持久化）
├── views/                   # 页面级装配视图
│   ├── templates/           #   模板管理页
│   └── workbench/           #   层级 todo 工作台
└── runtime/                 # 团队运行时 UI（核心功能区）
    ├── shell/               # shell 框架 + 子区域
    │   ├── session-view/    #   session 内部视图（层级对话抽屉）
    │   ├── sidebar/         #   侧边栏（工作区文件树 / session 卡片）
    │   ├── header/          #   顶部导航 + 工作区布局
    │   ├── controls/        #   交互控件（对话区 / 暂停 / 建议条 / 动态条）
    │   └── modals/          #   弹窗组件
    ├── data/                # 数据流 + 类型 + 派生（纯逻辑为 .ts，React 上下文层为 .tsx）
    ├── hooks/               # 运行时 hook
    ├── shared/              # 跨 tab 共享组件（含 content-kit/ 基础件）
    ├── tabs/                # 中间区 tab 页面
    │   ├── conversation/    #   对话 tab
    │   ├── tasks/           #   任务 tab
    │   ├── governance/      #   治理 tab（宪法 / 设置 / 审计）
    │   ├── metrics/         #   指标 tab
    │   ├── office/          #   办公 tab
    │   └── overview/        #   概览 tab
    └── styles/              # CSS 样式
```

`conversation/` 是本模块中约束最严的部分，有独立且**权威**的契约文档：
**`conversation/AGENTS.md`**。改动对话层之前必须读它，且不得违反其中任何硬约束。

---

## shell/ 子目录职责边界

### session-view/ — session 内部视图

**放什么**：点击某一层后展开该层 session 的对话抽屉等「session 内部」视图。

**不放什么**：与 session 无关的全局 UI（属 header/）；列表/导航（属 sidebar/）。

**命名规范**：`Team*.tsx` / `Layer*.tsx`

> 说明：历史上此处曾承载 session 头部 / 空态 / substate 进度条等组件，它们**已迁出**
> 到 `conversation/extras/`（对话相关的 chrome 归对话层所有）。

### sidebar/ — 团队页侧边栏

**放什么**：工作区文件树、session 卡片、文件预览、session 列表运行时状态与其 hook。

**不放什么**：session 内部视图（属 session-view/）；全局头部（属 header/）。

> 说明：**会话列表不在团队页侧边栏渲染**，由全局侧栏 `AppSidebar` / `FusionSidebar` 承载。

### header/ — 顶部导航 + 工作区布局

**放什么**：统一 tab 栏（`TeamTabBar`，`variant="single"` 为 V2 默认单条超级栏：工作区切换 + 主 tab + 状态栏 + 3D 合并一行；主 tab 窄屏**横向滚动而非折叠**，两端渐隐 + 滚轮/触控/键盘翻页）、状态栏、顶部栏、工作区切换下拉及其布局辅助模块。

**不放什么**：具体 tab 内容（属 tabs/）；session 视图（属 session-view/）。

### controls/ — 交互控件

**放什么**：对话输入区及其状态视图、暂停/恢复、失败流指示器、建议条、子 tab 栏、动态条、欢迎屏、快捷概览、可resize分隔条等交互控件与其 hook。

**不放什么**：完整页面布局（属 header/）；弹窗（属 modals/）。

### modals/ — 弹窗组件

**放什么**：所有 Modal / Dialog 组件；确认对话框、创建表单弹窗及其配置/模板数据。

**命名规范**：`*Modal.tsx`（例外：表单分片、配置与样式模块按职责命名）

### shell/ 根目录

**只放 shell 框架自身的组合层与原子件**（如 `team-runtime-shell-primitives.tsx`）。
一旦根目录文件接近体积上限，就把子组件提取到上面的对应子目录，
保持根文件只做「组合 + 状态分发」，不做具体渲染。

---

## 文件体积规则（继承 apps/web/AGENTS.md）

- **单文件上限 1500 行**：1300 行起预警，**超过 1500 行必须拆分，不得豁免**。
  （注意：根 `AGENTS.md` 写的是「超过 2000 行必须拆分」，两处阈值不一致；
  本目录按 **apps/web 的 1500 硬上限**执行。）
- 超过 80 行的渲染块 → 提取为独立组件
- 超过 3 层嵌套 JSX → 提取为独立组件
- 拆分时按职责边界切分，而非按行数截断：
  - UI 渲染 → 独立子组件（放对应子目录）
  - 数据获取 / 副作用 → `use*.ts`
  - 纯计算 / 格式化 → 同级 `*.ts`
  - 常量 / 类型 → 同级 `*.constants.ts` / `*.types.ts`
- **禁止**用 `// ===== Section A =====` 之类的注释分隔充当拆分——那是拆分信号，不是解决方案

---

## 新组件归类决策树

1. **是否属于对话装配层？**（对话视图 / 状态机 / 提交路由 / op 卡片）→ `conversation/`
2. **是否是 session 内部视图？**（层级抽屉等）→ `runtime/shell/session-view/`
3. **是否是侧边栏 / 文件树 / session 卡片？** → `runtime/shell/sidebar/`
4. **是否是顶部栏 / tab 栏 / 状态栏 / 全局布局？** → `runtime/shell/header/`
5. **是否是交互控件？**（按钮组 / 输入区 / 指示器 / 动态条）→ `runtime/shell/controls/`
6. **是否是弹窗？** → `runtime/shell/modals/`
7. **是否是跨 tab 共享的非 shell 组件？** → `runtime/shared/`（基础展示件 → `runtime/shared/content-kit/`）
8. **是否是某个 tab 的专属内容？** → `runtime/tabs/<tab-name>/`
9. **是否是数据类型 / 派生 / mock / 配置？** → `runtime/data/`
10. **是否是页面级装配视图？** → `views/`（模板页 → `templates/`，工作台 → `workbench/`）
11. **是否是页面级 hook？** → `hooks/`；运行时 hook → `runtime/hooks/`

---

## 跨目录依赖方向

```
conversation/ ──→ runtime/data/      ✅
conversation/ ──→ runtime/shared/    ✅
session-view/ ──→ hooks/             ✅（视图消费 hook 数据）
session-view/ ──→ data/              ✅（视图读取类型 / 配置）
sidebar/      ──→ hooks/             ✅
header/       ──→ hooks/             ✅
controls/     ──→ hooks/             ✅
tabs/         ──→ hooks/             ✅
tabs/         ──→ shared/            ✅
tabs/         ──→ data/              ✅
views/        ──→ hooks/             ✅
views/        ──→ conversation/      ✅

hooks/        ──→ data/              ✅（hook 消费类型定义）
data/         ──→ (无 React 依赖)     ✅（纯类型 / 配置 / 派生；React 上下文层单独放 .tsx）

session-view/ ──→ sidebar/           ❌ 禁止
sidebar/      ──→ session-view/      ❌ 禁止
controls/     ──→ session-view/      ❌ 禁止（通过 props 通信）
```

`conversation/` 自带更严格的依赖约束（含对 `pages/chat-page/**` 的禁令与历史例外清单），
以 `conversation/AGENTS.md` 为准。

---

## 测试文件位置

- 测试文件与源文件**同目录**放置（前端约定）
- 命名：`<ComponentName>.test.tsx`
- 拆分产生的 hook / util 一律**同步补对应测试**；无测试覆盖的文件不允许作为拆分起点
