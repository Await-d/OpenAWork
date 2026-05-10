# 260509 — P1 scout agent 与 repo 研究工具

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 1。

## Task Overview

借鉴 opencode `40d5ea1cf` (#24149)，为 OpenAWork 添加 **只读外部代码研究能力**：

1. **`repo_clone` 工具**：把 GitHub/Git URL/owner/repo 缩写解析成本地缓存路径，必要时 clone/refresh，可选指定 branch
2. **`repo_overview` 工具**：对缓存仓库或任意目录做结构概览（包管理器、依赖文件、入口、目录树）
3. **`scout` 内置 agent**：只读研究 agent，限定工具集 `repo_clone, repo_overview, glob, grep, read, webfetch`，专注调研第三方代码与文档

## Current Analysis

OpenAWork 用户高频场景："看看 `temp/opencode` 是怎么处理 X 的"、"我用的 `xxx-sdk` 这个 API 行为是？"——目前需要用户手动 clone 到本地或硬塞参考路径，agent 自身没有"克隆 → 调研"能力。

opencode 落点：

```
packages/opencode/src/agent/prompt/scout.txt              ← agent 提示词
packages/opencode/src/tool/repo_clone.ts/.txt             ← 工具
packages/opencode/src/tool/repo_overview.ts/.txt          ← 工具
packages/opencode/src/util/repository.ts                  ← 解析 + 缓存路径
packages/opencode/src/tool/external-directory.ts          ← 外部目录权限断言
```

`repo_clone.ts` 关键逻辑：
- 支持 `https://github.com/x/y`、`git@github.com:x/y`、`owner/repo`、`host/path` 多种引用格式
- 缓存路径：`<cache-root>/<host>/<owner>/<repo>`
- flock 防并发 clone
- 复用已存在仓库（origin URL 匹配则 fetch + reset，不匹配则删除重 clone）
- depth=100 浅克隆
- branch validate（白名单字符 + 防 `..`）
- 通过 `ctx.ask({ permission: 'repo_clone', ... })` 走权限审批

`repo_overview.ts` 关键逻辑：
- 检测包管理器：`bun.lock` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`
- 列生态：Node.js / Python / Go / Rust / Ruby / Java/Kotlin / PHP
- 遍历目录到 `depth=3`，跳过 `node_modules / dist / build / .git / .venv / __pycache__ / target / vendor / .next`
- `STRUCTURE_LIMIT=200` 节点上限
- 列出常见 entrypoints (`index.*` / `main.*` / `src/index.*`)

## Solution Design

### S1: 仓库引用解析

新建 `services/agent-gateway/src/repo-reference.ts`：

```ts
export type RepositoryReference = {
  protocol: 'https:' | 'ssh:' | 'git:' | 'file:';
  host: string;
  owner: string;
  repo: string;
  remote: string;          // 标准化的 git URL
  label: string;           // 用于展示，如 owner/repo
};

export function parseRepositoryReference(input: string): RepositoryReference | null;
export function repositoryCachePath(ref: RepositoryReference): string;
export function sameRepositoryReference(a: RepositoryReference, b: RepositoryReference): boolean;
```

缓存根：`path.join(getOpenAworkDataDir(), 'repos')`（复用现有 `storage-paths.ts`）。

### S2: `repo_clone` 工具

新建 `services/agent-gateway/src/repo-clone-tools.ts`：

- 工具名 `repo_clone`
- 参数：`repository: string`、可选 `branch: string`、可选 `refresh: boolean`
- 行为：
  1. parseRepositoryReference 失败 → 报错
  2. branch validate（同 opencode 正则）
  3. flock(`repo-clone:${localPath}`) 互斥
  4. 已存在且 origin 匹配 → 视 `refresh` 决定 reuse/refresh/cloned
  5. clone --depth=100 / fetch --all --prune / reset --hard
  6. 返回 `{ status, head, branch, localPath, ... }`
- 权限：经 `permission` 系统问 `repo_clone` 类型，patterns=[label]
- 取消：尊重 `ctx.signal`，git 子进程 abort

### S3: `repo_overview` 工具

新建 `services/agent-gateway/src/repo-overview-tools.ts`：

- 工具名 `repo_overview`
- 参数：`repository?: string`、`path?: string`、`depth?: number=3`
- 至少二选一：repository（缓存仓库）或 path（任意已授权目录）
- path 模式必须经 `external-directory` 等价的权限断言（不能让 LLM 偷看任意路径）
- 输出：

```yaml
path: /home/await/.cache/openawork/repos/github.com/foo/bar
repository: foo/bar
branch: main
head: abc123
package_manager: pnpm
ecosystems: [Node.js]
dependency_files: [package.json, pnpm-lock.yaml]
entrypoints: [src/index.ts]
structure: |
  - src/
    - index.ts
    - ...
truncated: false
```

### S4: `scout` 内置 agent

新建 `services/agent-gateway/src/agents/scout.ts`（或挂到现有 `agent-catalog.ts`）：

- 名称：`scout`
- 中文 description："只读外部库 / 依赖源码 / 文档研究 agent，可克隆 GitHub 仓库做调研"
- 工具白名单：`repo_clone, repo_overview, glob, grep, read, webfetch`
- 不能写入 / 编辑用户 workspace
- system prompt：参考 `temp/opencode/packages/opencode/src/agent/prompt/scout.txt`，但译成中文：

```
你是 `scout`，一个针对外部库、依赖源码与文档的只读研究 agent。
你的目标是调研用户当前 workspace 之外的代码并给出有证据的发现，绝不修改用户的 workspace。

何时使用：
- 检视依赖仓库或库的源码
- 把本地代码与上游实现做对比
- 研究环境可以克隆的 GitHub 公共仓库
- 通过阅读源码和文档解释一个库或框架是如何工作的
- 调研第三方 API、流程或行为

工作方式：
1. 涉及 GitHub 仓库或依赖源码时优先使用 `repo_clone`。
2. 克隆完成后用 `Glob`、`Grep`、`Read` 检视。
3. 当源码不足时使用 `WebFetch` 看官方文档。
4. 优先使用直接代码与文档证据，避免假设。
5. 涉及多个外部仓库时，逐个调研。

研究规范：
- 每条结论尽量给出绝对文件路径与行号
- 区分"已验证" vs "推断"
- 如答案依赖分支状态，注明你读的是仓库当前默认分支
- 如某个仓库无法克隆 / 访问，明确说出原因，并继续给出仍可获得的证据
- 主动暴露不确定性，不要"模糊带过"

输出要求：
- 先给直接答案
- 然后按仓库 / 来源逐个解释证据
- 引用相关文件
- 内容组织清晰

约束：
- 不修改文件，不调用任何会改用户 workspace 的工具
- 克隆仓库的发现，请在最终回复里返回绝对路径

完成用户的研究请求，并清晰地报告发现。
```

注册到 catalog 后通过 `delegate_task(subagent_type="scout", ...)` 即可调用。

### S5: 权限协议

新增权限类型 `repo_clone`，同 `tool` 走现有 permission 协议。建议默认行为：

- workspace permission config 里加 `repo_clone: { allowedHosts: ['github.com', 'gitlab.com', 'bitbucket.org'] }`
- 用户首次允许某 owner/repo 时可选 "allow always for this label"
- 任意 host 默认必须经用户确认

### S6: UI 适配

- 桌面端 / Web 工具结果卡片识别 `repo_clone` / `repo_overview`：
  - clone 卡片显示状态（cloned / refreshed / reused）+ HEAD + 本地路径（可点击打开）
  - overview 卡片显示包管理器、生态、目录树预览

## Complexity Assessment

- 原子步骤：6 → +2
- 并行流：S1 是基础，S2/S3 并行，S4/S5/S6 后续 → +1
- 模块：新增 5+ 文件，涉及 agent-gateway / agent-catalog / web 卡片 → +1
- 单步 >5 min：是 → +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：6 → Full orchestration**
- **Routing rationale**：跨工具/agent/UI/权限 4 个层面，需要协调

## Implementation Plan

### Phase 1: 基础设施 ✅
- [x] T-SCOUT-01: `services/agent-gateway/src/repo-reference.ts` — 移植 opencode `util/repository.ts`：`parseRepositoryReference` / `parseGitHubRemote` / `repositoryCachePath` / `sameRepositoryReference`，新增 `resolveGatewayReposDir()` 缓存根
- [x] T-SCOUT-02: `__tests__/repo-reference.test.ts` 26 项（GitHub / GitLab / SCP / file:// / 拒绝路径 / `OPENAWORK_REPO_CLONE_GITHUB_BASE_URL` 重定向）

### Phase 2: 工具实现 ✅
- [x] T-SCOUT-03: `services/agent-gateway/src/repo-clone-tools.ts` —
  - 工具 `repo_clone`，因子化的 `createRepoCloneTool({ gitRun })` + 默认 `repoCloneToolDefinition`
  - 默认 git 调用走 `child_process.spawn`，`GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo` 避免阻塞，5 分钟超时，signal → SIGTERM
  - host 白名单 `OPENAWORK_REPO_CLONE_ALLOWED_HOSTS`（默认 `github.com,gitlab.com,bitbucket.org`）
  - `validateBranchName`、`statusForRepository`、`resetTarget` 三个纯函数从 opencode 等价复刻
  - 进程内 per-localPath mutex 序列化并发 `repo_clone`
  - file:// 显式拒绝（避免 `repo_clone` 被当作"读任意路径"工具）
- [x] T-SCOUT-04: `services/agent-gateway/src/repo-overview-tools.ts` —
  - 工具 `repo_overview`，`createRepoOverviewTool({ gitRun })`
  - `repository` / `path` 二选一（path 必须绝对且默认必须在 repos 缓存根内，env `OPENAWORK_REPO_OVERVIEW_ALLOW_ANY_PATH=1` 旁路）
  - 包管理器 / 生态 / 依赖文件 / 入口（含 `package.json` 的 main/module/types/bin/exports）/ 结构树（depth 默认 3，最大 6，STRUCTURE_LIMIT=200，IGNORED_DIRS 与 opencode 同步）
- [x] T-SCOUT-05: 三态测试 + 边界用例 — 25 项 clone / 16 项 overview，全部 mock 自定义 `GitRunner`，零真实 git 调用

### Phase 3: agent ✅
- [x] T-SCOUT-06: scout system prompt 定稿（中文，长度合适，覆盖"何时使用 / 工作方式 / 研究规范 / 输出 / 约束"五段）
- [x] T-SCOUT-07: 注册到 `agent-catalog.ts:122-128`（`BUILTIN_AGENT_BASE` 末尾）+ `BUILTIN_AGENT_FALLBACK_PROMPTS.scout`
- [x] T-SCOUT-08: 工具注册到 `tool-definitions.ts:64,182,1273-1318`（含 JSON schema），所有 agent 默认能看到；后续可在 reference snapshot 里收紧 scout 的工具白名单（推迟到下批）

### Phase 4: UI 推迟
- [ ] T-SCOUT-09: web 工具结果卡片识别 repo_clone / repo_overview（推迟到 UI 升级批次）
- [ ] T-SCOUT-10: 桌面端同步（同上）

### Phase 5: 验收 ✅
- [x] T-SCOUT-V-01: typecheck 通过 + 单元 67/67（26+25+16）+ 全量 420/420
- [ ] T-SCOUT-V-02: scout agent e2e（克隆真实公开仓库）— 推迟到 UI 上线后人工触发
- [ ] T-SCOUT-V-03: 跨进程 flock — 单进程 gateway 不需要，多进程方案上线时再做

## Verification Commands

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/repo-reference.test.ts \
  src/__tests__/repo-clone-tools.test.ts \
  src/__tests__/repo-overview-tools.test.ts \
  src/__tests__/scout-agent.test.ts
```

## Risks & Rollback

- **磁盘占用**：克隆缓存可能膨胀。MVP 先简单 LRU prune（>5GB 清最老）；后续做正式管理面
- **网络/认证**：私有仓库需要 git credential helper；MVP 仅支持公共仓库，私有仓库返回明确错误
- **shallow clone 限制**：`--depth=100` 可能不够分析较老 commit；提供 `refresh=true` 触发 unshallow，文档说明
- **权限过严打断流**：scout agent 默认应预批准 `github.com/*`，否则 agent 调用 `repo_clone` 时被反复打断

## Notes

- 不与 .NET gateway 同时落地：TS 端先 GA，再考虑 .NET 复刻
- 完成后写两条 ADR：
  - `OpenAWork 提供 repo_clone/repo_overview 只读外部研究工具，缓存根 ~/.cache/openawork/repos`
  - `内置 scout agent 仅持有只读工具白名单，禁止访问用户 workspace 写入路径`
