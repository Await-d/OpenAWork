# shared-ui 设计 Token 规范

> 本文件为 `@openAwork/shared-ui` 的强制执行标准。所有组件实现必须引用此处定义的 token，禁止硬编码色值、间距、圆角。

## 色彩体系（E · Nebula）

### 四色系统

| 角色 | 暗色值 | 亮色值 | 用途 |
|------|--------|--------|------|
| accent（靛青） | `#5cd4c0` | `#6471f0` | CTA / active / 选中 / 主交互 |
| contrast（琥珀） | `#f0b429` | `#a06bff` | warning / 次级强调 / 数据高亮 |
| complement（珊瑚） | `#f06b7e` | `#e0497a` | danger / destructive / 通知 |
| aux（靛蓝） | `#8b9cf5` | `#3aa0ff` | info / 链接 / 代码高亮 |

### 每色 4 层级

```
--xxx:          实色（文字/图标/填充）
--xxx-muted:    14% 透明度背景
--xxx-subtle:   7% 透明度极淡背景
--xxx-border:   30% 透明度边框
```

### 线条 5 级

| 级别 | 暗色 | 亮色 | 用途 |
|------|------|------|------|
| invisible | `hsla(215,20%,50%,0.03)` | `rgba(15,23,60,0.03)` | 结构暗示 |
| subtle | `hsla(215,20%,50%,0.07)` | `rgba(15,23,60,0.05)` | 面板内分组 |
| default | `hsla(215,18%,50%,0.12)` | `rgba(15,23,60,0.08)` | 卡片/输入框 |
| emphasis | `hsla(215,16%,55%,0.20)` | `rgba(15,23,60,0.14)` | hover/focus |
| strong | `hsla(215,14%,60%,0.30)` | `rgba(15,23,60,0.22)` | active/selected |

### 文字 4 级

| 级别 | 暗色 | 亮色 | 用途 |
|------|------|------|------|
| strong | `#f1f4f8` | `#161a3a` | 标题/重点数字 |
| default | `#c8d1e0` | `#43497a` | 正文 |
| muted | `#7b8a9e` | `#7c83a9` | 次级信息/标签 |
| subtle | `#4d5b6e` | `#a8aec8` | 占位符/disabled |
| on-accent | `#052e22` | `#ffffff` | accent 色上的文字 |
| on-contrast | `#1f1200` | `#ffffff` | contrast 色上的文字 |
| on-complement | `#1f0508` | `#ffffff` | complement 色上的文字 |

## 间距系统

基准网格：8px

| Token | 值 | 用途 |
|-------|-----|------|
| spacing-1 | 4px | 图标内间距 |
| spacing-2 | 8px | 紧凑元素间 |
| spacing-3 | 12px | 卡片内 padding |
| spacing-4 | 16px | 标准间距 |
| spacing-5 | 20px | 面板 padding |
| spacing-6 | 24px | 区块间距 |
| spacing-8 | 32px | 大区块分隔 |
| spacing-12 | 48px | 页面顶部留白 |

## 圆角

| Token | 值 | 用途 |
|-------|-----|------|
| radius-xs | 4px | inline badge / 小标签 |
| radius-sm | 6px | 按钮 / 输入框 |
| radius-md | 8px | 卡片 / 下拉 |
| radius-lg | 12px | 面板 / 大卡片 |
| radius-xl | 16px | Modal / 弹窗 |
| radius-pill | 9999px | 胶囊 / 状态标签 |

## 阴影

| Token | 用途 | 暗色定义 |
|-------|------|----------|
| shadow-sm | 卡片默认 | `0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)` |
| shadow-md | 浮层/下拉 | `0 2px 4px rgba(0,0,0,0.2), 0 8px 24px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)` |
| shadow-lg | Modal | `0 4px 8px rgba(0,0,0,0.2), 0 24px 56px -16px rgba(0,0,0,0.5)` |
| shadow-glow | CTA 强调 | `0 0 16px -4px rgba(92,212,192,0.25)` |

## 动效

| Token | Duration | Easing | 用途 |
|-------|----------|--------|------|
| motion-micro | 100ms | `cubic-bezier(0.4, 0, 0.2, 1)` | hover 色变 / opacity |
| motion-normal | 200ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 面板展开 / 路由切换 |
| motion-emphasis | 350ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性动画 / 强调 |

