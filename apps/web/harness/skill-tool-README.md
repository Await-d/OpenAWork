# Skill 与目录加载更多真实浏览器验收

从仓库根目录启动 Vite，再运行以下命令：

```bash
bun run --filter @openAwork/web dev --host 127.0.0.1
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/skill-tool-verify.ts
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/patch-tool-verify.ts
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/list-directory-verify.ts
NODE_PATH=packages/browser-automation/node_modules bun apps/web/harness/skill-tool-regression-console.ts
```

页面入口：`http://127.0.0.1:5173/harness/skill-tool.html?mode=dark`（或 `light`）。
真实导入生产 `ToolCallDisplay`，没有 mock 组件、注入预览 DOM 或替换生产 CSS。

## 已执行结果

Chromium **145.0.7632.6**，headless，暗/浅色 × 375/768/1440，视口高度 1000。

| 验收                 | 通过 | 失败 | 截图 |
| -------------------- | ---: | ---: | ---: |
| Skill + 补充目录夹具 |  391 |    0 |   18 |
| 原有 patch-tool      |  270 |    0 |    6 |
| 原有 list-directory  |  187 |    0 |    6 |
| 合计                 |  848 |    0 |   30 |

- Skill 使用真实大小写 `Skill`，分别输入 `name` / `skill`。
- 覆盖 running/completed/failed/cancelled，以及 completed + isError 的失败优先级。
- 检查 Markdown 标题、粗体、列表、代码块、链接、表格和两个资源路径（含长路径）。
- 检查长正文初始裁剪、键盘展开后尾标记可见、收起、原始信封保留。
- 检查失败/取消不渲染成功文档、保留参数和原文；残缺信封、旧版纯文本回退；完整信封内的截断标记提示。
- 检查 Enter/Space 展开收起、键盘焦点环。
- 401 同级行：400 → 401；801 总行嵌套树：400 → 800 → 801；末项可见，加载完成移除按钮，折叠再展开保留已加载预算。
- 已返回空 children 显示“空目录”，未返回 children 显示“未展开”，二者均不提供无效展开按钮。
- 原有空列表断言“未返回目录条目”与当前语义一致，无需修改原回归断言。
- 每组检查折叠、Skill 展开、长正文展开、目录展开及最终页面宽度不超过视口。
- Skill 每组 `console.error` / `pageerror` 均为 0。原有回归只采集 pageerror，补充 console 脚本对两页六组矩阵采集，结果全部为 0。

主要结果位于 `skill-tool-artifacts/skill-tool-results.json`；补充控制台日志位于
`skill-tool-artifacts/skill-tool-regression-console.json`。原回归结果在各自 artifacts 目录。

## 复核说明与限制

最初新增脚本对鼠标操作后的程序化 focus() 直接要求焦点环，导致每组两项失败。
Chromium 的 :focus-visible 需要键盘输入模态；改为 Tab/Shift+Tab 后检查相同断言，
最终完整矩阵全部通过。没有放宽生产行为断言，也没有修改生产代码或原回归脚本。

- cancelled 是 resolver 支持的 wire 值，公共卡片 props 类型尚未收录；夹具使用与现有单测相同的窄范围类型断言。
- 这是确定性组件浏览器验收，不访问网关、技能安装服务或真实 LLM。
- 环境缺少 Python Playwright，使用仓库已有 Bun/Playwright 依赖，无新增依赖。
- 图像复核工具两次 HTTP 504；截图已保存，自动尺寸/DOM 检查通过，但不声称完成额外人工图像审阅。
- 首次前台回归触及两分钟工具超时，随后后台重跑完成；以完整 JSON 结果为准。
- 无生产缺陷复现项，未执行 git 或计划变更。
