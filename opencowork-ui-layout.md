# OpenCowork UI 布局与设计规范文档

> 基于源码分析 https://github.com/AIDotNet/OpenCowork (v0.6.0)

---

## 一、技术栈总览

| 层级       | 技术                                           | 版本       |
| ---------- | ---------------------------------------------- | ---------- |
| 桌面框架   | Electron                                       | ^36        |
| 构建工具   | electron-vite                                  | ^5.0       |
| UI 框架    | React                                          | ^19.2      |
| 语言       | TypeScript                                     | ^5.9       |
| 样式       | Tailwind CSS                                   | ^4.1       |
| 组件库     | shadcn/ui 风格（Radix UI）                     | —          |
| 图标       | lucide-react                                   | ^0.563     |
| 动画       | motion/react (Framer Motion)                   | ^12        |
| 状态管理   | Zustand + immer                                | ^5.0 / ^11 |
| 主题       | next-themes                                    | ^0.4       |
| 通知       | sonner                                         | ^2.0       |
| 命令面板   | cmdk                                           | ^1.1       |
| 代码编辑器 | @monaco-editor/react                           | ^4.7       |
| 终端       | @xterm/xterm                                   | ^6.0       |
| Markdown   | react-markdown + remark-gfm + rehype-highlight | —          |
| 图表       | mermaid                                        | ^11        |
| 国际化     | i18next + react-i18next                        | —          |
| 文档生成   | docx                                           | ^9.6       |
| 表格处理   | xlsx                                           | ^0.18      |
| PDF 渲染   | react-pdf                                      | ^10        |

---

## 二、整体布局结构

```
┌──────────────────────────────────────────────────────────┐
│                  TitleBar (h-10, 全宽)                    │
├──────┬─────────────────┬───────────────────────┬─────────┤
│ Nav  │ SessionList     │  Main Content Area    │ Right   │
│ Rail │ Panel           │                       │ Panel   │
│ w-12 │ (可折叠/拖拽)   │  Mode Toolbar (顶部)  │ (可选)  │
│      │                 │  MessageList (滚动)   │ 多标签  │
│      │ 项目树+会话列表  │  InputArea (底部)     │         │
└──────┴─────────────────┴───────────────────────┴─────────┘
```

### 顶层容器结构

```tsx
<div className="flex h-screen flex-col overflow-hidden">
  <TitleBar /> {/* 全宽，h-10 */}
  <div className="flex flex-1 overflow-hidden px-1 pt-1 pb-1.5">
    {/* 主卡片：圆角 + 毛玻璃 + 阴影 */}
    <div
      className="flex flex-1 overflow-hidden rounded-lg border border-border/60
                    bg-background/85 backdrop-blur-sm
                    shadow-[0_12px_40px_-20px_rgba(0,0,0,0.55)]"
    >
      <NavRail /> {/* 固定 w-12 shrink-0 */}
      <SessionListPanel /> {/* 可折叠，宽度可拖拽调整 */}
      {/* 主内容区 flex-1 min-w-0 */}
      <RightPanel /> {/* 条件渲染，可选显示 */}
    </div>
  </div>
</div>
```

**关键视觉细节：**

- 整体距屏幕边缘：`px-1 pt-1 pb-1.5`（轻微浮起感）
- 主卡片圆角：`rounded-lg`
- 边框：`border-border/60`（半透明边框）
- 毛玻璃：`bg-background/85 backdrop-blur-sm`
- 大阴影：`shadow-[0_12px_40px_-20px_rgba(0,0,0,0.55)]`

---

## 三、TitleBar（顶部标题栏）

**文件：** `src/renderer/src/components/layout/TitleBar.tsx`

### 尺寸与基础样式

- 高度：`h-10`（40px），`w-full shrink-0`
- 背景：`bg-background/80 backdrop-blur-md`（毛玻璃，比主卡片更模糊）
- 内边距：`px-3`
- 跨平台适配：
  - macOS：`pl-[78px]`（为交通灯按钮留空间）
  - Windows/Linux：`pr-[132px]`（为系统窗口控制按钮留空间）
- Electron 拖拽：整体加 `titlebar-drag` class，所有可交互元素加 `titlebar-no-drag`

### 左侧区域

```
[AppName] [Avatar] [状态提示文字]
```

- **应用名称**：`text-[12px] font-medium cursor-default select-none`
- **用户头像**：
  - 尺寸：`size-7`（28px）圆形
  - 样式：`rounded-full bg-muted ring-1 ring-border/50`
  - 悬停：`hover:ring-primary/50 hover:scale-105`（带缩放）
  - 点击展开 `HoverCard`（见下方）
