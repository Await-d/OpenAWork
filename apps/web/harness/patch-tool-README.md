# 补丁工具浏览器验收

通过真实 `ToolCallDisplay` 加载真实聊天样式，覆盖 `input.patchText`、序列化的
`success/files` 结果、重复及截断的 `fileDiffs`、运行中、失败和四文件增改删。

仓库根目录启动 Vite 后运行：

```bash
bun run --filter @openAwork/web dev --host 127.0.0.1 --port 5173
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/patch-tool-verify.ts
```

浏览器入口：`http://127.0.0.1:5173/harness/patch-tool.html?mode=dark`，`mode=light` 为浅色。

验收在真实 Chromium 下覆盖 375、768、1440 三视口及深浅主题，逐项检查：

- 外层 `aria-expanded` disclosure 点击切换。
- 原生文件 `details/summary` 展开和键盘 Enter 切换。
- 每个场景四个文件，重复快照不产生重复文件卡。
- 截断提示、真实变更内容、整文件删除语义、运行中和失败不声称已应用。
- 文件折叠及展开后页面均无横向溢出。
- 键盘焦点样式和浏览器异常。

输出在 `patch-tool-artifacts/`：六张完整页面截图和 `patch-tool-results.json`。
有断言失败则退出码 1。调整组件后可直接复跑，不应弱化状态或溢出断言。

此次执行：Chromium 145.0.7632.6，270 passed / 0 failed，每组合 45 项。
截图已生成；多模态图像复核工具返回 `No multimodal response text returned`，
因此不将本次结果描述为人工像素审查或完整 WCAG 对比度审计。

此 harness 不进入应用生产入口，未修改 CI 配置。没有安装 Python Playwright，
采用仓库现有的 JavaScript Playwright 依赖执行，无新增依赖。
