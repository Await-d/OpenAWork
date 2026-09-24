# 浏览器预览（内置浏览器 / Browser Live Preview）

> 面向开发者的能力协商、环境准备与运维说明。单点故障（控制台为空等）的排查步骤另见
> [`troubleshooting/browser-console-cross-origin.md`](./troubleshooting/browser-console-cross-origin.md)。

## 1. 这是什么

聊天页内置浏览器面板（`apps/web/src/components/chat/misc/BuiltInBrowser.tsx`）用于预览
页面、查看控制台 / 网络瀑布、检查 DOM 与样式、拾取元素引用进对话。它有三种本质不同的
渲染引擎，能力边界完全不同：

| 引擎             | 实现                                                          | 本质                                                    |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| **CDP 实时引擎** | 网关侧 Playwright + Chromium，screencast 帧渲染到 DOM `<img>` | 真浏览器，可编程、可采集、可输入                        |
| **iframe**       | Web 端 `<iframe>`（`engines/browser-content-area.tsx`）       | 只能显示；同源时可注入脚本采集控制台                    |
| **原生 webview** | 桌面端 Tauri 原生 `Webview`（`hooks/use-tauri-webview.ts`）   | 画面只能显示；控制台 / 网络由网关侧 CDP 采集（见 §2.2） |

面板从不「猜」用哪个引擎：`liveView` 为真时 CDP 实时引擎接管内容区（iframe 保留为回退），
否则按平台回退到 iframe / 原生 webview。

## 2. 引擎 × 能力矩阵

### 2.1 能力总表

| 能力                                | CDP 实时引擎（Chromium） | Web iframe（同源）     | Web iframe（跨域）    | Tauri 原生 webview                      |
| ----------------------------------- | ------------------------ | ---------------------- | --------------------- | --------------------------------------- |
| 显示页面                            | ✅ screencast 帧         | ✅                     | ✅（多数站点禁嵌）    | ✅                                      |
| 实时画面（screencast）              | ✅                       | ❌                     | ❌                    | ❌                                      |
| 控制台 `console.*`                  | ✅ 网关侧 CDP 采集       | ✅ 注入脚本            | ❌ 注入被同源策略拒绝 | ✅ 网关侧 CDP 采集（独立页面，见 §2.2） |
| 网络瀑布                            | ✅（无 body，见 §6）     | ✅ 注入（body 有截断） | ❌                    | ✅ 同上（无 body）                      |
| DOM 树 / 无障碍树 / computed styles | ✅ 网关侧 CDP            | ❌                     | ❌                    | ❌                                      |
| 元素拾取（引用进输入框）            | ✅                       | ❌                     | ❌                    | ❌                                      |
| 截图                                | ✅                       | ❌                     | ❌                    | ❌                                      |
| 设备预设（视口 / UA）               | ✅ CDP Emulation         | ✅ 容器尺寸（无 UA）   | ✅ 容器尺寸           | ❌（工具条隐藏）                        |
| 纯前端缩放                          | ✅ CSS transform         | ✅ CSS transform       | ✅ CSS transform      | ❌                                      |

> 表格里的「❌」不只是体验缺省，而是能力判定结果：UI 一律以
> `apps/web/src/components/chat/misc/browser/hooks/use-engine-capability.ts` 的
> `computeEngineCapability()` 输出为准（见 §2.3）。

### 2.2 Chromium-only 的 screencast 约束

- screencast 帧由 CDP `Page.startScreencast` 产生；`BrowserLiveSession.supportsScreencast()`
  仅当引擎为 `chromium` 时返回 `true`（`packages/browser-automation/src/live-session.ts`）。
- 网关把两件事**分开**下发：`available`（实时引擎能不能用：截图 / 读 DOM / 采集）与
  `screencast`（能不能推实时画面）。`GET /browser-live/status` 与 WS `hello` 都带这两个字段
  （`services/agent-gateway/src/browser-live/manager.ts`）。
