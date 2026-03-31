# agent-gateway 云端部署方案

## 任务概述

将 `services/agent-gateway` 从本地 Sidecar 模式升级为可独立云端部署的生产级服务，同时清理 `CloudWorkerConnection` stub，明确云端连接语义。

## 复杂度评估

- 原子步骤：8 步 → +2
- 独立并行流：部分可并行 → +2
- 涉及模块：gateway / agent-core / desktop / docker → +1
- 单步预计 >5 min：是 → +1
- 需持久化产物：是 → +1
- OpenCode 可用：是 → -1
- **总分：6**
- **选定模式：Full orchestration**
- **路由理由：** 跨多个包/服务的改动，含 Dockerfile、数据库、认证、CORS、`CloudWorkerConnection` 清理与前端对接，需要分阶段验证。

---

## 三端连接云端现状分析

### Web 端（`apps/web`）

| 维度 | 现状 | 问题 |
|------|------|------|
| 连接配置 | `LoginPage` 有折叠"高级"区含 `gatewayInput`，存入 `auth-store.gatewayUrl`（localStorage 持久化） | 默认值 `http://localhost:3000` 无云端引导 |
| 认证流程 | 调用 `login(gatewayUrl, email, password)` → `setAuth(accessToken, email, refreshToken, expiresIn)` | **完整**，只需填入正确 URL |
| Token 刷新 | `setInterval` 每 60s 检测，剩余 <2min 自动 `refreshAccessToken()` | **完整** |
| 云端 URL 引导 | 无，默认 localhost，用户需手动展开高级选项修改 | 需补充云端 URL 配置引导或默认提示 |

### Desktop 端（`apps/desktop`）

| 维度 | 现状 | 问题 |
|------|------|------|
| 引导流程 | `OnboardingWizard`：步骤 1 填 gateway URL + 测试连接，步骤 2 登录 | 能连接远程网关，但 UI 没有区分"本地 sidecar"和"远程云端"两种模式 |
| 本地 sidecar 启动 | `lib.rs` 中 `start_gateway()` 命令存在，但 `OnboardingWizard` 中未调用 `invoke('start_gateway')` | Desktop 默认总是手动填 URL，未自动启动本地 sidecar |
| 认证流程 | 调用 `apiLogin(url, email, password)` → `setAuth(...)` | **完整** |
| 云端模式 | `OnboardingMode: 'cloud'`（agent-core 中有设计）但 Desktop UI 无对应分支 | 缺少"连接云端"vs"启动本地"的明确模式选择 |

### Mobile 端（`apps/mobile`）

| 维度 | 现状 | 问题 |
|------|------|------|
| 引导步骤 | `select-mode → host-*/client-scan/cloud-login` 三条路径 | **Cloud 和 Client 路径均为 mock，完成后不调用任何 API** |
| Cloud 登录 | `CloudLoginStep.onNext()` 直接调用完成，未调用 gateway `/auth/login`，未写入 `useAuthStore.setTokens`/`setGatewayUrl` | 🔴 **关键缺失**：云端登录是空壳 |
| Client 扫码 | `ClientScanStep.onNext()` 直接完成，未解析 pairing JSON，未设置 gatewayUrl/token | 🔴 **关键缺失**：扫码配对是空壳 |
| Host 健康检查 | `HostHealthStep` 用 `setTimeout(2000)` 模拟检查成功，未真正请求 `/health` | 🟡 假健康检查 |
| Token 存储 | `SecureStore`（expo-secure-store）持久化 access/refresh token + gatewayUrl | 存储机制完整，但写入路径被 mock 跳过 |
| WebSocket 客户端 | `MobileGatewayClient` 完整实现：自动协议转换（http→ws/https→wss）、重连退避 | **完整**，只需 token 和 URL 正确即可工作 |

---

## 新增功能设计：二维码扫码连接

### 需求定义

- 网关启动时在**终端打印 ASCII 二维码**，编码连接信息（`{hostUrl, token, version}`）
- 二维码对应的 token **永久有效**（允许多次使用，不过期），直到服务重启
- 客户端（Mobile/Desktop/Web）扫码后自动填入 `gatewayUrl` 并跳过手动输入
- 账号登录仍需要邮箱/密码，二维码只负责传递**连接地址**，不传递凭据

### 现状评估

