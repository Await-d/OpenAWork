# apps/web/harness — 真实浏览器验收 harness

本目录是**开发期验收 harness**，不参与应用构建（Vite 只以 `index.html` 为入口），
不被 `src/` 任何代码导入。用途：在**真实 Chromium** 里渲染真实组件，
覆盖 jsdom 覆盖不到的部分（真实布局下的截断、真实引擎解析后的计算样式）。

## 子代理通知行三视口验收（`notice-3viewports`）

对应任务 T-30：子代理通知行在 **375 / 768 / 1280** 三视口下的视觉与交互验收。

覆盖项：

| 项               | 说明                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| 用例渲染         | done / failed / cancelled / failed 空描述 / grouped 五种用例在三视口均渲染                        |
| 截断样式         | `text-overflow: ellipsis` + `white-space: nowrap` + `overflow: hidden` 恒定生效                   |
| 真实截断         | 375 / 768 下长描述**确实溢出并被裁剪**；1280 下可容纳且行宽受容器约束（不被撑开）                 |
| 真实祖先链路     | chat 端虚拟化定位层（`position:absolute; left/right:0`）与 team 端 column-flex 链内均不溢出视口   |
| **兜底链**语义色 | 页面**不定义**任何组件 token → 组件落到 `tokens.ts` 的 hex 兜底（期望值从该模块推导，非写死）     |
| **主题链**语义色 | `.themed` 提供哨兵色值的 CSS 变量 → 组件**跟随变量**而非兜底                                      |
| focus ring       | `outline: solid 2px var(--accent)` + `outline-offset: 2px` + accent subtle 阴影（期望值同源推导） |
| 点击             | 点击回传子会话 id                                                                                 |
| 不可点击         | 无 `childSessionId` 时渲染为 `div` 而非 `button`                                                  |

> **为什么把颜色拆成两条链**：`packages/shared-ui/src/tokens.ts` 的取值形如
> `var(--aux, #8b9cf5)` —— **CSS 变量优先、hex 兜底**。若页面把变量定义成与兜底相同的值，
> 两条路径会被混为一谈：既没证明「无变量时兜底正确」，也没证明「有主题变量时跟随主题」。
> 因此 harness 页面**刻意不定义**组件消费的任何 token（页面 chrome 一律用字面量），
> 另用 `.themed` 哨兵提供主题链。期望值全部从 token 模块推导，token 调整后断言同步变化，
> 不会出现「断言仍绿但已与实际取值脱钩」。

### 运行

前置：**Vite 开发服务器已在 `127.0.0.1:5173` 运行**（`bun run --filter @openAwork/web dev`）。

```bash
# 仓库根目录执行。NODE_PATH 指向唯一声明 playwright 的 workspace
# （apps/web 刻意不依赖浏览器内核；bun 对 workspace 包做严格依赖解析，故需显式指定）
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-notice-3viewports.ts
```

脚本会打印 `N 通过 / M 失败`；有失败项时退出码为 1。忘记 `NODE_PATH` 时脚本会直接打印上面这条命令。

Playwright 浏览器由环境变量 `PLAYWRIGHT_BROWSERS_PATH` 指定（本机已配置）。
若未配置，先执行 `npx playwright install chromium`。

### 为什么需要它

- jsdom **没有布局引擎**：省略号是否真的生效、行会不会被内容撑破，
  只有真实引擎能判定。历史上这类问题最常见的成因是祖先链里出现 row 方向 flex
  却缺少 `min-width: 0` —— `white-space: nowrap` 会把 `min-content` 抬到整行文本宽度，
  进而把容器撑出视口。两条真实链路已在本 harness 中固化，改动布局后可立即回归。
- 三态语义色与 focus ring 的**计算值**校验：内联样式断言无法发现
  「CSS 变量未定义 → 回落到透明/继承色」这类问题。两条链（兜底 / 主题跟随）分别验证，
  避免「变量与兜底同值」把两条路径混为一谈。

## devtools 分区导航交互状态验收（`devtools-nav`）

对应 `src/pages/settings/devtools/devtools-section-nav.tsx` 的交互状态验收。

覆盖项：

