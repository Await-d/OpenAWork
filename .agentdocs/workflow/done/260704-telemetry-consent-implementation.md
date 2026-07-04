# 遥测同意与数据收集功能完整实施方案

## Task Overview

当前 OpenAWork 的「帮助改进 OpenAWork」遥测功能存在前后端断层：前端弹窗 UI 已有但回调无实际效果（accept/decline 逻辑完全相同，仅写 localStorage），后端 `packages/telemetry` 包设计完整但仅服务端可用，网关缺少遥测同意状态路由与通用事件采集入口。本方案补全从前端同意状态持久化 → 网关路由 → 服务端采集 → GitHub Issue 同步的全链路闭环。

## Current Analysis

### 现状问题清单

| 层面 | 问题 | 影响 |
|---|---|---|
| **前端弹窗回调** | `App.tsx:489-499` 中 `onAccept` 和 `onDecline` 逻辑完全相同，都只设 `telemetry_consent_shown = '1'` | 无法区分用户是否同意，后续无法决定是否采集 |
| **前端设置页** | `security-tab-content.tsx:73-80` 中 accept 设 `'1'`、decline 设 `'0'`，但未通知后端 | 本地状态与后端脱节，换设备/清缓存后丢失 |
| **前端无采集器** | 前端未引入任何遥测采集逻辑 | `app_start`、`session_created`、`tool_call`、`skill_installed`、`error_boundary` 等事件无人上报 |
| **网关无遥测路由** | `services/agent-gateway/src/routes/settings.ts` 无 `/settings/telemetry` 端点 | 前端无法将同意状态同步到后端 |
| **web-client 缺封装** | `packages/web-client/src/infra/settings.ts` 的 `SettingsClient` 接口无遥测方法 | 违反项目约定「禁止 apps/ 直接 fetch 网关」 |
| **外部端点不存在** | `TelemetryManager` 默认 flush 到 `https://telemetry.openwork.dev/v1/events` | 该域名未部署，数据上报后实际丢失 |
| **无 GitHub 同步** | 崩溃报告和错误事件无法自动同步到官方 GitHub Issues | 用户遇到的 bug 无法被开发者及时感知和排查 |

### 现有可复用资产

1. `packages/telemetry/src/telemetry-manager.ts` — 完整的 Node.js 遥测管理器（队列、批量 flush、退出机制、单飞保护、超时保护），可作为网关端采集核心
2. `services/agent-gateway/src/team/team-runtime-telemetry.ts` — 已有 `TelemetryManager` 实例化和封装模式可参照
3. `packages/shared-ui/src/telemetry/TelemetryConsentModal.tsx` — 首次进入弹窗 UI 已完成
4. `packages/shared-ui/src/telemetry/TelemetryConsentDialog.tsx` — 设置页弹窗 UI 已完成
5. `packages/web-client/src/infra/settings.ts` — 已有完整的 settings 客户端模式可扩展
6. `services/agent-gateway/src/routes/settings.ts` — 已有 `user_settings` 表 + `sqliteRun/Get/All` 模式可复用

### 设计约束

- **禁止 apps/ 直接 fetch 网关** — 所有 HTTP 请求必须走 `@openAwork/web-client`
- **`packages/telemetry` 是 Node.js 模块**（使用 `node:fs`/`node:os`/`node:crypto`）— 不能在浏览器端直接使用
- **前端遥测采集**需通过网关中转上报，而非直连外部端点
- **GitHub 同步**需考虑：速率限制、去重、隐私脱敏、用户可控
- **`telemetry_consent_shown` 语义**：当前 `'1'` = 已展示弹窗（不区分同意/拒绝），需迁移为 `telemetry_consent` = `'accepted' | 'declined' | null`

## Solution Design