## 图表配色（8 色序列）

| # | 暗色 | 亮色 | 名称 |
|---|------|------|------|
| 1 | `#5cd4c0` | `#6471f0` | 靛青 |
| 2 | `#f0b429` | `#a06bff` | 琥珀 |
| 3 | `#8b9cf5` | `#3aa0ff` | 靛蓝 |
| 4 | `#f06b7e` | `#e0497a` | 珊瑚 |
| 5 | `#c4b5fd` | `#7c3aed` | 薰衣草 |
| 6 | `#86efac` | `#16a34a` | 青柠 |
| 7 | `#67e8f9` | `#0891b2` | 天蓝 |
| 8 | `#fda4af` | `#e11d48` | 玫瑰 |

CSS 变量名：`--chart-1` 到 `--chart-8`，按上表序号对应。

## 代码语法高亮

| Token | 暗色 | 亮色 | 语义 |
|-------|------|------|------|
| hl-keyword | `#8b9cf5` | `#3aa0ff` | 关键字 |
| hl-function | `#5cd4c0` | `#6471f0` | 函数名 |
| hl-type | `#f0b429` | `#a06bff` | 类型 |
| hl-string | `#86efac` | `#16a34a` | 字符串 |
| hl-number | `#fda4af` | `#e11d48` | 数字 |
| hl-comment | `#4d5b6e` | `#a8aec8` | 注释 |

## 图标规范

| 尺寸 | 用途 | stroke-width |
|------|------|-------------|
| 16px | 行内 / 密集列表 | 1.75 |
| 18px | 导航 / 标准 | 1.75 |
| 20px | 按钮 / 工具栏 | 1.75 |
| 24px | Hero / 空状态 | 1.5 |

所有图标使用 Lucide 风格（24x24 viewBox, stroke, round cap/join）。

## 响应式断点

| 名称 | 宽度 | 布局变化 |
|------|------|----------|
| desktop-xl | ≥1440px | Rail 展开 + 双栏内容 |
| desktop | 1024–1439px | Rail 收窄 + 单栏 |
| tablet | 768–1023px | Rail 折叠为图标 + KPI 2列 |
| mobile | <768px | Rail 隐藏 + 底部导航 + 单列 |

## Focus 可访问性

所有可交互元素必须有 focus ring：
- 默认：`outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: 0 0 0 4px var(--accent-subtle)`
- Danger：`outline-color: var(--complement)`
- 禁止移除 focus 样式（`:focus { outline: none }` 仅在有自定义 focus 指示器时允许）

## 主题切换

切换暗亮主题时，给 `body` 添加 `theme-transitioning` 类，250ms 后移除：
```ts
document.body.classList.add('theme-transitioning');
// 切换主题 class
setTimeout(() => document.body.classList.remove('theme-transitioning'), 250);
```

## 强制执行规则

1. **禁止硬编码色值** — 所有颜色必须通过 CSS 变量引用
2. **禁止魔法数字间距** — 间距必须使用 spacing token（4/8/12/16/20/24/32/48）
3. **禁止自定义圆角** — 必须使用 radius token
4. **禁止无 focus 态的交互元素** — 按钮/链接/输入框必须有 focus ring
5. **禁止无语义色的状态表达** — success/warning/danger/info 必须使用对应语义色
6. **禁止单一状态组件** — 必须覆盖 default/hover/active/focus/disabled/loading/error

---

## 布局骨架

```
.shell: grid(220px rail + 1fr main), min-height 100vh
.rail: sticky top:0, height 100vh, bg-raised, border-right default
.topbar: height 56px, sticky top:0, z-index 10, backdrop-filter blur(16px)
.page: padding 24px 28px 64px, max-width 1100px, margin auto
```

### Rail 导航

| 元素 | 规范 |
|------|------|
| brand 区域 | 底部 border-subtle 分隔，logo + 名称 + 版本号 |
| section-title | 10px / 600 / uppercase / 0.12em letter-spacing / fg-subtle |
| rail-link | 8px 10px padding / radius-sm / border 1px transparent |
| rail-link hover | bg-hover + border-subtle + fg-default |
| rail-link active | bg accent-subtle + border accent-border + 左侧 3px 渐变线(accent→contrast) + glow |
| rail-link-icon | 18×18 / fg-subtle / active 时 fg accent |
| rail-link-badge | pill / accent 背景 / fg-on-accent / 10px 700 |
| rail-link-dot | 6px 圆 / success 色 + 6px glow |
| rail-footer | border-top subtle / 用户卡片(avatar + name + role) |

