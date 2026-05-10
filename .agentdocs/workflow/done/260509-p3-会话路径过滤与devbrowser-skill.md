# 260509 — P3 会话路径过滤与 dev-browser SKILL.md 内置

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 3。

## Task Overview

两件 P3 长尾打包：

1. **T-PATH**：会话列表支持按"当前目录"过滤（opencode `9209c0437`）
2. **T-DEVBROWSER**：把 oh-my-opencode 的 `dev-browser` SKILL.md 作为 OpenAWork 内置 skill（`bccc943`）

## T-PATH 路径过滤

### Current Analysis

opencode `9209c0437` (#24849) 在 session list endpoint 增加 path filter：

```
session.list({ path: '/abs/path' })
```

返回该 path 下（基于 session 的 `directory` 字段）的会话子集。同时增加 setting "禁用此过滤"。

OpenAWork 现状：
- `services/agent-gateway/src/routes/sessions.ts`（list endpoint）
- 会话 schema 已含 workspace 概念，但目录子集过滤没暴露
- 桌面端用户经常在多 workspace 下切换，"只看当前目录会话"是高价值

### Solution Design

#### S-P1: 后端 query 参数

```
GET /sessions?path=/abs/path&include_descendants=1
```

行为：
- `path` 必须是已注册 workspace 内的子目录
- 默认 `include_descendants=1`：会话 `directory` startsWith path 即命中
- 不传 `path` → 维持当前行为

#### S-P2: 前端入口

`apps/web` 桌面 sidebar 加切换：

```
[ ] 仅显示当前目录会话
```

默认关闭，用户开启后 list 调用带上 `path = activeDirectory`。

#### S-P3: Settings 全局禁用

某些团队场景希望强制不过滤：`settings.session.disablePathFilter = true` 时前端隐藏开关，后端忽略 `path` 参数。

#### S-P4: 测试

- 后端：3 个 session 分布在 `/a`、`/a/b`、`/c`，过滤 `/a` 命中前 2 条
- include_descendants=0 时只精确匹配
- disabled 时忽略 path

## T-DEVBROWSER

### Current Analysis

oh-my-opencode 的 dev-browser skill 内容（`temp/oh-my-opencode/src/features/builtin-skills/dev-browser/SKILL.md`）：

- standalone 模式：本地 spawn Chromium
- extension 模式：连用户已开的 Chrome（保留登录态）
- 通过 `client.page("name")` 创建命名页面，跨 script 持久
- 提供 `getAISnapshot()`、`selectSnapshotRef()` 让 LLM 探索 DOM

OpenAWork 现状：
- `packages/browser-automation` 已有自动化能力
- 但**没有以 SKILL.md 形式给 LLM 的"调用手册"**

### Solution Design

#### S-DB1: 评估对接路径

OpenAWork 的 browser-automation API 与 oh-my-opencode dev-browser 不一定 1:1，需要：

- 列 OpenAWork 当前提供的 page lifecycle API
- 对照 dev-browser 的 `client.page` / `getAISnapshot` 等
- 必要时**改写 SKILL.md**，让它对接 OpenAWork 自己的 API（不要照搬命令）

#### S-DB2: 落地为内置 skill

把改写后的 SKILL.md 放到：

```
packages/skills/builtin/dev-browser/
  SKILL.md
  references/installation.md
  references/scraping.md
```

并在 `services/agent-gateway/src/default-skills.ts` 登记为可加载 skill（默认不 auto-load，需 `load_skills=["dev-browser"]` 显式启用，避免污染普通对话）。

#### S-DB3: 平台兼容

- Linux：默认走 Playwright/Chromium
- macOS：同上
- Windows：参考 oh-my-opencode 的 Windows 安装文档（PowerShell 启动 server.sh 等）
- 桌面端 Tauri：可走 sidecar 起 chromium，但需要在 desktop config 增加二进制（评估再决定）

#### S-DB4: 测试

- skill 可加载
- skill 内 prompt 不包含敏感路径（`/home/await/...`）
- skill 描述符合 SKILL.md 元数据规范（`name`/`description`/`---` frontmatter）

## Complexity Assessment

- 原子步骤：6（PATH 4 + DEVBROWSER 4） → +2
- 并行流：两件事完全独立 → +1
- 模块：sessions route + web sidebar + skills package → +1
- 单步 >5 min：是（DEVBROWSER 文档改写需要核对 API） → +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：6 → Full orchestration**
- **Routing rationale**：两件独立长尾，单 workflow 维护成本最低

## Implementation Plan

### Phase 1: T-PATH ✅（后端）
- [x] T-PATH-01: `routes/sessions.ts` 增 `path` / `includeDescendants` 参数；当传入 `path` 时改走"全量取出 → filter → 偏移分页"路径，避免 SQL LIMIT 把命中行截掉
- [x] T-PATH-02: 单元测试 18 项 — 抽出纯函数 `session-path-filter.ts`（`normaliseFilterPath` / `sessionMatchesPath` / `filterSessionsByPath`），覆盖：descendants 默认 / 严格 exact / `/a` vs `/abc` 安全前缀守卫 / 空 path 视为无 filter / 输入顺序保留 / 损坏 metadata_json 容错
- [ ] T-PATH-03: 前端 sidebar 开关 + state — **推迟**到 UI 升级批次
- [ ] T-PATH-04: settings 全局禁用项 — **推迟**（需要时可在 settings UI 时一并落）

### Phase 2: T-DEVBROWSER ✅
盘点发现：dev-browser SKILL **早就注册**到 `BUILTIN_SKILLS`（`packages/skills/src/builtins.ts:223-294`），但 `descriptionForModel` 是 oh-my-opencode SKILL.md 的**逐字拷贝**，提到的 `client.page("name")` / `getAISnapshot()` / `selectSnapshotRef()` / `page.evaluate()` / `npx tsx` 脚本 / 浏览器扩展模式 等 API **OpenAWork 全部没有**。LLM 拿到这份 prompt 写出的脚本必然失败。**真正的修复是改写 prompt 对齐 OpenAWork 真实工具表面**（`desktop_automation` 单一 action 接口）。

- [x] T-DB-01: 盘点 — `desktop_automation` 实际仅暴露 status / start / goto / click / type / screenshot 6 个 action，单浏览器实例无 multi-page
- [x] T-DB-02: 改写 `descriptionForModel` 到 v2.0.0 — 完整对照表 + 标准工作流 + 选择器纪律 + 反虚构警告（不直接出现旧 API token，避免回归测试中 forbidden 误命中）
- [x] T-DB-03: 不另起目录，直接修 `packages/skills/src/builtins.ts:223-287`（与现有 manifest 同位置）
- [x] T-DB-04: 已注册（无需变更）
- [x] T-DB-05: 18 项单元测试 `__tests__/dev-browser-skill.test.ts`：
  - 元数据：v2 版号 / `com.openAwork.builtin.dev-browser` ID / on-demand / https 网络权限
  - 真实 API：6 个 action 全部出现、`desktop_automation` 名字精确出现、warn desktop runtime
  - 反回归：禁止旧 oh-my-opencode token（`client.page(` / `getAISnapshot` / `selectSnapshotRef` / `page.evaluate` / `waitForSelector` / `waitForPageLoad` / `server.sh` / `@/client.js` / `npx tsx` / `extension mode`）— 任一回归都会让对应测试失败

### Phase 3: 验收 ✅
- [x] T-V-01: typecheck 通过
- [x] T-V-02: 全量 51 文件 / 472 测试 全过（+36 从 436 到 472：18 PATH + 18 DEVBROWSER）；真机 dev-browser session 推迟到桌面端 UI 升级批次手动 smoke test

## Verification Commands

```bash
pnpm --filter @openAwork/agent-gateway typecheck
pnpm --dir apps/web exec tsc --noEmit
pnpm --filter @openAwork/agent-gateway exec vitest run \
  src/__tests__/routes-sessions-path-filter.test.ts \
  src/__tests__/dev-browser-skill.test.ts
```

## Risks & Rollback

- **path 过滤误判**：注意 `/a` 不应匹配 `/abc`，要用 `path + sep` 前缀比较
- **disable 设置后用户找不到开关**：在 settings 页面留说明
- **dev-browser 二进制依赖**：默认不安装 Playwright；skill 描述里写清楚"首次使用前请运行 `npx playwright install chromium`"
- **平台兼容**：先 Linux/macOS GA，Windows 留 known limitation

## Notes

- 两件事互相独立，可分头落
- T-PATH 完成后会有 OpenAWork 用户立刻反馈，建议优先做这件
- 完成后 ADR：`会话列表支持按目录过滤（opt-in），dev-browser 作为 opt-in 内置 skill`
