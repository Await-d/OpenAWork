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
| `BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS` | 单帧 ack watchdog **上限**毫秒数，默认 `4000`（实测往返低时自动收紧）  |

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
  - `POST /stop` —— 停止会话；**必须发合法 JSON body（`{}`）**，见 §7.6；
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

### 5.3 帧背压（两段式 credit / ack）

- **对 CDP 侧立即 ack**：网关一收到 `Page.screencastFrame` 就 `Page.screencastFrameAck`，
  Chromium 随即开始编码下一帧（编码与客户端解码并行）。旧实现要等 controller ack 才放行，
  帧率被一个完整链路往返钉死（`fps ≈ 1 / RTT`，60ms 就只剩 16fps），点击反馈也被同一环拖慢；
- **对 controller 侧限量 + 只保最新**：未 ack 的在途帧不超过
  `BROWSER_LIVE_HIGH_WATER_FRAMES = 3`；等待下发的帧只保留**最新一帧**，客户端跟不上时
  丢掉的是过期画面而不是新画面。controller 的 `ack` 只用于采样往返、降质/回升与回收配额，
  不再阻塞 CDP 产帧；
- **自适应 watchdog**：队首在途帧超时即回收配额，耐心值为
  `clamp(4 × ack 往返 EMA, 500ms, BROWSER_LIVE_FRAME_ACK_TIMEOUT_MS)`。固定 4s 的代价是
  「丢一次 ack 就冻结 4 秒」，收紧后只损失几百毫秒；没有样本时仍用配置值（4s）；
- 单帧 base64 超 `BROWSER_LIVE_MAX_FRAME_BYTES = 1_500_000` 直接丢弃但仍回 ack，
  避免撑爆 WS 缓冲。

### 5.4 起流定档（帧尺寸 / 画质）与自适应

定档不再由网关单方面决定：客户端在 `control.screencast.start` 里带上 `maxWidth` / `maxHeight` /
`quality` / `binary`，网关只负责校验（尺寸 ≤ 2048、质量 ≤ 100）与回落默认
（`BROWSER_LIVE_SCREENCAST_MAX_EDGE = 1024`、`BROWSER_LIVE_SCREENCAST_QUALITY = 50`）：

- **帧盒按显示尺寸 × 实得像素倍数**：客户端用
  `canvas 显示尺寸 × min(档位倍数, devicePixelRatio)` 计算（`resolveDisplayScale`）。
  窄面板不再按 1024 边产帧（多出来的像素只会变成编码 / 传输 / 解码成本），高 DPR 面板也不会
  停在 1x 发糊。**1x 屏上「均衡 / 清晰」档会退化成 1:1**：按 1.5 / 2 倍取像素只是让 Chromium
  多光栅化一遍再缩回去显示，清晰度不涨而编码 / 传输 / 解码全额变慢。`device` 上行必须带
  同一个 `deviceScaleFactor`——CDP 的 screencast 只缩不放，视口物理像素才是清晰度的上限，
  只改盒子不生效。
- **定档在推流期间可改**：`beginScreencast` 只在定档（quality / maxWidth / maxHeight）
  真正变化时重发 `Page.startScreencast`，参数一致则幂等早退。切换画质档位因此即时生效，
  不需要收起面板或断线重连。
- **慢帧降档 / 快帧回升**（`hub.ts` 的 `noteFrameLatency`）：按 ack 往返采样，> 250ms 连续
  15 帧降一档，< 60ms 连续 30 帧回升 5；质量下限 40、上限回到客户端协商值，两次调整间冷却
  10s。`Page.startScreencast` 幂等，调整只重发参数、不必停流。
  **降档前提是「降了有用」**：还要 `isProduceRateLagging` 判定产帧间隔确实超过 ack 限速周期
  的 1.5 倍（即编码 / 页面渲染真的是瓶颈）。产帧正常而只是往返慢时不动质量——否则会形成
  把「产帧慢」误判成「消费慢」的降档螺旋：越降越糊、帧率还不回升。
