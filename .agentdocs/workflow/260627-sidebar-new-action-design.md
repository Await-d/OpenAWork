# AppSidebar 新建功能联动设计

> 创建时间：2026-06-27
> 状态：**待确认**

## 1. 问题分析

当前有 3 种创建操作，它们的数据来源和创建方式完全不同：

| 操作 | 数据来源 | 创建方式 | 创建后展示 |
|------|----------|----------|-----------|
| 新建对话 | `useSessions().newSession(workspacePath?)` | 调用 `createSessionsClient().create(token, {metadata})` | 跳转 `/chat/{sessionId}` |
| 新建团队会话 | `TeamPageV2` 内 `data.createSession(draft)` + `NewTeamSessionModal` 弹窗 | 调用 `teamClient.createSession(token, wsId, payload)` | 在 TeamPageV2 内选中展示 |
| 新建团队工作区 | `TeamPageV2` 内 `NewTeamWorkspaceModal` 弹窗 | 调用 team workspace API | 跳转 `/team/{newWorkspaceId}` |

### 核心矛盾

- **新建对话**：可以在 AppSidebar 中直接完成（`useSessions` hook 已在 AppSidebar 中使用）
- **新建团队会话**：**不能**在 AppSidebar 中直接完成，因为 `NewTeamSessionModal` 依赖 `TeamRuntimeReferenceDataProvider` context（模板列表、角色绑定等），这个 context 只在 TeamPageV2 内部建立
- **新建团队工作区**：同样依赖 TeamPageV2 内部的 context

### 当前实现的问题

1. 顶部三个按钮中，"团队"和"工作区"按钮只是跳转到 TeamPageV2 + URL 参数触发弹窗
2. 跳转链路有问题：`/team` → 自动重定向到 `/team/{firstId}` → 可能丢失 `?action=new` 参数（已修复保留 query string）
3. 如果没有团队工作区，"新建团队会话"按钮跳转 `?action=newWorkspace`，但用户可能期望直接创建会话而非工作区
4. "对话工作区选择"按钮（文件夹图标）与三个按钮不协调

## 2. 重新设计方案

### 2.1 顶部按钮区域

保留三个按钮，但明确每个按钮的完整链路：

```
┌──────────┬──────────┬──────────┐
│ + 对话   │ + 团队   │ + 工作区  │
└──────────┴──────────┴──────────┘
```

### 2.2 每个按钮的完整行为

#### 按钮1：新建对话

- **直接在 AppSidebar 中创建**，不需要跳转
- 调用 `useSessions().newSession()`（已在 AppSidebar 中使用此 hook）
- 创建成功后自动 `navigate('/chat/{sessionId}')`（`newSession` 内部已实现跳转）
- 如果用户想选择工作目录再创建，使用旁边的文件夹按钮打开 `WorkspacePickerModal`，选择路径后再点"新建对话"

#### 按钮2：新建团队会话

- **跳转到 TeamPageV2** 触发创建弹窗（因为 `NewTeamSessionModal` 依赖 TeamPageV2 的 context）
- 判断逻辑：
  - 有团队工作区（`teamWorkspaces.length > 0`）→ `navigate('/team/{teamWorkspaces[0].id}?action=new')`
  - 无团队工作区 → `navigate('/team?action=newWorkspace')`（先创建工作区，工作区创建完成后再让用户创建会话）
- TeamPageV2 检测 `?action=new` → 打开 `NewTeamSessionModal` 弹窗
- TeamPageV2 检测 `?action=newWorkspace` → 打开 `NewTeamWorkspaceModal` 弹窗

#### 按钮3：新建团队工作区

- **跳转到 TeamPageV2** 触发创建弹窗
- `navigate('/team?action=newWorkspace')`
- TeamPageV2 检测 `?action=newWorkspace` → 打开 `NewTeamWorkspaceModal` 弹窗
- 创建完成后 `onCreated` 回调 → `navigate('/team/{newWorkspaceId}')`

### 2.3 对话工作区选择按钮

保留在顶部按钮区域旁边（文件夹图标），与三个创建按钮分开：
- 点击打开 `WorkspacePickerModal`（文件系统路径选择器）
- 选择路径后设置 `selectedWorkspacePath` / `fileTreeRootPath`
- 之后点"新建对话"时，`newSession(workspacePath)` 会携带该路径

### 2.4 团队工作空间标题行

移除所有操作按钮，只保留标题和数量。所有创建操作统一由顶部三个按钮处理。

### 2.5 TeamPageV2 侧的改动

1. `?action=new` → 打开 `NewTeamSessionModal`（已实现）
2. `?action=newWorkspace` → 打开 `NewTeamWorkspaceModal`（已实现）
3. 自动重定向 `/team` → `/team/{firstId}` 时保留 query string（已实现）
4. `NewTeamSessionModal` 在页面底部独立渲染（已实现）
5. `NewTeamWorkspaceModal` 在页面底部独立渲染（已实现）

### 2.6 创建完成后的联动

| 操作 | 创建完成后的行为 |
|------|-----------------|
| 新建对话 | `newSession` 内部 `navigate('/chat/{sessionId}')` + `fetchSessions()` 刷新列表 |
| 新建团队会话 | TeamPageV2 内 `selectTeamInternal(createdSessionId)` 选中 + `refreshWorkspaceSnapshot()` 刷新 + AppSidebar 的 `useTeamSidebarSessions` 通过 `subscribeSessionListRefresh` 自动刷新 |
| 新建团队工作区 | TeamPageV2 内 `workspaceState.refresh()` + `navigate('/team/{newWorkspaceId}')` + AppSidebar 的 `useTeamSidebarSessions` 自动刷新（工作区列表变化时） |

### 2.7 刷新联动

AppSidebar 中 `useSessions()` 和 `useTeamSidebarSessions()` 都监听 `subscribeSessionListRefresh` 事件。当 TeamPageV2 中创建/删除会话后调用 `requestSessionListRefresh()`，AppSidebar 的两个列表都会自动刷新。

需要确认：TeamPageV2 的 `handleSubmitDraft` 和 `handleDeleteSession` 是否调用了 `requestSessionListRefresh()`。如果没有，需要补上。

## 3. 最终顶部布局

```
┌──────────┬──────────┬──────────┐ ┌──┐
│ + 对话   │ + 团队   │ + 工作区  │ │📁│
└──────────┴──────────┴──────────┘ └──┘
 ↑ 三个创建按钮，accent色并排    ↑ 工作区选择(文件系统路径)
```

- 三个创建按钮：`accent` 背景、白色文字、并排无间隙
- 工作区选择按钮：独立按钮，`var(--bg-overlay)` 背景、`var(--border-default)` 边框

## 4. 需要确认的问题

1. TeamPageV2 的 `handleSubmitDraft` 创建团队会话成功后，是否调用了 `requestSessionListRefresh()` 通知 AppSidebar 刷新？
2. `NewTeamWorkspaceModal` 的 `onCreated` 回调中，是否需要通知 AppSidebar 刷新工作区列表？目前只调了 `workspaceState.refresh()`（TeamPageV2 本地刷新），AppSidebar 的 `useTeamSidebarSessions` 不会自动感知。
3. "新建对话"按钮是否应该直接创建会话（调 `newSession()`），还是保持跳转到 `/chat` 欢迎页等用户输入？