`packages/pairing` 已有基础实现：
- `PairingManagerImpl.generatePairingCode()` 生成 token + qrData JSON
- `qrData` 格式：`JSON.stringify({ hostUrl, token, version: '1' })`
- 当前 token TTL 为 **30 秒**（`TOKEN_TTL_MS = 30_000`）——与需求不符，需改为永久
- `connectWithToken()` 通过 `POST /pairing/connect` 确认连接
- **gateway 路由中没有 `/pairing/*` 端点**（pairing 包未接入 gateway）
- **没有终端 ASCII 二维码输出**（无 qrcode 依赖）

### 设计方案

#### 服务端（`services/agent-gateway`）

```
启动时：
  PairingManagerImpl.generatePairingCode() → { hostUrl, token, qrData }
  qrcode-terminal.generate(qrData) → 终端打印 ASCII 二维码
  token 永久保存（不设 TTL，重启后重新生成）

POST /pairing/connect   → 客户端提交 token，验证后返回 { ok: true }
GET  /pairing/status    → 返回当前 pairing token 状态（仅用于调试）
GET  /pairing/qr        → 返回 qrData JSON（供 Web 前端渲染二维码）
```

#### 终端输出示意
```
┌──────────────────────────────────────────┐
│  OpenAWork Gateway                       │
│  扫码连接此服务：                         │
│                                          │
│  ████ ██  ████ ████ ████                 │
│  ████ ██  ████ ████ ████                 │
│  ...（ASCII 二维码）                      │
│                                          │
│  或手动输入：http://192.168.1.100:3000   │
│  连接后请使用账号密码登录                  │
└──────────────────────────────────────────┘
```

#### Mobile 端扫码流程

```
ClientScanStep（当前）：粘贴 JSON 文本
  ↓ 升级为
ClientScanStep（新）：
  1. 相机扫码（expo-camera / expo-barcode-scanner）
  2. 解析 JSON：{ hostUrl, token }
  3. POST /pairing/connect（token 验证）
  4. await useAuthStore.setGatewayUrl(hostUrl)
  5. 跳转登录页（仍需账号密码）
```

#### Desktop 端扫码流程

```
OnboardingWizard（新）：
  - 新增「扫码连接」按钮（调用 Tauri camera 或展示截图识别提示）
  - 短期替代方案：用户从手机扫码获得 URL 后，Desktop 仍手动输入
  - 长期：Desktop 展示 /pairing/qr 返回的二维码图片（Web 渲染）
```

#### Web 端（登录页辅助）

```
LoginPage（新）：
  - 「扫码登录此设备」按钮 → 调用 GET /pairing/qr → 渲染二维码图片（qrcode 库）
  - 手机扫码后确认连接，Web 页面轮询 /pairing/status 自动刷新
  （适用于：用户从手机扫描当前 PC 的 Web 页面二维码来配对）
```

### 所需依赖

| 包 | 用途 | 安装位置 |
|---|---|---|
| `qrcode-terminal` | 终端 ASCII 二维码输出 | `services/agent-gateway` |
| `qrcode` | Node.js 生成 base64 图片 | `services/agent-gateway`（`/pairing/qr` 端点） |
| `expo-camera` 或 `expo-barcode-scanner` | Mobile 相机扫码 | `apps/mobile` |

---

## 新增功能设计：账号登录（云端场景）

### 现状评估

gateway `auth.ts` 已实现完整登录链路：
- `POST /auth/login`（email + password → accessToken + refreshToken）
- `POST /auth/refresh`（refreshToken → 新 accessToken）
- `POST /auth/logout`（撤销 refreshToken）
- JWT 有效期 15 分钟，refresh token 7 天
- 默认管理员：`ADMIN_EMAIL` + `ADMIN_PASSWORD`（环境变量）

**缺失的是各端「登录」流程与真实 API 的接通**：

| 端 | 缺失内容 |
|---|---|
| Web | **完整**，`LoginPage` 已调用 `/auth/login` ✅ |
| Desktop | **完整**，`OnboardingWizard` 已调用 `apiLogin()` ✅ |
| Mobile Cloud 模式 | `CloudLoginStep.onNext()` 直接完成，**未调用任何 API** 🔴 |
| Mobile Host 模式 | `HostHealthStep` 用 setTimeout 伪造，**未真实验证** 🔴 |

### 设计方案

