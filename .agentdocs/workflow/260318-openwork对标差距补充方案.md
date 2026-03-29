# .agentdocs/workflow/260318-openwork对标差距补充方案.md

## 任务概览

基于对 `different-ai/openwork`（12K stars）官方文档（PRODUCT.md、ARCHITECTURE.md、VISION.md、PRINCIPLES.md）深度分析，识别当前两份方案**尚未覆盖**的 10 项核心功能差距，形成独立补充方案。

本方案与以下两份方案**完全隔离**，独立时间线，独立交付：

- `260318-跨平台-ai-智能体-任务计划.md`（主计划）
- `260318-mcp-skills-统一工具扩展框架.md`（MCP/Skills 方案）

---

## 差距来源

OpenWork 核心理念：

> "OpenCode is the **engine**. OpenWork is the **experience**: onboarding, safety, permissions, progress, artifacts, and a premium-feeling UI."

我们当前方案偏重底层协议（MCP、Gateway），但**用户体验层**（Artifacts、权限语义、Onboarding、审计）设计严重不足。

---

## 模块设计

### 差距 L：Artifacts 管理（产出物）

每次任务 Run 的输出作为一等公民，独立列表管理。

**Artifact 类型**：文件创建/修改、生成文档（DOCX/XLSX/PDF）、导出日志、会话摘要。

```typescript
export interface RunArtifact {
  id: string;
  sessionId: string;
  type: 'file' | 'document' | 'log' | 'summary';
  name: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
  createdAt: number;
  preview?: string; // 前 N 行预览
}

export interface ArtifactManager {
  list(sessionId: string): Promise<RunArtifact[]>;
  open(artifactId: string): Promise<void>; // 系统默认程序打开
  share(artifactId: string): Promise<string>; // 返回分享链接
  download(artifactId: string, dest: string): Promise<void>;
  export(sessionId: string): Promise<string>; // 导出整个 Run 的 Artifact 包
}
```

**UI 组件**：

- `ArtifactList`：Run 结束后展示产出物（图标 + 名称 + 大小 + 操作按钮）
- `ArtifactPreview`：内联预览（文本/图片/Markdown）
- `ArtifactActions`：打开、分享、下载、复制路径

**触发时机**：tool 写文件 → 自动捕获；`session.summarize()` → 摘要作为 Artifact；Run 结束 → 汇总展示。

---

### 差距 M：三模式连接架构（Host / Client / Cloud）

```
Mode A - Host（桌面端本地启动）
  启动本机 OpenCode 引擎，UI 连接 localhost:PORT

Mode B - Client（移动端远程控制）  ← 当前完全缺失
  移动端扫码连接桌面 Host
  QR 码 / 一次性 Token，LAN 或隧道传输

Mode C - Cloud Worker（托管云端）
  登录云控制台 → 启动 Worker → 获取 URL + Token
  App「添加 Worker → 连接远程」
```

**QR 码配对接口**：

```typescript
export interface PairingSession {
  token: string; // 一次性 token，30 秒有效
  qrData: string; // 编码为 QR 的连接串
  hostUrl: string; // Host 局域网地址
  expiresAt: number;
}

export interface PairingManager {
  generatePairingCode(): Promise<PairingSession>; // Host 侧
  connectWithToken(hostUrl: string, token: string): Promise<void>; // Client 侧
  verifyConnection(): Promise<boolean>;
}
```

**Host 端 UI**：QR 码展示 + 倒计时 + 已连接设备列表
**Client 端 UI**：相机扫码 → 自动连接 → 显示 Host 会话列表、执行进度、权限批准入口

---

### 差距 N：Audit Log（审计日志导出）

