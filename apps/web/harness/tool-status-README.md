# 工具调用状态浏览器验收

使用真实 `ToolCallDisplay`，不替换生产组件或覆盖其样式。

在仓库根目录启动 Vite：

```bash
bun run --filter @openAwork/web dev --host 127.0.0.1 --port 5173 --strictPort
```

另一个终端执行：

```bash
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/tool-status-verify.ts
```

可通过 `TOOL_STATUS_BASE_URL` 使用已有 Vite 地址。手动入口为
`/harness/tool-status.html?mode=dark`（或 `light`）。

覆盖 32 个夹具：字面量 `tool`、空白工具名、超长未知工具名、`read`、`grep`
分别使用 running/completed/failed/cancelled/paused/pending；另测提问与计划确认的暂停状态。
所有夹具均保留带唯一标记的原始输出。暂停断言接受可读暂停或等待文案，同时严格检查
`data-tool-status="paused"`。

真实无头 Chromium 在 375/768/1440 × dark/light 下检查状态文案、非完成状态不误报完成、
通用工具名、未知名称保留、状态文字未截断、折叠/展开页面无横向溢出、键盘焦点环、
Enter 展开、Space 收起、原始输出可见，以及浏览器异常。

输出在 `tool-status-artifacts/`：`report.json` 与每组折叠/焦点/全部展开截图。
发现失败时 runner 返回非零退出码。该 harness 只用于开发期浏览器 QA，不运行构建、
类型检查或全量单元测试。

## 本次验收结果

六组矩阵共 1638/1638 项通过，生成 18 张截图。折叠/展开无页面横向溢出，
键盘展开收起、焦点环、状态文案、原始输出保留均通过。375px 深浅截图完成视觉检查，
长未知名称合理省略，无重叠遮挡。

额外视觉检查曾发现浅色暂停文字对比度为 3.46:1。现已将状态文字改为正文 token，
保留警示图标；真实 Chromium 375px 复测得到文字 `rgb(42, 45, 52)`、白色背景，
对比度提升至 **13.79:1**，页面无横向溢出。修复后截图为
`tool-status-artifacts/light-375-final.png`。已取消/待执行的实际文字对比度为 6.33:1，
执行失败为 4.79:1。上述对比度来自计算样式及 WCAG 相对亮度公式核验，
不计入 1638 项交互自动化断言。
