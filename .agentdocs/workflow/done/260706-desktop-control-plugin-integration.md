# 260706 系统桌面控制插件集成

## Task Overview

将 OpenCowork 的 Desktop Control / App Plugin 思路借鉴到 OpenAWork：前端提供插件开关与工作区诊断控制台，后端按用户插件配置决定是否向 Agent 注入 `desktop_control`，并在 sandbox 执行前再次门控，最终通过桌面端 Tauri 本机桥执行截图、点击、输入、按键、组合键、滚动、等待等系统桌面操作。

## Current Analysis

参考实现中 Desktop Control 属于默认隐藏的 App Plugin：开启后注册系统桌面工具，关闭后注销。OpenAWork 当前技术边界不同，不能直接复刻 renderer 内注册工具的方式，而应落到现有 `settings -> web-client -> agent-gateway -> tool-definitions -> sandbox -> desktop sidecar/Tauri` 链路。

关键约束：

- 前端禁止在 `apps/` 中直接 `fetch()` 网关端点，新增调用必须走 `@openAwork/web-client`。
- Agent 可见工具列表必须由后端按用户配置过滤，不能只依赖前端开关。
- 历史会话或恢复路径可能带着旧工具调用，因此 sandbox 执行前必须有 fail-closed 门控。
- 系统桌面操作属于高风险能力，需要和现有 permission preview / audit log 链路衔接。
- 桌面端实际执行应通过本机 bridge，网关 sidecar 只持有 loopback URL 和 token。

## Solution Design

采用双层门控 + 桌面本机桥方案：

- 配置层：新增 `plugin_settings.desktopControl.enabled`，由 `/settings/plugins` 读写并保存到 `user_settings`。
- 注入层：`filterPluginControlledToolsForUser()` 过滤 `desktop_control`，在普通 stream 与 permission resume stream 两条路径都生效。
- 执行层：`tool-sandbox` 对 `desktop_control` 执行前再次读取当前用户插件配置，未启用时拒绝并写 audit log。
- 能力层：新增 `desktop_control` 工具定义、参数 schema、网关 route 与 `@openAwork/web-client` 封装。
- 桌面层：Tauri 启动 loopback desktop control bridge，把 `OPENAWORK_DESKTOP_CONTROL_URL` / `TOKEN` 注入 gateway sidecar。
- 前端层：插件设置页提供开关与注入状态说明，工作区页提供状态和操作控制台。

## Complexity Assessment

- Atomic steps: 11 → +2
- Parallel streams: no → 0
- Modules/systems/services: 6（OpenCowork 参考、web-client、web、agent-gateway、agent-core permission、desktop Tauri）→ +1
- Long step (>5 min): yes → +1
- Persisted review artifacts: yes → +1
- OpenCode available: no → 0
- **Total score**: 5
- **Chosen mode**: Full orchestration
- **Routing rationale**: 该任务跨前端配置、后端注入、sandbox 安全门控和桌面本机执行，且需要保留可复查的实施与验证记录，因此按 Full orchestration 归档。

## Implementation Plan

### Phase 1: 参考与方案确认

- [x] T-01 ✅: 拉取并分析 `/temp/OpenCowork` 中 Desktop Control / App Plugin 的启用与注册方式。
- [x] T-02 ✅: 确认 OpenAWork 当前“操作电脑”能力已有 `desktop_automation` 浏览器 sidecar 路径，新系统桌面控制应独立为 `desktop_control`。

### Phase 2: 后端配置与工具注入

- [x] T-03 ✅: 新增插件配置 schema、`/settings/plugins` 读写和 `@openAwork/web-client` settings 封装。
- [x] T-04 ✅: 在普通 stream 与 permission resume stream 中按用户插件配置过滤 `desktop_control`。
- [x] T-05 ✅: 在 `tool-sandbox` 执行前加入 `desktop_control` 二次门控，关闭时 fail-closed 并写入审计。
- [x] T-06 ✅: 新增 `desktop_control` 工具定义、参数 schema、manager、网关 route 与 route 测试。

### Phase 3: 桌面端桥接

- [x] T-07 ✅: 新增 Tauri desktop control bridge 和平台 native 模块，由桌面启动流程注入 bridge URL / token 给 gateway sidecar。

### Phase 4: 前端配置与诊断控制台

- [x] T-08 ✅: 插件页新增“系统桌面控制”开关，保存到插件配置并明确说明注入状态。
- [x] T-09 ✅: 工作区页新增系统桌面控制状态卡片和截图、点击、输入、按键、组合键、滚动、等待控制台。
- [x] T-10 ✅: 修复新增控制卡片在窄栏下 driver 文本竖排的问题，改为自适应网格与单行省略。

### Phase 5: 验证与归档

- [x] T-11 ✅: 执行后端单元、web-client 单元、类型检查、构建、lint、Playwright smoke 与视觉 QA 证据整理。

## Notes

- 前端配置已完成：插件页开关会保存 `plugin_settings.desktopControl.enabled`；工作区页会读取 `/desktop-control/status` 并提供真实操作按钮。
- 后端注入已完成：`desktop_control` 只有在当前用户插件启用时才进入 Agent 工具列表；普通流与 approval resume 路径都接入过滤。
- 后端执行门控已完成：即使历史上下文或恢复路径带着 `desktop_control` 调用，sandbox 也会在执行前检查用户配置，未启用则拒绝。
- 网关 route 与 web-client 已完成：`status/screenshot/click/type/key/hotkey/scroll/wait` 均有封装和测试覆盖。
- 桌面 bridge 已接入：Tauri 桌面端启动 loopback bridge，并通过环境变量把 URL/token 传给 gateway sidecar。
- 视觉 QA 暴露一个既有风险：375px 移动宽度下设置页整体多栏布局会把插件详情/工作区内容推到视口外；这不是本次桌面控制卡片引入的问题，按用户约束未修复。
- 环境限制：当前机器没有 `cargo`，且缺少 Linux Tauri 打包依赖 `pkg-config` / WebKitGTK，无法在本环境完成 `cargo fmt/check` 与 `pnpm --filter @openAwork/desktop build`。
- Memory sync: completed。