#### 账号注册（新增需求）

当前 gateway 只有 `seedDefaultAdmin()`，没有自助注册端点。
云端多用户场景需要：

```
POST /auth/register   邮箱 + 密码 → 创建账号（可由环境变量 ALLOW_REGISTRATION=true 控制开关）
POST /auth/login      已有账号登录
POST /auth/refresh    刷新 token
POST /auth/logout     撤销 token
```

单用户云端场景（个人部署）：关闭注册，只用 ADMIN_EMAIL/ADMIN_PASSWORD 环境变量管理账号。

#### Mobile Cloud 模式完整登录流程

```
CloudLoginStep（新）：
  1. 输入框：Gateway URL（新增，当前缺失）
  2. 输入框：邮箱
  3. 输入框：密码
  4. 点击登录 → POST {gatewayUrl}/auth/login
  5. 成功：await setGatewayUrl(url) + await setTokens(access, refresh)
  6. 跳转主页
  7. 失败：显示错误（401/网络错误）
```

#### Token 自动刷新（Mobile）

当前 Mobile 没有 token 自动刷新机制（Web 有 setInterval，Mobile 无对应实现）。
需在 `useGatewayClient` 或全局 hook 中补充：

```
每次发起请求前检测 tokenExpiresAt，
剩余 <2min → POST /auth/refresh → 更新 SecureStore
```

---

## 当前状态分析

### 已具备条件
- `GATEWAY_HOST=0.0.0.0` 支持外网绑定
- `docker-compose.yml` 已有 gateway 服务（3000 端口）
- apps/web/Dockerfile 已存在（nginx 托管）
- JWT 认证完整（access token + refresh token + Redis session）
- `/health` 端点存在（Desktop 用于连接测试）
- `CORS: origin: true`（已开放跨域）
- Desktop `OnboardingWizard` 支持填写远程 `gatewayUrl`

### 需要解决的问题

| 编号 | 问题 | 严重度 | 涉及文件 |
|------|------|--------|----------|
| C-01 | `services/agent-gateway/Dockerfile` 不存在，docker-compose 无法构建 gateway | 🔴 P0 | 需新建 |
| C-02 | `DATABASE_URL` 配置名与实际行为不符：代码只检测该变量选 SQLite 文件路径，并非真正接 Postgres | 🔴 P0 | `db.ts:12` |
| C-03 | Redis mock（内存 Map）无法跨进程/跨实例共享 session，多副本部署时会出现登录失效 | 🟡 P1 | `db.ts:50-60` |
| C-04 | `JWT_SECRET` 默认值 `change-me-in-production-min-32-chars` 在云端为安全漏洞，无启动强校验 | 🟡 P1 | `auth.ts:10` |
| C-05 | `ADMIN_PASSWORD` 默认 `admin123456`，无启动时修改强制提示 | 🟡 P1 | `index.ts:12` |
| C-06 | `WORKSPACE_ROOT` 默认为 `process.cwd()`，云端容器中无意义（文件工具会操作容器内路径） | 🟡 P1 | `db.ts:17` |
| C-07 | `CloudWorkerConnection.stubConnectToRemote` 是空函数，但 `WorkerSessionManagerImpl.launch(mode='cloud_worker')` 已在业务流程中被调用，实际无效 | 🟡 P1 | `agent-core/worker/index.ts:165` |
| C-08 | `CORS: origin: true` 生产环境应配置白名单域名，否则任意来源可跨域访问 | 🟠 P2 | `index.ts:54` |
| C-09 | SQLite WAL 文件落在容器内 `data/openAwork.db`，容器重启数据丢失，需 Volume 挂载 | 🟠 P2 | `db.ts:12` |
| C-10 | Desktop 引导流程只有「连接本地 sidecar」和「连接远程网关」两种，但 `OnboardingMode: 'cloud'` 的流程（跳过 workspace 步骤）并未在 UI 中体现 | 🟠 P2 | `desktop/onboarding/OnboardingWizard.tsx` |

---

## 方案设计

### 云端部署架构

```
互联网
  │
  ├── 浏览器 → apps/web（nginx 静态托管）→ gateway:3000
  ├── Desktop（Tauri）→ OnboardingWizard 填 URL → gateway:3000（远程）
  └── Mobile（Expo）→ gatewayUrl → gateway:3000（远程）

gateway 容器
  ├── Fastify HTTP/WS :3000
  ├── SQLite（Volume 挂载持久化）
  ├── Redis（单实例，可选云托管）
  └── LLM Provider（AI_API_KEY 注入）
```

