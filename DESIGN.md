# OpenAWork 设计系统 — E · Nebula

> 本文件为 OpenAWork 的唯一设计系统真实来源。所有 UI 实现必须遵循此规范。

## 1. 设计哲学

OpenAWork 是面向连续工作场景的 AI Agent 工作台。设计服务于：

- **长时间使用**：耐看、稳定、低干扰
- **高信息密度**：清晰分组、层级靠亮度差而非重装饰
- **控制台感**：结构秩序优先于品牌展示
- **跨平台一致**：Web / Desktop / Mobile 语义统一

### 气质定位

**Linear 的秩序感 + Raycast 的工具效率感 + Claude 的局部聊天温度**

### Do

- 用亮度差管理层级
- 用四色系统建立交互与语义优先级
- 让工作台页面始终服务于"连续工作"
- 先复用 `packages/shared-ui` 中的现有模式

### Don't

- 不做营销页化（无巨型标题、无大段留白）
- 不把强调色拿去做背景装饰
- 不为"高级感"牺牲可读性
- 不新造脱离 token 体系的平行视觉语言

---

## 2. 色彩体系

### 四色系统

| 角色           | 语义                          | 暗色值         | 亮色值         |
| -------------- | ----------------------------- | -------------- | -------------- |
| **accent**     | CTA / active / 选中 / 主交互  | `#5cd4c0` 靛青 | `#6471f0` 靛紫 |
| **contrast**   | warning / 次级强调 / 数据高亮 | `#f0b429` 琥珀 | `#a06bff` 紫粉 |
| **complement** | danger / destructive / 通知   | `#f06b7e` 珊瑚 | `#e0497a` 玫瑰 |
| **aux**        | info / 链接 / 代码高亮        | `#8b9cf5` 靛蓝 | `#3aa0ff` 天蓝 |

### 每色 4 层级

```
--xxx:          实色（文字/图标/填充）
--xxx-muted:    14% 透明度背景
--xxx-subtle:   7% 透明度极淡背景
--xxx-border:   30% 透明度边框
```

### 语义色映射

- `--success` = `#3dd49a`（暗）/ `#16a37a`（亮 · 翡翠绿，保持绿色语义）
- `--warning` = `var(--contrast)`
- `--danger` = `var(--complement)`
- `--info` = `var(--aux)`

---

## 3. 表面层级

### 暗色主题

| Token           | 值        | 用途                           |
| --------------- | --------- | ------------------------------ |
| `--bg-base`     | `#080b12` | 最深底色（带极微蓝调 hue 215） |
| `--bg-raised`   | `#0d1119` | Rail / 侧栏                    |
| `--bg-overlay`  | `#121721` | 卡片 / 面板                    |
| `--bg-surface`  | `#171d29` | 输入框 / 内嵌区域              |
| `--bg-elevated` | `#1d2535` | 弹层 / tooltip                 |
| `--bg-hover`    | `#232d40` | hover 态                       |
| `--bg-active`   | `#2a3650` | active / pressed               |

### 亮色主题（Aurora 极光配色）

| Token           | 值        | 用途                     |
| --------------- | --------- | ------------------------ |
| `--bg-base`     | `#f4f6ff` | 页面底色（带极淡蓝紫调） |
| `--bg-raised`   | `#ffffff` | Rail / 面板              |
| `--bg-overlay`  | `#eef1ff` | 卡片                     |
| `--bg-surface`  | `#e4e8fa` | 输入框                   |
| `--bg-elevated` | `#d8defa` | 弹层                     |
| `--bg-hover`    | `#ccd4f5` | hover 态                 |

---

## 4. 文字层级

| 级别        | 暗色      | 亮色      | 用途                       |
| ----------- | --------- | --------- | -------------------------- |
| **strong**  | `#f1f4f8` | `#161a3a` | 标题 / 重点数字            |
| **default** | `#c8d1e0` | `#43497a` | 正文                       |
| **muted**   | `#7b8a9e` | `#7c83a9` | 次级信息 / 标签            |
| **subtle**  | `#4d5b6e` | `#a8aec8` | 占位符 / disabled / 时间戳 |

---

## 5. 线条层级

| 级别          | 暗色                     | 亮色                  | 用途              |
| ------------- | ------------------------ | --------------------- | ----------------- |
| **invisible** | `hsla(215,20%,50%,0.03)` | `rgba(15,23,60,0.03)` | 结构暗示          |
| **subtle**    | `hsla(215,20%,50%,0.07)` | `rgba(15,23,60,0.05)` | 面板内分组        |
| **default**   | `hsla(215,18%,50%,0.12)` | `rgba(15,23,60,0.08)` | 卡片 / 输入框边框 |
| **emphasis**  | `hsla(215,16%,55%,0.20)` | `rgba(15,23,60,0.16)` | hover / focus     |
| **strong**    | `hsla(215,14%,60%,0.30)` | `rgba(15,23,60,0.25)` | active / selected |

