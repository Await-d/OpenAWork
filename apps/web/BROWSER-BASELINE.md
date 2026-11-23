# apps/web 浏览器基线

> 本文是 `apps/web` 产物的**唯一**浏览器能力契约。
> 同一份产物既跑在用户浏览器里，也被 Tauri 桌面端装进系统 WebView，
> 所以「Baseline 广泛可用」不足以作为判断依据——必须按**最弱的那个引擎**定下限。
>
> `apps/web/vite.config.ts` 的 `build.target` 由本文推导，改本文必须同步改它。

## 一句话基线

**Chrome / Edge 111 · Safari 16.2 · Firefox 121**

定这个下限的不是某个「新特性」，而是**已经写死在 365 个文件里的 `color-mix()`**：
它是整套 E · Nebula 色彩 token 的实现基础——`@media`、hover、渐变、边框、阴影全靠它派生，
删不掉，也无法回退成硬编码色值。它的支持版本（MDN BCD，见文末「证据」）是：

| 特性          | 文件数 | Chrome | Safari   | Firefox |
| ------------- | ------ | ------ | -------- | ------- |
| `color-mix()` | 365    | 111    | **16.2** | 113     |
| `oklch()`     | 4      | 111    | 15.4     | 113     |
| `@container`  | 9      | 105    | 16       | 110     |
| `:has()`      | 3      | 105    | 15.4     | **121** |

取交集后：Safari 的硬地板由 `color-mix()` 给出（16.2），
Chrome 由 `color-mix()` / `oklch()` 给出（111），
Firefox 被 `:has()` 推到 121（若把这 3 处改为 `@supports` 回退，可降到 113）。

## 各运行时落地

| 运行时           | 引擎                              | 如何更新                                                  | 实际最低版本                                | 验证状态                         |
| ---------------- | --------------------------------- | --------------------------------------------------------- | ------------------------------------------- | -------------------------------- |
| Web（浏览器）    | 用户自带 Blink / Gecko / WebKit   | 随浏览器自动更新                                          | Chrome 111 / Safari 16.2 / Firefox 121      | ✅ 已由 MDN BCD 验证             |
| Windows 桌面     | WebView2（Chromium）              | Evergreen，随 Edge Runtime 自动更新；Tauri 用系统已装版本 | 需 WebView2 Runtime ≥ 111（Chromium 111）   | ✅ Chromium 版本号同 Edge        |
| macOS / iOS 桌面 | WKWebView（系统 WebKit）          | 随 macOS / iOS 系统更新，**应用无法自带**                 | macOS ≥ 14.0（出厂 Safari 17，已高于 16.2） | ⚠️ OS↔Safari 映射为推断（见下）  |
| Linux 桌面       | WebKitGTK（`webkit2gtk-4.1` ABI） | 随发行版包管理器                                          | 推断需 WebKitGTK ≥ 2.40（≈ WebKit 615）     | ⚠️ 推断，未经 changelog 逐条确认 |

### macOS：`minimumSystemVersion` 已显式设为 `"14.0"`

**现状**：`apps/desktop/src-tauri/tauri.conf.json` 的 `bundle.macOS.minimumSystemVersion`
已显式写为 `"14.0"`，不再走 Tauri 默认值。

**Tauri 默认值是 `10.13`**（macOS High Sierra），来源两处互相印证：

- 官方 config schema：<https://schema.tauri.app/config/2> →
  `definitions.MacConfig.properties.minimumSystemVersion.default = "10.13"`，
  描述原文为 "A version string indicating the minimum macOS X version that the bundled application
  supports. Defaults to `10.13`."
- 源码：`crates/tauri-utils/src/config.rs` 的 `macos_minimum_system_version()` 返回
  `Some("10.13".into())`。

**`10.13` 不可接受**：该系统的 WebKit 停留在 Safari 13.x，完全没有 `color-mix()`，
于是整套色彩 token 退化为无效声明（颜色继承或透明），UI 会整体崩坏而不是「略微难看」。

**已定值：`"14.0"`**，理由：

- macOS 14.0 出厂 Safari 为 **17**，已经高于 16.2 地板——「装上即满足」成立，
  不需要用户先完成一次系统更新才能看到正确的颜色。
- 这正是没有取 `"13.0"` 的原因：macOS 13.0 出厂 Safari 是 16.1，**低于** 16.2。
  这条缝隙 `minimumSystemVersion` 关不掉（它只能挡系统版本，挡不住 Safari 版本），
  只能靠运行时兜底（见末节）；而把门禁直接抬到 14.0 就从源头消除了出厂态缺口。