- **二进制帧**：客户端声明 `binary: true` 后，网关直接发 WS binary
  （`[kind][headerLen][header JSON][JPEG]`，见 shared 的 `BROWSER_LIVE_BINARY_FRAME_KIND`），
  省掉 base64 的 33% 体积与前端 `atob` + 逐字节搬运；没有 `sendBinary` 的 sink 自动回退
  JSON 信封。
- CDP 不设 `maxWidth` / `maxHeight` 时，每帧都按视口**原始像素**产出——大面板与高 DPR 的设备
  预设（手机 375×812 @2 = 750×1624 物理像素）下单帧是百万级像素的 JPEG，客户端每帧都要
  解码 + 重绘面板，主线程被吃满后**整个应用**都会卡；
- 盒子是「最长边不超过 1024 物理像素」的等比缩放盒（只缩不放、不拉伸）；客户端仍按帧元数据
  `deviceWidth / deviceHeight` 定位与换算坐标，画面只是变清晰度、不变比例，因此坐标映射、
  元素拾取、letterbox 全部不受影响；
- **截图不受影响**：`POST /browser-live/screenshot` 与 WS `control.screenshot` 走
  Playwright `page.screenshot`，仍是全分辨率；
- 尺寸收敛（§7.2）必须与盒子保持一致：`ScreencastConvergence` 的 `target.bitmapBounds`
  按同一规则推算期望位图尺寸（带 2px 取整容差），否则位图永远「不等于视口尺寸」，
  每次设备覆写都会空转到预算耗尽。

### 5.5 不可见即停流

预览「不可见」有两层，任一层成立都停流：

1. **宿主把容器隐藏**：预览宿主（`EditorBrowserWorkspace` / `BuiltInBrowser`）是 keep-alive 的，
   切走 tab / 收起面板只把容器 `display: none`，帧照样推；
2. **整个标签页 / 窗口不可见**（切到别的标签、最小化）：宿主毫不知情，但页面仍在收帧、解码。

`CdpLiveEngine` 的停流判定是 `hidden || !documentVisible`（`use-document-visibility` 监听
`visibilitychange`）：为真时下发 `control.screencast.stop`，重新可见时再下发
`control.screencast.start`（幂等，且会立即产出一帧，画面不会停在旧帧上）。

> 取舍：`screencast.stop` 停的是**整条会话**的产帧（与卸载路径同一套语义）。多端同时观看时
> 由仍在观看的一端重新拉起；`task` 侧不感知流状态。

### 5.6 前端渲染与输入节流

预览卡的主因是「每帧都要在主线程上做重活」，因此前端侧按三条规定收口：

- **帧数据不进 React 状态**：只有「元数据尺寸」与「是否已有画面」两份轻量状态参与渲染，
  帧本身留在 ref 里，由 `useCdpLiveFrames` 直接画进 `<canvas>`（不再每帧 `setState` +
  重设 `<img src="data:…">`）；
- **backing store 按显示尺寸定档**（`resolveBackingSize`）：画布位图**宽高各自**按
  `显示尺寸 × DPR × zoom` 取整，并且不超过帧位图本身。之前按位图尺寸定档时，帧盒可到
  2048 物理像素，而画面只显示在几百 CSS 像素的盒子里——每帧都要向合成器上传并缩放一张
  大纹理，这部分开销与清晰度无关。宽高必须分别换算：canvas 的 CSS 尺寸就是显示尺寸，
  若按位图比例反推高度，比例不一致时浏览器会把 backing store 拉伸变形。显示尺寸未测量时
  退回位图尺寸，保证首帧照常可画；
- **2d 上下文选项一致**：`alpha: false` / `desynchronized: true` 只在**首次**创建上下文时
  生效，因此 `clear()` 与 `paint()` 必须用同一组 `getContext` 选项——`clear()` 通常在
  首帧之前执行（切标签），若它用默认选项建了上下文，后续的低延迟绘制路径就永久失效；