- **状态友好提示**：`text-[11px] text-muted-foreground/80 max-w-[240px] truncate`

### 用户 HoverCard（头像点击展开）

```
┌──────────────────────────┐
│  渐变背景 (h-16)          │
│ ┌──┐                     │
│ │头│  用户名（可内联编辑）│
│ └──┘  [Open Source] tag  │
├──────────────────────────┤
│  翻译页面                │
│  主题切换（深/浅色）      │
│  语言切换（中/英）        │
│  设置                    │
└──────────────────────────┘
```

- 卡片宽：`w-60`，`p-0 overflow-hidden`
- 渐变头图：`h-16 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent`
- 大头像：`size-14 ring-2 ring-background`，`-mt-8`（向上偏移叠在头图上）
- 用户名：点击变为 `<Input>`，回车/失焦保存，ESC 取消
- Open Source badge：`bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20 rounded-full text-[10px]`
- 菜单项：`text-xs text-muted-foreground hover:bg-muted hover:text-foreground`，高度 `py-1.5`

### 右侧状态指示器（条件渲染）

| 指示器        | 触发条件         | 样式                                                                      |
| ------------- | ---------------- | ------------------------------------------------------------------------- |
| `AUTO`        | autoApprove 开启 | `bg-destructive/10 text-destructive text-[9px]`                           |
| `N pending`   | 有待审批工具调用 | `bg-amber-500/15 text-amber-600 animate-pulse text-[9px]`                 |
| SubAgent 名称 | 有运行中子 Agent | `bg-violet-500/10 text-violet-500 text-[9px]`，Brain 图标 `animate-pulse` |
| Team 进度     | 有活跃团队       | `bg-cyan-500/10 text-cyan-500 text-[9px]`，含进度 `completed/total`       |
| `N errors`    | 工具调用有错误   | `bg-destructive/10 text-destructive text-[9px]`                           |
| 后台命令      | 有运行中 shell   | Button ghost + Terminal 图标，点击展开 Popover 列表                       |
| Help          | 始终显示         | `size-7` 圆角图标按钮，外链                                               |

所有 badge/pill 共用 padding：`px-1.5 py-0.5 rounded`

### Windows 窗口控制

`<WindowControls />` 绝对定位于 `absolute right-0 top-0 z-10`，仅 Windows/Linux 渲染。

---

## 四、NavRail（左侧导航栏）

**文件：** `src/renderer/src/components/layout/NavRail.tsx`

### 尺寸与基础样式

- 宽度：`w-12`（48px），`shrink-0`，`h-full`
- 背景：`bg-muted/30`
- 右边框：`border-r`
- 布局：`flex flex-col items-center py-2`

### 导航项结构

```
┌────────┐
│  Chat  │  ← 顶部导航区，flex-col gap-1
│  Tasks │
│  Skills│
│  Draw  │
│  SSH   │
│        │
│  flex-1│  ← 弹性空白（撑开上下）
│        │
│Settings│  ← 底部固定区
│ v0.6.0 │  ← 版本号
└────────┘
```

### 导航按钮样式

```tsx
// 每个按钮
<button
  className="flex size-9 items-center justify-center rounded-lg
                   transition-all duration-200
                   /* 激活态 */
                   bg-primary/10 text-primary shadow-sm
                   /* 非激活态 */
                   text-muted-foreground hover:bg-muted hover:text-foreground"
>
  <Icon className="size-5" />
</button>
```

- 按钮尺寸：`size-9`（36px），`rounded-lg`
- 图标大小：`size-5`
- 激活态：`bg-primary/10 text-primary shadow-sm`
- 悬停态：`hover:bg-muted hover:text-foreground`
- 过渡：`transition-all duration-200`
- Tooltip：`side="right"` 方向提示

### 导航项列表

| 值         | 图标          | 行为                                     |
| ---------- | ------------- | ---------------------------------------- |
| `chat`     | MessageSquare | 打开会话列表侧栏，再次点击折叠侧栏       |
| `tasks`    | CalendarDays  | 打开 TasksPage（全屏替换主内容区）       |
| `skills`   | Wand2         | 打开 SkillsPage                          |
| `draw`     | Image         | 打开 DrawPage                            |
| `ssh`      | Monitor       | 打开 SshPage（首次后常驻 DOM，CSS 隐藏） |
| `settings` | Settings      | 底部固定，打开 SettingsPage              |

### 版本号

