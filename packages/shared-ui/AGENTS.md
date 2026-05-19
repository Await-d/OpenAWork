# shared-ui — 知识库

## 概述

60+ React 组件，被 Web、桌面端和移动端三个应用共同使用。是所有平台 UI 的唯一真实来源。组件按业务领域命名，而非抽象控件——这不是通用 UI 库。

## 目录结构

```
src/
├── index.ts              # 桶导出——所有公开组件必须在此导出
├── tokens.ts             # 设计令牌（颜色、间距）
├── primitives/           # 低层级基础 UI 原语
├── ChatMessage.tsx / StreamRenderer.tsx / ToolCallCard.tsx   # 聊天与流式 UI
├── AgentDAGGraph.tsx / AgentVizPanel.tsx                      # Agent 可视化
├── WorkflowCanvas.tsx / WorkflowModeToggle.tsx / WorkflowTemplateLibrary.tsx
├── ArtifactList.tsx / ArtifactPreview.tsx / ImagePreview.tsx
├── ChannelManager.tsx / MCPServerConfig.tsx / MCPServerList.tsx
├── CostBadge.tsx / CostOverview.tsx / ModelCostDisplay.tsx
├── ModelManager.tsx / ModelPriceConfig.tsx / ProviderSettings.tsx
├── CommandPalette.tsx
├── ContextPanel.tsx / FileFilterSettings.tsx / FileSearch.tsx / FileTreePanel.tsx
├── InstallProgressUI.tsx / InstalledSkillsManager.tsx
├── SkillDetailPage.tsx / SkillManagerDesktop.tsx / SkillManagerMobile.tsx / SkillMarketHome.tsx
├── RegistrySourceManager.tsx
├── PermissionPrompt.tsx / PermissionConfirmDialog.tsx / PermissionHistory.tsx
├── PlanPanel.tsx / PlanHistoryPanel.tsx / RootCausePanel.tsx
├── CronManager.tsx / ScheduleManagerUI.tsx
├── TeamPanel.tsx / TeammateCard.tsx
├── UsageDashboard.tsx / BudgetAlert.tsx
├── DiagnosticCard.tsx / LogViewer.tsx
├── OAuthButton.tsx / QRCodeDisplay.tsx / QRCodeScanner.tsx
├── PairingPanel.tsx / SSHConnectionPanel.tsx / DeveloperModePanel.tsx
├── TelemetryConsentDialog.tsx / TelemetryConsentModal.tsx
├── GenerativeUI.tsx / GenerativeUIValidator.ts
├── GitHubTriggerConfig.tsx
└── MobileResponsiveWrapper.tsx / AttachmentBar.tsx / VoiceRecorder.tsx
```

## 查找指引

| 任务               | 位置                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| 所有公开导出       | `src/index.ts`                                                        |
| 设计令牌           | `src/tokens.ts`                                                       |
| 聊天/流式 UI       | `ChatMessage.tsx`、`StreamRenderer.tsx`、`ToolCallCard.tsx`           |
| Agent 工作流可视化 | `AgentDAGGraph.tsx`、`AgentVizPanel.tsx`、`WorkflowCanvas.tsx`        |
| 技能管理 UI        | `SkillManager*.tsx`、`SkillMarket*.tsx`、`InstalledSkillsManager.tsx` |
| Provider/模型配置  | `ProviderSettings.tsx`、`ModelManager.tsx`、`ModelPriceConfig.tsx`    |
| 权限确认           | `PermissionPrompt.tsx`、`PermissionConfirmDialog.tsx`                 |
| 费用/用量          | `CostBadge.tsx`、`UsageDashboard.tsx`、`BudgetAlert.tsx`              |
| 遥测授权           | `TelemetryConsentDialog.tsx`、`TelemetryConsentModal.tsx`             |

## 约定

- 新组件必须加入 `src/index.ts`——未导出则对消费者不可见。
- 颜色/间距从 `./tokens.js` 导入，禁止硬编码。
- 按业务领域命名，而非控件类型（不用 Button、Input 等通用名）。
- 此包参与代码检查（严格 TS 规则）。
- **新增/修改组件前必须阅读 `DESIGN-TOKENS.md`**——该文件定义了 E · Nebula 色彩体系的强制执行标准。

## 设计 Token 强制规则

详见 `DESIGN-TOKENS.md`，以下为摘要：

1. **四色系统**：accent(靛青) / contrast(琥珀) / complement(珊瑚) / aux(靛蓝)
2. **线条 5 级**：invisible → subtle → default → emphasis → strong
3. **文字 4 级**：strong → default → muted → subtle
4. **间距 8 级**：4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 px
5. **圆角 6 级**：xs(4) / sm(6) / md(8) / lg(12) / xl(16) / pill(9999)
6. **动效 3 级**：micro(100ms) / normal(200ms) / emphasis(350ms)
7. **所有交互元素必须有 focus ring**
8. **所有组件必须覆盖 default/hover/active/focus/disabled 状态**

## 禁止事项

- 禁止添加通用抽象组件（Button、Input 等）——使用 `src/primitives/`。
- 禁止硬编码颜色/间距——使用 `tokens.ts` 或 CSS 变量。
- 新增组件后必须在 `src/index.ts` 补充导出。
- 禁止从 `dist/` 导入。
- **禁止使用 `DESIGN.md` 中的旧色值（靛紫 #5e6ad2 等）**——已废弃，使用 E · Nebula token。
- **禁止无 focus 态的交互元素**。
- **禁止单一状态组件**——必须覆盖完整交互状态。
