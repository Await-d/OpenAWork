# 资源能力用途契约

本文件固定 `/resources` catalog 中 `visibility`、`feature`、`usageKind` 三个字段的语义，避免 Skill、Agent、MCP、Commands、Prompts、Team Templates、Channel Persona 在前端或运行时被混合展示与误触发。

## 字段语义

| 字段         | 取值                                                                                                                                         | 说明                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `visibility` | `catalog`                                                                                                                                    | 可进入资源中心主目录，适合统一浏览、检索、启停或跳转到既有管理页。                    |
| `visibility` | `feature`                                                                                                                                    | 功能专用资源，不进入主目录混排，只由对应功能页或运行时按 `feature / usageKind` 读取。 |
| `feature`    | `skills` / `agents` / `mcps` / `extensions` / `channels` / `team` / `commands` / `prompts`                                                   | 资源所属功能域。前端功能页必须先按此字段过滤。                                        |
| `usageKind`  | `skill` / `agent` / `mcp-server` / `extension-example` / `channel-persona` / `agent-template` / `command-definition` / `runtime-instruction` | 资源在该功能域内的用途。运行时触发必须按此字段决定，不能只看目录名或 title。          |

## Area 默认映射

`packages/web-client/src/session/resources.ts` 导出的 `RESOURCE_USAGE_DEFAULTS` 是浏览器端的单一客户端契约。后端响应缺少用途字段时，客户端按此表回填；功能页也应复用此契约而不是重新写一份映射。

| Catalog area     | visibility | feature      | usageKind             | 使用边界                                                                     |
| ---------------- | ---------- | ------------ | --------------------- | ---------------------------------------------------------------------------- |
| `skills`         | `catalog`  | `skills`     | `skill`               | Skill 管理与 registry 对齐，不从资源中心直接执行。                           |
| `agents`         | `catalog`  | `agents`     | `agent`               | Agent catalog、Team 成员候选、只读预览。                                     |
| `mcps`           | `catalog`  | `mcps`       | `mcp-server`          | MCP 设置页与 server runtime 对齐，避免第二套 MCP 管理。                      |
| `extensions`     | `catalog`  | `extensions` | `extension-example`   | Extension 示例和后续安装模板。                                               |
| `agentTemplates` | `feature`  | `team`       | `agent-template`      | Team / workspace 初始化材料，写入 workspace knowledge，不混入普通 Agent。    |
| `souls`          | `feature`  | `channels`   | `channel-persona`     | Channel 通道人设，写入 channel config / session metadata，不进入 Team 模板。 |
| `commands`       | `feature`  | `commands`   | `command-definition`  | 命令描述与模板；可执行动作仍必须命中 gateway allowlist。                     |
| `prompts`        | `feature`  | `prompts`    | `runtime-instruction` | 运行时提示词片段；只由明确功能选择性注入。                                   |

## 后端规则

- `GET /resources` 返回完整 catalog，包括 `feature` 资源；后端不能为了资源中心 UI 裁剪 `souls`、`agentTemplates`、`commands`、`prompts`。
- 资源中心主目录如需轻量目录面，只能使用过滤后的视图；运行时功能读取必须以完整 catalog 为准。
- `POST /resources/uploads` 只信任 `area`，后台根据 area 派生 `visibility / feature / usageKind`，不得信任前端传入用途字段。
- 上传、删除后返回合并后的完整 catalog，前端以返回结果刷新，保证无需重载即可实时识别。

## 前端规则

- `apps/web` 访问资源必须通过 `@openAwork/web-client` 的 `createResourcesClient()`，不能裸 `fetch()` 调 gateway。
- 资源中心主目录只展示 `visibility === 'catalog'`。
- 功能专用资源区展示 `visibility === 'feature'`，并明确显示 `feature` 与 `usageKind`。
- Channels 页面只读取 `feature === 'channels' && usageKind === 'channel-persona'`。
- Team 新建工作区只读取 `feature === 'team' && usageKind === 'agent-template'`。
- Commands / Prompts 后续接入时只能作为描述、模板或上下文材料，不能因为资源存在就注册为可执行动作。

## 运行时隔离

| Resource kind  | 运行时边界                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| Skill          | 由 Skill registry 的安装态、启停态和 sandbox 权限决定。                    |
| Agent          | 作为 persona / role definition 输入，不自动扩大 tool 权限。                |
| MCP            | 由 MCP runtime、serverId、OAuth 和 session visibility 决定。               |
| Command        | 由 gateway command allowlist、workspace permission 和 session owner 决定。 |
| Prompt         | 由具体功能按 `runtime-instruction` 显式选择性注入。                        |
| Soul           | 按 channel instance 与用户上传资源隔离。                                   |
| Agent template | 按 workspace snapshot / knowledge 隔离。                                   |