### 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (apps/web)                          │
│                                                                  │
│  App.tsx                                                         │
│    └─ TelemetryConsentModal (首次启动弹窗)                        │
│       ├─ onAccept → 调用 web-client.updateTelemetryConsent()     │
│       └─ onDecline → 调用 web-client.updateTelemetryConsent()    │
│                                                                  │
│  SettingsPage → SecurityTabContent                               │
│    └─ TelemetryConsentDialog (设置→安全→遥测授权)                  │
│       └─ 同上，通过 web-client 同步到网关                          │
│                                                                  │
│  useTelemetry hook (新增)                                        │
│    └─ 前端事件采集：app_start / error_boundary                    │
│       └─ 通过 web-client.reportTelemetryEvent() 上报到网关         │
└──────────────────────────────────────────────────────────────────┘
                              │
                    packages/web-client
                    └─ SettingsClient
                       ├─ getTelemetryConsent()
                       ├─ updateTelemetryConsent()
                       └─ reportTelemetryEvent()
                              │
┌─────────────────────────────────┴────────────────────────────────┐
│                   services/agent-gateway (后端)                   │
│                                                                   │
│  routes/settings.ts                                               │
│    ├─ GET  /settings/telemetry/consent  → 读取用户同意状态         │
│    ├─ PUT  /settings/telemetry/consent  → 保存同意状态             │
│    └─ POST /settings/telemetry/event    → 接收前端遥测事件         │
│                                                                   │
│  telemetry/telemetry-service.ts (新增)                            │
│    ├─ 通用 TelemetryManager 单例（区别于 team-runtime 专用实例）    │
│    ├─ track(name, properties) → 入队                              │
│    ├─ 同意状态检查 → 用户未同意则不采集                              │
│    └─ GitHub Issue 同步器 (telemetry/github-sync.ts)              │
│       └─ error_boundary 事件 → 创建/更新 GitHub Issue              │
│                                                                   │
│  user_settings 表                                                 │
│    └─ key='telemetry_consent', value='{"status":"accepted",...}'  │
└───────────────────────────────────────────────────────────────────┘
                              │
                    packages/telemetry
                    └─ TelemetryManager.flush()
                       └─ POST → 外部端点（可配置）
