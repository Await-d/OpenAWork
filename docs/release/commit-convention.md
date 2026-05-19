# 提交信息规范

本项目通过 **husky + commitlint** 在提交时强制校验 commit message。提交标题不符合规则时，`git commit` 会直接失败。

## 标题格式

提交标题必须严格使用以下格式：

```text
type(scope): 中文描述
```

### 强制要求

- `type` 必须为以下之一：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`chore`、`ci`、`revert`
- `scope` **必填**
- `scope` 使用**小写**，优先采用模块、包名、应用名或功能域
- `subject` 必须以**中文字符开头**
- 标题总长度不得超过 **100** 个字符

### 推荐的 scope 取值

- `gateway`
- `web`
- `mobile`
- `desktop`
- `agent-core`
- `shared-ui`
- `web-client`
- `repo`
- `agentdocs`

## 正确示例

```text
feat(gateway): 新增工作流路由鉴权
fix(web): 修复聊天页重试状态闪烁
refactor(shared-ui): 抽离统一代码差异展示组件
docs(repo): 补充技能开发说明
test(agent-core): 增加工具注册边界测试
```

## 错误示例

```text
feat: 新增工作流路由鉴权
```

错误原因：缺少 `scope`

```text
feat(gateway): add workflow auth
```

错误原因：描述未以中文开头

```text
feat(Gateway): 新增工作流路由鉴权
```

错误原因：`scope` 未使用小写

## 正文与尾注

提交正文和尾注不是必填项，但如果填写，仍需遵守 Conventional Commit 的基础格式约束：

- 标题与正文之间保留空行
- footer / trailer 前保留空行
- 每行尽量控制在 100 个字符以内

## 协作尾注限制

本仓库提交信息**不允许出现任何 Sisyphus 协作尾注**，包括但不限于以下内容：

```text
Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)

Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>
```

以下写法均视为不规范，提交前应删除：

- `Ultraworked with ...`
- `Co-authored-by: Sisyphus ...`
- 任何变体、拆分写法或其他 Sisyphus 协作痕迹

## 本地触发方式

- `pre-commit`：运行 `pnpm lint-staged`
- `commit-msg`：运行 `pnpm commitlint --edit "$1"`

如果需要在提交前手动检查，可执行：

```bash
pnpm commitlint --edit .git/COMMIT_EDITMSG
```