暗色线条带蓝灰色调（hue 215），不是纯白透明度——让边框和背景同色系。

---

## 6. 排版

### 字体

- **正文**：Inter（400 / 500 / 600 / 700 / 800）
- **等宽**：JetBrains Mono（代码 / 数字 / 时间戳 / 命令）
- **数字**：`font-variant-numeric: tabular-nums`

### 字号阶梯

| 角色    | 大小    | 字重    | 用途        |
| ------- | ------- | ------- | ----------- |
| Display | 26-28px | 800     | Hero 标题   |
| H1      | 22px    | 700     | 页面标题    |
| H2      | 16px    | 600     | 区块标题    |
| H3      | 14px    | 600     | 卡片标题    |
| Body    | 13px    | 400     | 正文        |
| Small   | 11-12px | 400-500 | 标签 / 时间 |
| Mono    | 12-13px | 400     | 代码 / 路径 |

### 字重使用

- 400：正文与说明
- 500：导航、标签
- 600：标题、卡片头
- 700：页面标题
- 800：仅 Display 级别

---

## 7. 间距系统

基准网格：8px

| Token      | 值   | 用途           |
| ---------- | ---- | -------------- |
| spacing-1  | 4px  | 图标内间距     |
| spacing-2  | 8px  | 紧凑元素间     |
| spacing-3  | 12px | 卡片内 padding |
| spacing-4  | 16px | 标准间距       |
| spacing-5  | 20px | 面板 padding   |
| spacing-6  | 24px | 区块间距       |
| spacing-8  | 32px | 大区块分隔     |
| spacing-12 | 48px | 页面顶部留白   |

---

## 8. 圆角

| Token       | 值     | 用途                  |
| ----------- | ------ | --------------------- |
| radius-xs   | 4px    | inline badge / 小标签 |
| radius-sm   | 6px    | 按钮 / 输入框         |
| radius-md   | 8px    | 卡片 / 下拉           |
| radius-lg   | 12px   | 面板 / 大卡片         |
| radius-xl   | 16px   | Modal / 弹窗          |
| radius-pill | 9999px | 胶囊 / 状态标签       |

---

## 9. 阴影

| Token       | 用途       | 暗色定义                                                                                           |
| ----------- | ---------- | -------------------------------------------------------------------------------------------------- |
| shadow-sm   | 卡片默认   | `0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.02)`                                  |
| shadow-md   | 浮层/下拉  | `0 2px 4px rgba(0,0,0,0.2), 0 8px 24px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.02)` |
| shadow-lg   | Modal/弹窗 | `0 4px 8px rgba(0,0,0,0.2), 0 24px 56px -16px rgba(0,0,0,0.5)`                                     |
| shadow-glow | CTA 强调   | `0 0 16px -4px rgba(92,212,192,0.25)`                                                              |

暗色下阴影用多层叠加 + inset 高光模拟真实光照。亮色下阴影更轻，用暖灰调。

---

## 10. 动效

| Token           | Duration | Easing                              | 用途                 |
| --------------- | -------- | ----------------------------------- | -------------------- |
| motion-micro    | 100ms    | `cubic-bezier(0.4, 0, 0.2, 1)`      | hover 色变 / opacity |
| motion-normal   | 200ms    | `cubic-bezier(0.16, 1, 0.3, 1)`     | 面板展开 / 路由切换  |
| motion-emphasis | 350ms    | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性动画 / 强调反馈  |

### 主题切换

切换暗亮时给 `body` 添加 `theme-transitioning` 类（250ms 后移除），触发全局 transition。

---

## 11. 图表配色（8 色序列）

| #   | 暗色             | 亮色             | 名称 |
| --- | ---------------- | ---------------- | ---- |
| 1   | `#5cd4c0` 靛青   | `#6471f0` 靛紫   | 主色 |
| 2   | `#f0b429` 琥珀   | `#a06bff` 紫粉   | 对比 |
| 3   | `#8b9cf5` 靛蓝   | `#3aa0ff` 天蓝   | 辅助 |
| 4   | `#f06b7e` 珊瑚   | `#e0497a` 玫瑰   | 互补 |
| 5   | `#c4b5fd` 薰衣草 | `#c084fc` 紫罗兰 | 扩展 |
| 6   | `#86efac` 青柠   | `#16a37a` 翡翠   | 扩展 |
| 7   | `#67e8f9` 天蓝   | `#0891b2` 深青   | 扩展 |
| 8   | `#fda4af` 玫瑰   | `#f0abfc` 粉紫   | 扩展 |

