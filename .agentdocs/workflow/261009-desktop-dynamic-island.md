# 261009-desktop-dynamic-island.md

## 任务概述

为 OpenAWork 桌面端（Tauri v2）实现"灵动岛"（Dynamic Island）功能：一个小型浮窗（pill 形，约 220×48px），固定于主显示器顶部中央，始终置顶、无边框，实时展示 Agent 运行状态与网关健康；鼠标 hover 展开为卡片（约 420×140px），显示当前会话标题、最后消息预览与「打开会话」按钮；点击可跳转至主窗口对应 session。用户可在设置中开关，并可用全局快捷键 `Alt+Shift+I` 显示/隐藏。

## 当前分析

### 现状

- Tauri 主窗口 `main` 已通过 `WebviewWindowBuilder` 创建，Rust 侧有完整的托盘、全局快捷键、锁屏等成熟模式
- 桌面端生产构建：`apps/web/dist` 通过 `frontendDist` 加载到 Tauri WebView；dev 模式走 `devUrl`（Vite localhost）
- `gateway:health` 事件已在 Rust 侧（`update_gateway_health`）通过 `app.emit()` emit，所有窗口均可接收
- `useAuthStore`（Zustand persist）在 WebView 内共享 `localStorage`，island 窗口可直接读取 token，无需重新认证
- 当前没有多窗口架构，只有 `main` 一个窗口
- `tauri.conf.json` 的 `windows` 数组仅声明 main 窗口；island 需通过 Rust `WebviewWindowBuilder` 动态创建
- 主窗口 agent 状态变化目前无统一 emit 出口，需要在数据层补齐

### 约束

- **Windows 透明窗口**：`transparent: true` 时整个 WebView 背景透明，前端需 CSS `border-radius` + `rgba` 背景模拟 pill 形状；不能依赖 WebView 自身圆角
- **WebView 资源**：增加一个 island 窗口 ≈ 增加一个 Chromium 进程（~50-100MB），必须允许用户关闭（设置 + 快捷键）
- **多显示器**：定位取主显示器 `available_area`，不做多显示器漫游
- **数据隔离**：两个窗口的 Zustand 是独立内存实例，跨窗口同步必须走 Tauri `emit`/`listen`

## 方案设计

### 窗口架构

| 窗口 label | 用途 | 创建方式 |
|---|---|---|
| `main` | 完整工作台 | `tauri.conf.json` 声明 |
| `island` | 灵动岛浮窗 | Rust `setup()` 内 `WebviewWindowBuilder` 动态创建 |

island 窗口配置：
- `always_on_top(true)` / `decorations(false)` / `skip_taskbar(true)` / `focusable(false)` / `transparent(true)`
- 大小：折叠态 220×48，展开态 420×140（通过 `setSize` 切换）
- 位置：主显示器 `available_area` 顶部水平居中（考虑任务栏/Dock 偏移）
- URL：`index.html?island=1`（生产 dist）/ `devUrl + "?island=1"`（dev）

### 前端入口分流

`apps/web/src/main.tsx` 挂载前检测 `window.location.search.includes('island=1')`：
- 命中 → 渲染独立 `<IslandEntry />`（最小 Provider 树，不导入主 App 的 Layout/路由）
- 未命中 → 正常 `mountApp()`

`apps/desktop/src/main.tsx` 同步处理（dev 入口）。

### 数据流

```
主窗口 agent 状态变化
  → Rust 侧（或主窗口 Tauri emit）emit("island:agent-state", {state, sessionId, preview})
  → island 窗口 listen → Zustand store 更新 → pill 重渲染

Rust update_gateway_health
  → app.emit("gateway:health", health)（所有窗口）
  → island 窗口读取 → 显示网关注状态点（绿/黄/红）

island hover 展开
  → Tauri invoke("island_set_expanded", true) → Rust setSize(420, 140)
  → 前端卡片内部做 CSS 展开动画
  → mouseleave 800ms → invoke("island_set_expanded", false) → Rust setSize(220, 48)

island 点击「打开会话」
  → Tauri emit("island:navigate", sessionId)
  → 主窗口 listen → navigate(`/chat/${sessionId}`) + set_focus
```

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `apps/desktop/src-tauri/src/lib.rs` | 修改 | 新增 `create_island_window` / 3 个 island commands / `PersistedSettings.island_enabled` / 全局快捷键 `Alt+Shift+I` |
| `apps/web/src/main.tsx` | 修改 | 检测 `?island=1`，分流渲染 |
| `apps/desktop/src/main.tsx` | 修改 | 同上（dev 入口） |
| `apps/web/src/pages/island/IslandEntry.tsx` | 新增 | island 窗口专属引导 |
| `apps/web/src/components/island/DynamicIsland.tsx` | 新增 | pill 主组件 |
| `apps/web/src/stores/island/island-store.ts` | 新增 | Zustand store |
| `apps/web/src/pages/settings/desktop/`（相关子文件） | 修改 | 加「灵动岛」开关 |