- 代价是放弃 Ventura（13）及更早用户。这个取舍已被接受：Safari 16.2 虽从 macOS 11
  起可安装，但 Big Sur / Monterey 已停止安全更新，且整套 UI 在缺少 `color-mix()` 时
  是整体崩坏而非「略微难看」，不值得为旧系统保留一个必然出错的组合。

另注：Tauri 官方 prerequisites 页面写的是 "macOS Catalina (10.15) and later"，
与 schema 默认 `10.13` 不一致；以 schema 为准——那才是真正写进 `Info.plist` 的
`LSMinimumSystemVersion`。

iOS 侧默认 `"15.0"`（schema `IosConfig`），同样低于 Safari 16.2 的需求。
若将来在 iOS WebView 里复用这套 UI，需同步上调到 `"16.2"`。

### Linux：版本由发行版打包决定

- Tauri v2 要求 ABI 为 **`webkit2gtk-4.1`**（官方 prerequisites 的 apt / pacman / dnf 包名
  均为 `webkit2gtk-4.1` / `libwebkit2gtk-4.1-dev`），4.1 ABI 自 WebKitGTK 2.36 起提供。
- 但 `color-mix()` 需要更晚的 WebKit。按 WebKit 615 系列 ≈ Safari 16.4 推断，
  需要 **WebKitGTK ≥ 2.40**（⚠️ 该数字为推断：WebKitGTK 的 NEWS 只写工程改动，
  不逐条列 CSS 特性，无法直接验证）。
- 已验证的发行版现状：Ubuntu 22.04 (jammy) 的 `libwebkit2gtk-4.1-0` 当前为 **2.50.4**，
  远超所需。
- 结论：**不设 WebKitGTK 硬门禁**——Tauri 应用无法控制它。只能靠发行版包管理
  - 运行时检测兜底。

## 特性清单

### 1. 可安全使用

| 特性                                         | Chrome | Safari | Firefox | 现状                               |
| -------------------------------------------- | ------ | ------ | ------- | ---------------------------------- |
| `color-mix()`                                | 111    | 16.2   | 113     | 365 文件（基线本身）               |
| `oklch()` / `oklab()`                        | 111    | 15.4   | 113     | 4 文件                             |
| 容器查询 `@container` / `container-type`     | 105    | 16     | 110     | 9 个 CSS 文件                      |
| `:has()`                                     | 105    | 15.4   | 121     | 3 文件（Firefox 地板）             |
| `structuredClone()`                          | 98     | 15.4   | 94      | 1 文件                             |
| `Array.prototype.findLast` / `findLastIndex` | 97     | 15.4   | 104     | 0 处使用                           |
| `Array.prototype.toSorted` / `toReversed`    | 110    | 16     | **115** | 0 处使用                           |
| `AbortSignal.timeout()`                      | 103    | 16     | 100     | 0 处使用（⚠️ 版本号未从 BCD 复核） |

两个易踩的坑：

- **`toSorted` / `toReversed` 的 Firefox 下限是 115，高于基线 113/121 中的 113。**
  在当前基线（Firefox 121）下可用，但**不要**据此把 Firefox 下限往回降到 113，
  否则这两个方法会在 113–114 上抛 `TypeError`。
- `findLast` 安全（Firefox 104），但注意别把自定义函数名（如 `findLastUserMessageIndex`）
  误统计成 `Array.prototype.findLast`。

### 2. 必须带回退

| 特性              | Chrome | Safari   | Firefox | 要求                                                                   |
| ----------------- | ------ | -------- | ------- | ---------------------------------------------------------------------- |
| `scrollbar-color` | 121    | **26.2** | 64      | 必须同时写 `::-webkit-scrollbar` 回退——Safari 直到 26.2 才支持该属性。 |
| `scrollbar-width` | 121    | 18.2     | 64      | 同上，回退为 `::-webkit-scrollbar { width: … }`。                      |

**落地情况（已按本表双向补齐）**：

- **只写标准属性、缺 WebKit 回退** → 已补：
  `apps/web/src/pages/team/runtime/styles/team-workbench-controls.css` 的
  `.team-wb-chip-scroll`（约 :157）与 `.team-wb-filter-row`（约 :284）、
  `apps/web/src/pages/chat-page/panels/chat-overview-tab-content.css` 的
  `.chat-overview__injected-panel`（约 :805）。三处都包在
  `@supports not (scrollbar-color: auto)` 里，只在引擎不支持标准属性时才落 WebKit 伪元素。