| 项         | 说明                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| 分区渲染   | 总览 / 诊断 / 日志 / Worker 四个分区按钮，初始 `aria-pressed` 只落在当前分区 |
| hover 背景 | 未选中分区 hover 后的计算背景**等于** `--bg-hover` 哨兵                      |
| 陷阱守卫   | hover 背景**不等于** `--bg-subtle` 洋红陷阱（见下）                          |
| 选中态     | 选中分区 hover 时保持 accent 背景，不被 hover 覆盖                           |
| focus ring | `outline: 2px solid var(--accent)` + `outline-offset: 2px` 的计算值          |
| 点击       | `aria-pressed` 转移到目标分区，回调收到分区 id                               |
| 自动刷新   | `role="switch"` 存在，切换后回调收到布尔值                                   |
| 排障复制   | 「复制排障上下文」按钮带问题计数，点击后回调触发且成功反馈可见               |
| 导出菜单   | 打开后出现 3 个 `menuitem`，Escape 关闭                                      |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-devtools-nav.ts
```

### 为什么需要它

内联样式 + CSS 变量的组合里，**变量名写错不会报错**：`var(--bg-subtle)` 在变量未定义时
只是解析失败，元素静默保持初始背景。jsdom 不做样式解析，内联样式断言也只看声明、
不看解析结果，只有真实引擎的 `getComputedStyle` 能判定。harness 页面用哨兵色值把
「跟随变量」与「解析失败」区分开，并用洋红陷阱变量守卫历史缺陷的回归。

## 思考块「贴底折叠窗口」验收（`reasoning-tail-window`）

对应 `src/components/chat/assistant/assistant-reasoning-block.tsx` 的折叠窗口行为。
折叠态是 **贴底窗口**：`column-reverse` 把内容钉在容器底部，超出部分从**顶部**裁掉，
因此折叠预览始终落在最新的 N 行上。

覆盖项（375 / 768 / 1280 三视口，流式与静态各一遍）：

| 项           | 说明                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 窗口语义     | `data-collapsed-window="tail"` + `display:flex` / `flex-direction:column-reverse` 生效                                     |
| 真实裁剪     | 内容子块高度确实大于窗口可视高度（`overflow:clip` 不产生滚动区，故不能用 `scrollHeight`）                                  |
| 可见区落点   | **末段完整可见并贴底**、**首段被裁到窗口上方**（而不是显示开头、末尾被裁）                                                 |
| 流式跟随     | 追加新行后，新末行自动进入可见区且原末行被裁到窗口上方（无 JS 跟随滚动）                                                   |
| 展开 / 收起  | 展开后应用高度上限（`min(60vh, 480px)`）但仍为贴底窗口、块内可滚动回看更早内容；收起后可见区回到最新内容                   |
| finalize     | 流式与静态折叠窗口高度、可见区一致（不翻转方向、不跳动）                                                                   |
| 流式光标     | 光标宿主是可见的末段（`data-streaming` 的 `::after` 落在窗口内）                                                           |
| 折叠提示单层 | 长思考（>1500 字符）展开后，思考块内**不得**再出现消息级「展开全部 · N 字符」二次裁剪                                      |
| 思考内代码块 | 长思考内部的长代码块（>100 行）也不自折叠：展开思考后只有思考块自己的一层高度上限 + 块内滚动                               |
| 思考围栏归属 | 长正文（>1500 字符）里的 ```thinking 围栏块不自折叠：只剩消息级一层提示（短正文仍保留自带折叠，见 `fold-policy.test.tsx`） |
| 围栏窗口参数 | 短正文里的 ```thinking 围栏块与主思考块同窗口：折叠 5 行（108px）贴底、展开到高度上限并可在块内滚动                        |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-reasoning-tail-window.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**：折叠窗口"看到哪几行"完全由真实排版决定；jsdom 里
  `scrollTop` / `getBoundingClientRect` 全是 0，任何单测都无法发现"折叠后只剩开头可见"
  这类缺陷。
- 历史缺陷正是这一类：早期实现用 `overflow:hidden` + `scrollTop = scrollHeight` 跟随末尾，
  finalize 时窗口又从"末 6 行"跳回"前 3 行"；后来的修法改成统一显示前 3 行，却让折叠态
  看不到最新思考内容。本 harness 把"贴底窗口 + 流式跟随 + finalize 不跳动 + 展开态只有一层
  高度上限（块内滚动回看）"四条不变量一起固化，防止任何一边回退。
- 另一个真实缺陷是**两层折叠提示**：思考块自带 展开/收起，而 >1500 字符的思考正文又会命中
  消息级折叠（`CollapsibleAssistantContent`），展开思考后还要再点一次「展开全部 · N 字符」，
  且第二层仍把内容裁到 60vh —— "展开"名不副实。思考正文现在显式传 `foldMode="disabled"`
  （见 `renderReasoningRichBody`），本 harness 的"折叠提示单层"用例守卫它。
- 同源的第三、四层是**思考内部的围栏块**与 **``thinking 围栏块**：思考块内部通过
`FoldDisabledContext` 让代码块 / Markdown 预览块不再自折叠；长正文里的 ``thinking
  围栏块则让位给消息级折叠（`MessageFoldContext`），短正文仍保留自带的「展开思考」。
  这两条分别由 harness 的"思考内代码块 / 思考围栏归属"与 `fold-policy.test.tsx` 守卫。

## 对话 finalize 自动贴底验收（`scroll-finalize`）

对应 `components/conversation-runtime/scroll/use-scroll-manager.ts` 与
`pages/chat-page/conversation/ChatConversationView.tsx` 的内容列布局。渲染的是真实链路：
`ChatMessageGroupList` + `useScrollManager` + 真实 Markdown / 思考块渲染。

覆盖场景（`short` = 非虚拟列表 / `long` = 触发消息组虚拟列表）：

| 场景 | 说明                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------- |
| A    | 完整流式 → 定稿：定稿前后视口都停在最新消息底部                                                 |
| B    | 揭示滞后时定稿（定稿内容远长于屏幕上的流式内容）+ 延迟快照对账后仍贴底                          |
| C    | 流式结束后输入区高度变化（滚动区可视高度变化 / 浏览器钳位）后仍贴底                             |
| D    | **纯推理段增长（无 buffer 变化）与定稿后迟到增长（异步 Markdown / 图片 / 工具输出）仍自动贴底** |
| E    | **打开长历史会话：首帧绘制前已贴底（`prePaintDistance`）+ 打开后迟到增长仍贴底**                |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-scroll-finalize.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**，也没有真实的 ResizeObserver / 滚动钳位：跟随是否真的发生在
  「最新内容处」只有真实引擎能判定。
- 历史缺陷（本 harness 固化时修掉）：`contentColumnStyle` 的 `minHeight: 100%` + 默认
  `flex-shrink: 1` 会把内容列**盒子**压回滚动区高度 —— 内容溢出但盒子不变，
  `useScrollManager` 的 ResizeObserver 主路径**永不回调**。流式期间只有正文增量
  （`visibleStreamBufferLength`）能触发跟随，所以实时看起来正常；一旦收尾（推理段增长、
  工具卡输出、定稿后的异步 Markdown / meta 渲染），增长没有任何触发点，视口就停在最新
  回复上方，必须手动往下滚。场景 D 的两个断言就是这条路径的守卫：去掉内容列的
  `flexShrink: 0`，`[D/short]` / `[D/long]` 会以 75–225px 的差距失败。
- 场景 C 守卫另一条独立路径：内容远高于视口时内容列盒子不再跟随视口高度，输入区 /
  面板高度变化必须由**滚动区自身**的 ResizeObserver 兜住（并顺带修复浏览器钳位留下的
  陈旧程序化落点，见 `useScrollManager` 的基线刷新注释）。
- 场景 E 守卫「打开会话」这条链路：首批内容提交时 `scrollTop` 停在旧处、只有内容在长，
  若把它当成「用户离开 latest」就会挂起跟随——表现为打开长历史会话时先看到最旧的消息，
  之后才跳到最新（慢机 / 后台标签页下更久）。开屏贴底必须由 layout effect 的同步首帧
  在第一帧绘制前完成（`prePaintDistance` 断言），并由 ResizeObserver 的
  `layoutOnly` 对账兜住打开后的迟到增长。

## 后台任务面板验收（`background-task-panel`）

对应组件：`src/pages/chat-page/panels/background-task-panel.tsx`（面板主体，W2b）

- `src/pages/chat-page/panels/use-background-task-panel.ts`（数据归一，W1）。
  渲染的是**真实链路**：`useBackgroundTaskPanel` + `BackgroundTaskPanel`，覆盖右栏
  「后台任务」tab 的汇总条 / 子代理区 / 后台命令区 / 三态在 375 / 768 / 1280 下的布局。

覆盖场景（固定 fixture：running 子代理 / pending 子代理 / running 后台命令 / failed 命令）：

| 用例         | 说明                                                                           | 断言                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixtures`   | 4 行固定 fixture（两分区 + 汇总条）                                            | 行数 = 4、每行 `scrollWidth <= clientWidth`、复制按钮可见可点且有 aria-label（点击不炸页面）、打开子会话 / 停止 / 查看 / 终止 / 全停 五条操作链路的回调（破坏性操作走确认弹窗）、截图 |
| `in-flight`  | 子代理「停止中」/ 命令「终止中」的行内态                                       | 「停止中」「终止中」按钮为 disabled 且文案正确                                                                                                                                        |
| `loading`    | 加载骨架                                                                       | 面板渲染 + 不横向溢出                                                                                                                                                                 |
| `empty`      | 空态 + 触发说明                                                                | 空态可见 + 截图                                                                                                                                                                       |
| `error`      | 错误提示 + 重试入口                                                            | 错误态可见 + 重试回调                                                                                                                                                                 |
| `chip`       | 常驻胶囊（composer footer，1 子代理 + 1 命令进行中）                           | 胶囊可见且不溢出容器、展开后 3 行、打开子会话 / 停止（确认）/ 查看 / 打开面板 回调、可再次展开 + Esc 关闭、截图                                                                       |
| `chip-idle`  | 常驻胶囊空态（无活跃任务）                                                     | **不渲染**胶囊                                                                                                                                                                        |
| `chip-short` | 矮窗口（1280×460）：62vh 面板 + `overflow:hidden` + composer 贴底 + 6 条活跃行 | 弹层可见、**top 未被面板上沿裁掉**、不溢出下沿、底部「打开后台面板」可见且可点（`45vh` 封顶的回归守卫）                                                                               |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-background-task-panel.ts
```

当前为三视口完整验收（**157 断言**，375 / 768 / 1280 全绿）：`fixtures` 用例截图写到
`/tmp/opencode/background-task-panel-<width>.png`，`empty` 用例截图写到
`/tmp/opencode/background-task-panel-empty-<width>.png`；`chip` 用例截图写到
`/tmp/opencode/background-task-chip-<width>.png`。

**矮窗口阶段（1280×460）**：胶囊弹层 `maxHeight` 用 `min(320px, 45vh)` 封顶——`vh` 是相对
**浏览器窗口**的，所以该用例必须在矮窗口里跑（页面内的矮容器测不出 cap 的作用）。有效性已用
红/绿证明：把封顶改回固定 `320px` 时 `[short] 弹层未被面板上沿裁掉` 会失败（实测 `popoverTop=22`
小于 `paneTop=78`，被裁 56px）。

另有一条**只读真实链路冒烟**（不进本目录）：在真实应用里展开会话面板 → 切到「后台」tab，
断言 `recovery.tasks` 进入面板行（真实会话 12 行 / 0 页面错误）并截图
`/tmp/opencode/background-task-panel-live.png`；覆盖 classic（`aria-label="后台任务"`）
与 Fusion（tab 文本「后台」）两套入口。

### 为什么需要它

- jsdom **没有布局引擎**：行内的等宽 id（`task_id` / `terminalId`）与命令文本
  是否真的溢出、复制按钮是否被挤出视口，只有真实排版能判定 —— 这与
  `notice-3viewports` 里「`white-space: nowrap` + 缺 `min-width: 0` 撑破容器」
  是同一类风险。
- 面板同时承载**破坏性操作**（停止 / 终止）与**实时性口径**（「同步于 Xs 前」），
  真实浏览器下逐行可达性（按钮不被裁剪、focus ring 可见）是可用性底线，
  单测只覆盖文案与回调，覆盖不到这两点。

## 子代理运行列表折叠验收（`sub-agent-run-list`）

对应组件：`src/pages/chat-page/panels/sub-agent-run-list.tsx` 的 `SubAgentRunList`
（主对话区左侧悬浮的子代理运行列表）。渲染真实组件 + 真实宿主容器
（复刻 `ChatConversationView` 的 `SPLIT_INNER_STYLE` 相对定位链）。

覆盖项（375 / 768 / 1280 三视口）：

| 项         | 说明                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 默认展开   | `aria-expanded=true`、列表 `display:flex`、容器占满宿主高度                                                                              |
| 折叠       | 点击表头后收缩为迷你胶囊：高度为表头、宽度为内容宽（≤140px，承载「后台 N 运行中」后实测约 132px）、列表 `display:none`、卡片区域高度为 0 |
| 信息保留   | 折叠后总数徽标保留、「子代理」标签隐藏、运行中改以脉冲点提示（`title` 标注数量）                                                         |
| 持久化     | 折叠后刷新页面仍保持折叠；展开后写回 `chat.subagentRunList.collapsed = '0'`                                                              |
| 再次展开   | 高度恢复宿主高度；固定 200px 栏宽（含左 padding）不溢出宿主                                                                              |
| hover 背景 | hover 后的计算背景**等于** `--bg-hover` 哨兵                                                                                             |
| focus ring | `outline: 2px solid var(--accent)` + `outline-offset: 2px` + accent-subtle 阴影的计算值                                                  |
| 点击接线   | 停止按钮 → `stop:<childId>`；卡片 → `open:<childId>`                                                                                     |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-sub-agent-run-list.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**：折叠的核心效果是「容器高度收缩、把消息区让出来」，
  `bottom: auto` 是否生效、表头高度是否真的小于宿主高度，只有真实排版能判定。
- **内联样式会静默压过 `:hover` 规则**：开关的默认 `background` / `color` 若写在内联 style，
  `.sub-agent-run-list__toggle:hover` 永远不生效（内联优先级更高）。本用例首次运行即抓到
  该缺陷；哨兵色值把「跟随变量」与「解析失败 / 被覆盖」区分开，与 `devtools-nav` 同一口径。
- **focus 断言必须走键盘**：鼠标交互之后的脚本 `focus()` 不触发 `:focus-visible`，
  ring 计算值只能由 Tab 导航建立焦点后读取——否则会把「样式正确但没匹配」误判为缺陷。

## 插件 / 技能 / MCP 管理面三视口验收（`plugin-manager-3viewports`）

对应 260924「插件、技能、MCP 管理界面重构」：`InstalledSkillsManager`、
`McpServerManager`、`SkillMarketHome` 三个核心列表组件（375 / 768 / 1280 三视口）。

覆盖项：

| 项             | 说明                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| 渲染           | 三个面板均渲染（`data-openawork-installed-skills` / `-mcp-manager` / `-skill-market`）           |
| 无横向溢出     | 每个面板 `scrollWidth <= clientWidth`（列表行在窄视口必须换行而不是撑破）                        |
| 省略号         | 长技能名 `text-overflow: ellipsis` + 375 下真实裁剪（`scrollWidth > clientWidth`）               |
| 语义色         | 开关轨道 = accent、更新版本号 = contrast、MCP 错误文案 = danger（真实计算值）                    |
| 行内编辑       | 「编辑」展开 `禁用工具`，`完成` 收起                                                             |
| 新增表单       | `+ 添加服务器` 展开/收起 `服务器名称` 输入（表单提交按钮为「+ 确认添加」，不与开关同名）         |
| 开关交互       | 点击后 `role="switch"` 的 `aria-checked` 翻转                                                    |
| focus ring     | 键盘模态下 `outline: 2px solid var(--accent)` + `outline-offset: 2px` + accent-subtle 阴影计算值 |
| 新增按钮唯一性 | `data-mcp-add-toggle` 只落在面板头部按钮上，避免与表单提交按钮文案重名导致点击歧义               |

### 运行

```bash
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-plugin-manager-3viewports.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**：`min-width: 0` + `flex-wrap` 的换行行为、省略号是否真实裁剪，
  以及统计信息/操作按钮混排是否溢出，只有真实排版能判定。