```

### 关键设计决策

1. **同意状态双写**：前端 localStorage + 网关 `user_settings` 表，以网关为准
2. **前端采集通过网关中转**：前端不直接实例化 `TelemetryManager`，而是通过 `POST /settings/telemetry/event` 上报到网关，由网关统一 flush
3. **GitHub Issue 同步**：仅 `error_boundary` 事件触发 GitHub Issue 创建，包含去重逻辑（相同堆栈签名 24h 内不重复创建）
4. **隐私优先**：GitHub Issue 中不包含 installId，仅包含错误堆栈摘要 + 平台信息 + 应用版本
5. **可配置端点**：`TelemetryManager` 的 endpoint 支持通过环境变量 `TELEMETRY_ENDPOINT` 覆盖，开发环境可指向本地

## Complexity Assessment

- Atomic steps: 10+ → score: +2
- Parallel streams: 是（网关路由 / web-client 扩展 / 前端改造 / GitHub 同步 可并行） → score: +2
- Modules/systems/services: 5（web-client / agent-gateway / shared-ui / apps/web / packages/telemetry） → score: +1
- Long step (>5 min): 是（GitHub Issue 同步器 + 测试） → score: +1
- Persisted review artifacts: 是（workflow 文档 + 代码） → score: +1
- OpenCode available: 否 → score: 0
- **Total score**: 7
- **Chosen mode**: Full orchestration
- **Routing rationale**: 10+ 原子步骤跨 5 个模块，4 条并行流，需要 runtime 协调与状态跟踪

## Implementation Plan

### Phase 1: 网关遥测基础设施（前置依赖）

- [x] T-01 ✅: 在 `services/agent-gateway/src/telemetry/` 新建 `telemetry-service.ts`
  - 创建通用 `TelemetryManager` 单例（与 team-runtime 隔离）
  - 暴露 `trackEvent(userId, name, properties)` 方法
  - 同意状态门控：调用前检查用户是否已同意
  - 支持 `TELEMETRY_ENDPOINT` 环境变量覆盖端点
  - 支持 `GITHUB_TELEMETRY_TOKEN` / `GITHUB_REPO` 环境变量配置 GitHub 同步

- [x] T-02 ✅: 在 `services/agent-gateway/src/telemetry/` 新建 `telemetry-consent-store.ts`
  - `getConsent(userId)` → 读取 `user_settings` 中 `telemetry_consent` 键
  - `setConsent(userId, status)` → 写入同意状态（`accepted` / `declined`）
  - 返回结构：`{ status: 'accepted' | 'declined' | null, updatedAt: string }`
  - Zod schema 校验

- [x] T-03 ✅: 在 `services/agent-gateway/src/routes/settings.ts` 新增 3 个遥测路由
  - `GET /settings/telemetry/consent` — 读取当前用户同意状态
  - `PUT /settings/telemetry/consent` — 保存同意状态（accept/decline）
  - `POST /settings/telemetry/event` — 接收前端上报的遥测事件（入队网关端 TelemetryManager）
  - 全部走 `requireAuth` + Zod 校验
  - `POST /settings/telemetry/event` 在处理前先检查同意状态，未同意返回 403

### Phase 2: web-client 封装（依赖 Phase 1）

- [x] T-04 ✅: 在 `packages/web-client/src/infra/settings.ts` 扩展 `SettingsClient` 接口
  - 新增 `getTelemetryConsent(token)` → `GET /settings/telemetry/consent`
  - 新增 `updateTelemetryConsent(token, status)` → `PUT /settings/telemetry/consent`
  - 新增 `reportTelemetryEvent(token, eventName, properties)` → `POST /settings/telemetry/event`
  - 遵循现有 `performSettingsRequest` 模式
  - 同步更新 `settings.test.ts` 单元测试

### Phase 3: 前端同意状态闭环（依赖 Phase 2）

- [x] T-05 ✅: 修复 `apps/web/src/App.tsx` 中 `TelemetryConsentModal` 回调
  - `onAccept` → 调用 `webClient.updateTelemetryConsent(token, 'accepted')` + 设 `localStorage.telemetry_consent = 'accepted'`
  - `onDecline` → 调用 `webClient.updateTelemetryConsent(token, 'declined')` + 设 `localStorage.telemetry_consent = 'declined'`
  - 两者都设 `localStorage.telemetry_consent_shown = '1'`（保留向后兼容）
  - 网络失败时仍记录 localStorage，不阻塞用户进入

- [x] T-06 ✅: 修复 `apps/web/src/pages/settings/security/security-tab-content.tsx` 中 `TelemetryConsentDialog` 回调
  - 同 T-05 逻辑，通过 web-client 同步到网关
  - 添加当前同意状态显示（从网关读取 `getTelemetryConsent`）

- [x] T-07 ✅: 新建 `apps/web/src/hooks/use-telemetry.ts`
  - 初始化时从网关拉取同意状态，同步到 localStorage
  - 暴露 `trackEvent(name, properties)` 方法（内部走 `webClient.reportTelemetryEvent`）
  - 暴露 `isTelemetryEnabled` 状态
  - 自动采集 `app_start` 事件（组件挂载时，若已同意）
  - 自动采集 `error_boundary` 事件（全局 error handler 接入）

### Phase 4: GitHub Issue 同步（依赖 Phase 1）

- [x] T-08 ✅: 在 `services/agent-gateway/src/telemetry/github-sync.ts` 新建 GitHub Issue 同步器
  - 监听 `error_boundary` 事件
  - 堆栈签名去重：SHA-256(stackTrace 前 5 帧) 作为去重 key
  - 24 小时窗口内相同签名不重复创建 Issue
  - 去重状态持久化到 SQLite（`telemetry_github_dedup` 表）
  - Issue 标题格式：`[Telemetry] {errorName} on {platform}`
  - Issue 正文：错误堆栈摘要 + 平台 + 应用版本 + installId 前缀（仅前 8 位用于关联，不可逆向）
  - 使用 `GITHUB_TELEMETRY_TOKEN` + `GITHUB_REPO` 环境变量
  - 未配置 token 时静默跳过，不影响主流程
  - 遵守 GitHub API 速率限制（5000 req/h），失败时退避重试

- [x] T-09 ✅: 新建 `services/agent-gateway/src/telemetry/telemetry-db.ts`
  - SQLite migration：创建 `telemetry_github_dedup` 表
    ```sql
    CREATE TABLE IF NOT EXISTS telemetry_github_dedup (
      signature TEXT PRIMARY KEY,
      issue_number INTEGER,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      occurrence_count INTEGER DEFAULT 1
    );
    ```
  - `getDedupEntry(signature)` → 查询去重记录
  - `upsertDedupEntry(signature, issueNumber?)` → 插入/更新去重记录
  - `cleanupStaleEntries(olderThanDays)` → 清理过期去重记录（默认 30 天）

### Phase 5: 网关通用事件采集（依赖 Phase 1 + Phase 4）

- [x] T-10 ✅: 在网关关键路径接入通用遥测采集
  - `session_created`：在 session 创建路由中调用 `trackEvent`
  - `tool_call`：在工具执行完成后调用 `trackEvent`（仅记录工具名 + 耗时，不含输入输出）
  - `skill_installed`：在技能安装路由中调用 `trackEvent`
  - 所有采集点先检查用户同意状态
  - 采集失败静默吞掉，不干扰主流程

### Phase 6: 测试与验证

- [x] T-11 ✅: 网关遥测路由单元测试
  - `GET /settings/telemetry/consent` 正常读取 + 空状态
  - `PUT /settings/telemetry/consent` accept/decline 写入 + Zod 校验失败
  - `POST /settings/telemetry/event` 正常入队 + 未同意时 403
  - GitHub 同步去重逻辑测试
  - SQLite migration 测试

- [x] T-12 ✅: 前端集成验证
  - 首次进入弹窗 accept → 网关 `user_settings` 表有 `telemetry_consent = accepted`
  - 首次进入弹窗 decline → 网关 `user_settings` 表有 `telemetry_consent = declined`
  - 设置页修改 → 网关状态同步更新
  - `app_start` 事件在同意后自动上报
  - 网络失败时 localStorage 仍正常写入，不阻塞用户

## Notes

### 隐私保障原则

1. **仅匿名数据**：installId（UUID）、事件类型、时间戳、平台/版本信息
2. **绝不采集**：prompt 内容、响应内容、文件内容、文件路径、API 密钥、用户邮箱
3. **GitHub Issue 脱敏**：installId 仅保留前 8 位（用于关联同一安装的多次错误，不可逆向）
4. **用户可控**：随时可在设置 → 安全 → 遥测授权中切换，环境变量 `DO_NOT_TRACK=1` 全局退出

### GitHub 同步策略

1. **仅 error_boundary 触发**：常规使用数据不上报 GitHub，仅崩溃/错误才创建 Issue
2. **堆栈签名去重**：相同错误 24h 内只创建一个 Issue，后续追加 comment 或更新 occurrence_count
3. **速率限制保护**：GitHub API 5000 req/h，同步器内部限流 10 req/min
4. **可选配置**：未配置 `GITHUB_TELEMETRY_TOKEN` 时跳过 GitHub 同步，遥测数据仍正常 flush 到外部端点
5. **Issue 管理建议**：自动创建的 Issue 添加 `auto-reported` + `telemetry` 标签，便于开发者筛选

### 向后兼容

- `localStorage.telemetry_consent_shown = '1'` 保留，语义为「已展示过弹窗」
- 新增 `localStorage.telemetry_consent = 'accepted' | 'declined'`，语义为「用户选择」
- 首次升级后，已有 `telemetry_consent_shown = '1'` 但无 `telemetry_consent` 的用户，视为未明确同意，不采集（等用户下次操作时从网关拉取）
