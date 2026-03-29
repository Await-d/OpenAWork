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

## 禁止事项

- 禁止添加通用抽象组件（Button、Input 等）——使用 `src/primitives/`。
- 禁止硬编码颜色/间距——使用 `tokens.ts`。
- 新增组件后必须在 `src/index.ts` 补充导出。
- 禁止从 `dist/` 导入。
