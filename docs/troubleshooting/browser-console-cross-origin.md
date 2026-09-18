# 内置浏览器控制台为空（跨域页面无法注入）

## 错误信息

内置浏览器的「控制台」面板一直为空，并显示：

```text
暂无控制台输出 · 跨域页面(非 localhost)无法注入,只能展示同源页面的日志
```

有时还会在加载后多出一行 info 级日志：

```text
页面已加载: https://example.com（跨域页面无法捕获控制台输出）
```

打开 `localhost` 上的本地开发服务器时日志一切正常，一旦换成外部站点（或局域网 IP）就完全收不到日志与网络。

## 问题原因

内置浏览器默认走 **iframe 引擎**：宿主往 iframe 的文档里注入一段脚本（`injectConsoleProxy`），由它劫持 `console.*` / `fetch` / `XMLHttpRequest` 再 `postMessage` 回父窗口。

注入的前提是能拿到 `iframe.contentWindow.document`，而跨域时这一步会直接抛 `SecurityError`：

```ts
// apps/web/src/components/chat/misc/browser/console-proxy.ts
iframeWindow.document.head.appendChild(script);
} catch {
  // Cross-origin — can't inject
}
```

这是**浏览器同源策略（SOP）的硬限制**，页面内的任何代码都绕不过去——只有与前端同源（localhost）的页面能被注入。所以这不是开关没打开，而是这条引擎路线本身覆盖不到跨域站点。

好消息是仓库里已经有第二条引擎：**网关侧 CDP 实时引擎**（`/browser-live`）用 Playwright 驱动真实 Chromium，在浏览器层面采集 `console` / `pageerror` / `network`，**与页面是否同源无关**。它默认没有启用。

## 解决方案（按推荐程度排序）

### 方案 1：启用网关侧 CDP 实时引擎（推荐）

1. 让网关启用实时引擎：

   ```bash
   # .env
   OPENAWORK_BROWSER_LIVE=1
   ```

   桌面端（Tauri）不需要配置——本地 sidecar 已默认注入 `DESKTOP_AUTOMATION=1`（`apps/desktop/src-tauri/src/lib.rs`）；该变量作为兼容别名同样会启用实时预览。

2. 确保运行网关的机器上存在 Chromium：

   - 直接使用系统安装的 Chrome / Edge，**或**
   - 执行 `npx playwright install chromium`

3. 重启网关。前端会自动接线：`useBrowserLiveWiring` 把 CDP 下行的 `console` / `network` 信封映射成与控制台面板完全相同的 `ConsoleEntry` 模型，无需额外操作。

> `OPENAWORK_BROWSER_LIVE` 与 `DESKTOP_AUTOMATION` 是两个独立开关（判定见 `isBrowserLiveEnabled`）：
> 前者只开实时预览；后者是桌面端历史变量，会**同时**启用 Agent 的 `desktop_automation` 工具（`goto` / `click` / `type` / `screenshot` …）并跳过 `/docs` 交互式 API 文档。**只想要跨域控制台就用 `OPENAWORK_BROWSER_LIVE`**，不要为了控制台去开 `DESKTOP_AUTOMATION`。

### 方案 2：本地开发直接用 localhost 访问

被调试页面与前端同源时（例如 `http://localhost:5173` 调试 `http://localhost:3000`），iframe 注入正常工作，日志与网络都能收到。仅适用于本地调试。

### 方案 3：让被调试站点配合

`document.domain`（已废弃、且要求同一可注册域）或由目标站返回允许被嵌入 / 读取的 CORS 响应头。取决于被调试站点，不受 OpenAWork 控制。

### 方案 4：网关反向代理目标页

由网关把目标页代理到同源路径下，iframe 注入即可恢复。但绝对 URL、CSP、Cookie、WebSocket 都会连锁出问题，**不推荐**。

## 验证修复

1. 确认网关已报告引擎可用：启动网关后，界面上内置浏览器顶部不应再出现黄色的「实时预览不可用」横幅。
2. 在内置浏览器打开任意跨域站点，展开「控制台」：
   - 生效：空态显示为「日志由网关侧实时引擎采集…」，或直接出现页面日志 / 网络条目；
   - 未生效：仍显示「跨域页面(非 localhost)无法注入」——回到方案 1 的步骤 2 检查 Chromium 是否装好。
3. 「瀑布」视图可一并验证网络采集：`unavailable` 表示引擎未启用 / 未建连成功，`ready` 表示已在采集。

## 技术细节

- **引擎选择**：`capability.liveView`（实时引擎可用且支持 screencast，仅 Chromium）为真时由 CDP 引擎接管内容区，否则回退 iframe。能力判定与完整矩阵见 [`docs/browser-preview.md`](../browser-preview.md)。但控制台 / 网络采集只要 `availability.available === true` 就生效，与是否 screencast 无关。
- **可用性探测**：`probeLiveBrowserAvailability()` 只做可执行文件路径解析 + 磁盘校验，不启动浏览器。候选顺序为：环境变量覆盖（`OPENAWORK_BROWSER_PATH` 优先，其次 `CHROME_PATH`）→ Playwright managed chromium → 系统浏览器（Chrome / Chromium / Edge / Brave / Vivaldi / Opera；每族先扫 `PATH`，Windows 遵循 `PATHEXT`，再回退到按平台枚举的安装路径）。覆盖值不可用**不会中断搜索**，只会继续往后找；全部落空才报 `browser-missing`。完整顺序与 token 含义见 [`docs/browser-preview.md`](../browser-preview.md)。
- **失败原因**：`browser-missing`（未找到浏览器）/ `browser-outdated`（managed 修订目录残缺）/ `probe-failed`。前端会把这些 reason 翻译成可操作的中文提示（`describeBrowserLiveUnavailable`）。
- **会话生命周期**：一个用户最多一条 live session，用引用计数表示当前 WS 订阅者数量；计数归零后保温 `BROWSER_LIVE_IDLE_TTL_MS`（默认 120000ms）再真正关闭浏览器。
- **Tauri 原生 webview 模式**无法采集控制台与网络，请在 Web 模式或系统开发者工具中查看。

## 相关文件

| 作用                  | 路径                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| iframe 注入脚本       | `apps/web/src/components/chat/misc/browser/console-proxy.ts`                  |
| 控制台面板            | `apps/web/src/components/chat/misc/browser/BrowserConsolePanel.tsx`           |
| 实时通道 → 控制台桥接 | `apps/web/src/components/chat/misc/browser/live-console-bridge.ts`            |
| 实时会话 hook         | `apps/web/src/components/chat/misc/browser/hooks/use-browser-live-session.ts` |
| 引擎能力矩阵          | `apps/web/src/components/chat/misc/browser/hooks/use-engine-capability.ts`    |
| 网关 WS 路由          | `services/agent-gateway/src/routes/browser-live.ts`                           |
| 会话管理器 + 开关     | `services/agent-gateway/src/browser-live/manager.ts`                          |
| 浏览器可用性探测      | `packages/browser-automation/src/live-browser-availability.ts`                |