- **解码离主线程**：走 `createImageBitmap`（JPEG 解码不占主线程），画完（或解码失败）立刻回
  `ack`——失败也必须回，否则整条链路要等 watchdog。缺 `createImageBitmap` 的老 WebKit
  回落离屏 `<img>` + data URL（慢但画面不消失）；
- **串行解码、只解最新一帧**：网关对 CDP 侧是 `BROWSER_LIVE_HIGH_WATER_FRAMES` 帧在途，
  客户端跟不上时这些帧会同时到达。若对每帧都直接解码，除最新那张外全部会被代次判定丢弃
  ——JPEG 解码是整条链路最贵的一段，白解两次就把帧预算吃光。因此客户端只保留一个待解码槽
  （新帧顶掉旧帧）且同一时刻只允许一个解码在飞，被顶掉的帧**立即归还配额**；
- **指针输入按帧合并**：`mouseMoved` 每个动画帧只发最后一次坐标，且与上次下发坐标的位移
  不足 `POINTER_MOVE_MIN_DISTANCE_PX = 1` 时不发（亚像素抖动对远端毫无意义，却每次都会
  让页面重新命中测试并产出一帧全量 JPEG）；`wheel` 在帧内累加增量合成一条，且**不参与**
  位移阈值——滚轮的每一分增量都对应真实位移，筛掉会让滚动距离缩水；
- **控制台 / 网络事件批量归并**：`applyConsoleOps` 按 tab 一次性应用整批操作——每个 tab
  只复制一次数组、`networkId → 下标` 索引只建一次，批量结束后统一裁剪。逐条
  `upsertNetworkEntry` / `append` 的写法是「操作数 × 表长」的全表扫描加整表复制，首屏
  日志洪峰（几百条）时会涨到数万次元素搬运，正好和画面解码抢主线程；
- **两层 ack 职责不同，不能混为一谈**：
  - **客户端 → 网关的 `ack`** 只表示「我消费完了」，用于测往返 / 降质 / 回收配额。客户端在
    「解码 + 绘制完成」后**立即**回，不叠加任何最小间隔；定时器版本会在挂起期间丢弃新 ack，
    把那一帧拖到 watchdog（帧率瞬间跌到 0.25fps）。
  - **网关 → CDP 的 `Page.screencastFrameAck`** 才是**产帧速率限制器**：它的语义是「可以编
    下一帧了」。收到就回等于让 Chromium 编码器全速运转，而编码与页面自身的 JS / 布局 /
    绘制在同一进程里抢 CPU——页面越重被挤压得越狠，实测表现为画面 1–3fps、点击半天才有
    反应。网关因此保留最小间隔 `BROWSER_LIVE_CDP_ACK_FLOOR_MS = 16`（≈60fps 上限；环境
    变量可覆盖，`0` = 关闭）：间隔内到达的帧只记账**最新**一帧的 `frameSessionId`，到点补
    一次 ack。取 16ms 而非更保守的值：限速只该拦掉「无意义的全速空转」，不该成为帧率主瓶颈
    ——实测客户端解码 2ms、单帧 10KB、带宽与 CPU 双双空闲仍只有 8fps 时，瓶颈在别处，
    把上限压到 25fps 只会白白损失流畅度。
  - **但限速必须对交互让路**：限速的等待会原封不动加到「手动了、画面还没动」的感知延迟
    上——这正是「拖动明显卡顿」。因此网关在 `BROWSER_LIVE_INTERACTIVE_WINDOW_MS = 250`
    窗口内（自最近一次输入起算，由 `noteUserInput` 标记）**取消限速**：拖动 / 输入期间每
    帧立即放行（追求跟手），空闲时恢复限速（把 CPU 让回页面）。

