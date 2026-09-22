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
| 展开 / 收起  | 展开后解除裁剪且开头可见；收起后可见区回到最新内容                                                                         |
| finalize     | 流式与静态折叠窗口高度、可见区一致（不翻转方向、不跳动）                                                                   |
| 流式光标     | 光标宿主是可见的末段（`data-streaming` 的 `::after` 落在窗口内）                                                           |
| 折叠提示单层 | 长思考（>1500 字符）展开后，思考块内**不得**再出现消息级「展开全部 · N 字符」二次裁剪                                      |
| 思考内代码块 | 长思考内部的长代码块（>100 行）也不自折叠：展开思考即看到全部内容，无「展开全部 N 行」                                     |
| 思考围栏归属 | 长正文（>1500 字符）里的 ```thinking 围栏块不自折叠：只剩消息级一层提示（短正文仍保留自带折叠，见 `fold-policy.test.tsx`） |

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
  看不到最新思考内容。本 harness 把"贴底窗口 + 流式跟随 + finalize 不跳动"三条不变量一起固化，
  防止任何一边回退。
- 另一个真实缺陷是**两层折叠提示**：思考块自带 展开/收起，而 >1500 字符的思考正文又会命中
  消息级折叠（`CollapsibleAssistantContent`），展开思考后还要再点一次「展开全部 · N 字符」，
  且第二层仍把内容裁到 60vh —— "展开"名不副实。思考正文现在显式传 `foldMode="disabled"`
  （见 `renderReasoningRichBody`），本 harness 的"折叠提示单层"用例守卫它。
- 同源的第三、四层是**思考内部的围栏块**与 **``thinking 围栏块**：思考块内部通过
`FoldDisabledContext` 让代码块 / Markdown 预览块不再自折叠；长正文里的 ``thinking
  围栏块则让位给消息级折叠（`MessageFoldContext`），短正文仍保留自带的「展开思考」。
  这两条分别由 harness 的"思考内代码块 / 思考围栏归属"与 `fold-policy.test.tsx` 守卫。
