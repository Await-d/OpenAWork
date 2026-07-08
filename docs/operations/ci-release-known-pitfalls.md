# CI 与发布易错点记录

这份清单记录在 CI、桌面发布、团队 MCP 与 OMO 适配器里已经踩过或容易复发的问题。遇到相似失败时，先按这里排查，避免把问题误判成随机 CI 波动。

## CI 与发布触发

- 普通 `fix(...)` / `feat(...)` / `chore(...)` 提交只触发 `CI` workflow，不会生成 Windows、macOS 或 Linux 桌面安装包。
- 桌面安装包由 `release-desktop.yml` 生成；入口是 `desktop-v*` tag、手动 `workflow_dispatch`，或 `auto-release.yml` 在发现 `release(<scope>): 中文描述` 提交后自动创建 tag。
- 如果目标只是让云端重新跑质量门禁，推普通修复提交即可；如果目标是构建安装包，必须走 `release(...)` 触发提交或手动触发发布 workflow。
- 本地 Linux 环境通常只能直接构建 Linux 桌面包。Windows 安装包应优先走 GitHub Actions 的 Windows runner；除非明确配置交叉编译工具链、WebView2/WiX/NSIS 等依赖，否则不要把本地 Linux 构建失败误判为代码回归。

## CI 环境差异

- CI 不一定有开发机上的 provider 专用环境变量，例如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`。测试如果只设置通用 `AI_API_KEY`，运行时代码必须在缺少专用 key 时回退到通用 key。
- 不要在测试里硬编码本机绝对路径，例如 `/home/await/project/OpenAWork`。CI runner、临时工作区和本地路径都可能不同，测试应使用临时目录或从运行时上下文解析 workspace。
- 注意模块加载时读取环境变量的代码。若测试在用例内部临时设置 env，生产代码需要在调用时读取，不能在 import 时缓存旧值。
- `gh run view --json conclusion` 偶发会让人误读正在变化的 run 状态；排查失败时以 `gh run watch --exit-status` 和 `gh run view --log-failed` 的实际日志为准。

## 团队 MCP 持久化

- 受保护 builtin MCP（例如 `codegraph`、`lsp`、`omo`）保存设置时必须保持 `source: 'system'`。如果 UI 编辑流程把它们改写成 `source: 'user'`，团队会话在空 MCP allowlist 下不会自动带上这些系统桥接能力。
- 排查团队会话突然失去内置工具时，先检查持久化后的 MCP rows：`id` 是否仍是 builtin id，`source` 是否仍是 `system`，以及 gateway 的 `isSystemMcpServer` 是否能识别它。
- 设置页序列化逻辑变更时，要同时验证“编辑 builtin 行后保存”和“团队空 allowlist 启动”两条路径，不能只看设置页展示是否正常。

## OMO 工具清单

- OMO native alias 要同时规范化下划线和连字符写法，例如 `git_bash` / `git-bash`、`grep_app` / `grep-app`。否则 hyphen 写法会被误当成 adapter 工具，生成无法复用真实 builtin 的假工具名。
- OMO id 去重不能只做 lowercase。最终工具名会把标点折叠为 `_`，所以 `ast-grep` 与 `ast_grep` 会坍缩成同一个 tool name。校验阶段必须按最终 `toOmoToolName()` 结果拒绝冲突。
- 排查“OMO 工具重复、缺失或生成 inert `mcp__omo__...` 工具”时，优先检查 manifest 的 `mcpServers`、`capabilities` 与 catalog key 是否在规范化后发生碰撞。

## 提交与工作区

- 修复 CI 时只提交根因相关文件和直接测试，避免把本地 UI 实验、生成缓存或其他人的 dirty work 混进修复提交。
- `tsconfig.tsbuildinfo` 等构建缓存如果是 tracked 文件，类型检查可能改动它。没有明确授权时不要用回滚类命令清理；提交前应只 stage 本次任务需要的文件。
- 提交信息必须使用 `type(scope): 中文描述`，scope 小写；需要触发自动发布时才使用 `release(<scope>): 中文描述`。

## 快速排查命令

```bash
gh run watch <run-id> --exit-status
gh run view <run-id> --log-failed
gh run view <run-id> --json status,conclusion,url,headSha,name,createdAt,updatedAt

git status --short --branch --untracked-files=all
git diff --staged --stat
```