- **只写 WebKit 伪元素、缺标准属性** → 已补：
  `apps/web/src/components/chat/markdown/markdown-blocks.css` 的 `.chat-markdown-table-wrap`
  加了 `scrollbar-width: thin` + `scrollbar-color`；
  `apps/web/src/pages/team/runtime/styles/team-runtime.css` 的 `.team-tab-bar__tab-scroll`
  隐藏滚动条依赖组件内联的 `scrollbarWidth: 'none'`（`TeamTabBar.tsx` 的
  `SINGLE_PRIMARY_GROUP_STYLE`），Firefox 侧已覆盖，无需再改 CSS。

正确写法参考 `apps/web/src/index.css:1898` 的 `.nav-rail-scroll`（两条都写）。
颜色一律取全局 token（`--scrollbar-thumb` / `--scrollbar-thumb-hover`），**禁止**写死色值。

### 3. 禁止使用

| 特性                                     | Chrome | Safari                | Firefox | 原因                                                                                    |
| ---------------------------------------- | ------ | --------------------- | ------- | --------------------------------------------------------------------------------------- |
| `interpolate-size: allow-keywords`       | 129    | **preview（未发布）** | **无**  | WebKit 至今未发布，Firefox 未实现。只能作渐进增强，**不得**作为唯一实现手段。           |
| `field-sizing: content`                  | 123    | 26.2                  | 152     | Safari 直到 26.2 才支持，远高于基线。**不要用**。                                       |
| `sibling-index()`                        | 138    | 26.2                  | 154     | 全部远高于基线。**禁止**。                                                              |
| 弹出层 API `popover` / `:popover-open`   | 114    | 17                    | 125     | Safari 17 才支持，高于基线。要用需 `@supports selector(:popover-open)` 回退到自建弹层。 |
| 锚点定位 `anchor-name` / `@position-try` | 125    | 26                    | 147     | 全部远高于基线。**禁止**。                                                              |
| CSS 嵌套                                 | 120    | 17.2                  | 117     | 高于基线，且当前 0 文件在用。**禁止新增**（⚠️ 版本号未从 BCD 复核）。                   |

关于 `field-sizing`：MDN BCD 当前记录为 **Safari 26.2 起支持**（早前确实完全不支持）。
结论不变——26.2 远高于基线，仍然不能用；但如果将来基线抬到 Safari 26+，需要重新评估。

## 如何验证

新增任何 Web 平台特性前，按下面顺序确认，**不要凭记忆**：

1. **查 Baseline 指南**（本仓库可用）：
   ```bash
   DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 search "<2-5 个英文词>"
   DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 retrieve "<id>"
   ```
   注意：该 CLI 返回的是**设计 / 实现指南**（主题级），不是逐特性版本数据库。
   它能告诉你「该不该用、怎么用」，但**版本号仍需 MDN 或 caniuse 复核**。
2. **取权威版本号**：MDN browser-compat-data 原始 JSON，
   `https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/<prop>.json`
   里的 `__compat.support.{chrome,safari,firefox}.version_added`。
   MDN 页面上那张兼容表由 JS 渲染，`curl` 抓不到，别指望它。
3. **运行时自测**（用于验证某个具体引擎实例）：
   ```js
   CSS.supports('color', 'color-mix(in srgb, red, blue)'); // CSS 特性
   'toSorted' in []; // JS API
   ```

**规则**：采用任何新特性前，必须把该特性连同版本号写进本文对应表格；
若归入「必须带回退」或「禁止使用」，还要在代码里注释原因。
`build.target` 与本文不一致视为缺陷。

### legacy-scan 的已知误报

`modern-web-guidance` 还带一个 `legacy-scan` 子命令，用于对**已写好的代码**做静态规则扫描：

```bash
DISABLE_TELEMETRY=1 npx -y modern-web-guidance@1.0.1 legacy-scan "<path>" --json
```

其中 `ime-safe-enter-submit` 会稳定报出约 **38 处**命中（`apps/web/src` + `packages/shared-ui/src`），
**这些命中全部是误报**，不要据此改代码：

- **误报原因**：该规则是纯静态模式匹配，只认「`keydown` 处理函数 + 判断 `Enter`」这一形状，
  既看不到处理函数里已经 `return` 提前退出，也不理解 `isImeComposingKeyboardEvent` /
  `isImeComposingNativeEvent` 的语义。