```typescript
export interface RunAuditLog {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  workspace: string;
  entries: AuditEntry[];
}

export type AuditEntry =
  | { type: 'prompt'; role: 'user' | 'assistant'; content: string; timestamp: number }
  | { type: 'plan'; steps: string[]; timestamp: number }
  | {
      type: 'tool_call';
      toolName: string;
      args: unknown;
      result: unknown;
      durationMs: number;
      timestamp: number;
    }
  | {
      type: 'permission';
      scope: string;
      decision: PermissionDecision;
      reason?: string;
      timestamp: number;
    }
  | { type: 'artifact'; name: string; path: string; timestamp: number };

export type PermissionDecision = 'allow_once' | 'allow_session' | 'always_allow' | 'reject';

export interface AuditLogManager {
  append(sessionId: string, entry: AuditEntry): void;
  export(sessionId: string, format: 'json' | 'markdown'): Promise<string>;
  list(sessionId: string): Promise<AuditEntry[]>;
}
```

**UI**：Run 详情页「导出审计日志」按钮 → 选择格式（JSON/Markdown）→ 保存到本地文件。

---

### 差距 O：Permission 细粒度语义

OpenWork 定义四级权限响应，而非简单允许/拒绝：

```typescript
export type PermissionReply =
  | 'once' // 允许本次，下次仍提示
  | 'always' // 本会话内始终允许（session 结束后失效）
  | 'permanent' // 永久允许（显式且可撤销）
  | 'reject'; // 拒绝，Run 优雅降级

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  scope: string; // 如 'file:write:/Users/me/docs'
  reason: string; // Agent 解释为何需要此权限
  riskLevel: 'low' | 'medium' | 'high';
}

export interface PermissionManager {
  reply(requestId: string, decision: PermissionReply): Promise<void>;
  listGranted(sessionId: string): Promise<GrantedPermission[]>;
  revoke(permissionId: string): Promise<void>; // 撤销永久权限
}
```

**UI 设计原则**：

- 显示 `reason`（为什么需要此权限）
- `riskLevel: 'high'` → 需额外确认步骤，不可一键批准
- `permanent` 选项需二次确认弹窗，设置页可撤销
- 所有决策写入 Audit Log

---

### 差距 P：File Browser + 变更视图

```typescript
export interface FileBrowserAPI {
  searchText(query: string, options?: SearchOptions): Promise<FileSearchResult[]>;
  searchFiles(pattern: string): Promise<string[]>;
  searchSymbols(query: string): Promise<SymbolResult[]>;
  read(path: string): Promise<FileContent>;
  status(): Promise<FileChange[]>; // 类 git status，显示 Run 引发的变更
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  linesAdded?: number;
  linesDeleted?: number;
}
```

**UI 组件**：

- `FileStatusPanel`：Run 结束后变更文件列表（类 git diff 视图，可点击查看 diff）
- `FileSearch`：全文 / 文件名 / 符号三种搜索模式
- `FileViewer`：内联预览含语法高亮

**平台差异**：桌面端直接读取文件系统（Tauri 权限控制）；移动端通过 Host/Server API 代理访问。

---

### 差距 Q：OpenPackage 注册中心（opkg）

```bash
opkg install brave-search          # 从注册中心安装
opkg install github:user/my-skill  # 从 GitHub 安装
opkg list                          # 列出已安装
opkg update brave-search           # 更新
opkg remove brave-search           # 卸载
opkg push                          # 发布到注册中心
```

```typescript
export interface SkillRegistry {
  search(query: string): Promise<SkillEntry[]>;
  getDetail(id: string): Promise<SkillDetail>;
  install(id: string, source?: 'registry' | 'github'): Promise<void>;
  uninstall(id: string): Promise<void>;
  update(id: string): Promise<void>;
  listInstalled(): Promise<InstalledSkill[]>;
  checkUpdates(): Promise<UpdateAvailable[]>;
}

export interface SkillEntry {
  id: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  tags: string[];
  verified: boolean; // 官方策划验证标记
}
```

**UI**：应用内 Skill 市场（搜索、策划列表、一键安装、更新提示角标）。

---

### 差距 R：Host/Client Onboarding 流程

```
首次启动
    ↓
选择模式：Host | Client
    │                    │
  Host                Client
    ↓                    ↓
选择 workspace        扫码 / 输入 URL+Token
配置允许目录              ↓
选择 Provider/模型    verifyConnection()
健康检查                  ↓
测试任务 hello world  进入 Host 会话列表
成功页 + 示例命令
```

