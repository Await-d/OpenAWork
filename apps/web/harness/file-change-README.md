# 文件变更结果浏览器 QA

真实 `ToolCallDisplay` 与 `ToolOutputPreview`，无 mock。只新增 `file-change*` harness 文件及产物。

## 运行

在 `apps/web` 启动 `bun run dev --host 127.0.0.1 --port 5174 --strictPort`。
本次 Vite terminal：`term_4245e26de2d8ab8e`；5173 探测无服务，使用 5174。

仓库根目录执行：

```bash
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/file-change-verify.ts
```

可用 `FILE_CHANGE_BASE_URL=http://127.0.0.1:5173` 指定已有服务。
页面：`http://127.0.0.1:5174/harness/file-change.html?mode=light`。

## 精确检查

- dark/light × 375/768/1440；每种结果分别验证 display/preview。
- 通用 tool、patch 无请求内容、双重 JSON；通过 Vite `?raw` 读取当前网关 `stream.ts` 全文形成 before/after。
- JSON 停在 before 字符串内、显式 truncated、文本截断标记、缺少 after、success:false、空文件列表。
- 新增、删除、移动、多文件、深层路径、无分隔超长文件名和超长代码行。
- 默认不挂载 diff 或 JSON DOM，不泄露源码；展开前不挂载 diff。
- 原生 summary 可经 Tab/Shift+Tab 聚焦，检查 focus-visible 和非零 outline；Enter 展开、Space 收起。
- 仅完整文件挂载真实 `[data-diff-view-mode]`；不完整结果显示警告且不生成 diff。
- 原始结果按需挂载，键盘触发完整复制，读取真实剪贴板逐字比较输入；字符串保留原序列化，长源码尾部标记也必须存在。
- 折叠、展开、每次原始结果打开时检查文档 scrollWidth；被裁切的 diff 另验证内部 scrollLeft 可移动。
- 捕获浏览器异常。每个主题/尺寸保存 collapsed、expanded 全页和 focus 视口截图，共 18 张。

最终结果：Chromium 145.0.7632.6，1374 项通过 / 0 项失败。
机器结果与逐项明细：`file-change-artifacts/results.json`。另有一张局部长源码问题截图，共 19 张。

## 视觉观察

已检查暗色 375 展开、浅色 375 焦点、浅色 1440 展开截图。未见页面横向溢出、控件遮挡，焦点框清楚。
长路径换行；左右 diff 在窄屏中需内部横向滚动。代码区最大高度为 320px，长源码需内部纵向滚动。

视觉问题（本任务不修改生产组件，自动交互检查通过不代表视觉问题消失）：

1. **需修复**：768px 的 `stream-source` 双栏 diff 中，第 2 行左栏长 import 越过中央分隔线，与右栏同一行内容重叠，右边缘也裁切。证据：`file-change-artifacts/dark-768-stream-detail.png`。复现：暗色 / 768px，展开 `stream-source` 的 preview 文件行。页面无横向溢出并不能检测到这种内部跨栏重叠。
2. 非阻断：操作标签、路径、计数及“快照不完整”间距偏紧；超长路径换行后统计信息不易扫读。
3. 非阻断：success:false 显示“结果报告失败”，但传入 completed 的外层仍显示“已完成”，且失败提示不突出。
4. 非阻断：移动端左右 diff 的水平滚动提示较弱，初始只看到其中一部分；滚动能力已单独验证。

## 范围与诊断

不跑全量测试、不提交。harness 不参与生产构建，真实页面由 Vite 编译并在 Chromium 中执行。
fixtures 与 runner 可从 `apps/web` 运行以下独立 TypeScript 检查：

```bash
bunx tsc --noEmit --skipLibCheck --module esnext --moduleResolution bundler --target es2022 --types node,vite/client harness/file-change-verify.ts harness/file-change-fixtures.ts
```

编辑器 LSP 对新建后再修改的文件返回旧行号诊断，touch 后仍未更新；以上独立 tsc 通过作为最新文件诊断依据。