相邻色有足够区分度，在暗亮两种背景上都能清晰辨识。

CSS 变量名：`--chart-1` 到 `--chart-8`，按上表序号对应。

---

## 12. 代码语法高亮

| Token           | 暗色      | 亮色      | 语义                            |
| --------------- | --------- | --------- | ------------------------------- |
| `--hl-keyword`  | `#8b9cf5` | `#6471f0` | 关键字（if/const/return）       |
| `--hl-function` | `#5cd4c0` | `#a06bff` | 函数名                          |
| `--hl-type`     | `#f0b429` | `#3aa0ff` | 类型（string/number/interface） |
| `--hl-string`   | `#86efac` | `#16a37a` | 字符串字面量                    |
| `--hl-number`   | `#fda4af` | `#e0497a` | 数字字面量                      |
| `--hl-comment`  | `#4d5b6e` | `#a8aec8` | 注释                            |

---

## 13. 图标规范

- 风格：Lucide（24×24 viewBox, stroke, round cap/join）
- 默认 stroke-width: 1.75

| 尺寸 | 用途            |
| ---- | --------------- |
| 16px | 行内 / 密集列表 |
| 18px | 导航 / 标准     |
| 20px | 按钮 / 工具栏   |
| 24px | Hero / 空状态   |

---

## 14. 响应式断点

| 名称       | 宽度        | 布局变化                    |
| ---------- | ----------- | --------------------------- |
| desktop-xl | ≥1440px     | Rail 展开 + 双栏内容        |
| desktop    | 1024–1439px | Rail 收窄 + 单栏            |
| tablet     | 768–1023px  | Rail 折叠为图标 + KPI 2列   |
| mobile     | <768px      | Rail 隐藏 + 底部导航 + 单列 |

---

## 15. Focus 可访问性

所有可交互元素必须有 focus ring：

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}
```

Danger 类元素用 `--complement` 替代 `--accent`。

---

## 16. 组件状态覆盖

所有交互组件必须实现以下状态：

| 状态           | 视觉表现                                                    |
| -------------- | ----------------------------------------------------------- |
| default        | 标准外观                                                    |
| hover          | 背景升级到 `--bg-hover`，边框升级到 `--border-emphasis`     |
| active/pressed | 背景 `--bg-active`，轻微 translateY(1px)                    |
| focus          | focus ring（见上）                                          |
| disabled       | opacity 0.4，cursor: not-allowed                            |
| loading        | spinner + opacity 0.85                                      |
| error          | 边框 `--complement-border`，shadow 用 `--complement-subtle` |

---

## 17. Markdown 渲染色彩

对话消息区的 Markdown 渲染遵循以下规则：

| 元素          | 暗色处理                                                          | 亮色处理            |
| ------------- | ----------------------------------------------------------------- | ------------------- |
| h1/h2/h3      | `--fg-strong`                                                     | `--fg-strong`       |
| p / li        | `--fg-default`                                                    | `--fg-default`      |
| strong        | `--fg-strong`                                                     | `--fg-strong`       |
| em            | `--contrast`（琥珀）                                              | `--contrast`        |
| a             | `--accent` + 下划线                                               | `--accent` + 下划线 |
| code（行内）  | `--accent` 文字 + `--accent-subtle` 背景 + `--border-subtle` 边框 |
| pre（代码块） | `--bg-base` 背景 + `--border-default` 边框                        |
| blockquote    | 左 3px `--accent-border` + `--accent-subtle` 背景                 |
| table th      | `--fg-muted` + `--bg-surface` 背景                                |
| table td      | `--fg-default` + hover 行高亮                                     |
| hr            | `--border-default`                                                |

---

## 18. 设计参考文件

| 文件                                    | 用途                         |
| --------------------------------------- | ---------------------------- |
| `DESIGN.md`（本文件）                   | 设计系统完整定义             |
| `DESIGN.openawork.md`                   | 项目级适配规则与页面落地指引 |
| `packages/shared-ui/DESIGN-TOKENS.md`   | 组件级强制执行标准           |
| `temp/design-demos/e-nebula-dark.html`  | 暗色版视觉参考               |
| `temp/design-demos/e-nebula-light.html` | 亮色版视觉参考               |
| `temp/design-demos/e-nebula-dark.css`   | 暗色版完整 CSS 实现          |
| `temp/design-demos/e-nebula-light.css`  | 亮色版完整 CSS 实现          |