### `CloudWorkerConnection` 的正确定位

**结论：`agent-gateway` 即是云端，不需要 `CloudWorkerConnection` 来连接它。**

`CloudWorkerConnection` 是为"弹性计算节点"设计的（类似 E2B/Modal），
当前架构中没有这类第三方节点服务，应将其标记为未实现而非让调用链静默通过。

两种处理选项：
- **选项 A（推荐）**：在 `stubConnectToRemote` 中抛出明确错误，防止误用。保留接口供未来实现。
- **选项 B**：删除 `cloud_worker` 模式，简化 `WorkerSessionManagerImpl`，仅保留 `local` 和 `sandbox`。

---

## 实施计划

### Phase 1：基础设施 — 让 docker-compose 能真正构建运行（P0）

- [ ] T-01：新建 `services/agent-gateway/Dockerfile`（多阶段构建，pnpm + tsx 运行）
- [ ] T-02：验证 `docker-compose up` 能成功启动 gateway + postgres + redis + web

### Phase 2：数据持久化与真实 Redis（P1）

- [ ] T-03：明确 `DATABASE_URL` 语义：当前仍用 SQLite，变量名改为 `SQLITE_PATH` 或补充注释说明 Postgres 为规划中
- [ ] T-04：接入真实 `ioredis`（`.evidence/` 中有参考实现），替换内存 Map mock
- [ ] T-05：在 docker-compose 中为 SQLite 数据文件配置 Volume 挂载（`data/` 目录）

### Phase 3：安全加固（P1）

- [ ] T-06：`auth.ts` 启动时校验 `JWT_SECRET` 长度（< 32 字符则 exit(1) + 明确错误日志）
- [ ] T-07：`index.ts` 启动时检测 `ADMIN_PASSWORD` 仍为默认值时打印 WARNING
- [ ] T-08：`index.ts` CORS 从 `origin: true` 改为读取 `ALLOWED_ORIGINS` 环境变量，默认仅允许 localhost

### Phase 4：三端云端连接接通（P0/P1）

#### Mobile 端（✅ 已完成）

- [x] T-09：`CloudLoginStep` 接入真实鉴权：填写 `gatewayUrl` + 调用 `POST /auth/login`，成功后调用 `useAuthStore.setGatewayUrl()` + `setTokens()`，失败显示错误
- [x] T-10：`HostHealthStep` 替换 `setTimeout` mock，改为真实 `fetch(gatewayUrl + '/health')`，失败时显示错误并阻止继续
- [x] T-11：`ClientScanStep` 解析 pairing JSON（`{hostUrl, token}`），调用 `setGatewayUrl(hostUrl)` 并用 token 验证连接可达性

#### Desktop 端（🟡 P1 — 缺少本地/远程模式分流）

- [ ] T-12：`OnboardingWizard`（Desktop）补充模式选择：「启动本地 Gateway」（自动 `invoke('start_gateway')`）vs「连接已有云端 Gateway」（手动填 URL），当前两种行为混在同一流程

#### Web 端（🟠 P2 — 功能完整但引导不足）

- [ ] T-13：`LoginPage` 高级选项默认展开（或在 URL 为 localhost 时显示云端引导提示），降低用户连接云端的摩擦

### Phase 5：云端 Worker 设计收口（P1）

- [ ] T-14：`CloudWorkerConnection.stubConnectToRemote` 改为抛出明确错误：`'CloudWorkerConnection: remote execution nodes not implemented. Use agent-gateway as your cloud backend.'`
- [x] T-15：`OnboardingWizard`（Mobile）`cloud-login` 步骤补充 gatewayUrl 输入框（已完成，含在 T-27）

### Phase 7：二维码扫码连接（P1）