- 因此 `available: true` 且 `screencast: false` 是一个合法降级态：内容区保持 iframe，
  但控制台 / 网络仍由网关采集，检查器仍可读 DOM、仍可截图——只是没有实时画面。
- 当前探测只会解析到 Chromium（`engine: 'chromium'`），所以该降级态主要出现在协议契约与
  测试注入里；UI 仍必须显式消费 `screencast`，不得假定 Chromium。
- **Tauri 原生 webview：画面与采集分离**。画面由系统 webview 渲染，但实时通道同样接入
  （`use-browser-live-wiring` 不再按平台关闭）：控制台 / 网络由网关侧 CDP 采集，导航由
  `use-browser-live-navigation` 把当前标签页 URL / 刷新信号下发给远端采集页面（预览不可见时
  不下发，重新可见时补发）。
- **采集页面是一个独立页面实例**：它由 sidecar 的 Chromium 打开，与系统 webview 不共享
  cookie / 登录态，窗口内的点击等交互不会同步过去——采集到的是「同一 URL 的另一次加载」。
  站内跳转（页面内点链接）同样不会同步：导航同步只跟随地址栏 / 标签页层面的 URL 变化。
  本地开发服务器（无需登录、加载即产生日志）是主要受益场景。
- 能力矩阵对 `tauri-webview` 仍不解锁 `domEval` / `screenshot` / `liveView`（元素拾取依赖
  DOM 上的 overlay，截图与实时画面依赖 CDP 视图），这些能力只在 Web 模式下可用。

### 2.3 能力判定的单一入口

`computeEngineCapability(engine, url, appOrigin, liveAvailable, liveScreencast)` 是纯函数，
输出：

| 字段          | 含义                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `sameOrigin`  | 目标 URL 与 `appOrigin` 同源（只用于判定 iframe 能否注入脚本）           |
| `domEval`     | 同源 iframe 注入可读 DOM **或** 实时引擎在网关侧读 DOM                   |
| `screenshot`  | 实时引擎可用即可截图（Playwright `page.screenshot`，与 screencast 无关） |
| `liveView`    | 实时引擎可用 **且** 支持 screencast（仅 Chromium）                       |
| `limitations` | 不可用能力对应的中文原因，UI 直接展示                                    |

约定：**UI 门控只看能力矩阵的输出**，不再自行拼 `availability.available === true` 这类判断：

- 内容区接管：`liveView`（`BuiltInBrowser` → `BrowserContentArea` 的 `liveActive`）；
- 元素拾取按钮：`liveView`（拾取器只存在于实时引擎的 DOM 视图里）；
- 控制台 / 检查器：宿主从网关状态派生一次的 `available`（它们吃的是采集与 DOM 读取，
  不需要 screencast），同一份派生值透传给三个消费点。控制台 / 网络对两种引擎都生效
  （含 Tauri 原生窗口）；检查器仍只在 Web 模式可用。

## 3. 让实时预览真正跑起来

### 3.1 开关

| 环境变量                            | 作用                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `OPENAWORK_BROWSER_LIVE=1`          | 只启用浏览器实时预览（Web / 服务器部署推荐）                           |
| `DESKTOP_AUTOMATION=1`              | 兼容别名；桌面端 sidecar 一直注入它，同时会启用 Agent 的桌面自动化工具 |
| `BROWSER_LIVE_IDLE_TTL_MS`          | 会话空闲回收毫秒数，默认 `120000`                                      |
| `BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS` | 单帧 ack watchdog 毫秒数，默认 `4000`                                  |

关闭时 `GET /browser-live/status` 返回 `available: false` + disabled-runtime reason，
前端显示开关提示（见 §4），面板自动留在 iframe 回退。

### 3.2 浏览器解析顺序（只探测，不启动浏览器）