- **focus 断言必须走键盘**：与 `sub-agent-run-list` 同一口径——指针交互之后脚本
  `focus()` 不触发 `:focus-visible`，脚本先按一次 Tab 建立键盘模态再读取 ring 计算值。
- **harness 容器必须用 `grid-template-columns: minmax(0, 1fr)`**：默认 `auto` 轨道会被
  子元素 min-content 撑开，把「组件内部不收缩」伪装成「无问题」——首次运行即因此漏报，
  改成 minmax(0,1fr) 后组件内部溢出才会体现为自身 `scrollWidth > clientWidth`。

## 已安装插件管理面三视口验收（`third-party-plugins-3viewports`）

对应 260924「插件系统 v2 完整集成」T-27：`ThirdPartyPluginsView`（设置 → 插件 →
已安装插件）在 375 / 768 / 1280 三视口下的视觉与交互验收。

覆盖项：

| 项           | 说明                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 渲染         | 列表五行（活跃 / 超长 id / 失败 / 已停用 / 外部加载）+ 空态均渲染                                         |
| 无横向溢出   | 列表与空态的 `scrollWidth <= clientWidth`                                                                 |
| 省略号       | 超长插件 id `text-overflow: ellipsis` + 375 下真实裁剪                                                    |
| 语义色       | 活跃状态点 = success、失败状态点 = danger、**已停用状态点 = fg-subtle**、失败原因 = danger、徽章色正确    |
| 外部加载形态 | 无 `installId` 的行不显示「重载 / 卸载」                                                                  |
| 启停         | 已停用行只有「启用」（无重载/停用）；停用点击回调记录 `disable:<pluginId>`                                |
| focus ring   | 键盘模态下安装按钮 `outline: 2px solid var(--accent)` + accent-subtle 阴影（按钮初始 disabled，先填路径） |
| 卸载二次确认 | 首次点击「卸载」不触发回调、出现「确认卸载」，确认后回调记录 `remove:<installId>`                         |
| 安装表单     | 输入路径提交 → 回调记录 `install:<path>:false`，成功后输入清空                                            |

