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