- **降档有两级杠杆，先质量后分辨率**（`hub.adjustScreencastQuality`）：JPEG 质量降到
  `BROWSER_LIVE_MIN_QUALITY = 40` 见底后，改按 15% 步长缩**帧盒**——编码成本与像素量成
  正比，而像素量是边长的平方，缩到 85% 就少 28% 像素，这是质量见底后唯一还有明显效果的
  手段。帧盒下限是协商值的 `BROWSER_LIVE_MIN_FRAME_SCALE = 0.5`，再小就糊到看不清；回升
  时顺序相反（先补分辨率再补质量）。

- **拖动期间指针输入不走按帧合并**：合并要等下一个动画帧（0–16ms），而拖拽对这段延迟极
  其敏感。`pointerInput.moveImmediate()` 当帧直接上行（仍过 `POINTER_MOVE_MIN_DISTANCE_PX`
  阈值，亚像素抖动不产帧）；悬停移动仍走合并压噪声。拖动状态由 `mousedown`/`mouseup`
  维护，并用全局 `mouseup` + `blur` 兜底——否则拖到面板外松手会让状态永久卡在「拖动中」，
  此后所有悬停都变成即时上行、持续产帧。

  不使用 CDP 的 `everyNthFrame`：尺寸收敛（§7.2）依赖「每次 rearm 立即产出一帧」，而 Chromium
  对 `everyNthFrame` 的计数口径不在协议契约里，本机无 Chromium 可验证（`live-session` 集成
  测试 `skipIf(!chromiumAvailable)`）。

### 5.6.1 低帧率诊断口径

实时画面角标现在同时展示两组尺寸：`视口 WxH` 是 CDP 元数据，`位图 WxH` 是
`createImageBitmap` 成功解码后的真实 JPEG 像素尺寸；两者不能混用来判断帧盒是否生效。
角标中的 `总 / 排队 / 解码 / 绘制` 分别表示从客户端收帧入口到 ack 的总耗时、等待串行解码槽的
耗时、JPEG 解码耗时和 Canvas 绘制耗时。WebSocket 消息进入浏览器后、进入信封回调前的二进制
header 解析与 `ArrayBuffer` 复制不包含在这四个数中。

网关可通过 `OPENAWORK_BROWSER_LIVE_DIAGNOSTICS=1` 每秒输出一次帧生命周期采样，字段包括
`produceIntervalMs`、`produceFps`、`sendMs`、`ackRttEmaMs`、`inflightFrames` 和
`pendingFrame`。该开关默认关闭，避免诊断日志干扰实时链路。

FPS 对照必须使用持续产生 damage 的动画页；`about:blank` 或纯静态页只适合验证首帧和
`screencast.refresh`，不能作为持续帧率基准。

### 5.7 两条渲染通道（实时画面 / 原生渲染）

实测环境里 CDP 链路的帧率由**网关侧编码 + 传输 + 客户端解码**共同决定；容器 / 无 GPU /
远程网关下可能只有个位数 fps。因此预览提供两条通道，由工具栏显示器图标切换（偏好持久化到
`NATIVE_RENDER_KEY`）：

|                 | 实时画面（缺省）                             | 原生渲染                                                   |
| --------------- | -------------------------------------------- | ---------------------------------------------------------- |
| 画面            | 网关 Chromium 的 screencast，画进 canvas     | 本地 iframe，浏览器原生合成                                |
| 帧率 / 输入     | 受编码 + 传输 + 解码限制，输入多一次往返     | 60fps，输入直达页面                                        |
| 地址同步        | CDP `nav` 事件，跨域页面也准确               | 跨域页面读不到 `location`，地址栏不跟随                    |
| 后退 / 前进     | CDP `goBack` / `goForward`（保留 SPA state） | 前端历史定向导航（整页重载；跨域 iframe 禁止访问 history） |
| 拾取 / 设备模拟 | 可用                                         | 不可用（画面不经过 canvas）                                |

原生渲染下网关侧页面仍由 `useBrowserLiveNavigation` 跟随 URL，因此**控制台 / 网络采集**继续
可用。实时画面连续 3 个采样窗口低于 8fps 时，画面顶部会出现「切换原生渲染」提示条——这是
「卡到不可用」时的确定性出路，不必让用户自己猜。