网关在建立会话前调用 `probeLiveBrowserAvailability()`
（`packages/browser-automation/src/live-browser-availability.ts`），按**有序候选**解析可执行
文件并做磁盘校验（存在 + 非零大小 + posix 可执行位）：

1. `override` —— 环境变量显式覆盖：`OPENAWORK_BROWSER_PATH`（本产品专用，优先）→ `CHROME_PATH`
   （puppeteer 等工具的通用约定）。覆盖只是「优先尝试」：路径不可用时**继续**后面的候选，不会中止探测；
2. `managed` —— Playwright 自带的 chromium（`chromium.executablePath()`，`source: 'managed'`）；
3. 系统浏览器 —— 依次为 `system-chrome` / `system-chromium` / `system-edge` / `system-brave` /
   `system-vivaldi` / `system-opera`。每族先扫 `PATH`（Windows 遵循 `PATHEXT`），再回退到按平台枚举
   的静态安装路径（Linux 含 flatpak / snap / `/usr/local/bin`，macOS 含用户级 `~/Applications` 与
   Chrome Beta/Dev/Canary，Windows 含各发布通道的安装目录）。

`managed` 修订目录存在但可执行文件缺失 / 零字节时记为 `browser-outdated`，但**不会遮蔽**
其他可用的系统浏览器候选；全部候选都不可用才回落到 `browser-missing`。
`managed` 命中时启动会省略 `executablePath`，交给 Playwright 校验修订号；
`override` 与所有 `system-*` 则显式传 `executablePath`（跳过 Playwright 修订校验，这是唯一的降级路径）。

探测缓存：正向结果进程级缓存；负向结果 `NEGATIVE_PROBE_CACHE_TTL_MS = 5000`（刚装好浏览器的
下一次轮询即可拾取）。

### 3.3 安装命令与固定版本

```bash
npx playwright install chromium
```

- 运行时依赖固定在 `packages/browser-automation/package.json`：`playwright@1.58.2`。
  升级该版本会改变期望的 `chromium-<revision>`，需要同步重装浏览器（否则落入 `browser-outdated`）。
- 未安装 Playwright 浏览器时，系统 Chrome / Edge 可兜底；两者都没有才会提示安装。
- 桌面端 sidecar 使用 `build:binary` 打包，**不包含**浏览器二进制，因此在用户机器上仍需
  系统浏览器或 managed 安装。

### 3.4 `PLAYWRIGHT_BROWSERS_PATH` 行为

桌面端在拉起 gateway sidecar 时注入 `PLAYWRIGHT_BROWSERS_PATH`
（`apps/desktop/src-tauri/src/lib.rs` 的 `playwright_browsers_dir`）：

- 进程环境里已有**非空**外部值时沿用外部值（开发机 / CI 常见）；
- 否则落到 `<effective_data_root>/browsers`（跟随桌面端设置里的数据根目录）。

`desktop_automation` 工具与实时预览共用同一个 sidecar 进程，因此注入一次、两处同时生效。
以 `bun run --filter @openAwork/agent-gateway dev` 独立跑网关时不会注入，Playwright 按自身
平台默认目录（如 `~/.cache/ms-playwright`）解析，也可以自己 export 该变量覆盖。

### 3.5 验证