`text-[9px] text-muted-foreground/40 select-none`，从 package.json 读取

---

## 五、SessionListPanel（会话列表面板）

**文件：** `src/renderer/src/components/layout/SessionListPanel.tsx`

### 尺寸与基础样式

- 默认宽度：`LEFT_SIDEBAR_DEFAULT_WIDTH`（持久化到 settings-store）
- 宽度范围：有 `clampLeftSidebarWidth` 限制最小/最大值
- 支持鼠标拖拽右边缘调整宽度（`mousedown` → `mousemove` → `mouseup`）
- 高度：`h-full`
- 折叠：由 `leftSidebarOpen` 控制，通过 `AnimatePresence` + `PanelTransition` 动画
- 折叠动画方向：`side="left"` 滑出

### 面板内部布局

```
┌─────────────────────┐
│ [+新建] [+项目] [折叠] │  ← 顶部工具栏
├─────────────────────┤
│ [搜索框]             │  ← Search Input
├─────────────────────┤
│ ▼ Project A  (3)    │  ← 项目组（可折叠）
│   └ Session 1       │
│   └ Session 2       │
│ ▶ Project B  (1)    │  ← 折叠状态
├─────────────────────┤
│ Session (无项目)     │  ← 无项目会话
└─────────────────────┘
```

### 项目组样式

- 项目行：`text-xs font-medium rounded-lg px-2.5 py-1.5`
- 激活态：`bg-muted text-foreground`
- 非激活：`text-muted-foreground hover:bg-muted/40 hover:text-foreground`
- 折叠箭头：`ChevronRight size-3.5`，展开时 `rotate-90`，过渡 `duration-200 ease-in-out`
- 项目图标：`FolderOpen size-4 shrink-0`
- 折叠动画：`grid transition-[grid-template-rows,opacity] duration-200`
  - 折叠：`grid-rows-[0fr] opacity-0 pointer-events-none`
  - 展开：`grid-rows-[1fr] opacity-100`
- 子会话缩进：`ml-4 border-l border-border/40 pl-2`

### 会话列表项样式

- 容器：`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm`
- 激活态：`bg-accent text-accent-foreground`
- 非激活：`text-foreground/80 hover:bg-muted/60`
- 图标：`size-4` 或 `size-3.5`（pin 图标），`shrink-0`
- 标题：`truncate text-sm leading-4`
- 双击标题：进入内联编辑（`<input>` 替换文字）
- 右侧元数据（`ml-auto flex shrink-0 items-center gap-1`）：
  - 运行中：`Loader2 size-3.5 animate-spin text-blue-500`
  - 完成：`CheckCircle2 size-3.5 text-emerald-500`
  - 队列数量：`rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary`
  - 置顶图标：`Pin size-3 text-muted-foreground/30 -rotate-45`
  - 模式标签：`rounded bg-muted px-1 py-px text-[8px] uppercase text-muted-foreground/40`
  - 消息计数：`text-[10px] text-muted-foreground/40`

### 右键菜单（ContextMenu）

**项目右键菜单：** 置顶/取消置顶、重命名、修改工作目录、修改默认模型、删除

**会话右键菜单：** 重命名、导出 Markdown、导出 JSON、复制、清空消息、置顶/取消置顶、切换模式（子菜单）、删除

### 搜索功能

- 搜索框：`Input` 组件，`Search` 图标前缀
- 搜索范围：会话标题 + 模式名 + 已加载消息内容（全文检索）
- 内容匹配时显示摘要片段：`text-[9px] text-muted-foreground/40 truncate`

---

## 六、主内容区（Main Content Area）

**文件：** `src/renderer/src/components/layout/Layout.tsx`（内联）

### 页面路由（互斥，AnimatePresence mode="wait"）

| 条件                  | 渲染页面        | 动画 key         |
| --------------------- | --------------- | ---------------- |
| `tasksPageOpen`       | `TasksPage`     | `tasks-page`     |
| `skillsPageOpen`      | `SkillsPage`    | `skills-page`    |
| `settingsPageOpen`    | `SettingsPage`  | `settings-page`  |
| `drawPageOpen`        | `DrawPage`      | `draw-page`      |
| `translatePageOpen`   | `TranslatePage` | `translate-page` |
| `chatView === 'home'` | `ChatHomePage`  | `chat-home`      |
| 默认                  | 聊天视图        | `main-layout`    |

所有页面均为懒加载（`React.lazy`），外包 `<Suspense>` fallback 为居中 `Loader2` spinner。

