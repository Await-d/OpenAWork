# 260723-mobile-pen-visual-alignment

## Task Overview

按最新 `designs/mobile-ui.pen` 对齐手机端视觉（浅色 token + 共享 UI + Screen 壳）。逻辑问题不盲改。

## Status

**已从 git stash 恢复并继续补齐**（工作区曾被并发清空：`components/ui` / `Screen` / `layout` / `home` / 设置枢纽等丢失）。

### Completed
- [x] Theme tokens + `components/ui/*` + `Screen` + layout metrics
- [x] 主流程：连接 / 登录 / 会话 / 聊天 / 设置枢纽
- [x] 对话相关组件与侧屏
- [x] 图片 / 渠道 / 网络 / MCP
- [x] `SubagentDetailModal` 浅色化
- [x] 中间 Tab「工作台」首页 `app/home.tsx`
- [x] 会话 / MCP 空态对齐 pen 41 / 38
- [x] metrics/keyboard 单测通过（7/7）

### Notes
- pen 新增 00 工作台、34–41 编辑/空态/断开等帧；设置页改为分区枢纽布局。
- 登录 / 配对页保留定制顶栏，但已包 `Screen`。
- 建议：尽快提交，避免再次被并发 WIP 覆盖。