## 复杂度评估

- 原子步骤数：14 个 → **+2**
- 可并行流：Rust 侧（T-01~04）与前端组件（T-05~07）部分可并行 → **+1**
- 涉及模块数：`src-tauri` + `apps/web/src` + `apps/desktop/src` ≥ 3 → **+1**
- 长步骤（>5min）：T-01 窗口定位 ~15min、T-07 主组件 ~20min → **+1**
- 需持久化评审：功能方案需记录 → **+1**
- **总评分**：**+6**
- **选定模式**：**Full orchestration**（score ≥ 3）
- **路由依据**：跨 Rust 窗口架构、前端入口分流、跨窗口状态同步三层，且原子步骤 14 个、跨 3+ 模块，需完整 master_plan 跟踪。

## 实施计划

> 状态说明：T-01~T-13 已实现并完成独立复核（2026-10-09 第二轮，证据见下表行号，文件为 `apps/desktop/src-tauri/src/lib.rs`）；T-14 需真机执行。Rust 侧行号基于复核后的文件。

### Phase 1: Rust 窗口与命令基础
- [x] T-01: `lib.rs` 新增 `create_island_window` —— `WebviewWindowBuilder`，`always_on_top`/`decorations(false)`/`skip_taskbar`/`transparent(true)`；定位至主显示器**可用区域**（`Monitor::work_area`）顶部水平居中；入口经 `initialization_script` 注入窗口模式（替代原 `?island=1` 方案，见偏差 1）→ 实现：`create_island_window` L2041-2061、`island_logical_position` L2020-2034
- [x] T-02: `lib.rs` 新增 Tauri commands：`island_set_expanded(expanded: bool)`（`setSize` 220×48 ↔ 420×140，并同步更新 x 坐标保持水平居中）、`island_toggle_visible()`（`show`/`hide`，返回切换后可见性）、`island_get_state()` → L1426-1453；尺寸常量 L56-60；展开/折叠实现 `apply_island_expanded` L2163-2178
- [x] T-03: `lib.rs` `setup()` 内：读取 `PersistedSettings.island_enabled`，为 `true` 时 `ensure_island_window`（L2714-2728）；`on_window_event` 拦截 island 窗口 `CloseRequested`（`api.prevent_close()` + `hide()`，不销毁，L2757-2765）
- [x] T-04: `PersistedSettings.island_enabled: Option<bool>`（`#[serde(default)]`，默认启用，L338）；`DesktopSettingsView`（L367）/ `DesktopSettingsPatch`（L393）同步扩展；`update_desktop_settings` 处理该字段并即时 show/hide（L1829-1848）；`island_is_enabled` L2011

### Phase 2: 前端 island 入口
- [x] T-05: `apps/web/src/main.tsx` 与 `apps/desktop/src/main.tsx` 经 `readDesktopWindowMode()` 分流，命中时**动态导入** `mount-island.tsx`（主窗口不付加载成本）→ `apps/web/src/island/window-mode.ts`、`apps/web/src/island/mount-island.tsx`
- [x] T-06: `apps/web/src/island/IslandApp.tsx`：island 专属引导（回读 `island_get_state` + 订阅事件 + `mark_island_host_ready`）；Rust 侧就绪标记 `IslandState.host_ready`（L259-262、L1461-1475）
- [x] T-07: `apps/web/src/island/island-pill.tsx`：pill 渲染（按 `tone` 变色脉冲点 + 状态文字）；hover 展开卡片（标题 + 预览 + 「打开会话」/「隐藏」）；点击经 `island_navigate` 通知主窗口；样式 `island.css`