SSH 页面特殊处理：**首次打开后常驻 DOM**，通过 `display: none` 切换隐藏，保留 xterm buffer。

### 聊天视图内部结构

```
┌─────────────────────────────────────────┐
│  Mode Toolbar (shrink-0, px-3 py-2)     │  ← 模式切换栏
├─────────────────────────────────────────┤
│  MessageList (flex-1, overflow-y-auto)  │  ← 消息列表
├─────────────────────────────────────────┤
│  InputArea (shrink-0)                   │  ← 输入区
└─────────────────────────────────────────┘
```

外层背景渐变：`bg-gradient-to-b from-background to-muted/20`

### Mode Toolbar（模式切换栏）

- 容器：`flex shrink-0 items-center gap-2 px-3 py-2`
- 当左侧栏折叠时，显示展开按钮（`PanelLeftOpen size-4`）
- 模式切换器容器：`rounded-lg bg-background/95 backdrop-blur-sm p-0.5 shadow-md border border-border/50`
- 每个模式按钮：`h-6 px-2.5 text-xs font-medium rounded-md transition-all duration-200`
- 激活高亮：`motion.span layoutId="layout-mode-switch-highlight"` 滑动动画
  - 弹簧参数：`stiffness: 380, damping: 30, mass: 0.8`
  - 高亮样式：`absolute inset-0 rounded-md border border-border/50 bg-background shadow-sm`

### 三种模式

| 模式      | 图标       | 含义          |
| --------- | ---------- | ------------- |
| `clarify` | CircleHelp | 澄清/问答模式 |
| `cowork`  | Briefcase  | 协作模式      |
| `code`    | Code2      | 代码模式      |

---

## 七、动画系统

### 页面切换动画

- 组件：`<PageTransition>` 包裹各页面
- 容器：`AnimatePresence mode="wait"`（等待当前页退出后新页入场）
- 文件：`src/renderer/src/components/animate-ui/`

### 侧栏动画

- 组件：`<PanelTransition side="left">`
- 容器：`AnimatePresence`（无 mode，并发动画）
- 左侧栏折叠/展开为滑入滑出

### 模式切换高亮动画

- 使用 Framer Motion `layoutId` 共享布局动画
- 高亮块在按钮间平滑滑动
- spring 弹簧：`stiffness: 380, damping: 30, mass: 0.8`

### 项目折叠动画

- 纯 CSS Grid 动画：`grid-rows-[0fr]` ↔ `grid-rows-[1fr]`
- 配合 `opacity-0` ↔ `opacity-100` 和 `pointer-events-none`
- 过渡：`transition-[grid-template-rows,opacity] duration-200 ease-in-out`

---

## 八、主题与颜色系统

### 主题切换

- 使用 `next-themes` 的 `ThemeProvider`
- 支持 `dark` / `light` 两种主题
- 在 `TitleBar` HoverCard 菜单可切换
- 快捷键：`Ctrl+Shift+D`

### CSS 变量

```css
--app-background    /* 自定义背景色（settings 可配置）*/
--app-font-family   /* 自定义字体 */
--app-font-size     /* 自定义字号 */
--background        /* 基础背景（hsl 值）*/
```

### 动画开关

```html
<html data-animations="enabled|disabled"></html>
```

通过 `animationsEnabled` settings 控制，写入 `root.dataset.animations`。

### 颜色使用规范（从源码归纳）

| 语义      | 使用的颜色 token                                           |
| --------- | ---------------------------------------------------------- |
| 激活/强调 | `primary`，`primary/10`（背景），`text-primary`            |
| 次要文字  | `text-muted-foreground`，`text-muted-foreground/60`，`/40` |
| 悬停背景  | `hover:bg-muted`，`hover:bg-muted/60`，`hover:bg-muted/40` |
| 激活背景  | `bg-accent text-accent-foreground`                         |
| 危险/错误 | `destructive`，`bg-destructive/10 text-destructive`        |
| 警告/等待 | `amber-500`，`bg-amber-500/15 text-amber-600`              |
| 成功      | `emerald-500`，`text-emerald-500`                          |
| Agent/AI  | `violet-500`，`bg-violet-500/10 text-violet-500`           |
| 团队协作  | `cyan-500`，`bg-cyan-500/10 text-cyan-500`                 |
| 边框      | `border-border`，`border-border/60`，`border-border/40`    |

---

## 九、快捷键系统

所有快捷键在 `Layout.tsx` 的 `keydown` 事件中统一处理：

