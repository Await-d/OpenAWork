# 260704 显示设置扩展实施方案

## Task Overview

在已有的显示设置（display tab）基础上，新增 5 项设置，补齐与 opencode 对标的显示/展示控制能力：
1. 推理块显隐（完全隐藏，不只是折叠）
2. 命令面板按钮显隐
3. 网关状态指示点显隐
4. 顶栏终端按钮显隐
5. 深色/浅色/跟随系统主题切换

## Current Analysis

### 已有基础
- `apps/web/src/stores/settings/display-preferences.ts` — Zustand 持久化 store（v2，10 项设置）
- `apps/web/src/pages/settings/display/display-tab-content.tsx` — 显示设置页面（3 Section + 重置）
- 设置 tab 已注册在 `settings-page-helpers.ts` 的 TABS 和 TAB_CATEGORIES 中

### 目标消费组件位置
| 设置项 | 消费组件 | 文件路径 |
|--------|---------|---------|
| 推理块显隐 | `AssistantReasoningBlock` | `apps/web/src/components/chat/assistant/assistant-reasoning-block.tsx` |
| 命令面板按钮显隐 | `ChatTopBar` | `apps/web/src/components/chat/session/ChatTopBar.tsx` |
| 网关状态指示点显隐 | `AppSidebar` | `apps/web/src/components/layout/AppSidebar.tsx` |
| 顶栏终端按钮显隐 | `ChatTopBar` | `apps/web/src/components/chat/session/ChatTopBar.tsx` |
| 主题切换 | `App.tsx` + CSS 变量 | `apps/web/src/App.tsx`（已有 `prefers-color-scheme` 检测） |

## Solution Design

### Store 扩展
在 `display-preferences.ts` 新增 5 个字段，版本 v2→v3，migrate 保留已有设置。

### UI 扩展
在 `display-tab-content.tsx` 新增 2 个 Section：
- **界面元素显隐**（命令面板、网关状态点、终端按钮）
- **外观**（主题模式：跟随系统/浅色/深色）

推理块显隐加入现有"推理与工具调用" Section。

### 消费接入
每个设置项在对应组件中 `useDisplayPreferencesStore` 读取并条件渲染。
主题切换通过 `document.documentElement` 的 `data-theme` 属性 + CSS 变量实现。

## Complexity Assessment
- Atomic steps: 5 → score 0
- Parallel streams: 无 → score 0
- Modules/systems: 3+（store、display tab、ChatTopBar、AssistantReasoningBlock、App.tsx）→ score +1
- Long step (>5 min): 否 → score 0
- Persisted review artifacts: 是 → score +1
- OpenCode available: 是 → score -1
- **Total score: 1**
- **Chosen mode: Lightweight**
- **Routing rationale**: 5 步跨多模块但无并行需求，轻量模式顺序执行。

## Implementation Plan

### Phase 1: Store 扩展
- [x] T-01: 在 `display-preferences.ts` 新增 5 个字段 + migrate v2→v3 ✅
- [x] T-02: 在 `display-tab-content.tsx` 新增"界面元素显隐"和"外观"两个 Section ✅

### Phase 2: 消费接入
- [x] T-03: `ChatTopBar.tsx` 接入命令面板按钮 + 终端按钮显隐 ✅
- [x] T-04: `AppSidebar.tsx` 接入网关状态指示点显隐 ✅
- [x] T-05: `assistant-reasoning-block.tsx` 接入推理块显隐（在 ChatPageSections 渲染处） ✅
- [x] T-06: `App.tsx` 接入主题切换（data-theme + CSS 变量） ✅

## Notes
- 主题切换需要确认项目 CSS 变量是否支持 `[data-theme="dark"]` 选择器，或需要新增 dark 主题变量覆盖
- 所有设置即时生效并自动持久化，无需保存按钮