**Cloud Worker Onboarding（补充路径）**：

```
登录云控制台 → 启动 Worker（含计费确认）
→ 等待 Worker 就绪 → 获取连接凭据
→ App「添加 Worker → 连接远程」
→ 一键深链接 / 手动 URL + Token fallback
```

**UI 组件**：

- `OnboardingWizard`：步骤进度条 + 每步独立页面
- `ProviderSetup`：API Key 输入 + 实时验证
- `QRCodeDisplay`：Host 侧显示配对 QR 码 + 倒计时
- `QRCodeScanner`：Client 侧相机扫码
- `WorkspaceSelector`：原生文件选择器 + 允许目录配置
- `HealthChecker`：启动检查进度展示

---

### 差距 S：Session Summarize（会话摘要）

```typescript
export interface SessionSummary {
  sessionId: string;
  generatedAt: number;
  keyDecisions: string[];
  filesChanged: string[];
  toolsUsed: string[];
  fullText: string; // Markdown
}
```

**UI**：Run 详情页「生成摘要」按钮 → loading → 摘要以 Artifact 形式展示，可导出/分享。

---

### 差距 T：Workspace 目录双层授权

```
层 1（UI 层）：用户通过原生文件选择器主动授权目录，默认拒绝授权范围外一切访问
层 2（运行时层）：Agent 超出已授权目录时触发 PermissionRequest → once/session/permanent/reject
```

```typescript
export interface FolderAuthorizationManager {
  getAuthorizedRoots(): Promise<string[]>;
  addRoot(path: string): Promise<void>;
  removeRoot(path: string): Promise<void>;
  isAuthorized(path: string): boolean;
  requestExpansion(path: string, sessionId: string): Promise<PermissionReply>;
}
```

**移动端**：DocumentPicker + SecureStore 持久化；**桌面端**：Tauri `open()` + workspace 配置文件。

---

### 差距 U：Developer Mode / TUI 控制

默认隐藏，设置页开关启用。启用后显示：

- 原始 SSE 事件流 Inspector（完整 JSON）
- 工具调用 Raw 参数/结果视图
- 会话 ID / 请求 ID（非开发者模式下 progressive disclosure 隐藏）
- TUI 快捷命令面板（`tui.appendToPrompt`、`tui.submitPrompt`、`tui.showToast`）

---

## 实施计划（独立时间线）

> 状态说明：🟡待开始 | 🔵进行中 | ✅完成 | ❌失败 | ⏸️阻塞

### Phase H1（W1-W2）Onboarding + 连接模式

- [x] H1-01 ✅：实现 `OnboardingWizard`（Host/Client 模式、workspace 配置、Provider 设置、健康检查）
- [x] H1-02 ✅：实现 `PairingManager`（QR 码生成 + Token 验证 + 连接确认）
- [x] H1-03 ✅：实现 `FolderAuthorizationManager`（双层目录授权，原生文件选择器）
- [x] H1-04 ✅：Cloud Worker 连接流程（URL + Token 手动输入 + 一键深链接）

**验收标准**

- 全新安装 5 分钟内完成首次任务
- 移动端扫码配对桌面端，可查看并批准权限请求
- 授权范围外访问被正确拦截并提示

---

### Phase H2（W2-W3）Permission 细粒度 + Audit Log

- [x] H2-01 ✅：实现细粒度 `PermissionManager`（once/session/permanent/reject，含撤销）
- [x] H2-02 ✅：权限提示 UI（scope + reason + riskLevel；high risk 需二次确认）
- [x] H2-03 ✅：实现 `AuditLogManager`（append、list、export JSON/Markdown，导出前自动脱敏）
- [x] H2-04 ✅：Run 详情页权限决策历史 + 导出审计日志按钮

**验收标准**

- 四种权限决策均正确记录 Audit Log
- `permanent` 权限可在设置页撤销
- 导出 JSON/Markdown 均可正常打开，敏感字段已脱敏

---

### Phase H3（W3-W4）Artifacts + File Browser + Summarize