- **如何判定某处其实安全**：读处理函数体，确认在**任何 `preventDefault()` 之前**已经调用了
  `isImeComposingKeyboardEvent`（React 合成事件）或 `isImeComposingNativeEvent`（原生监听器），
  两者均来自 `@openAwork/shared-ui`。有这次提前返回即视为已处理。

真正未加守卫的只有 3 处，且**本就该如此**：

| 位置                                                | 为什么不需要 IME 守卫                |
| --------------------------------------------------- | ------------------------------------ |
| `apps/web/src/components/common/modal/PinInput.tsx` | 纯数字 PIN 输入，不存在输入法组合态  |
| `packages/shared-ui/src/models/ModelManager.tsx`    | 数值比例输入框，只接受数字           |
| `packages/shared-ui/src/agent/AgentDAGGraph.tsx`    | SVG 节点的键盘可达性，不是文本输入框 |

**不要**为了把 `legacy-scan` 的数字刷成 0 就给上面这几处硬加守卫——往非文本框里塞 IME 逻辑只会
引入永不成立的分支。

## 运行时兜底建议

`build.target` **只做语法降级**（可选链、`??`、类字段等），
它**不会**为 API 或 CSS 补 polyfill。三类东西的处理方式完全不同：

| 类别    | 例子                                            | 处理方式                                           |
| ------- | ----------------------------------------------- | -------------------------------------------------- |
| JS 语法 | `?.`、`??`、class fields                        | 由 `build.target` 自动降级                         |
| JS API  | `toSorted`、`structuredClone`、`Object.groupBy` | 需 polyfill 或运行时判断（`'x' in []`）            |
| CSS     | `color-mix`、`:has`、`@container`               | **无法 polyfill**，只能 `@supports` 回退或能力检测 |

桌面端建议做一次启动期能力检测（**本次未实现**，仅记录位置建议）：

- **位置**：`apps/web/src/main.tsx`（或 `apps/desktop` 的对应入口）最早期，
  早于 `ReactDOM` 渲染——检测失败时渲染一张「WebView 版本过旧」的静态提示页，
  而不是让 UI 带着失效的颜色渲染出来。
- **检测式**：
  ```ts
  const supportsColorMix = CSS.supports('color', 'color-mix(in srgb, red, blue)');
  ```
- **为什么仍然必须有**：macOS 的 WKWebView 与 Linux 的 WebKitGTK 都由系统 / 发行版决定，
  `minimumSystemVersion` 只能挡住过老的 macOS，挡不住
  「发行版 WebKitGTK 太旧」和「系统够新但用户没更新 Safari」两种情况。
  把门禁抬到 `"14.0"` 后，macOS 侧的出厂态缺口已关闭（出厂 Safari 17 ≥ 16.2），
  但系统版本不等于引擎版本（WKWebView 随系统更新、用户可推迟安装更新），
  因此运行时检测仍是唯一能确认「眼前这个引擎真的支持 `color-mix()`」的手段。

## 证据与未验证项

已从官方来源验证：

- 全部特性版本号：MDN browser-compat-data（`main` 分支原始 JSON）
- Vite 6.4.3 默认 `build.target = 'modules'`
  → `['es2020','edge88','firefox78','chrome87','safari14']`
  （`node_modules/vite/dist/node/constants.js:57` 的 `ESBUILD_MODULES_TARGET`）
- Tauri `bundle.macOS.minimumSystemVersion` 默认 `"10.13"`：
  <https://schema.tauri.app/config/2> + `tauri-utils/src/config.rs`
- Tauri v2 Linux 依赖 `webkit2gtk-4.1`：<https://v2.tauri.app/start/prerequisites/>
- Ubuntu 22.04 `libwebkit2gtk-4.1-0` = 2.50.4：
  <https://packages.ubuntu.com/jammy/libwebkit2gtk-4.1-0>

**未能验证（文中已逐处标注为推断）**：

- WebKitGTK 引入 `color-mix()` 的确切版本（NEWS 不列 CSS 特性；按 WebKit 615 ≈ Safari 16.4
  推断为 2.40）。
- macOS 各大版本出厂的 Safari 具体版本号（Apple 文档站为 JS 渲染，抓不到正文）。
- `AbortSignal.timeout()`、CSS 嵌套的确切支持版本。
- WebView2 的 Chromium 版本与 Edge 版本的精确对应关系。
