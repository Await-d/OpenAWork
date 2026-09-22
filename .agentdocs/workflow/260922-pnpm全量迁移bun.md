# 260922 pnpm 全量迁移 bun

## Task Overview

把仓库的包管理器层从 pnpm 10.25.0 全量切到 bun 1.3.12：锁文件、`package.json` 配置字段、workspace scripts、辅助脚本、Docker 构建、GitHub Actions、桌面/移动端打包链路、活跃文档。**不迁移**测试运行器（保持 Vitest）与构建器（tsc / vite / metro），因为它们不是包管理器的一部分。

## Current Analysis

### 实测依据（本机，bun 1.3.12 / pnpm 10.25.0，registry = npmmirror，两方同源）

| 场景 | pnpm | bun |
| --- | --- | --- |
| 冷缓存 + 有锁文件（Docker/CI 首次） | 71s | 10s |
| 缓存热 + 清空 node_modules | 5s | 6s |
| warm no-op | 3–4s | 0s |
| 一次性：从 pnpm-lock 迁移并解析 | — | 431s（仅迁移时一次） |
| node_modules / 全局缓存 | 2.3G / 2.2G | 2.4G / 2.3–2.5G |

结论：收益集中在**冷缓存安装**（Docker 构建、CI 缓存失效）约 7 倍；日常与缓存命中场景打平。

### 兼容性已验证（本地实验）

- bun 1.3 **默认 isolated linker**：`node_modules/.bun` + 各 workspace 内符号链接；即使删掉 `pnpm-workspace.yaml`/`pnpm-lock.yaml` 仍保持隔离 → **无幽灵依赖风险**。
- `bun install` 可直接读 `pnpm-lock.yaml` 完成迁移，23 个 workspace 与全部版本解析保留；`workspace:*`（39 处）正常。
- `pnpm.patchedDependencies` → 迁移为顶层 `patchedDependencies`，playwright-core 补丁实测生效。
- `pnpm.onlyBuiltDependencies` → 被 bun 当受信列表；better-sqlite3 / koffi / ffmpeg-static 二进制正常产出；pnpm 拦下的 ssh2 / protobufjs 等 bun 同样拦。
- 根 `prepare`（husky）在 bun 下正常执行。
- `bun run --filter`（多 filter + glob）、`--workspaces --if-present`、`--parallel` 可覆盖 `pnpm --filter` / `-r` / `--parallel` 用法（已实测）。
- 锁文件守卫可迁移：`bun.lock` 的 `packages` 值是 `name@version`（键为提升路径），按 value[0] 取版本即可复刻"唯一版本"检查——原型脚本对 fastify 家族判定通过。

### 不能机械替换 / 风险

1. `pnpm.peerDependencyRules.allowedVersions`（expo/react-native 的 React peer 放宽）、`allowedDeprecatedVersions`、`.npmrc auto-install-peers` **无 bun 等价物**；bun 只告警不报错，但 RN 场景需要实测 React 解析结果。
2. 写死的 `node_modules/.pnpm/...` 路径（`scripts/markdown-theme-demo.mjs`、`services/agent-gateway/Dockerfile` 的 ffprobe-static 裁剪、`scripts/build/vite-plugin-file-icons.mjs` 注释与假设）。
3. 网关 Dockerfile 的 `--prod --ignore-scripts` 二次裁剪与 `.pnpm` 路径手术必须重写。
4. CI 全部 7 个 workflow、`packageManager`、`engines.pnpm`、lint-staged 的 `pnpm-lock.yaml` 条目。
5. EAS Build（移动端发布）走 `packageManager` 字段选择装包器：eas-cli 24.7.0 内部模板已明确识别 `bun.lock` 与 `bunx eas-cli`，但仍需一次 preview 构建实测（**P0 门禁**，本地无法验证）。
6. 双锁文件必然漂移 → 只能全切，不能并行维护。
7. 本机 **cargo 未安装**：桌面端打包链路（Tauri）无法本地完整验证，只能验证脚本层面的 bun 调用。