### 运行

```bash
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-third-party-plugins-3viewports.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**：安装表单的 `flex-wrap` 换行、超长插件 id 的截断、长错误
  信息的换行是否撑破容器，只有真实排版能判定。
- **断言的是展示层**（`ThirdPartyPluginsView`，纯 props + 本地 UI 状态）——数据加载与
  操作接线由容器 `ThirdPartyPluginsPanel` 承担，jsdom 组件测试覆盖（13 例）。
- **按钮初始 disabled**：安装按钮在输入为空时不可聚焦，focus ring 断言必须先填入
  路径（首次运行即因此漏报）。

## 插件市场三视口验收（`plugin-market-3viewports`）

对应 260924「插件市场与在线安装」：`PluginMarketView`（设置 → 插件 → 插件市场）在
375 / 768 / 1280 三视口下的视觉与交互验收。

覆盖项：

| 项         | 说明                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 渲染       | 条目三行（普通 / 超长 repo / 根目录单插件回退）+ 空态均渲染                                         |
| 无横向溢出 | 市场与空态的 `scrollWidth <= clientWidth`（**首轮即抓到**失败源提示长 URL 不换行导致的 375 溢出）   |
| 省略号     | 超长 repo 行 `text-overflow: ellipsis` + 375 下真实裁剪                                             |
| 语义色     | 版本徽章 = accent、失败来源提示 = contrast（真实计算值）                                            |
| 信任确认   | 点击「安装」出现确认文案（含「无沙箱」与来源 repo）；「确认安装」后回调记录 `install:<entryId>`     |
| 详情       | 「详情」打开详情卡（README 渲染）→「关闭」回调并隐藏                                                |
| 来源管理   | 「来源（n）」展开面板；添加表单提交记录 `add:<repo>:<ref>`；「移除」记录 `remove-source:<sourceId>` |
| focus ring | 键盘模态下搜索按钮 `outline: 2px solid var(--accent)` + accent-subtle 阴影                          |

### 运行

```bash
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-plugin-market-3viewports.ts
```

### 为什么需要它

- **jsdom 没有布局引擎**：长 URL 的换行、超长 repo 的截断、窄视口下的横向溢出只有真实排版能判定。
- **信任确认是安全交互**：确认文案必须在真实渲染中可见（含来源与「无沙箱」提示），而不是只在单测里断言函数被调用。
- **断言的是展示层**（`PluginMarketView`，纯 props + 本地 UI 状态）——数据接线由容器 `PluginMarketPanel` 承担，jsdom 组件测试覆盖。

## 终端 tab 条验收（`terminal-tab-label`）

对应 260924「终端新建位置与窗口标题」改动：`TerminalTabStrip` + `terminalTabLabel`
在 375 / 768 / 1280 三视口下的标签与布局验收。渲染**真实组件与真实 CSS 链**
（`.terminal-panel` → `.terminal-split` → `.terminal-pane` → `.terminal-panel__tab-strip`），
右侧动作区用固定宽度占位（受力点：长标签不得把它挤出 pane）。

覆盖项：

| 项             | 说明                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 渲染与 DOM 序  | 6 条夹具 tab 全渲染，DOM 顺序 = 旧 → 新                                                    |
| 可见顺序       | 每个 tab `rect.x` 严格递增（新 tab 追加在右）                                              |
| 标签文案       | 逐条断言优先级：自定义名 > agent 描述 > 窗口标题 > 命令 > `终端 N`；长标题 = 22 字符 + `…` |
| 宽度上限       | tab ≤ 200px / 标签 ≤ 160px；**<768px 另有更紧的 media query**：148 / 108                   |
| 不换行         | `white-space: nowrap` + `text-overflow: ellipsis` + `overflow: hidden`，标签单行高度       |
| 宿主不被撑开   | tab 条 `scrollWidth ≤ clientWidth`（由自身横向滚动接管，而不是把宿主顶宽）                 |
| 动作区可达     | 右侧固定宽动作区仍完整留在 pane 内（未被压缩 / 未被挤出）                                  |
| 页面无横向溢出 | 文档 `scrollWidth ≤ 1280`                                                                  |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-terminal-tab-label.ts
```

