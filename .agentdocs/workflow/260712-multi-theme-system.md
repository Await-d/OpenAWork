# 260712 - 多主题系统改造

## Task Overview

将当前项目从 dark/light 双主题升级为多主题系统，支持主题风格（Aurora / Nebula / Linear）与明暗模式（Dark / Light / System）两个维度独立选择、任意组合。

## Current Analysis

### 现状
- 主题切换通过 `<html>` 上添加/移除 `.light` class 实现
- `:root` = Nebula 暗色，`:root.light` = Nebula 亮色
- `ThemeMode = 'system' | 'light' | 'dark'`，只有明暗维度
- 没有主题风格选择器
- CSS 变量定义在 `apps/web/src/index.css`（3500+ 行）
- 状态管理在 `stores/settings/display-preferences.ts`
- 切换逻辑在 `App.tsx`
- 设置 UI 在 `pages/settings/display/display-tab-content.tsx`

### 目标
- 新增 `themeStyle: 'nebula' | 'aurora' | 'linear'` 维度
- `ThemeMode` 保持不变（system/light/dark）
- 两个维度独立：用户可以选 "Aurora + Dark" 或 "Linear + Light" 等任意组合
- 切换机制从 `.light` class 改为 `data-theme` + `data-mode` 属性
- 设置页面增加主题风格选择器（带预览卡片）
- 所有现有的 toggle 按钮（NavRail、TitlebarToolsMenu 等）保持工作

## Solution Design

### CSS 变量架构

```css
/* 当前：:root = dark, :root.light = light */
/* 改为：[data-theme="nebula"][data-mode="dark"] 等 */

:root {
  --theme-style: nebula;
  --theme-mode: dark;
}

/* Nebula Dark */
:root[data-theme="nebula"][data-mode="dark"] { ... }
/* Nebula Light */
:root[data-theme="nebula"][data-mode="light"] { ... }
/* Aurora Dark */
:root[data-theme="aurora"][data-mode="dark"] { ... }
/* Aurora Light（修复文字对比度版） */
:root[data-theme="aurora"][data-mode="light"] { ... }
/* Linear Dark */
:root[data-theme="linear"][data-mode="dark"] { ... }
/* Linear Light */
:root[data-theme="linear"][data-mode="light"] { ... }
```

### 关键决策

1. **变量名映射**：A-D 主题使用 `--bg / --text / --accent` 等简短变量名，项目现有 Nebula 使用 `--bg-base / --fg-strong / --accent` 等。需要做一层映射，让现有组件代码不需要改。
2. **`:root.light` 选择器**：需要全部替换为 `[data-mode="light"]` 形式。index.css 中有大量 `:root.light .xxx` 覆盖规则，需要批量替换。
3. **向后兼容**：首次加载时，如果没有 `data-theme` 属性，默认 `nebula` + `dark`/`light`（根据 system preference）。

## Complexity Assessment
- Atomic steps: 7 → +2
- Parallel streams: 否 → 0
- Modules/systems/services: 4+（index.css、store、App.tsx、settings page、layout 组件） → +1
- Long step (>5 min): 是（index.css 重构） → +1
- Persisted review artifacts: 否 → 0
- OpenCode available: 否 → 0
- **Total score**: 4
- **Chosen mode**: Full orchestration
- **Routing rationale**: 5+ 步骤、跨 4+ 模块、index.css 单文件 3500+ 行重构，需要完整跟踪

## Implementation Plan

### Phase 1: CSS 变量层重构
- [x] T-01: 在 `index.css` 顶部新增 3 套主题的 CSS 变量定义（6 组 data-theme + data-mode），映射到项目现有变量名 ✅
- [x] T-02: 将 `:root` 默认变量改为 `[data-theme="nebula"][data-mode="dark"]` ✅
- [x] T-03: 将 `:root.light` 改为 `[data-theme="nebula"][data-mode="light"]` ✅
- [x] T-04: 批量替换所有 `:root.light` 选择器为 `[data-mode="light"]`（保留组件级覆盖） ✅

### Phase 2: 状态管理
- [x] T-05: 在 `display-preferences.ts` 中新增 `themeStyle: ThemeStyle` 和 `setThemeStyle` ✅

### Phase 3: 切换逻辑
- [x] T-06: 修改 `App.tsx`（web + desktop），将 `.light` class 切换改为 `data-theme` + `data-mode` 属性设置 ✅

### Phase 4: 设置 UI
- [x] T-07: 在 `display-tab-content.tsx` 中新增主题风格选择器（带预览色板卡片） ✅

### Phase 5: 验证
- [x] T-08: 检查所有 toggle 入口（NavRail、TitlebarToolsMenu、命令面板等）是否正常工作 ✅
- [x] T-09: 桌面端 App.tsx + global.css 同步修改 ✅
- [x] T-10: lint 检查通过 ✅

## Notes

- Aurora 亮色需要使用修复后的文字对比度版本（`--text: #0a0e2e` 等）
- Linear 暗色直接使用 demo 中的变量值
- 3 套主题的变量名需要统一映射到项目现有的 `--bg-base / --fg-strong / --accent` 等命名
- 不改桌面端 `apps/desktop/src/styles/global.css`（桌面端走自己的 HSL 变量体系，后续单独处理）