- **切标签：清空 + 拉闸门，等远端真到目标地址才放行**。实时分支只有一块 canvas + 一个远端
  页面。只清一次 `clearRect` 不够——远端此时还停在旧文档上，下一帧立刻把旧内容画回来（切到
  新建的空白标签最明显）。因此 `CdpLiveEngine` 在 `tabId` / `url` 变化时：
  1. `clearRect` 清空；
  2. 拉上 `frameGateRef`——闸门期间收到的帧**不解码不绘制**，只回 ack 维持背压；
  3. 等网关的 `nav` 事件（主文档已切换）才放开；1.5s 兜底放行，避免目标页自我跳转 / 加载
     失败导致画面永久空白；
  4. **放行时必须补一帧**：screencast 只在页面产生 damage 时推帧，静态页（尤其
     `about:blank`）加载完就不再产帧，而闸门期间那些帧已被丢弃——不补就是永久空白。
     走 `control: screencast.refresh`（网关重发幂等的 `Page.startScreencast`，沿用当前
     定档、立即按当前视口产一帧）。
  5. 两个标签 URL 相同时补一次 `reload`（url effect 不会重复下发 navigate，远端不产生新
     damage，清空后会一直空白）。

  **帧带页面代次（根治快速来回切换）**：闸门只覆盖「导航确认前」的窗口，覆盖不了竞态——
  切走再切回时，上一轮页面产出的帧可能在新一轮导航之后才到达，仅按时序判定就会画进新标签。
  因此 `Page.screencastFrame` 被打上 `generation`（复用 `navigationGeneration`，主文档每导航
  一次自增）并一路透传到 `frame` 信封。客户端维护 `minGenerationRef`：低于门槛的帧一律丢弃
  （仍回 ack 维持背压），门槛在「拉闸门」与「收到更大代次」两处抬高。老网关不下发该字段时
  退回原来的时序判定，行为不变。

  **远端自身导航不重复下发 `navigate`**：SPA 路由 / 页内点链接会先由网关回报 `nav`，地址
  再写回标签、触发 `url` 变化。若这时照常清空 + `navigate`，等于把页面整页重载——画面闪白、
  状态全丢（用户感受是「点个链接就卡住」）。引擎用 `remoteUrlRef`（`nav` 回报的实际地址）
  区分「谁发起的导航」：地址来自远端就只更新记录，不再下发。

  **占位页也必须真实下发 `navigate about:blank`**：这是合法的 CDP 导航，能把网关侧主文档
  真的切到空白页。早期实现用 `NAVIGABLE_URL_PATTERN` 挡掉它，远端就一直停在旧页面继续推
  旧帧——既画面错位，也让控制台 / 网络采集挂在上一个页面上。

配套的两条量产约束：

- **写盘自动刷新有 8s 冷却**（`WORKSPACE_INDEX_REFRESH_MIN_INTERVAL_MS`）：Agent 连续写盘时
  索引版本几乎每轮都在变，不加冷却就等于每 2.5s 整页 reload 一次；冷却期内的变化会合并成
  一次**尾随**刷新，最后一次写盘不会漏。
- **控制台面板是 memo 组件**：`BuiltInBrowser` 未被 React Compiler 接管（`check:react-compiler`
  实测 compiled 0 / bailout 1，compiler-limit），因此 `logs` 与 `inspector` 两个大 props 的
  引用必须在宿主侧手工稳定，否则每次父渲染都会重刷上百行日志。

## 6. 已知限制

- **CDP 路径不采集响应体**：网络仅上报方法 / URL / 状态 / 耗时 / 已脱敏头，`requestBody` /
  `responseBody` 为空（注入路径才读 body，且 8KB 截断）。`NetworkExchange.responseBody`
  因此只可能来自同源 iframe 注入。
- **HAR 是纯客户端导出**：瀑布视图由前端 `network-har.ts` 把已采集记录拼成 HAR 1.2 后
  用 Blob 下载，不经过网关；未采集的字段（`headersSize` / `bodySize` / 分段耗时）按规范写 `-1`。
