# .agentdocs/workflow/260320-shared-ui-web集成方案.md

## 概述

`packages/shared-ui` 中已有 60+ 功能组件，但 `apps/web` 的 `SettingsPage.tsx` 及其他页面几乎未集成任何一个。本方案系统梳理缺口，制定分批接入计划。

> 状态说明：🟡 待开始 | 🔵 进行中 | ✅ 完成 | — 不迁移

---

## Part 1：SettingsPage 扩展（高优先级）

- [x] SW-01 ✅：SettingsPage 接入 `ProviderSettings` / `ModelManager`，替换硬编码 provider 列表，localStorage 持久化
- [x] SW-02 ✅：SettingsPage 接入 `MCPServerConfig`，替换当前本地状态实现，localStorage 持久化
- [x] SW-03 ✅：SettingsPage 新增「用量与费用」板块，接入 `UsageDashboard` + `CostOverview` + `BudgetAlert`（全部渲染）
- [x] SW-04 ✅：SettingsPage 新增「权限记录」板块，接入 `PermissionHistory`
- [x] SW-05 ✅：SettingsPage 新增「遥测授权」板块，接入 `TelemetryConsentDialog`
- [x] SW-06 ✅：SettingsPage 新增「AI 提供商费用」板块，接入 `ModelPriceConfig`
- [x] SW-07 ✅：SettingsPage 新增「文件过滤」板块，接入 `FileFilterSettings`
- [x] SW-08 ✅：SettingsPage 新增「开发者模式」板块，接入 `DeveloperModePanel` + `LogViewer`（全部渲染）
- [x] SW-09 ✅：SettingsPage 新增「SSH 连接」板块，接入 `SSHConnectionPanel`
- [x] SW-10 ✅：SettingsPage 新增「归因配置」板块，接入 `AttributionConfigUI`

---

## Part 2：Layout / 导航扩展（高优先级）

- [x] LY-01 ✅：Layout 新增 `CommandPalette` 全局命令面板（Cmd+K 触发）
- [x] LY-02 ✅：Layout 接入 `PermissionPrompt` / `PermissionConfirmDialog`（工具调用前弹出）
- [x] LY-03 ✅：Layout TopBar 接入 `CostBadge` 实时费用展示
- [x] LY-04 ✅：Layout 右侧边栏新增 `ContextPanel` 上下文管理面板
- [x] LY-05 ✅：Layout 右侧边栏新增 `FileTreePanel` 文件树变更视图

---

## Part 3：新增页面路由（中优先级）

- [x] NP-01 ✅：新增 `/skills` 页面路由，接入 `SkillMarketHome` + `SkillDetailPage` + `InstalledSkillsManager` + `SkillManagerDesktop`
- [x] NP-02 ✅：新增 `/channels` 页面路由，接入 `ChannelManager`
- [x] NP-03 ✅：新增 `/workflows` 页面路由，接入 `WorkflowCanvas` + `WorkflowTemplateLibrary` + `WorkflowModeToggle`
- [x] NP-04 ✅：新增 `/team` 页面路由，接入 `TeamPanel` + `TeammateCard`
- [x] NP-05 ✅：新增 `/usage` 页面路由，接入 `UsageDashboard` + `ModelCostDisplay` + `CostOverview`
- [x] NP-06 ✅：新增 `/schedules` 页面路由，接入 `CronManager` + `ScheduleManagerUI`

---

## Part 4：ChatPage 功能增强（中优先级）

- [x] CP-01 ✅：ChatPage 接入 `AttachmentBar`（替换原文件附加按钮 + chip 列表）
- [x] CP-02 ✅：ChatPage 接入 `VoiceRecorder` 语音输入（🎙 按钮切换显示）
- [x] CP-03 ✅：ChatPage 接入 `ImagePreview` 图片预览（图片附件在输入区展示）
- [x] CP-04 ✅：ChatPage 接入 `GenerativeUIRenderer` 渲染结构化 AI 响应
- [x] CP-05 ✅：ChatPage 接入 `PlanPanel` 计划面板（右侧折叠面板）
- [x] CP-06 ✅：ChatPage 接入 `ToolCallCard` 工具调用展示（右侧面板 tools tab）
- [x] CP-07 ✅：ChatPage 接入 `AgentVizPanel` Agent 执行可视化（右侧面板 viz tab）
- [x] CP-08 ✅：ChatPage 接入 `WorkflowModeToggle` 模式切换（TopBar 左侧）

---

## Part 5：Onboarding 扩展（低优先级）

- [x] OB-01 ✅：OnboardingModal 接入 `PairingPanel`（Host/Client 配对流程，第3步可选）
- [x] OB-02 ✅：OnboardingModal 接入 `OAuthButton`（GitHub OAuth，登录步骤顶部）
- [x] OB-03 ✅：App.tsx 首次启动接入 `TelemetryConsentModal` + `OnboardingModal`（`onboarded` localStorage 门控）

---

## Part 6：不迁移项

| 功能 | 原因 |
|---|---|
| `MobileResponsiveWrapper` / `SkillManagerMobile` | Web 端已有响应式布局，移动端专属逻辑意义不大 |
| `QRCodeScanner`（相机扫码） | 浏览器需 HTTPS + 用户授权，优先级低 |
| `InstallProgressUI` | Skill 安装流程依赖后端 Gateway API 尚未接入，待 NP-01 完成后补 |

---

## 实施建议

### 阶段一（P0 / 本周）
SW-01、SW-02、LY-01、LY-02、LY-03 — SettingsPage 核心配置 + 全局交互

### 阶段二（P1 / 下周）
NP-01（Skills 市场）、CP-04~CP-07（Chat 增强）、LY-04、LY-05

### 阶段三（P2 / 后续迭代）
NP-02~NP-06（新页面）、SW-03~SW-10（Settings 高级板块）、OB-01~OB-03

---

## 技术注意事项

1. `ProviderSettings` / `ModelManager` 的 `ref` 接口需要配套 Gateway API（`/providers`、`/models`），接入前确认路由已实现
2. `MCPServerConfig` / `MCPServerList` 当前 SettingsPage 使用本地 state，迁移时需要接入 Gateway `/mcp/servers` CRUD
3. `CommandPalette` 需要全局 hotkey 注册（Cmd/Ctrl+K），在 App.tsx 层挂载
4. `PermissionPrompt` 需要订阅 agent-core 的 `PermissionManager` 事件流，依赖 Gateway WS 事件推送
5. `WorkflowCanvas` 依赖 `react-flow`，需确认 apps/web 已安装此依赖
6. 所有新路由需同步更新 Layout.tsx `railItems` 导航项