#### 服务端
- [x] T-18：`packages/pairing/src/manager.ts` 修改 `TOKEN_TTL_MS`：永久 token 模式（不设超时，服务重启后重新生成）；`generatePairingCode()` 改为幂等——服务生命周期内同一 token 复用
- [x] T-19：安装 `qrcode-terminal` + `qrcode` 依赖到 `services/agent-gateway`
- [x] T-20：`services/agent-gateway/src/index.ts` 启动时调用 `PairingManagerImpl.generatePairingCode()`，使用 `qrcode-terminal` 在终端打印 ASCII 二维码 + 手动输入 URL 提示
- [x] T-21：新建 `services/agent-gateway/src/routes/pairing.ts`，注册路由：
  - `POST /pairing/connect`（验证 token，返回 `{ ok: true, hostUrl }`）
  - `GET /pairing/qr`（返回 base64 二维码图片，供 Web/Desktop 渲染）
  - `GET /pairing/status`（返回当前 token 状态，调试用）
- [x] T-22：在 `index.ts` 中注册 `pairingRoutes`（无需认证，连接前可访问）

#### Mobile 端
- [x] T-23：`ClientScanStep` 升级：解析 pairing JSON + `POST /pairing/connect` 验证 + 地址可编辑确认 + 跳转 `ClientLoginStep` 账号登录（expo-camera 扫码需 EAS Build 原生支持，留作后续）

#### Desktop 端
- [ ] T-24：`OnboardingWizard`（Desktop）新增「扫码连接」入口：调用 `GET /pairing/qr`（当 gateway 已在运行时）展示二维码，或提示用户从终端扫码获取 URL

#### Web 端
- [ ] T-25：`LoginPage` 新增「扫码」辅助入口：`GET /pairing/qr` 渲染二维码图片，供手机扫描配对此 Web 页面所在的 gateway

### Phase 8：账号登录补全（P0/P1）

#### 服务端
- [ ] T-26：`services/agent-gateway/src/auth.ts` 新增 `POST /auth/register`（邮箱+密码创建账号），由环境变量 `ALLOW_REGISTRATION=true` 控制开关（默认 `false`，个人部署只用管理员账号）

#### Mobile 端
- [x] T-27：`CloudLoginStep` 完整实现：补充 Gateway URL 输入框，调用 `POST /auth/login`，成功后 `await setGatewayUrl` + `await setTokens`，失败显示错误
- [x] T-28：Mobile 补充 token 自动刷新：`AppNavigator` useEffect setInterval 60s 检测，<2min 调 `POST /auth/refresh` 并更新 SecureStore

### Phase 6：工作区隔离与文档（P2）

- [ ] T-16：云端部署文档（`docs/cloud-deployment.md`）：环境变量说明、WORKSPACE_ROOT 配置建议、Volume 路径、安全 checklist、二维码扫码连接说明
- [ ] T-17：`.env.example` 补充云端部署专用注释：`ALLOWED_ORIGINS`、`SQLITE_PATH`、`ALLOW_REGISTRATION`

---

## 依赖关系 DAG

```
Phase 1:  T-01 → T-02
Phase 2:  T-03 → T-05
          T-04 → T-02（真实 Redis 后 docker-compose 才完整）
Phase 3:  T-06 → T-07 → T-08
Phase 4:  T-09（独立）
          T-10（独立）
          T-11（独立）
          T-12（独立）
          T-13（独立）
Phase 5:  T-14（独立）
          T-15（依赖 T-09 逻辑完成）
Phase 6:  T-16 ← T-02, T-05, T-08, T-09~T-15 全完成
          T-17 ← T-03, T-06, T-08
```

**可并行起始组**：`[T-01, T-03, T-04, T-06, T-09, T-10, T-11, T-12, T-13, T-14]` 全部独立，可同时开工。

**关键路径**：`T-01 + T-04 → T-02`（docker-compose 可运行）→ `T-16`（文档完成）

**新增并行组**：`[T-18, T-19, T-23, T-26, T-27]` 独立，可同时开工
`T-20 + T-21 + T-22` 依赖 T-18/T-19 完成后串行推进

---

## 验收标准

### 服务端
- `docker-compose up` 能完整启动，gateway 返回 `GET /health → {status: 'ok'}`
- `JWT_SECRET` 缺失或过短（< 32 字符）时 gateway 启动失败并打印明确错误
- `ADMIN_PASSWORD` 为默认值时打印 WARNING 日志
- `CloudWorkerConnection.connect()` 调用时抛出明确的「未实现」错误而非静默通过
- gateway 启动时终端打印 ASCII 二维码，包含 `{hostUrl, token}` 信息
- `POST /pairing/connect` 验证 token 成功返回 `{ ok: true, hostUrl }`
- `GET /pairing/qr` 返回可渲染的 base64 二维码图片
- pairing token 服务生命周期内保持有效，不因客户端扫码而失效（允许多次使用）
- `ALLOW_REGISTRATION=true` 时 `POST /auth/register` 可创建新账号