- [x] H3-01 ✅：实现 `ArtifactManager`（list、open、share、download、export）
- [x] H3-02 ✅：`ArtifactList` + `ArtifactPreview` UI（Run 结束自动汇总）
- [x] H3-03 ✅：实现 `FileBrowserAPI`（searchText、searchFiles、searchSymbols、read、status）
- [x] H3-04 ✅：`FileStatusPanel`（变更文件列表 + diff 视图）+ `FileSearch` UI
- [x] H3-05 ✅：实现 `SessionManager.summarize()`，摘要作为 Artifact 展示

**验收标准**

- Run 结束后 Artifact 列表自动展示所有产出文件
- 文件搜索在 1s 内返回结果（本地 workspace ≤ 10K 文件）
- 会话摘要可导出 Markdown 文件

---

### Phase H4（W4-W5）Skill 市场 + Developer Mode

- [x] H4-01 ✅：实现 `SkillRegistry` 客户端（search、install、uninstall、update、checkUpdates）
- [x] H4-02 ✅：应用内 Skill 市场 UI（搜索、策划列表、一键安装、更新角标）
- [x] H4-03 ✅：`opkg` CLI 命令集成（install/remove/push）
- [x] H4-04 ✅：Developer Mode 开关 + 事件流 Inspector + Raw 工具调用视图
- [x] H4-05 ✅：TUI 快捷命令面板

**验收标准**

- 应用内搜索并一键安装 Skill，安装后立即可用
- Developer Mode 下可看到完整 SSE 事件流原始 JSON
- `opkg install` CLI 可正常安装并激活 Skill

---

## 里程碑

- MH1（W2）：Onboarding + 三种连接模式均可用
- MH2（W3）：细粒度权限 + Audit Log 导出
- MH3（W4）：Artifacts 管理 + File Browser + 会话摘要
- MH4（W5）：Skill 市场 + Developer Mode

---

## 依赖关系（DAG）

```
H1-03（目录授权）→ H2-01（权限管理）→ H2-03（审计日志）→ H3-01（Artifacts）
H1-01（Onboarding）→ H1-02（QR配对）→ H1-04（Cloud Worker）
H2-01 → H2-02（权限 UI）→ H2-04（审计导出）
H3-03（File API）→ H3-04（File UI）
H3-05（Summarize）→ H3-01（摘要作为 Artifact）
H4-01（Registry）→ H4-02（Skill 市场 UI）
```

---

## 风险矩阵

| 风险                                     | 概率 | 影响 | 控制措施                                           |
| ---------------------------------------- | ---- | ---- | -------------------------------------------------- |
| QR 码配对在防火墙/严格 NAT 环境失败      | 中   | 高   | 手动 URL+Token fallback；文档说明端口需求          |
| 移动端沙箱限制导致 File Browser 功能降级 | 高   | 中   | 移动端通过 Host/Server API 代理；明确功能边界      |
| Skill 市场恶意包                         | 中   | 高   | verified 标记 + 来源白名单 + 安装前展示权限清单    |
| `permanent` 权限被用户误点               | 中   | 高   | 二次确认弹窗 + 设置页显眼撤销入口                  |
| Audit Log 包含敏感数据                   | 中   | 高   | 导出前自动脱敏（正则匹配 key/token/password 字段） |

---

## 度量指标

- Onboarding 完成率（首次安装 → 首次任务成功）
- QR 码配对成功率 / 平均配对时间
- 权限提示理解率（低误操作率）
- Artifact 下载/分享次数
- Skill 市场安装转化率
- Audit Log 导出使用频率
- Developer Mode 启用率

---

## 备注

- 本文档为独立方案 v1，不修改主计划及 MCP+Skills 方案任何任务。
- 三方案接口边界：本方案 `PermissionManager` 与 MCP+Skills 方案 `ToolRegistry` 共享权限决策事件；`AuditLogManager` 消费主计划 `agent-core` 工具调用事件流。
- 设计参考：`different-ai/openwork` PRODUCT.md、ARCHITECTURE.md、VISION.md、PRINCIPLES.md（2026-03-18 版本）。
- Memory sync: completed