1. 打开内置浏览器：若顶部出现黄色「实时预览不可用」横幅，按 §4 对号入座；
2. 没有横幅且内容区出现实时画面（顶部状态 chip 为已连接）即实时引擎生效；
3. 也可以直接看网关状态：

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/browser-live/status
# { "available": true, "engine": "chromium", "screencast": true, "source": "managed", ... }
```

## 4. reason token 与用户提示

`reason` 由网关下发，前端 `describeBrowserLiveUnavailable()` 翻译成可操作的中文提示，
渲染为面板顶部的黄色横幅（`BuiltInBrowser` 的 `role="status"` 区域）。

| reason                  | 含义                                      | 用户可见提示（要点）                                                                            | 修复                                                               |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ready`                 | 探测成功（只会随 `available: true` 出现） | 无提示（不进入不可用分支）                                                                      | —                                                                  |
| `browser-missing`       | 所有候选都不可用                          | 「安装 Chrome/Edge 即可直接使用，或执行 `npx playwright install chromium`」                     | 装系统 Chrome/Edge，或执行安装命令后重试                           |
| `browser-outdated`      | managed 修订目录在、可执行文件缺失/零字节 | 「调试浏览器版本与当前 Playwright 不匹配，请重新执行 `npx playwright install chromium`」        | 重新执行安装命令（常见于升级 Playwright 之后）                     |
| `probe-failed`          | 探测过程预期外错误（解析路径抛错等）      | 「调试浏览器检测失败，请稍后重试或确认 Playwright 浏览器安装完整」                              | 查看网关日志中的原始 `detail`；重试或修安装                        |
| disabled-runtime 契约串 | 网关未启用实时预览                        | 「设置 `OPENAWORK_BROWSER_LIVE=1` 后重启网关（桌面端 sidecar 由 `DESKTOP_AUTOMATION=1` 启用）」 | 配置对应环境变量后重启网关                                         |
| 其他未知值              | 例如状态请求的 HTTP 错误信息              | 通用提示「浏览器实时预览不可用，当前已自动切换为 iframe 预览」                                  | 原始 `reason` 保留在 `availability.reason`（控制台可见），据此排查 |

> disabled-runtime 在网关侧是**契约字符串**而非探针 token：
> `browser live view is disabled in this runtime`（`BROWSER_LIVE_DISABLED_MESSAGE`）。
> Web 端无法 import 网关包，只能按同一字面量匹配；改动该串需要同时改
> `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-session.ts` 的常量。

## 5. 协议摘要

### 5.1 传输

- **WS**：`GET /browser-live`，token 走 `?token=<jwt>` 或 `Authorization: Bearer <jwt>`；
- **REST**（前缀 `/browser-live`）：
  - `GET /status` —— 能力协商（`available` / `engine` / `screencast` / `reason` / `installable` / `source` / `expectedRevision` / `executablePath`）；
  - `POST /start` `{ url? }` —— 预热会话（不长期占订阅引用计数）；
  - `POST /stop` —— 停止会话；**必须发合法 JSON body（`{}`）**，见 §7.3；
  - `POST /screenshot` `{ sessionId, fullPage? }` —— 截图并落 artifact，返回
    `{ artifactId, fileName, mimeType, sizeBytes }`。

### 5.2 信封

所有下行消息统一为 `{ ch, seq, ts, payload }`（`@openAwork/shared` 的
`BrowserLiveEnvelope`）。下行 `seq` 按用户单调递增；上行消息 `seq` 恒为 0。

**下行通道**：`hello`（握手一次，含可用性）、`frame`、`console`、`network`、`nav`、
`node`、`dom`、`a11y`、`screenshot`、`error`、`pong`。

**上行通道**：`ack`（帧确认）、`input`（mouse / wheel / key）、`device`（视口 + UA）、
`control`（`navigate` / `reload` / `screencast.start` / `screencast.stop` / `pick` /
`node.styles` / `screenshot` / `dom.tree` / `a11y.tree` / `ping`）。

### 5.3 帧背压（credit / ack）

- 任意时刻**只有一帧在途**：网关发出 `frame` 后等待 controller 回 `ack`（携带该帧的线路
  `frameSessionId`），收到后才 `Page.screencastFrameAck` 并放行下一帧；
- 浏览器端在 `<img>` `onLoad` 后 ack，另有 500ms 兜底定时器（解码异常时也能放行）；
- **4s watchdog**：超时未 ack 时网关强制放行（`BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS`），
  避免 controller 卡死整条链路；