- **source map 只覆盖 `error` 级别、前 ~12 帧**：`DEFAULT_SOURCE_MAP_MAX_FRAMES = 12`，且只处理
  `http(s)` 帧（`data:` / `chrome-*` 等一律跳过）；普通 `log` / `info` / `debug` 不解析（见 §7.7）。
  脚本无 `sourceMappingURL`、map 抓取失败或位置未命中时，该帧回落为打包后位置并标记「未映射」。
  解析结果只带位置、**不带源码全文**。
- **DOM 树被钳制**：深度默认 4、上限 12（`BROWSER_LIVE_DOM_DEFAULT_DEPTH` /
  `BROWSER_LIVE_DOM_MAX_DEPTH`），节点上限 2000（`BROWSER_LIVE_DOM_MAX_NODES`）；
  无障碍树节点上限同为 2000。命中上限时 `dom` 回包带 `truncated: true`。
- **实时画面按需定档**：位图由客户端按「显示尺寸 × `min(档位倍数, DPR)`」协商（§5.4），
  JPEG 质量 50 起、慢帧自动降档（下限 40）；帧率不再有固定上限，由链路（编码 + 传输 +
  解码）与在途配额决定（§5.3 / §5.6）。预览角标的 `N×M · nfps · KB · ms` 依次是位图尺寸、
  实测帧率、最近一帧的体量与处理耗时，可直接区分「带宽 / 主线程 / 静态页」三类情况。
  大面板 / 桌面预设下放大观赏仍会偏糊、高帧率动画也不会完全跟随；要原始分辨率请用截图
  （不受限帧影响）。
- **写盘后的自动刷新不是实时的**：最短 8s 一次（§5.6），Agent 连续写盘期间预览不会逐轮跟随。
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

### 7.3 拖动面板 / 拖拽窗口时画面明显卡

**原因**：帧盒由面板测量尺寸算出，而 `screencast.start` 的 effect 依赖帧盒；网关发现定档
变化就会重发 `Page.startScreencast`，而重发会**重启流失并全量重编码一帧**。若按像素级
变化触发，整个拖拽过程会持续重编码，画面就一直抖着卡。

**修复**：面板尺寸测量带比例容差（`SURFACE_SIZE_EPSILON_RATIO = 0.1`，最少 1px），容差内的
尺寸变化不产生新的 `surfaceSize`，因此不会重开流失。

若拖拽**停止后**依然卡，看预览角标：`nfps` 接近 60 且 `ms` 很小说明链路健康，卡顿来自
页面自身渲染；`nfps` 只有个位数而 `KB` 极小、`ms` 也极小时，说明 Chromium 侧编码 / 页面
渲染是瓶颈——此时应降档（缩帧盒）或改用原生渲染，而不是继续调链路参数。

### 7.4 重启应用后标签全没了

**症状**：关掉应用再打开，内置浏览器的所有标签与网址都消失，只剩一个空白新标签。

**原因**：标签按 workspace 存在 `localStorage`，key 为
`openawork:builtin-browser:tabs:v1:<workspacePath>`。冷启动时 `workspacePath`
（`uiWorkspaceScope`）往往**先以 `null` 出现**，等会话 / 工作目录解析完才变成真实路径。
旧实现在 `null` 阶段就按 `__default__` 桶读写，于是：

1. 读 `__default__` 读不到真实历史 → 界面回落成「一个空白新标签」；
2. 真实路径到位后，持久化 effect 把这个占位标签**写进了真实 workspace 的 key**，
   把用户历史整个覆盖掉。

**修复**：

- `isWorkspaceStorageReady` 判定「workspace 是否已知」，未就绪时**既不读也不写**，
  等真实路径到位后一次性加载；
- `migrateDefaultWorkspaceTabs` 收拾现场：就绪时若真实桶为空、而 `__default__` 桶里
  有真实历史（至少一个非 `about:blank`），就把它搬回来并清掉临时桶；