### Phase 3: 数据层与跨窗口同步
- [x] T-08: `apps/web/src/island/island-store.ts`（Zustand）：`agentState`/`gatewayHealth`/`activeSessionId`/`sessionTitle`/`lastMessagePreview`/`expanded`/`visible` + action
- [x] T-09: 主窗口 `IslandReporter`（`apps/web/src/island/island-reporter.tsx`）挂在 `App.tsx`；数据源走 `subscribeSessionRunState` 总线（自带 `queueMicrotask` 合批，只在状态翻转时触发，避免按 token 高频 IPC）；Rust `island_report_agent_state` 转发（L1483-1510），未就绪时缓存、就绪后补发
- [x] T-10: island 窗口内 `listen("gateway:health")` 订阅（Rust `update_gateway_health` emit，L742-754；前端 `normalizeGatewayHealth` + `presentIslandStatus` 决定状态点）

### Phase 4: 设置 UI 与快捷键
- [x] T-11: 桌面端设置加「灵动岛」Section（`apps/web/src/pages/settings/desktop/desktop-tab-content.tsx` L639-667，开关 → `update_desktop_settings({ patch: { islandEnabled } })`）；Rust 收到关闭即 `hide()`（不销毁，便于再开）
- [x] T-12: `tauri_plugin_global_shortcut` 注册 `Alt+Shift+I`（L2743）**并在 handler 中接线**（L2650-2656 → `toggle_island_visible`）；`island_enabled=false` 时快捷键仍可用——`toggle_island_visible` 会重新启用并 `save_settings` 持久化（L2186-2199）

### Phase 5: 验证
- [x] T-13: `apps/web/src/island/island-types.test.ts`（18）+ `island-store.test.ts`（5）单元测试，共 23 个
- [ ] T-14: 手工验证清单（三端）—— 🟡 **待真机执行**（本机无 cargo / 无三端桌面环境）：
  - 启动后 island 显示于主显示器顶部中央（`work_area` 可用区域，考虑 macOS 菜单栏 / Windows 任务栏 / Linux 面板）
  - 折叠态 pill 颜色随 agent 状态变化（绿/黄/蓝/灰）
  - hover 展开卡片，显示正确会话信息；mouse leave 自动折叠（实现为 **450ms**，见偏差 5）
  - 点击「打开会话」→ 主窗口唤回并跳转到 `/chat/${sessionId}`
  - 点「隐藏」/ 设置中关闭 island → 窗口消失；重新开启 → 窗口恢复
  - `Alt+Shift+I` 切换显示/隐藏；在设置里关掉后再按 `Alt+Shift+I` 应能重新开启并持久化（重启后仍开）
  - 网关异常时 pill 显示红色状态点
  - **Linux**：窗口出现后人为拖动 / 由 WM 抢位，10s 内应自动回到顶部居中（位置校正任务）
  - **跨重启**：上次退出时处于展开态，下次启动窗口应是折叠尺寸 220×48（已把 island 排除出窗口状态记忆）

## 关键风险与规避

| 风险 | 影响 | 规避方式 |
|---|---|---|
| Windows 透明窗口背景 | 整个 WebView 透明，pill 外区域不可点击 | 前端全容器 `background: transparent`；pill 内层 `border-radius: 24px` + 半透明背景；外层 div 占满 100% 宽高并设 `pointer-events: none`，仅 pill 内层 `pointer-events: auto` |
| 多显示器坐标漂移 | Linux 下 WM 可能移动 always_on_top 窗口 | 每 10s 定时 `setPosition()` 校正（仅 Linux 平台判断）；Windows/macOS 通常稳定 → 已实现：`start_island_reposition` / `stop_island_reposition`（L2083-2153），隐藏与退出时置停止信号 |
| 窗口状态记忆覆盖 island 定位 | 上次退出时的展开尺寸/旧显示器坐标被 `tauri-plugin-window-state` 回写，出现「窗口 420×140 但状态是折叠」或落在已拔掉的显示器上 | 已实现：把 `island` 加入 `with_denylist`，定位完全由 `island_logical_position` 每次启动实时计算（L2631-2635） |
| 两窗口 Zustand 不同步 | island 显示过时 agent 状态 | 所有跨窗口数据通过 Tauri `emit`/`listen`；island 内 Zustand 只做本地渲染态，数据源是事件流 |
| island 窗口创建时 WebView 未就绪 | `mark_island_host_ready` 未调用前 emit 丢失 | 沿用现有 `DialogHostReady` 模式，Rust 侧维护 `island_host_ready` AtomicBool；未就绪时把状态写入 `last_agent_state` 缓存、不 emit，就绪后补发（L1461-1510） |
| 资源占用 | 多一个 Chromium 进程 | 设置默认开启但文档说明可关闭；`island_enabled` 关闭时不创建窗口（关闭时仅 hide，保留 WebView 以便秒开） |