三视口 45 断言全绿；截图写到 `/tmp/opencode/terminal-tab-label-<width>.png`。

### 为什么需要它

- **jsdom 没有布局引擎**：标签的「JS 截断（> 24 → 22 + `…`）」与「CSS 上限 + 省略号」
  是两层防御，只有真实排版能证明它们叠加后既不换行、也不把 tab 与宿主撑开。
- **上限是分视口的**：`terminal-panel.css` 在 `@media (max-width: 767px)` 里把 tab / 标签
  上限收紧到 148 / 108 —— 断言必须带视口维度，否则「窄视口放宽上限」这类回归会漏报
  （首轮探针就是把页面视口固定在 375，只测到窄视口那一档）。
- **红→绿证据（实测）**：移除 `terminalTabLabel` 的标题截断 → 三视口各 2 条文案断言失败
  （标签变成整条 `user@host: …`）；再把 tab / 标签的 `max-width` 一并移除 → tab 宽涨到
  507px、标签 476px，宽度断言失败。两层防御各自都有守卫。
- **顺序真相在 panel 层**：上游 `useSessionTerminals` 是「最新在前」，panel 层重排为
  「旧 → 新」后才交给 tab 条 —— 这条语义由 `QuickTerminalPanel.test.tsx` 的面板级用例
  守卫；本 harness 只验证 tab 条按传入顺序从左到右渲染。