- 迁移必须在**首次读盘之前**执行，否则这一帧已经拿着「读不到」的结果建了占位标签。

同时修掉了 `persistState` 漏写 `faviconUrl` 的问题（类型里声明了但实际没写，
导致重启后所有标签图标消失）。

**服务端持久化（跨设备 / 跨重装）**：标签另有一份存在服务端 `user_settings`
（key `user_browser_tabs_v1`，`services/agent-gateway/src/user/user-browser-tabs.ts`），
接口 `GET/PUT /settings/browser-tabs`。客户端启动时**以服务端为准**（这才是「换设备后接着
上次浏览」），只有服务端返回 `null`（无记录）时才用本机缓存初始化并推上去。

两条安全边界（都在 `browser-tabs-remote-sync.ts` 里，并有单测钉住）：

- **服务端无记录返回 `null` 而不是空数组**：返回空数组会让客户端清空本机标签；
- **空列表拒绝推送**：本机为空时推上去会覆盖服务端的真实记录，正是「历史被删掉」的形态。

`tabs` 采用**整体替换**而非按下标合并——按下标合并会让已关闭的标签「自己回来」。
推送有 800ms 去抖，拖拽 / 连续导航不会打出一串请求。

### 7.5 切回空白标签后，它被替换成上一个标签的地址

**症状**：新建一个空白标签 → 切到前面已打开的标签（已有地址）→ 再切回空白标签，
空白标签的地址变成了前一个标签的地址。

**原因**：`nav` 是**延迟**回报——网关侧要等主文档提交、再等 150ms settle、读完 title
才 emit。用户在这个窗口里切标签，旧标签的回报就会在「新标签已是激活标签」之后才到达，
而宿主原来无条件把它写回激活标签。

**修复**：`attributeNavReport`（`browser/browser-nav-attribution.ts`）做归属判定，
两条独立判据任一命中即丢弃：

- **代次单调**：`nav.generation` 是网关侧主文档导航的自增计数，比本标签已接受的代次
  更小 ⇒ 迟到回报；
- **地址归属**：回报地址等于**其它**标签当前的地址、且不等于本标签的地址 ⇒ 别人的回报。
  真正的页面内跳转（SPA / 点链接 / 重定向）给的是「不属于任何其它标签」的地址，
  因此不会被误伤。

切标签时会复位已接受代次（换的是另一个页面实例）。已知边界：两端标签访问同一地址时，
判据 2 理论上可能误丢——代价是地址栏不更新（刷新后自动纠正），好过把地址写到别的标签上。

### 7.6 「停止实时预览」返回 400

**症状**：调用 `POST /browser-live/stop` 得到 `400`（Fastify 5 的 body 校验错误）。

**原因**：该端点没有入参，早期客户端直接 `POST` 且带 `content-type: application/json` 但不带
body；Fastify 5 对「JSON content-type + 空 body」直接返回 400，而不是按无体处理。

**修复**：客户端必须发合法 JSON body（`{}`）。`packages/web-client/src/infra/browser-live.ts`
的 `stop()` 已如此实现；新增客户端 / 脚本时照抄该约定。

### 7.7 控制台条目没有调用栈

控制台条目的 `stack` / `sourceMappedStack` 由 CDP `Runtime.consoleAPICalled` /
`Runtime.exceptionThrown` 提供，再经网关 source map 解析：

- **`sourceMappedStack` 只对 `error` 级别生成**（`shouldResolveSourceMap`）：解析要抓脚本、
  抓 map、跑 `SourceMap.findEntry`，一次最多 12 帧；而 `log` / `info` / `debug` 在真实页面上
  是成百上千条的量级，逐条解析会把网关 CPU 与 WS 带宽一起吃掉、直接压低画面帧率。
  因此普通日志只有 `stack`（打包后位置），`pageerror` 与 `console.error` 才带源码位置；