### Web 端
- `LoginPage` 填入远程 gateway URL 能成功登录并进入 `/chat`
- `LoginPage` 提供「扫码」入口，渲染 `/pairing/qr` 二维码图片
- Token 过期前 2 分钟自动刷新，用户无感

### Desktop 端
- `OnboardingWizard` 支持区分「启动本地 Gateway」和「连接云端 Gateway」两种模式
- 选择本地模式时，自动调用 `invoke('start_gateway')` 启动 sidecar
- 选择云端模式时，填入 URL → 测试连接 → 登录三步流程完整可用
- 可展示 `/pairing/qr` 二维码供手机扫码连接

### Mobile 端
- 选择 Cloud 模式后，填写 gatewayUrl + 邮箱 + 密码，能真实登录并进入会话列表
- 选择 Client 模式后，相机扫码解析二维码 JSON → `POST /pairing/connect` 验证 → `setGatewayUrl` → 跳转登录
- Host 健康检查真实请求 `/health`，返回非 200 时显示错误
- WebSocket 流式聊天在云端 URL（wss://）下正常工作
- token 过期前 2 分钟自动刷新（新增 setInterval）

---

## 注意事项

### 架构
- SQLite 在单副本云端场景完全够用，不必强推 Postgres 迁移
- Redis 在单副本时可继续用内存 mock，多副本/重启后无状态可接受（refresh token 已持久化在 SQLite）
- `WORKSPACE_ROOT` 在云端应配置为空目录或明确禁用文件工具（`WORKSPACE_ACCESS_MODE=restricted`），避免 Agent 随意操作容器文件系统
- Desktop 桌面端默认继续使用本地 sidecar，云端模式是可选配置，不应破坏现有默认体验

### Mobile 特殊注意
- Mobile `auth.ts` 使用 `expo-secure-store` 存储 token，不用 localStorage；`setGatewayUrl()` 是 async，调用时必须 `await`
- Mobile WebSocket 协议自动转换（`http→ws`，`https→wss`）在 `MobileGatewayClient.openConnection()` 中已实现，云端只需确保 gateway 开启 WSS
- Mobile `CloudLoginStep` 当前缺少 gatewayUrl 输入框，用户无法指定服务端地址，必须补充（T-15）

### Web 特殊注意
- Web `gatewayUrl` 默认 `http://localhost:3000`，通过 localStorage（`auth-store`）持久化；首次访问云端时用户必须展开高级选项手动修改，可考虑通过环境变量 `VITE_GATEWAY_URL` 在构建时注入默认值，减少云端部署配置摩擦

### Desktop 特殊注意
- Desktop `lib.rs` 的 `start_gateway()` Tauri 命令已实现，但 `OnboardingWizard.tsx` 中没有 `invoke('start_gateway')` 调用，导致本地 sidecar 从未被自动启动；T-12 补充此调用时需处理端口冲突（GATEWAY_PORT 环境变量动态分配）

### 二维码特殊注意
- pairing token **不得**在 `POST /pairing/connect` 被消费后删除——需求是允许多次使用（多端扫码连接同一 gateway）
- token 生命周期绑定 gateway 进程：服务启动时生成一次，重启后重新生成新 token
- `GET /pairing/qr` 无需认证（客户端连接前无 token），但应只返回 base64 图片，不暴露明文 token
- `qrcode-terminal` 输出 ASCII 二维码到 stdout，生产部署时日志聚合服务可能会截断，建议同时打印明文 URL 作为备用
- Mobile 端 `expo-barcode-scanner` 从 Expo SDK 50 起已弃用，改用 `expo-camera` 的 `CameraView` + `onBarcodeScanned`

### 账号注册特殊注意
- `ALLOW_REGISTRATION` 默认 `false`：个人云端部署只需用 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 环境变量初始化管理员账号
- 注册端点需要与登录端点相同的 Zod 校验（email 格式 + 密码最少 8 字符）
- 注册前需检测邮箱是否已存在，返回 `409 Conflict` 而非 500