## 对话内容列宽度自适应验收（`chat-content-width`）

对应 `pages/chat-page/layout/conversation-layout-state.ts` 的
`resolveResponsiveContentMaxWidth`（策略本体）与 `conversation/ChatConversationView.tsx`
的内容列 `maxWidth` 接线（接线由 `ChatConversationView.test.tsx` 守卫）。
渲染的是与组件一致的内联样式链：滚动区（padding + flex column）→ 内容列
（`width:100%` + `maxWidth: clamp(基准, 88%, 1.5×基准)` + `margin:0 auto`）。

覆盖项（5 个**固定宽度容器**，页面视口 1900；期望值由夹具按规则独立重算）：

| 项               | 说明                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| clamp 声明       | 真实引擎保留 `clamp(基准px, 88%, 1.5×基准px)`，三个组件逐项对齐（含窄容器下「渲染宽恒等于容器」的盲区用例） |
| 渲染宽度（下限） | 容器 900 / 基准 1024：窄于下限 → 铺满容器且不横向溢出                                                       |
| 渲染宽度（比例） | 容器 1200 / 基准 1024：按 88% 加宽（1024 → 1134 容器下取 1024，1800 容器下取 1525.9）                       |
| 渲染宽度（封顶） | 容器 1800 / 基准 1024 → 1536 封顶；容器 1600 / 基准 820 → 1230 封顶；基准 1536（split 抬高）仍按 88% 自适应 |
| 居中             | 未占满容器时左右边距差 ≤ 1.5px（`margin: 0 auto` 真实生效）                                                 |
| 页面不溢出       | 文档 `scrollWidth ≤ 1900`                                                                                   |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-chat-content-width.ts
```

21 断言全绿；截图写到 `/tmp/opencode/chat-content-width-<pane-id>.png`。

### 为什么需要它

- **jsdom 没有布局引擎**：`max-width: clamp(px, %, px)` 的解析值与真实渲染宽度
  （`min(容器, clamp)`）、`margin: 0 auto` 的居中，只有真实引擎能判定；jsdom 只保留声明字符串。
- **Chromium 的计算值不解析 clamp**：`getComputedStyle().maxWidth` 会**原样返回**
  `clamp(...)` 数学函数（规范允许）——所以断言拆成两条：解析声明组件证明「声明被接受」，
  比较渲染宽度证明「解析结果正确」。只做前者会漏掉解析错误，只做后者会在窄容器用例上失明。
- **容器 ≠ 视口**：策略刻意用容器百分比而不是 `vw` / `vh`（分栏面板里视口单位会失真），
  因此用例必须用**固定宽度容器**而不是三视口档位。
- **红→绿证据（实测）**：把策略比例从 88 改成 60 → 5 条 clamp 声明断言 + 2 条渲染宽度断言
  失败（`b1024-wide` 实际 1040.4px、`b820-wide` 实际 920.4px）；恢复 88 后 21/21 全绿。

## 工具卡展开可视化验收（`tool-expansion`）

对应 260924「工具展开可视化优化」：`BlockToolCall` / `BatchToolCallCard`（web）与
`BashTerminalCard` / `UnifiedCodeDiff`（shared-ui），呈现口径对齐参考实现
`temp/opencode-v2.0.16`（session-ui 的 shell / edit / write 渲染）。渲染真实链路
（`ToolCallDisplay` 路由 → 各卡片 → 真实 `index.css` carbon 暗色 + `chat-message.css`），
三视口（375 / 768 / 1280）+ 三个运行态用例，共 **183 断言**。

覆盖项：

| 用例              | 说明                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bash`            | **终端观感**（`$` 提示符 + 命令 + 同底色输出 + 运行中块光标）；展开体不叠面板；多行命令完整 `pre-wrap`；入参区不渲染；复制悬停显示；无横向溢出                     |
| `edit`            | **默认展开**（不点击即可见变更）；文件卡头 = 图标 + 目录 + 文件名 + `+N`（成功色）；变更行自带底色且**无列头 / 无逐行描边**；**diff 带语法高亮**；入参区不渲染     |
| `patch`           | unified diff：hunk 折叠为「⋯ 第 N 行起 / ⋯ N 行未变更」（不再铺原始 `@@`）；**逐行语法高亮**；入参区不渲染                                                         |
| `write`           | 新建文件（`before=''`）：**全量新增**（无删除行 / 无幽灵 context 行）+ `+N` 统计 + 语法高亮；入参区不渲染                                                          |
| `split-diff`      | split（并排）视图：**左右两侧都带语法高亮**（`span.hljs-*` 两侧均可命中）                                                                                          |
| `read`            | 查看文件：**折叠**摘要 = 路径 + `:起-止` 行区间；**展开**只有预览 meta 一处路径（可点击预览 + `起–止 / 总行数 行` + 语法高亮行号内容），摘要不再重复路径，无参数区 |
| `ask`             | 提问（askuserquestion）：摘要 = `已向用户提问（N 题）`；展开 = 问答对（问题 + 答案 chip），**无分区标签**                                                          |
| `read-long`       | 长文件 read：默认只渲染 **300 行**（DOM 上限）+ 「显示全部（N 行）」入口；点击放开全部、可再收起                                                                   |
| `list-dir`        | 列举目录：摘要 = **路径 + 条目数**；展开 = 树形预览（目录 `▾` + 计数、文件 `·`），**无参数区**                                                                     |
| `list-dir-stored` | 刷新后的 **JSON 字符串形态**同样还原成目录树（存储层序列化不能把结构化预览降级成 JSON 文本）                                                                       |
| `dir-read`        | read 命中目录：摘要不带行区间；展开 = **目录清单**（路径 + `N 项` + 目录/文件行），不是「文件 N 行 + 行号代码」                                                    |
| `create-dir`      | 创建目录：摘要 = **路径**；展开 = 中文确认行（`已创建了目录 · <path>`，**不透传英文工具名**），无参数区                                                            |
| `batch`           | 子行 chevron 可见（展开态旋转 + accent）；子行展开**只做 12px 缩进**、内容块自带表面；**嵌套卡不再重复 header**（embedded）；无横向溢出                            |
| `bash-running`    | 执行中显示「运行中，等待输出…」+ 闪烁光标；命令仍完整显示                                                                                                          |
| `bash-live`       | **单条 bash 真·实时输出**（网关 `tool_progress` 单元素通道 → `_batchProgress`）：自动贴底 + 运行中块光标 + 不展示入参                                              |
| `batch-live`      | 子行实时输出（`_batchProgress.partialOutput`）自动贴底 + `data-terminal-running="true"`                                                                            |
| 页面              | 各类卡片容器与文档均无横向溢出                                                                                                                                     |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-tool-expansion.ts
```

截图写到 `/tmp/opencode/tool-expansion-<width>-<case>.png`（`HARNESS_SHOT_SUFFIX=-before`
可给文件名加后缀，用于前后对比）。

### 为什么需要它

- **jsdom 没有布局引擎**：展开体是否叠了面板、多行命令是否被压成一行、行底色是否覆盖整行、
  chevron 是否可见、实时输出是否贴底、悬停显隐（`:hover` + transition）只有真实排版能判定。
- **对齐参考实现（opencode v2.0.16）**：shell = 「命令段 + 结果段 + 滚动」的单终端块，
  结果段弱化文字色；文件编辑 = 「文件卡头（图标 + 目录/文件名 + 增删统计）+ diff 直接可见」，
  diff 无列头、靠行底色区分；展开内容只做 12px 缩进（**不是**面板）。默认展开（`fileEdit`
  类别）与卡片头去重属于**行为契约**，必须由断言固化。
- **「不展示入参」也是契约**：bash / diff 类工具的参数区被移除（对齐参考实现），
  断言直接检查 `details.tool-call-block-params` 不存在，防止后续被顺手加回来。
- **「真·实时」是端到端契约**：单条 bash 的滚动 stdout 由网关 `tool_progress` 单元素通道
  推送（`_batchProgress` → 终端卡），运行中视口必须停在最新一行——这条链路只有真实引擎 +
  真实事件注入能验证（harness 的 `bash-live` / `batch-live` 用例）。
- **diff 对齐 = 高亮 + 折叠 + 上限**：参考实现的 diff 是 `@pierre/diffs`（语法高亮 + 行底色 +
  「N 行未变更」折叠 + 虚拟化）；我们复用已在依赖树里的 `lowlight`（highlight.js 的 hast 封装）
  做整段高亮按行拆 token（unified 与 split 两侧都高亮），用 new 侧行号区间折算 hunk 分隔条，
  并用「600 行渲染上限 + 展开全部」轻量替代虚拟化——三件事都必须由真实引擎 / DOM 断言固化。
- **bash = 终端，不是「命令块 + 结果块」**：提示符 `$`、命令与输出**同一底色**、输出用正常
  前景色（保留 ANSI 颜色）、运行中在末尾跟一个**块光标**，配合网关的 `tool_progress` 单元素
  通道就是「实时终端」观感——这几条（含 `data-terminal-running` / live cursor）都由断言固化。
- **查看类工具（read）= 路径 + 行范围 + 预览**：摘要里直接给 `path:起-止`（运行中退回
  `offset/limit` 估算），展开只留预览（`起–止 / 总行数 行` + 行号内容），**不渲染参数区**。
- **红→绿证据（实测）**：改造前基线 **18 条失败**（展开面板透明 / 命令被截断 / diff 无背景 /
  chevron `display:none` / 嵌套 header 重复）；对齐参考后 **129/129 全绿**。

## FileContentPreview 宽度验收（`file-content-preview-width`）

对应 `components/chat/tool-call/previews/file-content-preview.tsx` 与
`tool-call/css/base.css` 的输出区布局（`.tool-call-inline-section`）。渲染真实链路：
`InlineToolCall`（read、默认展开）→ `.tool-call-inline-output` → `.tool-call-inline-section`
（「输出」标签 + 预览），固定宽度容器 375 / 768 / 1280，共 **112 断言**。

覆盖项（每个宽度 × 4 个夹具：短行 / 超长单行 / 五行行号 / 截断标记）：

| 项                       | 说明                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 标签独立成行             | 「输出」标签位于预览上方；输出区为 column flow，不再与预览争同一行                                 |
| 预览铺满可用宽度         | 预览宽度 = 输出区宽度（±1px）——修复前 1280 下短行预览仅 471px（输出区 1236px），宽度随内容长度漂移 |
| 无横向溢出               | 输出区 / 卡片 / 容器 / meta 行 `scrollWidth <= clientWidth`                                        |
| 超长行归属代码块整体滚动 | 超长行用例 `pre.scrollWidth > clientWidth`；单行不再自建「无滚动条、无省略号」的隐形滚动区         |
| 行号栏吸附               | 滚到最右后最宽行的行号仍停在代码块左内侧（`sticky`；位置与未滚动时一致且不越出块边界）             |
| 页面不横向溢出           | 文档 `scrollWidth <= 1400`                                                                         |

### 运行

```bash
# 同样需要 Vite dev server 已在 127.0.0.1:5173 运行
NODE_PATH=packages/browser-automation/node_modules \
  bun apps/web/harness/verify-file-content-preview-width.ts
```

截图写到 `/tmp/opencode/file-content-preview-width-<width>.png`。

### 为什么需要它

- **jsdom 没有布局引擎**：row flex + `flex-wrap: wrap` 里「预览按内容宽度还是铺满」完全由真实
  排版决定（jsdom 的 rect 全是 0），单测发现不了「同一个卡片，短文件预览 471px、长文件预览
  1236px」这类宽度漂移。
- **逐行 `overflow-x: auto` 是隐形滚动区**：每行各自滚动时，真实浏览器里表现为「文字被硬裁切、
  无滚动条、无省略号」；本 harness 把「横向溢出归属代码块自身 + 行号吸附」固化成断言。
- **红→绿证据（实测）**：修复前 **31 条失败**（短行预览 471.5px vs 输出区 1236px；超长行
  `pre.scrollWidth == clientWidth` 且逐行 `scrollWidth > clientWidth`）；把夹具升级为真实
  可点击路径形态后，另暴露可点击路径按钮的 4px 横向溢出（`meta scrollWidth 335 > 331`，
  并向上冒泡到消息卡片），一并修复；修复后 112/112 全绿。