### Topbar

| 元素 | 规范 |
|------|------|
| search-box | height 32px / bg-overlay / border-default / radius-sm / min-width 200px |
| search-box focus | border accent-border + shadow 0 0 0 2px accent-subtle |
| topbar-btn | 32×32 / bg-overlay / border-default / radius-sm |
| topbar-btn-badge | absolute top-4 right-4 / complement 背景 / 16px pill |
| topbar-avatar | 28×28 / 渐变(accent→contrast) / ring: 2px bg-raised + 3px accent-border |

---

## 组件样式规范

### Hero 卡片

```
background: linear-gradient(180deg, bg-overlay, bg-raised)
border: 1px solid border-default
border-radius: radius-lg
box-shadow: shadow-md
::after — 顶部高光线: linear-gradient(90deg, transparent, border-emphasis, transparent) 1px
::before(glow) — radial-gradient accent-subtle 左上 + contrast-subtle 右下
```

### KPI 卡片

```
background: linear-gradient(180deg, bg-overlay, bg-raised)
border: 1px solid border-default
border-radius: radius-md
hover: border-emphasis + translateY(-1px) + shadow-sm
featured: border accent-border + glow
::after — 顶部高光线(同 hero)
icon-wrap: 38×38 / radius-md / xxx-muted 背景 + xxx-subtle 边框 + 实色图标
  c1=accent, c2=contrast, c3=aux, c4=complement
kpi-number: 24px / 700 / tabular-nums / fg-strong
kpi-trend: pill / 11px 600 / success-muted 或 accent-muted 背景
```

### 工具调用卡片

```
padding: 12px 16px / radius-md / bg-overlay / border-default
hover: border-emphasis + bg-surface
active: border accent-border + shadow ring 1px accent-subtle + bg accent-subtle
tool-icon: 32×32 / radius-sm / 分色:
  read = aux-muted + aux-subtle border + aux 色
  edit = contrast-muted + contrast-subtle border + contrast 色
  shell = accent-muted + accent-subtle border + accent 色
tool-name: 12.5px / 600 / fg-default
tool-path: 11px / mono / fg-subtle / ellipsis
tool-status.done: 20px 圆 / success-muted / success 色 ✓
tool-status.running: accent-muted / spin-dot(8px border 动画)
```

### 时间线

```
grid: 12px dot列 + 1fr 内容列
tl-dot: 8px 圆 / success=发光 / accent=发光 / muted=无发光
tl-line: absolute 1px / linear-gradient(border-default → border-invisible)
tl-text: 12px / fg-muted / strong=fg-default
tl-time: 11px / mono / fg-subtle
```

### Toast 通知

```
padding: 10px 14px / radius-md / border 1px
4 种语义:
  success: success-muted bg + success-border + success 文字
  warning: contrast-muted bg + contrast-border + contrast 文字
  error: complement-muted bg + complement-border + complement 文字
  info: aux-muted bg + aux-border + aux 文字
入场动画: translateY(-8px) → 0, opacity 0→1, 300ms
```

### 表单输入

```
form-input:
  height: 36px / padding 0 12px / radius-sm
  bg: bg-surface / border: border-default / color: fg-strong
  ::placeholder: fg-subtle
  :hover: border-emphasis
  :focus: border accent-border + shadow 0 0 0 3px accent-subtle
  .error: border complement-border + shadow 0 0 0 3px complement-subtle
  :disabled: opacity 0.5 / cursor not-allowed / bg-overlay

toggle:
  track: 36×20 / radius 10px / bg-elevated / border-default
  thumb: 14×14 圆 / fg-muted / left 2px
  checked: track bg accent-muted + border accent-border / thumb translateX(16px) + accent 色
```

### 按钮变体