| 快捷键              | 功能                          |
| ------------------- | ----------------------------- |
| `Ctrl+Shift+N`      | 新建会话（回到首页）          |
| `Ctrl+N`            | 新建会话                      |
| `Ctrl+B`            | 切换左侧栏                    |
| `Ctrl+Shift+B`      | 切换右侧面板                  |
| `Ctrl+,`            | 打开设置                      |
| `Ctrl+1/2/3`        | 切换 clarify/cowork/code 模式 |
| `Ctrl+L`            | 清空当前会话（需确认）        |
| `Ctrl+D`            | 复制当前会话                  |
| `Ctrl+P`            | 置顶/取消置顶                 |
| `Ctrl+↑/↓`          | 在会话间导航                  |
| `Ctrl+Home/End`     | 滚动到顶部/底部               |
| `Escape`            | 停止 AI 生成                  |
| `Ctrl+/`            | 显示快捷键帮助                |
| `Ctrl+Shift+C`      | 复制会话为 Markdown           |
| `Ctrl+Shift+A`      | 切换自动审批工具调用          |
| `Ctrl+Shift+D`      | 切换深/浅色主题               |
| `Ctrl+Shift+O`      | 从 JSON 导入会话              |
| `Ctrl+Shift+S`      | 备份所有会话为 JSON           |
| `Ctrl+Shift+E`      | 导出当前会话为 Markdown       |
| `Ctrl+Shift+Delete` | 删除所有会话（需确认）        |
| `Ctrl+Shift+T`      | 切换右侧面板标签              |

---

## 十、状态管理架构

所有 UI 状态集中在各 Zustand store，组件通过 selector 订阅：

| Store              | 职责                                                   |
| ------------------ | ------------------------------------------------------ |
| `ui-store`         | 页面导航、侧栏开关、右侧面板状态、chatView、mode       |
| `chat-store`       | 会话列表、消息、项目、activeSessionId，持久化到 SQLite |
| `settings-store`   | 主题、字体、语言、apiKey、侧栏宽度等，持久化           |
| `agent-store`      | 运行中 Agent、工具调用审批队列、后台进程               |
| `provider-store`   | AI Provider 配置（模型列表）                           |
| `app-plugin-store` | 插件管理                                               |
| `team-store`       | 多 Agent 团队任务                                      |
| `ssh-store`        | SSH 连接配置                                           |
| `cron-store`       | 定时任务                                               |

---

## 十一、设计风格总结

### 整体视觉风格

- **极简桌面 App 风格**：无边框窗口，主内容区略微浮离屏幕边缘（`px-1 pt-1 pb-1.5`），圆角卡片感
- **毛玻璃层次感**：TitleBar `backdrop-blur-md`，主卡片 `backdrop-blur-sm`，透明度叠加营造景深
- **半透明 + 深色阴影**：`bg-background/85`、`border-border/60` 让界面轻盈，大阴影增强立体感
- **克制的色彩**：主色调单一，大量使用 `muted`/`muted-foreground` 降噪，状态色（amber/violet/cyan/emerald）按需点缀

### 间距规律

| 场景         | 值                                                                  |
| ------------ | ------------------------------------------------------------------- |
| 列表项内边距 | `px-2.5 py-1.5`                                                     |
| 工具栏内边距 | `px-3 py-2`                                                         |
| 图标按钮尺寸 | `size-7`（小）/ `size-9`（中）/ `size-12`（大头像）                 |
| 列表间距     | `gap-1`（密）/ `gap-2`（标准）                                      |
| 文字大小     | 主文字 `text-sm`，次要 `text-xs`，微标注 `text-[9px]`~`text-[11px]` |

### 交互细节

- **Tooltip 统一**：所有图标按钮配 Tooltip，NavRail 方向 `side="right"`，顶栏方向 `side="bottom"`
- **悬停统一**：`hover:bg-muted hover:text-foreground` 为标准悬停，过渡 `transition-all duration-200`
- **内联编辑**：用户名、会话标题均支持双击/点击进入内联 input 编辑，回车确认，ESC 取消
- **右键菜单**：会话项和项目组均有 ContextMenu，操作后配合 `sonner` toast 反馈（含撤销 action）
- **加载状态**：懒加载页面用 `Loader2 animate-spin` 居中占位；运行中会话用 `Loader2 animate-spin text-blue-500`
- **弹簧动画**：模式切换高亮用 Framer Motion layoutId 共享布局动画，弹簧参数 `stiffness: 380, damping: 30`
- **SSH 页面保活**：首次打开后 DOM 常驻，`display: none` 切换，保留终端 buffer 状态