- **线上协议不含源码全文**：`BrowserLiveResolvedStackFrame` 刻意没有 `source` 字段。
  一条日志最多 12 帧，若每帧都捎一份源文件，单条日志可能几十 KB，而这些字节要经
  CDP → 网关 → WS 全链路 JSON 序列化与传输——这是「页面一打日志画面就卡」的典型来源；
- 没有任何帧时不渲染调用栈入口（`buildConsoleStackView` 返回 null）——CDP 未采集到栈时即是此
  情形（例如非脚本求值路径产生的日志）；
- 有栈但与源码对不上时，帧会标记「未映射」并展示打包后位置，常见原因：
  只解析前 12 帧（`DEFAULT_SOURCE_MAP_MAX_FRAMES`）、帧 URL 不是 `http(s)`、脚本没有
  `sourceMappingURL`、map 不可达或位置未命中映射；
- dev server（Vite / webpack）下需要能访问到被服务脚本与其 map；局域网 / 权限问题会让抓取
  失败并整体回落为未映射。

### 7.8 `POST /browser-live/screenshot` 返回 404 `browser_live_session_not_found`

该错误码**不是**「实时会话不存在」，而是 artifact 落库前的**会话所有权校验失败**：
`body.sessionId` 对应的聊天会话必须存在且属于当前 token 的用户，否则直接 404
（`services/agent-gateway/src/routes/browser-live.ts`）。

- 传对聊天会话 id（截图 artifact 会挂到该会话下）；
- 若会话存在但 500/503 提示「浏览器实时预览会话尚未启动」，那是 live session 没起来：
  先连 WS 或调用 `POST /browser-live/start` 预热；
- 不同账号的会话 id 不能互用（按 `request.user.sub` 收敛）。

## 8. 相关文件

| 作用                        | 路径                                                                             |
| --------------------------- | -------------------------------------------------------------------------------- |
| 引擎能力矩阵（单一入口）    | `apps/web/src/components/chat/misc/browser/hooks/use-engine-capability.ts`       |
| 实时接线（事件 → 控制台）   | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-wiring.ts`     |
| Tauri 采集导航同步          | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-navigation.ts` |
| 实时会话生命周期            | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-session.ts`    |
| CDP 实时视图                | `apps/web/src/components/chat/misc/browser/engines/cdp-live-engine.tsx`          |
| 画面面（解码 / 绘制 / ack） | `apps/web/src/components/chat/misc/browser/hooks/use-cdp-live-frames.ts`         |
| 帧解码（离主线程 + 回退）   | `apps/web/src/components/chat/misc/browser/frame-decode.ts`                      |
| 指针输入按帧合并            | `apps/web/src/components/chat/misc/browser/pointer-input-batch.ts`               |
| 整页可见性（停流判定）      | `apps/web/src/components/chat/misc/browser/hooks/use-document-visibility.ts`     |
| 预览自动刷新（含冷却）      | `apps/web/src/components/chat/misc/browser/hooks/use-workspace-index-refresh.ts` |
| 内容区（三引擎分支）        | `apps/web/src/components/chat/misc/browser/engines/browser-content-area.tsx`     |
| 引擎可用性探测              | `packages/browser-automation/src/live-browser-availability.ts`                   |
| 实时会话实现 + source map   | `packages/browser-automation/src/live-session.ts`、`source-map-resolver.ts`      |
| 网关 WS / REST 路由         | `services/agent-gateway/src/routes/browser-live.ts`                              |
| 会话管理器 + 开关           | `services/agent-gateway/src/browser-live/manager.ts`                             |
| 扇出 + 帧背压               | `services/agent-gateway/src/browser-live/hub.ts`                                 |
| 线路协议（shared）          | `packages/shared/src/browser-live.ts`                                            |
| 客户端（web-client）        | `packages/web-client/src/infra/browser-live.ts`                                  |
| 桌面端浏览器目录注入        | `apps/desktop/src-tauri/src/lib.rs`（`playwright_browsers_dir`）                 |