```
btn-primary:
  height 36px / padding 0 16px / radius-sm / 600
  bg: accent / color: fg-on-accent
  border: 1px rgba(255,255,255,0.1)
  shadow: shadow-accent + inset 高光
  hover: accent-hover + translateY(-1px) + shadow-glow
  active: accent-active + translateY(0)
  loading: opacity 0.85 + spinner(12px border 动画)
  disabled: opacity 0.4

btn-secondary:
  bg: bg-surface / border: border-default / color: fg-default
  hover: bg-hover + border-emphasis

btn-danger:
  bg: complement / color: fg-on-complement
  shadow: complement glow
  hover: complement-hover

btn-ghost-sm:
  height 28px / padding 0 10px / radius-xs
  bg: bg-surface / border: border-default / color: fg-muted / 11.5px 500
  hover: bg-hover + fg-default + border-emphasis
```

### 空状态

```
padding: 48px 32px / radius-lg / bg-overlay
border: 1px dashed border-emphasis
text-align: center
empty-icon: fg-subtle / opacity 0.6 / stroke-width 1
empty-title: 16px / 600 / fg-strong
empty-desc: 13px / fg-muted / max-width 320px / line-height 1.5
CTA: btn-primary
```

### 骨架屏

```
shimmer 动画:
  background: linear-gradient(90deg, bg-surface 25%, bg-elevated 50%, bg-surface 75%)
  background-size: 200% 100%
  animation: 1.5s ease-in-out infinite (background-position 200%→-200%)
skel-circle: 32×32 圆
skel-line: height 10px / radius 5px / 宽度变体 w40/w50/w60/w80
skel-badge: 48×20 / pill
```

### Tooltip

```
tooltip-bubble:
  padding 6px 12px / radius-sm
  bg: bg-elevated / border: border-emphasis
  color: fg-default / 11.5px 500 / nowrap
  shadow: shadow-md
tooltip-arrow:
  8×8 方块 / rotate(45deg) / 同色 bg + 右下 border
  position: bottom -5px center
```

### Badge

```
padding: 3px 10px / radius-pill / 11px 600 / border 1px
6 种语义:
  accent: accent-muted bg + accent 色 + accent-border
  success: success-muted bg + success 色 + success-border
  warning: contrast-muted bg + contrast 色 + contrast-border
  danger: complement-muted bg + complement 色 + complement-border
  info: aux-muted bg + aux 色 + aux-border
  neutral: bg-surface bg + fg-muted 色 + border-default
```

### 进度条

```
bar: height 5px / radius 3px / bg-elevated
bar-fill: radius 3px / transition width 500ms
  .accent: linear-gradient(90deg, accent, accent-hover)
  .warn: linear-gradient(90deg, contrast, contrast-hover)
```

### Sparkline

```
container: flex / align-items flex-end / gap 3px / height 28px
spark-bar: flex 1 / height var(--h) / radius 2px
  background: linear-gradient(180deg, accent, accent-muted)
```

### Avatar

```
单个: 渐变(accent→contrast) / fg-on-accent / 圆形 / 11px 700
ring: box-shadow 0 0 0 2px bg-raised, 0 0 0 3px accent-border
avatar-stack: flex / 每个 margin-left -5px / border 2px bg-overlay
```

### 快捷入口卡片

```
shortcut:
  flex / gap 14px / padding 14px 16px / radius-md
  background: linear-gradient(180deg, bg-overlay, bg-raised)
  border: border-default
  ::after 顶部高光线
  hover: border-emphasis + bg(surface→overlay) + translateY(-1px) + shadow-sm
shortcut-icon: 38×38 / radius-md / 4色分类(同 KPI)
shortcut-arrow: fg-subtle / hover 时 accent + translateX(3px)
```

---

## 背景氛围层（可选）

暗色主题可使用极克制的背景光晕：

```
bg-orb: 3 个径向渐变圆 / blur 120px / opacity 0.22
  orb-1: 靛青 / 40vw / 左上 / 26s 动画
  orb-2: 琥珀 / 30vw / 右下 / 32s 动画
  orb-3: 靛蓝 / 20vw / 中部 / 38s 动画
bg-grain: 噪点纹理 / opacity 0.18 / mix-blend-mode overlay
```

亮色主题光晕更克制：opacity 0.28 / mix-blend-mode multiply / 尺寸缩小。

**注意**：光晕仅做氛围暗示，不得抢焦点。在性能敏感场景可完全移除。