## Solution Design

- **单一事实来源**：`bun.lock`（提交），删除 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`（workspace glob 已在根 `package.json` 的 `workspaces` 字段）。
- **配置字段迁移**：`patchedDependencies`（顶层）、`trustedDependencies`（替代 `onlyBuiltDependencies`）、`packageManager: bun@1.3.12`、`engines` 更新；删除 peer/deprecated 相关 pnpm 字段。
- **脚本层**：`pnpm --filter X Y` → `bun run --filter X Y`；`pnpm -r run Z` → `bun run --workspaces [--if-present] Z`；裸 `pnpm <bin>` → `bunx <bin>` 或 `bun run`。
- **守卫重写**：`check-fastify-dependency-alignment.mjs` 改读 `bun.lock`（JSONC 去尾逗号 + value[0] 取版本），保留 manifest 对齐部分。
- **Docker**：bun 作为安装器（多阶段从 `oven/bun` 拷二进制，版本与 `packageManager` 对齐）；运行时仍用 Node（网关 `node dist/index.js`），验证原生二进制与符号链接布局可用。
- **CI**：`pnpm/action-setup` + `cache: pnpm` → `oven-sh/setup-bun@v2`（锁版本）+ `bun install --frozen-lockfile`；可选 `actions/cache` 缓存 `~/.bun/install/cache`。
- **提交策略**：分批提交（chore/build/ci/docs 等），中文描述、scope 必填。

## Complexity Assessment

- Atomic steps: 15+ → +2
- Parallel streams: 有（workflows / Docker / scripts / 文档 / 应用配置） → +2
- Modules/systems/services: 6+（gateway、web、mobile、desktop、CI、Docker） → +1
- Long step (>5 min): 有（首次 bun 解析、docker build、全量 typecheck/test） → +1
- Persisted review artifacts: 有（workflow + runtime） → +1
- OpenCode available: 是 → −1
- **Total score**: 6
- **Chosen mode**: Full orchestration
- **Routing rationale**: 跨 6 个系统、存在并行流且含多项 >5 分钟验证步骤，需要 runtime 执行记录与分段门禁。

## Implementation Plan

### Phase 0：门禁与隔离
- [x] T-01 分支策略确认（用户选择：直接在 main 改，不新建分支，先不提交）
- [x] T-02 记录基线：`typecheck` 全绿；`test`/`lint` 基线未取到（packageManager 切换后 pnpm 拒绝运行）

### Phase 1：根配置与锁文件
- [x] T-03 改写根 `package.json`（scripts、trustedDependencies、patchedDependencies、packageManager: bun@1.4.2、engines、lint-staged）
- [x] T-04 生成 `bun.lock`（由 pnpm-lock 迁移结果播种后由 bun 1.4.2 落定），删除 `pnpm-lock.yaml` / `pnpm-workspace.yaml`
- [x] T-05 `bun install` 全量安装并核对（fastify 家族单版本、react/react-native/expo、better-sqlite3/koffi/ffmpeg/ffprobe 产物、playwright 补丁）

### Phase 2：脚本与守卫
- [x] T-06 重写 `scripts/check-fastify-dependency-alignment.mjs`（bun.lock JSONC 解析，实测通过）
- [x] T-07 迁移 `scripts/*.mjs` 与桌面脚本（含 `bundle-sidecar.mjs` 的 bun 探测缺陷修复、新增 `scripts/rebuild-native-packages.mjs` 替代 `pnpm rebuild`）
- [x] T-08 迁移 workspace scripts（gateway 49 处、desktop 4 处）

### Phase 3：Docker
- [x] T-09 重写 `services/agent-gateway/Dockerfile`（bun 安装器 + `bun prune --production` 裁剪 + 原生产物保留）
- [x] T-10 重写 `apps/web/Dockerfile`（alpine + bun musl 二进制 + 补 tsconfig.base.json 与传递闭包清单）
- [x] T-11 本地 `docker build` 实测两个镜像：网关 1.47GB（构建 123s，`/health` 200 冒烟通过，better-sqlite3 正常加载）；Web 196MB（构建 275s，产物完整）。顺带修复 web 镜像的两处**迁移前既有缺陷**：缺 `apps/desktop` 源码（`apps/web` 页面直接引用）与缺根 `scripts/`（`vite.config.ts` 引用）

### Phase 4：CI 与发布
- [x] T-12 迁移 `.github/workflows/ci.yml`（setup-bun + actions/cache + bun 命令）
- [x] T-13 迁移 auto-release / prepare-release / rollout / eas-ota workflows
- [x] T-14 迁移 release-desktop（TAURI_SCRIPT + 跨架构补装改走 rebuild 脚本）与 release-mobile（EAS 门禁保留）

### Phase 5：文档与验证
- [x] T-15 活跃文档更新（30 个文件、约 171 处引用；含 AGENTS.md/CLAUDE.md/README/docs/随包技能文案）
- [x] T-16 全量验证：`lint` exit 0 ✓；`typecheck` 全 23 包 exit 0 ✓（与迁移前基线一致）；非网关包单测全绿（shared 70 / lsp-client 32 / mcp-client 24 / web-client 343 / agent-core 589 / shared-ui 133 / mobile 273 / desktop 22 / multi-agent 17 / skill-types 0）；网关 `test:unit` 结果见执行日志；`format:check` 的失败全部来自未跟踪的 `@temp/`（368 个文件）与用户未提交改动（29 个文件），迁移涉及的 70 个文件已全部通过 prettier
- [x] T-17 运行时探针：移动端 expo / react-native 与 react 19.2.0 完全一致（无重复 React）；web/desktop 各自 react 19.3.0；网关镜像 `/health` 200；桌面 tauri 包装链路（`bun run --filter @openAwork/desktop tauri`）验证到 `bundle-sidecar.mjs` 正确调用 `bun run build` 后，因本机无 `rustc/cargo` 停在 `readTargetTriple`（环境限制，非迁移缺陷）
- [ ] T-18 待人工验证：EAS preview 云构建（需 EXPO_TOKEN + workflow_dispatch）、桌面三平台打包（需 Rust 工具链/CI）、GitHub Actions 实跑
- [x] T-19 项目记忆同步：`.agentdocs/index.md` 新增「架构决策」1 条（包管理器全量切换 bun）+「已知陷阱」4 条（bun 迁移 5 个实测坑 / 守卫改解析 bun.lock / 本地 format 失败来源 / 顺带修掉的既有缺陷）

## Notes

- **P0 门禁**：EAS 云构建必须实测（需 EXPO_TOKEN + `workflow_dispatch`）；若 EAS 不支持 bun，则移动端发布无法纳入本次全量切换，需回到方案讨论。
- **不迁移**：Vitest（23 个包、692 处 `vi.*`）、tsc/vite/metro 构建、历史归档文档（`.agentdocs/`、`.omo/`、`temp/`、`@temp/`）。
- 性能口径基于 npmmirror；GitHub Actions runner 的绝对耗时不同，相对结论（冷装大赢、稳态持平）不受影响。
- 分段改动门禁：每个 Phase 内按文件组（≤3 个文件为一个改动段）逐段验证，不做一次性大爆改。

## 执行记录与实测坑位（2026-09-22）

### 版本口径
- 本机 bun 在会话中途从 1.3.12 自动升级到 **1.4.2**（`~/.bun/bin/bun` mtime 14:44）。锁文件由 1.4.2 写出，`packageManager` / `engines` / CI / Docker 全部统一到 **1.4.2**。
- 迁移前的基线：`pnpm typecheck` 全绿（exit 0）；`pnpm test` / `pnpm lint` 未取到基线（`packageManager` 改为 bun 后 pnpm 直接拒绝运行，属预期）。

### bun 行为实测（都影响实现，勿凭记忆改）
1. **默认 isolated linker**：`node_modules/.bun` + 各 workspace 内符号链接；根 `node_modules` 只有根依赖，**无幽灵依赖**；删掉 `pnpm-workspace.yaml` 后依旧隔离。
2. **部分 workspace 可用**：只拷闭包清单时 bun 会 `note: skipped N workspaces listed in bun.lock but not on disk`；但**已包含 workspace 的 workspace 依赖必须同时在磁盘上**，否则报 `depends on workspace ... listed in bun.lock but not on disk`（`apps/web/Dockerfile` 因此要拷 `artifacts`/`logger` 清单）。
3. **`bun install --production` 对已有 node_modules 是 no-op**（不会裁 devDependencies）；裁剪必须用 **`bun prune --production`**（实测 1.7G→1.5G，删 395 包，better-sqlite3 绑定与 ffmpeg 二进制**保留**）。
4. **`bun run <script>` 默认用 Node 执行脚本**（除非 `--bun`），所以不能靠 `process.versions.bun` / `npm_execpath` 判断"调用者是不是 bun"——`bundle-sidecar.mjs` 曾因此把 `node run build` 当成 bun 调起来（已修：只在真正跑在 bun 运行时下才复用 `process.execPath`，否则回退 `BUN_INSTALL/bin/bun` 或 PATH）。
5. **依赖级 bin 只在包自己的 `node_modules/.bin`**：`node_modules/.bun/better-sqlite3@x/node_modules/.bin/prebuild-install`。手工重跑生命周期脚本必须补 `PATH`（`scripts/rebuild-native-packages.mjs` 已内置），否则退出码 127。
6. **`bun run --filter <pkg> <bin>` 不支持任意 bin**（只认 script 名）：`bun run --filter <pkg> vitest ...` 会报 `Script "vitest" not found`；正确写法是 `bun run --filter <pkg> test <args>`（参数会透传到 `vitest run`）。
7. **`bun.lock` 结构**：`packages` 的值首项是 `name@version`（键是提升路径，含 `@scope/pkg` 嵌套），版本唯一性守卫据此解析（已重写并验证通过）。
8. **bun 读 `.npmrc`**：registry 沿用（本机为 npmmirror）；`.npmrc` 里 pnpm 专属项（`auto-install-peers`）已移除，构建脚本白名单改由根 `trustedDependencies` 控制。
9. **受信脚本**：bun 迁移时会识别 `pnpm.onlyBuiltDependencies`；改完为顶层 `trustedDependencies` 后 `bun pm untrusted` 为 0，better-sqlite3 / koffi / ffmpeg-static / @sentry/cli 产物齐全；playwright-core 补丁（顶层 `patchedDependencies`）实测生效。
10. **回退代价**：`packageManager` 改为 bun 后 pnpm 命令会直接报 "This project is configured to use bun"；如需回退，先改回 `packageManager` 字段再 `pnpm install`。

### 运行时代码的边界（有意保留 pnpm）
- 网关/客户端里"识别第三方项目包管理器"的探测列表（`lsp-client` root markers、`repo-overview-tools` 依赖文件清单、`bash-arity` 命令表、`bash-tools` 的 ERR_PNPM 提示、workspace 根标记）**保留 pnpm 项并新增 bun 项**——产品必须同时支持 pnpm 与 bun 项目；本次只把"本仓库自身的工具链"切到 bun。

### 复查追加（第二轮，2026-09-22）

**本轮新修**：
1. `bundle-sidecar.mjs` 的 bun 探测补上 `npm_execpath` / `npm_config_user_agent` 信号（bun 会给脚本把它俩分别设为 bun 路径与 `bun/<版本>`），优先复用"调用者用的那个 bun"，不再依赖 PATH；实测日志 `npm_execpath=true user_agent=true → 使用 /home/await/.bun/bin/bun`。
2. `.dockerignore` 补 `@temp/`（本机 232MB 的 vendored opencode 源码树此前会进 Docker 构建上下文）。
3. 修掉一处文档里的非法 bun 调用：`bun run --filter @openAwork/desktop vite build` → `cd apps/desktop && bunx vite build`（bun 的 `--filter` 只认脚本名，不能直接跑任意 bin）；并新增全仓校验（94 处 `bun run --filter` 全部对照真实脚本名，现为 0 违规）。

**本轮新增验证**：
- 根 `bun run build` 端到端 **exit 0**（201s，packages + services + web 全部产出）。
- `--` 参数透传三种形态均正确（`bun run <script> -- <args>` / 不带 `--` / `--filter <pkg> <script> -- <args>`）——网关 `bun run verify -- <file>` 链路成立。
- 根 `dev` 的确切组合 `bun run --parallel --workspaces --if-present dev` 实测并发执行且自动跳过无脚本包。
- 26 个 JSON 清单与 8 个 workflow YAML 全部可解析；`docker-compose*.yml` / `.dockerignore` / `tauri.conf.json` / `build.rs` 无 pnpm 残留。
- `scripts/rebuild-native-packages.mjs` 对 7 个原生包解析全部成功（含 `@sentry/cli` 走 store 兜底）。

**新发现的注意事项（非阻塞）**：
- `bun.lock` 会把 tarball URL 固化（本仓 2555 条指向 `registry.npmmirror.com`）。在干净环境（模拟 CI：无用户级 `.npmrc`）实测 `--frozen-lockfile` 只联系 npmmirror → **CI / EAS / Docker 构建会从 npmmirror 拉包**。Docker 构建已验证可行，但境外 runner 会更慢，且对单一镜像源有依赖。若要改回 npmjs：重新生成锁文件（`bun install --registry=https://registry.npmjs.org/`），代价是本机安装也会走 npmjs。**用户决定：暂不改（保持镜像源）。**
- 本机 `~/.bun/install/cache` 在注册表行为探针中被清空过（缓存可再生，无数据风险）。
- 仓库内有一套"识别第三方包管理器"的 pnpm 引用（61 个文件），均属兼容/测试/生成物/历史文档，非迁移遗漏。

### 第三轮：可选优化（用户全部批准，1–7）
1. ✅ `.prettierignore` 增加 `@temp/` → 仓库级 `format:check` 从 398 个问题降到 **29 个**（全部是用户未提交的 WIP 文件，与迁移无关；CI 不受影响）。
2. ✅ **bun 版本单一来源**：新增根 `.bun-version`（`1.4.2`）。CI 的 7 个 workflow、15 处 `setup-bun` 全部改为 `bun-version-file: .bun-version`；两个 Dockerfile 改为「全局 `ARG BUN_VERSION` + 独立 `bun-runtime` stage」（**因为 BuildKit 不支持 `COPY --from` 里做变量展开**，必须用 `FROM oven/bun:${BUN_VERSION}` 再 COPY 二进制），`docker build --check` 两个文件均无警告。升级 bun 的三处：`.bun-version`、两个 Dockerfile 的 ARG 默认值、`package.json` 的 `packageManager`（`engines.bun` 是最低版本，不用改）。
3. ✅ 清理桌面陈旧产物：`src-tauri/binaries/`（170MB 旧 sidecar 二进制与 gz、`.bundle-stamp`）与 `src-tauri/sidecars/` 已清空（均为 gitignore 产物，下次构建自动重建）。
4. ⏸ `apps/desktop/src-tauri/target/`（**1.6GB，root 归属**）需你处理：无免密 sudo，我无法改归属。两种方式：`sudo chown -R $USER apps/desktop/src-tauri/target`，或构建时改用 `CARGO_TARGET_DIR=/tmp/opencode/cargo-target`（内存中已记录该绕法）。
5. ✅ `.claude/settings.local.json`（本地、gitignore）的 6 处 pnpm 白名单全部改为 bun/bunx 等价项，JSON 仍合法。
6. ✅ 遗留的旧 vitest 进程（PID 674232，引用已删除的 `.pnpm` 树）已结束。
7. ✅ `.npmrc` 移除 `node-options=--no-deprecation`，只留说明性注释（**文件必须保留**：两个 Dockerfile 都会 COPY 它）。