## 备注

- island 窗口"展开"通过 Rust `setSize` 实现原生尺寸变化（前端 CSS transition 不适用于原生窗口），卡片内容区用 CSS `max-height` + `overflow: hidden` 做内部展开动画，窗口尺寸固定为展开大小，前端决定显示多少内容
- `focusable(false)` 意味着 island 不抢焦点；用户操作主窗口时不受干扰；点击 island 通过 `emit` 发消息给主窗口，不直接 `set_focus`
- **MVP 建议**：Phase 1+2 完成后即可做最小验证（pill 显示网关状态 + agent 运行脉冲），Phase 3 数据层和 Phase 4 设置 UI 可分两轮迭代交付

## 独立复核（2026-10-09 第二轮）

复核范围：`lib.rs` island 相关代码静态审查 + `apps/web`/`apps/desktop` 前端复跑门禁；**本机无 cargo/rustc，Rust 侧只做静态审查，未编译验证**。

本轮发现并修复的**真实缺口**（都在 island 代码内）：

| # | 缺口 | 影响 | 修复 |
|---|---|---|---|
| 1 | `Alt+Shift+I` 只注册、handler 未接线（原 handler 只处理 `Alt+Shift+O/P`） | 快捷键完全无效（T-12 表面完成、实际不工作） | `lib.rs` L2650-2656 增加 `matches_island` 分支 → `toggle_island_visible` |
| 2 | Linux 每 10s `setPosition()` 校正只有承诺、无实现（grep 无 reposition） | Linux 下 WM 挪窗后浮窗不再回位 | 新增 `start_island_reposition`/`stop_island_reposition`（L2083-2153）+ 常量 L63-68 + 调用点（L1842/L1846/L2067/L2073/L2205/L2209/L2762/L2783） |
| 3 | `island_logical_position` 用整块显示器 `position/size`，未用可用区域 | macOS 菜单栏 / Linux 面板会遮挡浮窗（T-14 第 1 条不成立） | 改用 `Monitor::work_area()`（L2025-2030），沿用物理→逻辑换算 |
| 4 | 窗口状态记忆（`tauri-plugin-window-state`）会回写 island 的尺寸/位置 | 上次退出时若为展开态，下次启动窗口 420×140 但状态是折叠 | `with_denylist(&[ISLAND_WINDOW_LABEL])`（L2631-2635） |
| 5 | `island_report_agent_state` 在 host-ready 前直接 `return Ok(())`，状态被丢弃 | 启动竞态下浮窗停在默认「待机」 | `IslandState.last_agent_state` 缓存 + 就绪后补发（L259-263、L1461-1510） |

其他记录（**未改代码**，只登记为偏差/待真机项）：

1. 入口分流用 `initialization_script` 注入 `__OPENAWORK_WINDOW_MODE__`，而非方案的 `?island=1`（Windows 下 `WebviewUrl::App` query 不可靠）。
2. 未使用 `.focusable(false)`，改用 `.focused(false)`（L2053）：pill 有 hover/点击交互，完全不接受焦点的窗口在部分平台会同时失去鼠标事件；`focused(false)` 已满足「不抢焦点」。
3. 跨窗口 emit 由 Rust 命令转发（主窗口 capability `deny-emit`，island capability 最小集 `capabilities/island.json`）。
4. 折叠延迟实现为 `COLLAPSE_DELAY_MS = 450`（`IslandApp.tsx`），方案文字写的是 800ms。
5. 样式中未使用 `pointer-events: none`（风险表第 1 行）：pill 铺满整个窗口，不存在透明死区，无需该技巧。
6. 前端 `islandListen` 与 `mark_island_host_ready` 之间存在极窄竞态（补发事件可能早于监听注册落地的 IPC）；已用「先 `island_get_state` 再 `mark_island_host_ready`」多一次 IPC 往返降低概率，真机若观察到首帧状态丢失可改为前端主动拉取。