- 帧队列高水位 `BROWSER_LIVE_HIGH_WATER_FRAMES = 3`；单帧 base64 超
  `BROWSER_LIVE_MAX_FRAME_BYTES = 1_500_000` 直接丢弃但仍回 ack，避免撑爆 WS 缓冲。

## 6. 已知限制

- **CDP 路径不采集响应体**：网络仅上报方法 / URL / 状态 / 耗时 / 已脱敏头，`requestBody` /
  `responseBody` 为空（注入路径才读 body，且 8KB 截断）。`NetworkExchange.responseBody`
  因此只可能来自同源 iframe 注入。
- **HAR 是纯客户端导出**：瀑布视图由前端 `network-har.ts` 把已采集记录拼成 HAR 1.2 后
  用 Blob 下载，不经过网关；未采集的字段（`headersSize` / `bodySize` / 分段耗时）按规范写 `-1`。
- **source map 只覆盖前 ~12 帧**：`DEFAULT_SOURCE_MAP_MAX_FRAMES = 12`，且只处理 `http(s)`
  帧（`data:` / `chrome-*` 等一律跳过）；脚本无 `sourceMappingURL`、map 抓取失败或位置未命中时，
  该帧回落为打包后位置并标记「未映射」。
- **DOM 树被钳制**：深度默认 4、上限 12（`BROWSER_LIVE_DOM_DEFAULT_DEPTH` /
  `BROWSER_LIVE_DOM_MAX_DEPTH`），节点上限 2000（`BROWSER_LIVE_DOM_MAX_NODES`）；
  无障碍树节点上限同为 2000。命中上限时 `dom` 回包带 `truncated: true`。
- **一个用户最多一条 live session**，引用计数归零后保温 `BROWSER_LIVE_IDLE_TTL_MS`
  （默认 120s）再关闭浏览器。
- WS 的 `control.screenshot` 回传**内联 base64**（不落 artifact）；需要 artifact 的截图走
  REST `POST /browser-live/screenshot`。

## 7. 故障排查

### 7.1 实时预览显示空白 / 纯白帧

按可能性从高到低排查：

1. **默认标签页就是空白页**：新标签页 URL 是 `about:blank`（`browser-storage.ts` 的
   `DEFAULT_URL`），先在地址栏导航到真实页面。
2. **远端还没被导航**：`navigate` 指令要等通道就绪才会下发——建连窗口内的上行消息会被缓冲，
   收到首个下行信封（`hello`）后才冲刷（`use-browser-live-session` 的待发队列 + hello 门控）。
   顶部状态 chip 未显示已连接时，先等连接完成再地址栏回车。
3. **帧到了但页面本身是白的**：用目标页的 console 输出确认页面脚本是否执行；纯静态白页
   在 screencast 下就是白帧。
4. **确认帧通道真的在推流**：`screencast.start` 只在 `hello.screencast === true` 时发出；
   若状态显示 `screencast: false`（非 Chromium 的降级态），本就没有实时画面，属预期行为。

### 7.2 切换设备预设后画面不更新

先区分两件事：

- **预设**决定模拟视口（`device` 上行），是服务端行为；
- **缩放**是纯前端 CSS `transform: scale()`，**不会改变帧内容**，画面看起来「没变」是预期。

预设本身有三段延迟/收敛逻辑（都在 `cdp-live-engine.tsx` 与 `live-session.ts` 内）：

1. `device` 上行有 200ms 防抖（`DEVICE_SYNC_DEBOUNCE_MS`）；
2. Chromium 的 screencast 只在页面产生新 damage 时产帧，覆写视口后 `setDeviceMetricsOverride`
   会**主动重开 screencast** 强制产出新帧；
3. 过渡帧可能带着新尺寸的元数据却是旧视口的位图，`ScreencastConvergence` 会按帧校验位图与
   元数据，不匹配就重开，直到收敛或用尽次数 / 截止时间。

