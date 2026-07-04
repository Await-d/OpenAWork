# Codegraph Cache

OpenAWork 的 codegraph 是 agent-gateway 管理的代码发现缓存，用来加速“符号在哪里”“谁调用它”“改它影响什么”的探索。它不是编译器、测试或源码读取的替代品。

## 缓存位置

- SQLite 主缓存路径：`<OPENAWORK_DATA_DIR>/codegraph/codegraph.sqlite`。
- `OPENAWORK_DATA_DIR` 未配置时使用平台数据目录下的 `agent-gateway`。
- 不应在项目根新增或依赖 `.codegraph/`。项目根出现 `.codegraph/` 时只能视为外部工具遗留，不是 OpenAWork gateway v1 的运行依赖。
- stale marker 存在同一个 SQLite 缓存的 `codegraph_stale_markers` 表。

## 启动自检与降级

startup preflight 只做非阻塞检查：

- 初始化或打开 gateway data dir 下的 codegraph 缓存。
- 检查索引依赖和 LSP 依赖状态。
- 仅在策略允许时复用已有 LSP bounded install helper。
- 失败时记录 degraded 状态并让 `codegraph_status` 暴露原因。

codegraph 失败不能阻断 `/health`、desktop sidecar、`app.listen()` 或普通聊天。缺依赖、索引失败、缓存损坏都应降级为可观察状态，并提示使用 fallback。

## 工具语义

模型可见工具：

- `codegraph_status`：查看缓存、startup/dependency、freshness/stale 状态。
- `codegraph_index`：触发当前 active workspace 索引；只允许写 gateway cache。
- `codegraph_search`：按符号名或部分名称查位置。
- `codegraph_node`：查看符号或文件节点、关系和 bounded 源码片段。
- `codegraph_callers`：查看调用/引用边。
- `codegraph_impact`：做 bounded 影响面遍历。

所有路径参数必须位于当前 session 的 active workspace 内。查询输出必须 bounded；`impact` 深度和结果数有硬上限。工具不暴露 SQL，不读取任意文件系统路径，不执行破坏性操作。

## Stale 与 Fallback

写入类工具成功后应 best-effort 标记受影响文件 stale：

- `write`
- `edit`
- `multi_edit`
- `apply_patch`
- `lsp_rename`

stale 标记失败不能回滚成功写入。查询返回 stale 时，agent 必须用 `read` 或 LSP 读取真实当前内容后再编辑或删除。

推荐顺序：

1. 架构/影响面探索：先看 `codegraph_status`，再用 `codegraph_search`、`codegraph_node`、`codegraph_callers`、`codegraph_impact`。
2. codegraph 返回 `not_indexed`、`stale`、`degraded` 或 `not_available`：回退到 `lsp_*`、`ast_grep_search`、`grep`、`read`。
3. 修改后：运行目标测试、类型检查或 LSP diagnostics；不要把 codegraph 结果当正确性证明。

## 限制

- v1 不做 UI 图谱浏览器。
- v1 不做隐藏 always-on 重索引 watcher。
- TypeScript/TSX 语义质量取决于 LSP 可用性；其他语言可能只有文件级或文本级信息。
- 跨文件调用关系是 best-effort，动态派发、回调注册和生成代码可能不完整。
- 如果核心 `services/agent-gateway/src/codegraph/` 服务或 SQLite 缓存不可用，工具会返回降级结果而不是崩溃。

## 故障排查

- `codegraph_status.status = not_available`：核心索引/查询服务未加载，先用 fallback 工具完成工作。
- `freshness.status = stale`：索引已过期，先读取真实文件内容；需要时重新运行 `codegraph_index`。
- `codegraph_index` 拒绝路径：确认 `workspaceRoot` 或 `path` 在当前 session active workspace 内。
- 启动日志出现 codegraph degraded：检查 LSP 服务器安装状态和 gateway data dir 权限。
- 不要通过删除项目根 `.codegraph/` 来“修复”gateway 缓存；gateway 缓存不应依赖该目录。
