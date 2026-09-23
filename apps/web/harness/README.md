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