所以：切换后 1–2 秒内未更新属正常收敛窗口；持续停在旧尺寸时，检查连接是否仍是已连接状态
（掉线重连会由 `hello` 重新拉起 screencast），并确认预设下拉确实发出了变更。

### 7.3 「停止实时预览」返回 400

**症状**：调用 `POST /browser-live/stop` 得到 `400`（Fastify 5 的 body 校验错误）。

**原因**：该端点没有入参，早期客户端直接 `POST` 且带 `content-type: application/json` 但不带
body；Fastify 5 对「JSON content-type + 空 body」直接返回 400，而不是按无体处理。

**修复**：客户端必须发合法 JSON body（`{}`）。`packages/web-client/src/infra/browser-live.ts`
的 `stop()` 已如此实现；新增客户端 / 脚本时照抄该约定。

### 7.4 控制台条目没有调用栈

控制台条目的 `stack` / `sourceMappedStack` 由 CDP `Runtime.consoleAPICalled` /
`Runtime.exceptionThrown` 提供，再经网关 source map 解析：

- 没有任何帧时不渲染调用栈入口（`buildConsoleStackView` 返回 null）——CDP 未采集到栈时即是此
  情形（例如非脚本求值路径产生的日志）；
- 有栈但与源码对不上时，帧会标记「未映射」并展示打包后位置，常见原因：
  只解析前 12 帧（`DEFAULT_SOURCE_MAP_MAX_FRAMES`）、帧 URL 不是 `http(s)`、脚本没有
  `sourceMappingURL`、map 不可达或位置未命中映射；
- dev server（Vite / webpack）下需要能访问到被服务脚本与其 map；局域网 / 权限问题会让抓取
  失败并整体回落为未映射。

### 7.5 `POST /browser-live/screenshot` 返回 404 `browser_live_session_not_found`

该错误码**不是**「实时会话不存在」，而是 artifact 落库前的**会话所有权校验失败**：
`body.sessionId` 对应的聊天会话必须存在且属于当前 token 的用户，否则直接 404
（`services/agent-gateway/src/routes/browser-live.ts`）。

- 传对聊天会话 id（截图 artifact 会挂到该会话下）；
- 若会话存在但 500/503 提示「浏览器实时预览会话尚未启动」，那是 live session 没起来：
  先连 WS 或调用 `POST /browser-live/start` 预热；
- 不同账号的会话 id 不能互用（按 `request.user.sub` 收敛）。

## 8. 相关文件

| 作用                      | 路径                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- |
| 引擎能力矩阵（单一入口）  | `apps/web/src/components/chat/misc/browser/hooks/use-engine-capability.ts`       |
| 实时接线（事件 → 控制台） | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-wiring.ts`     |
| Tauri 采集导航同步        | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-navigation.ts` |
| 实时会话生命周期          | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-session.ts`    |
| CDP 实时视图              | `apps/web/src/components/chat/misc/browser/engines/cdp-live-engine.tsx`          |
| 内容区（三引擎分支）      | `apps/web/src/components/chat/misc/browser/engines/browser-content-area.tsx`     |
| 引擎可用性探测            | `packages/browser-automation/src/live-browser-availability.ts`                   |
| 实时会话实现 + source map | `packages/browser-automation/src/live-session.ts`、`source-map-resolver.ts`      |
| 网关 WS / REST 路由       | `services/agent-gateway/src/routes/browser-live.ts`                              |
| 会话管理器 + 开关         | `services/agent-gateway/src/browser-live/manager.ts`                             |
| 扇出 + 帧背压             | `services/agent-gateway/src/browser-live/hub.ts`                                 |
| 线路协议（shared）        | `packages/shared/src/browser-live.ts`                                            |
| 客户端（web-client）      | `packages/web-client/src/infra/browser-live.ts`                                  |
| 桌面端浏览器目录注入      | `apps/desktop/src-tauri/src/lib.rs`（`playwright_browsers_dir`）                 |
