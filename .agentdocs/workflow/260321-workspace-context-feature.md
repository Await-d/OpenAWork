# 工作区上下文对话功能设计方案

## 任务概述

为 OpenAWork 实现「工作区」概念：用户可以将一个文件夹绑定到会话，Agent 对话时能感知该目录的文件结构与内容，实现真正的代码/文件上下文对话。

## 复杂度评估

| 维度 | 信号 | 得分 |
|------|------|------|
| 原子步骤数 | 10+ 步 | +2 |
| 并行流 | 前端/后端/core 可并行 | +2 |
| 涉及模块数 | 4个（gateway/agent-core/shared-ui/web） | +1 |
| 单步 >5min | 是 | +1 |
| 需持久化产物 | 是 | +1 |
| OpenCode 可用 | 是 | -1 |
| **合计** | | **+6** |

**选定模式：Full orchestration**  
**理由**：跨越 4 个包的端到端功能，涵盖数据库迁移、后端路由、上下文注入、前端 UI，必须全流程协调。

---

## 现状分析

### 已有但未串联的基础设施

| 组件 | 路径 | 状态 |
|------|------|------|
| `ContextManagerImpl` | `packages/agent-core/src/context/manager.ts` | 已实现，支持 `addFile(path)`、`buildContextBlock()` |
| `FileBrowserAPIImpl` | `packages/agent-core/src/filesystem/file-browser-api.ts` | 支持文件搜索、文本搜索、git status |
| `CrushIgnoreManager` | `packages/agent-core/src/crush-ignore/index.ts` | 读取 `.crushignore` 文件排除规则 |
| `FolderAuthorizationManager` | `packages/agent-core/src/onboarding/folder-authorization-manager.ts` | 目录访问权限控制 |
| `ContextPanel` | `packages/shared-ui/src/ContextPanel.tsx` | UI 已实现，传空数组占位 |
| `FileTreePanel` | `packages/shared-ui/src/FileTreePanel.tsx` | UI 已实现，传空数组占位 |
| `FileSearch` | `packages/shared-ui/src/FileSearch.tsx` | UI 已实现，onSearch 返回空 |
| `ConversationSession.metadata` | `packages/agent-core/src/types.ts` | `Record<string, unknown>`，可扩展 |
| `sessions.metadata_json` | `services/agent-gateway/src/db.ts` | 已存储，未用于工作区 |

### 核心缺口

1. `stream.ts` 发给 LLM 的请求没有注入任何文件/目录上下文
2. `Layout.tsx` 右侧面板组件全部传空数据，未连接真实 API
3. 会话 `metadata` 无 `workingDirectory` 字段，会话不记得绑定的文件夹
4. 前端无目录选择入口（Web 端需要通过 API 选择，桌面端可用 Tauri 原生 dialog）
5. 网关无文件系统 API 路由，前端无法查询目录树

---

## 设计方案

### 核心架构决策

**工作区是「会话级」概念**：每个会话可绑定 0 或 1 个工作区路径，存储在 `sessions.metadata_json` 的 `workingDirectory` 字段。工作区路径在服务端验证，不允许任意路径穿越。

**上下文注入策略**：流式请求时，网关从会话 metadata 取出 `workingDirectory`，通过 `FileBrowserAPI` 生成目录摘要（文件树 + 关键文件内容），注入 system prompt。文件内容按 token 限制截断（默认 32k tokens）。

**安全边界**：服务端限制工作区路径只能是配置的 `WORKSPACE_ROOT` 下的子目录，防止路径穿越攻击。

---

## 实现计划

### Phase 1：数据层（后端 DB + API）

- [x] T-01 ✅：`sessions` 表 metadata_json 字段已支持 workingDirectory（无需新增 workspaces 表）
- [x] T-02 ✅：`POST /sessions` 已支持 `workingDirectory` 字段写入 metadata
- [x] T-03 ✅：`PATCH /sessions/:id/workspace` 端点已实现（sessions.ts:188-231）
- [x] T-04 ✅：`GET /workspace/tree?path=` 已实现（workspace.ts，含深度控制+路径安全校验+忽略规则）
- [x] T-05 ✅：`GET /workspace/file?path=` 已实现（workspace.ts，100KB 截断保护）
- [x] T-06 ✅：`stream.ts` `buildWorkspaceContext()` 已注入工作区文件树到 system prompt

### Phase 2：共享 UI 组件扩展

- [x] T-07 ✅：`WorkspaceSelector` 组件已存在于 shared-ui（154行，含路径输入+验证状态）
- [ ] T-08 ⚠️：`FileSearch.onSearch` 仍为 `async () => []` 空函数，未接入真实搜索 API（见 FIX-07b）

### Phase 3：前端接入（Web）

- [x] T-09 ✅：`ChatPage` 已有 `WorkspacePickerModal` + `useWorkspace` hook，顶部工具栏有工作区指示器
- [x] T-10 ✅：`Layout.tsx` `FileTreePanel` 已连接真实 `treeNodes`（来自 `workspace.fetchTree`）
- [x] T-11 ✅：`Layout.tsx` `FileSearch.onSearch` 已接入真实搜索（`workspace.searchFiles` → `GET /workspace/search`），Gateway 端点已实现
- [x] T-12 ✅：`ContextPanel` 已根据 `workspace.workingDirectory` 动态显示上下文条目
- [x] T-13 ✅：`WorkspacePickerModal` 已实现，新建会话后可选择工作区

### Phase 4：桌面端适配

- [ ] T-14 🟡：`apps/desktop` 使用 Tauri `dialog.open` 原生文件夹选择（P3，待实现）

---

## 关键接口设计

### session metadata 结构
```typescript
interface SessionMetadata {
  workingDirectory?: string;  // 绝对路径，e.g. "/home/user/my-project"
  contextItems?: Array<{      // 用户手动添加的上下文条目
    path: string;
    pinned: boolean;
  }>;
}
```

### PATCH /sessions/:id/workspace
```typescript
// Request
{ workingDirectory: string | null }
// Response
{ ok: true, workingDirectory: string | null }
```

### GET /workspace/tree
```typescript
// Query: ?path=/abs/path&depth=3
// Response: { nodes: FileTreeNode[] }
```

### system prompt 注入格式
```
<workspace path="/home/user/project">
<file_tree>
src/
  index.ts
  pages/
    ChatPage.tsx
</file_tree>
<key_files>
<file path="src/index.ts">
[文件内容，超长则截断]
</file>
</key_files>
</workspace>
```

---

## 风险与注意事项

1. **路径安全**：网关必须校验请求路径在 `WORKSPACE_ROOT` 内，防止 `../../etc/passwd` 攻击
2. **Token 超限**：目录可能很大，需要 token budget 控制，超出时优先保留文件树，截断文件内容
3. **Web vs 桌面**：Web 端无法用系统文件 dialog，需要路径文本输入 + 服务端验证；桌面端用 Tauri dialog
4. **实时性**：当前方案每次请求重新读取文件树，适合中小项目；大项目考虑缓存
5. **`.crushignore`**：文件树生成时通过 `CrushIgnoreManager` 过滤敏感文件

---

## 备注

- `FileTreePanel` 现有组件设计为展示 git 变更（status 字段），工作区文件树需要单独的展示模式
- `ContextPanel` 可直接复用，用于展示「当前注入到 LLM 的上下文条目」
- 桌面端 Tauri sidecar（agent-gateway 二进制）运行在本地，文件系统访问天然安全；Web 端需要额外的路径白名单配置
