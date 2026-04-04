# T-02 Artifact 实时预览实施

## Task Overview
基于既有 `T-02-artifact实时预览` 方案，将 OpenAWork 当前仅支持附件上传/简单列表/静态预览的旧 artifact 壳升级为真正的 Artifact 实时预览 + 可编辑产物系统，交付统一数据模型、版本化持久化、可渲染预览、编辑保存与会话级展示闭环。

## Current Analysis
- 当前 `packages/artifacts` 仍是旧的 `RunArtifact` / `file_created|file_modified|document|log|summary` 模型，不具备类型检测、版本化或编辑能力。
- 当前 gateway `routes/artifacts.ts` 只有 `/sessions/:sessionId/artifacts` 列表与上传两条接口，底层依赖 index-file 的 `ArtifactManagerImpl`，并没有 SQLite artifact 主表或版本表。
- 当前 Web `ArtifactsPage.tsx` 不是在展示真实 artifact，而是在拉取 `sessions` 后伪装为 artifact 列表；`ArtifactPreview` / `ArtifactList` 也只是静态 text/image/file 预览壳。
- 当前聊天页只是在上传附件后把 `artifact:id` 文本拼入消息摘要，并没有 stream 级 artifact 提取、实时预览或编辑回写。

## Solution Design
- packages/artifacts：收敛为 T-02 的共享 artifact 类型、检测逻辑、版本化 store 合同与预览/编辑辅助函数。
- gateway：新增 `artifacts` / `artifact_versions` SQLite 真相表，替换旧 index-file manager；扩展 artifact CRUD / versions / revert / session list 接口，并接入 stream 产物提取。
- web/shared-ui：把旧 `ArtifactList` / `ArtifactPreview` 升级为真实 artifact viewer/editor 组件，`ArtifactsPage` 改为展示真实 artifact；聊天页增加会话级 artifact 面板入口。
- 验证：覆盖类型检测、store 版本化、路由、会话关联、Web 列表与预览/编辑 UI，以及至少一条真实手动 QA 链。

## Complexity Assessment
- 原子步骤：8 个核心实施步骤（共享合同 / DB / routes / stream / shared-ui / web page / chat integration / 验证） → +2
- 并行流：数据层与前端展示层在合同冻结后可并行 → +2
- 模块/系统/服务：packages/artifacts + shared-ui + services/agent-gateway + apps/web + chat page → +1
- 单步 >5min：数据迁移、流式提取和 UI 集成均超过 5 分钟 → +1
- 持久化审查产物：需写入 `.agentdocs` 工作流与运行时计划 → +1
- OpenCode 可用：→ -1
- **总分：6**
- **选定模式：Full orchestration**
- **路由理由：T-02 涉及跨包数据模型重构、后端持久化、流式链路与前端预览编辑闭环，必须先冻结计划并持续同步状态。**

## Success Criteria
- Artifact 具备真实主表与版本表，能按会话列出、按 id 获取、更新并生成版本、查看历史并回滚。
- Web 端能展示真实 artifact 列表与预览，不再把 session 伪装成 artifact。
- 至少一种核心可预览类型可在 Web 中实时渲染，并支持编辑保存后刷新版本。
- 聊天/会话链路中能看到与当前会话关联的真实 artifact，而不是仅有 `artifact:id` 文本引用。
- 相关类型检查、测试、构建、手动 QA 均有通过证据。

## Test Plan
- 单测：artifact type 检测、store create/update/version/revert、预览辅助逻辑。
- gateway 集成：artifact create/get/list/update/versions/revert/session-list。
- web 测试：ArtifactsPage 真列表/预览/空态/错误态，编辑保存交互。
- 构建验证：受影响包测试 + `@openAwork/web build` + `@openAwork/agent-gateway build` + `@openAwork/artifacts` / `shared-ui` 构建。
- 手动 QA：真实创建 artifact → 在 Web 页面与会话入口看到列表/预览/编辑效果。

## Implementation Plan

### Phase 1: 合同与持久化
- [ ] T-02-1: 冻结共享 artifact 合同与类型检测策略
- [ ] T-02-2: 在 gateway 建立 artifacts / artifact_versions SQLite 真相表与 store
- [ ] T-02-3: 用新 store 替换旧 index-file artifact manager 路由

### Phase 2: 预览与会话接入
- [ ] T-02-4: 升级 shared-ui ArtifactList / ArtifactPreview 与类型分发
- [ ] T-02-5: 重写 ArtifactsPage 为真实 artifact 列表/预览页
- [ ] T-02-6: 将聊天页接到真实会话 artifact 列表入口

### Phase 3: 编辑、版本与验证
- [ ] T-02-7: 接入 artifact 编辑保存、版本历史与回滚最小闭环
- [ ] T-02-8: 补齐测试、构建和手动 QA 证据
- [ ] T-02-9: 完成 Oracle 审阅并同步 agentdocs 状态

## Notes
- 当前正式实施从旧 artifact 壳迁移开始，不以保留 `RunArtifact` 旧模型为目标。
- 若 Metis 返回更清晰的执行波次，应以 repo-grounded 的计划结果回填本工作流。
- Memory sync: pending
