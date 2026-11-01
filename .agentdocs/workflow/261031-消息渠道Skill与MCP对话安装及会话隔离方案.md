# 消息渠道 Skill / MCP 对话安装与会话隔离实施方案

## Task Overview

- 任务 ID：`261031-消息渠道Skill与MCP对话安装及会话隔离方案`；日期：2026-10-31。
- 状态：方案已编制，待用户批准实施；本次只交付文档，不修改业务代码、不安装第三方扩展。
- 目标：用户在消息渠道提出安装需求，经明确确认后，仅为当前会话增加 Skill / MCP；其他会话、用户级配置不受影响。
- 默认隔离单位：沿用当前渠道实例 + chatId 对应的 session；群内共享，不宣称按成员或话题隔离。
- 交付范围：会话资源存储、统一有效配置解析、独立 MCP 连接与凭据授权、对话管理工具、审批、客户端确认页及验收。
- 本文中的新表、接口、字段和模块均为拟议契约，实施前须与现有迁移机制对齐；不是已实现能力。

## Current Analysis

| 当前事实 | 代码依据（网关路径相对 `services/agent-gateway/src/`） | 影响 |
| --- | --- | --- |
| 管理工具已存在，但 channel/cron/team 禁用 | `session/session-tool-visibility.ts`、`skill/skill-admin-tools.ts`、`mcp/mcp-admin-tools.ts` | 不应再造平行安装工具，也不能直接删除守卫 |
| Skill 用户级安装，会话仅选择覆盖 | `skill/skill-installed-store.ts`、`skill/skill-selection.ts`、`routes/skill-selection.ts` | 用户级安装可能影响其他会话，选择不等于独立版本 |
| MCP session resolver 实际读取 owner 的用户配置 | `mcp/mcp-runtime.ts:124-156` | 没有独立会话配置 |
| 连接与目录按用户身份共享 | `skill/skill-mcp-connection-pool.ts`、`mcp/mcp-tool-catalog.ts` | 仅修改工具列表不能隔离进程状态 |
| 渠道普通工具可能自动批准 | `tools/sandbox/permission-ladder.ts:487-523` | 管理变更必须独立于自动批准与永久授权 |
| 群共享 session，本轮权限由 AsyncLocalStorage 固定 | `channels/channel-actor-scope.ts` | 审批续跑不可回退到最后发言人的共享 metadata |
| 内置 Skill 多为 prompt 内容；当前安装主要登记 manifest | `packages/skills/src/builtins.ts`、`routes/skills.ts` | 不得承诺完整脚本及依赖已部署 |
| pin 快照只固定 ID；内嵌 MCP 仍按用户技能查找 | `skill/pinned-skills-prompt.ts`、`skill/skill-mcp-connection-pool.ts` | 须纳入版本化资源与统一授权链 |

相关历史方案：`done/260924-技能管理工具.md`、`done/260924-MCP自助管理工具.md`。工作区已有大量其他在途改动，实施前须重新核对热点文件；不覆盖、不回滚其他任务。

## Solution Design

### 1. 产品与授权边界

- 渠道管理工具默认关闭；由 owner 在渠道配置中显式开启 `sessionExtensionManagement`，普通 `tools.mcp` 不授予安装权限。
- 开启后渠道只允许 `scope=session`；管理 sessionId、owner、actor、channel、chat 全由服务端可信上下文解析，模型不得指定任意目标。
- 个人会话保留历史缺省 `scope=user` 的行为与审批；显式 `scope=session` 使用新流程。team/cron 继续禁止管理；渠道派生子代理只读继承。
- 新渠道开启本能力时使用 `explicit` 扩展策略；启用界面展示哪些旧能力将不再继承，确认前不切换。
- 老会话没有策略字段时保留旧行为；不得把缺失字段自动解释为新渠道的全量继承。
- 群会话扩展对有使用权限的群成员共享；成员 ACL 仍逐轮取交集。按 sender/topic 建新会话为独立后续需求，不在本期悄悄改变历史路由。
- 会话隔离指配置、授权、版本、MCP 客户端/进程状态隔离，不等于 OS 文件系统/网络沙箱，也不能隔离远端服务共享账号的数据。

### 2. 会话资源真相源与有效配置

- 新增 `session_extension_settings`：owner/session、`policyVersion`、`inherit|explicit`、单调 revision；显式空集合表示不继承任何可选扩展。
- 新增 `session_skill_installations`：owner/session/resourceRef、原 skillId、来源、固定版本、manifest/正文快照、contentDigest、enabled/pinned、revision。
- 新增 `session_mcp_servers`：owner/session/resourceRef、展示 ID、规范化配置、secretRef、enabled、disabledTools、revision；与用户同名也不隐式覆盖。
- 会话绑定已有用户扩展时复制获准配置/技能快照，不自动随用户升级；不能复制未授权凭据。用户硬撤权高于会话绑定和 pin。
- FK 级联覆盖标准删除及恢复删除路径；所有读写校验 session ownership，按 session+resourceRef 唯一约束并使用 expectedRevision 防并发覆盖。
- 新会话扩展解析器统一供提示词、技能加载、MCP list/call/flat 工具、retry、OAuth、状态接口使用；同轮使用同一 revision 快照。
- effective 集合为会话策略、渠道策略、原始 actor 权限、上游用户硬禁用的交集；无授权上下文时拒绝，不回退 owner 全量能力。
- 内置资源单独声明 `requiredSystemResources`；仅保留经审计的必要项，不能因 `source=system` 绕过 explicit 白名单；模型不得替换内置端点。
- 旧 `requestedMcpServers` 仅兼容旧路径；新策略明确区分未配置与 `[]`，不沿用“空即不限制”。

### 3. 安装、启用与动态生效

- 扩展既有 `skill_manage`：新增 session scope 的 search/inspect/install/list/uninstall/enable/disable；用户 scope 保留旧动作契约。
- session 安装调用独立共享服务，HTTP 与 agent tool 同源；禁止先写用户 `installed_skills` 再靠会话 override 遮掩。
- 首期支持已配置且受信任注册源的 prompt/manifest 型技能，安装前检查来源、内容、权限与内嵌 MCP，审批绑定检查后的实际 digest。
- 任意 GitHub 仓库完整部署、脚本依赖安装、自动运行安装脚本不在首期；发现需要这些能力时返回明确不支持与管理页指引。
- 复用既有内置技能说明，补能力目录中的管理提示；不新增有特权的“安装器 Skill”，不让提示词内容代替授权。
- 内嵌 MCP 绑定 skill resourceRef + contentDigest，经与普通 MCP 相同的白名单/凭据/执行检查；禁用技能同时撤销其 MCP，禁止同名用户 MCP 回退。
- pin 新格式固定 resourceRef/contentDigest/revision；保留旧快照兼容，区分缺失/显式空；撤权优先于 pin。
- 新增/普通编辑下一轮生效，结果明确 `effectiveFrom=next_turn`；当前模型工具数组不热替换。禁用、删除、撤权立即阻止新调用。

### 4. MCP 实例、凭据与生命周期

- MCP 管理复用 `mcp_manage_servers` 的动作与配置 schema；新增 session scope 的 inspect/preview、读写与探活服务，不调用用户级全量 PUT。
- SSE 连接及 stdio 均只采用现支持的 transport；不顺带引入未经核实的新协议。新增 stdio 需独立开关，默认关闭。
- stdio 开启前明确提示宿主执行风险；采用允许的命令/包来源与固定版本，校验 cwd，最小环境变量，禁止默认继承网关敏感环境。
- 连接、catalog、刷新去重、推送、OAuth 身份统一为 owner/session/resourceRef/configDigest/credentialRevision；保留用户旧命名空间。
- configDigest 规范化生成，不回显敏感值；内存缓存键不得直接暴露原始 token。secretRef 逐次验证归属，不让模型在聊天中填写密钥。
- OAuth state/PKCE 绑定上述身份、配置 revision、TTL 与单次消费；回调重验资源和授权。首期需新建会话 grant，缺少安全复用能力时不自动借用用户 grant。
- token 轮换、退出授权、删除会话清理仅作用于对应 grant；共享用户凭据只能显式引用且明确撤销范围。
- 调用前及重连前再次验证 revision/授权；非幂等 MCP 调用不得因断线自动重放，取消不能声称远端副作用已回滚。
- generation/tombstone 阻止已删除资源被迟到 connect/目录刷新复活；取消 pending connect/retry，释放监听与 stdio 子进程。
- 活跃调用计数参与清理，避免 idle 回收长任务；删除后异步幂等清理可重试，失败记录待清理，不将配置重新放回有效集合。
- 配置已保存但探活失败返回 `configured_unavailable`，不得宣告可用；安装超时、用户取消、进程重启都有可恢复终态。

### 5. 渠道确认与操作状态机

- 新增持久化 `session_extension_operations`：operationId、owner/session、channel/chat、原 requester、action/resourceRef、configDigest、expectedRevision、TTL、nonce、幂等键、审批者、状态、脱敏错误。
- 状态：pending_approval → approved → applying → succeeded / configured_unavailable / failed；并提供 rejected/expired/cancelled。审批不等于安装成功。
- 首期渠道回复“来源、版本、风险、仅当前会话、确认链接”；链接不是 bearer 授权，访问必须登录。审批要求 owner 且在独立管理员清单，无匹配者拒绝并指引配置。
- 管理员清单由 owner 设置页维护，平台 senderId 不自动映射网关用户；普通工具白名单与群内自然语言“同意”均不算批准。
- 原生渠道按钮留作后续适配：平台签名校验、可信 actor 映射、事件去重到位后才开放；当前期无需先实现全部渠道卡片。
- 独立授权门在所有普通 allow/yolo/channel-policy/永久允许之前生效，显式 deny 仍优先；模型、子代理、父代理自动决策均不能消费管理员确认。
- 审批以 CAS 原子单次消费，复核 TTL、当前管理员/actor 权限、配置 digest/revision；内容变化必须重新确认，不能审批 A 执行 B。
- 原请求者与审批者分离；恢复执行从操作记录重建可信来源链，不从群共享 metadata 读取“最后一个人”。
- 操作不参加普通权限 category/scope 合并及级联同意/拒绝；拒绝一个安装不得误伤群内其他 pending 请求。
- 持久化操作本身是恢复真相源；提交后写 durable 结果投递记录，按 operationId 去重，复用渠道出站通道。通知失败不重复安装。
- 不要求整个聊天会话长时间 paused；复用现权限卡展示结构，但写入与结果查询走独立操作接口，减少旧 permission-resume 语义耦合。

### 6. 拟议接口与客户端

所有新接口均需 JWT + ownership；审批额外查独立管理员授权。URL 不能代替鉴权。

| 接口 | 契约 |
| --- | --- |
| `GET /sessions/:id/extensions` | effective 集合、来源、策略、revision、脱敏可用状态 |
| `PATCH /sessions/:id/extensions` | 选择/继承策略，expectedRevision；直接 API 变更也必须通过同一授权服务 |
| `POST /sessions/:id/extension-operations` | kind/action/目标配置或来源/expectedRevision/idempotencyKey；创建提案，不直接执行 |
| `GET /sessions/:id/extension-operations/:operationId` | 操作及安全预览，不返回 env/header/token |
| `POST /sessions/:id/extension-operations/:operationId/decision` | approve/reject + nonce，原子确认；不接受 session/permanent/alwaysOverride |
| `POST /sessions/:id/extension-operations/:operationId/cancel` | 取消待执行操作；执行中只提供 best-effort 取消及真实结果 |

**实现补充（2026-11-01，第十一轮同步）**：落地时另加了下面几条，原清单未列，特此补齐以免「规格说 6 个接口、代码里有 9 条」这种对不上账的情况：

| 接口 | 契约 | 为什么需要 |
| --- | --- | --- |
| `POST /sessions/:id/extensions/revoke` | 禁用 / 移除一条会话条目（**只收窄**） | 面板需要收窄入口；启用等于扩权，必须重新走提案确认，所以不提供「一键启用」 |
| `PUT /sessions/:id/extension-secrets/:name` | 录入 / 轮换会话凭据（**仅 owner**，明文只上行、响应不回显） | 会话级 MCP 的 `secretRef` 需要来源；放在提案链路之外，避免密钥进入 `payload_json` 审计 |
| `DELETE /sessions/:id/extension-secrets/:name` | 删除会话凭据 | 同上 |
| `GET/POST/DELETE /settings/session-extension-admins` | 独立管理员清单的读写 | 审批资格需要 owner 显式委派；清单本身是敏感配置，必须走鉴权接口而非配置文件 |

- 搜索/检查复用共享查询层，先权限过滤再返回；所有写入口（含 PATCH 策略、凭据、重试启动）按动作风险走同一授权服务，禁止 HTTP 绕过确认。
- 在 `packages/web-client/src/` 增加客户端并从 `index.ts` 导出，apps 内不直连网关；旧用户级接口语义保持不变。
- Web 增确认页与会话扩展列表，展示共享范围、来源、版本、风险、等待/拒绝/过期/不可用状态；密钥由已登录用户安全填写，不回流模型。
- 桌面复用 Web 页面；移动端首期用受支持的登录 Web 确认链接，必须真机验证可达，不宣称已有原生配置 UI。

## Complexity Assessment

- Atomic steps：5+ → +2；本方案细化为 24 个实施任务。
- Parallel streams：Skill / MCP / 渠道授权可在共同契约完成后独立开发 → +2。
- Modules/systems/services：存储、Skill、MCP、权限/渠道、客户端/UI（5+）→ +1。
- Long step (>5 min)：存在存储迁移与跨层接线 → +1。
- Persisted review artifacts：需要持久化评审与执行记录 → +1。
- OpenCode available：否，当前 CodeBuddy → +0。
- **Total score**：7；**Chosen mode**：Full orchestration。
- **Routing rationale**：安全敏感且跨模块，保留 workflow + runtime；本次串行汇总方案，未来按依赖并行实施，热点文件协调者串行合并。

## Implementation Plan

### 2026-11-01 接线复核更正（优先于下方历史统计）

- 已修复：模型实际 JSON Schema 缺少 `scope/resourceRef/search/query`；渠道显式开关未接配置与会话 metadata；MCP 查询/目录仍绕回用户配置；nonce 仅落库未校验；委托管理员被 owner-only HTTP 守卫挡住。
- 当前 nonce 仅在鉴权后的有效 pending 详情返回（`Cache-Control: no-store`），批准与拒绝 SQL CAS 同时匹配 nonce、会话、操作、有效期和 pending 状态。提案、链接、决策响应不返回凭证。委托管理员仅能读详情/决策，其他写接口仍 owner-only。
- 最新验证：网关 16 文件 / 218 用例；确认页 10 用例；客户端 6 用例；三个包完整 typecheck 退出码均 0；本轮 lint 通过。测试记录 `runtime/.../nonce-final.log`，`TEST_EXIT=0`。
- 撤回历史“23 项完成/端到端闭环”的描述：T-09 的删除/撤权回收接线、T-13 的真实探活/启动恢复/结果投递、T-18 主动通知、T-17 完整面板和凭据表单仍未交付；T-21 真实渠道与浏览器验收未执行。下方此前测试计数为历史批次记录，不能当作当前全量门禁。

### 2026-11-01 代码复查（两轴）与修复（优先于下方历史状态）

对未提交改动做 Standards + Spec 两轴复查，查出 4 条规范类 + 5 条方案类问题，**本轮已修复 9 项**：

| # | 问题（复查结论） | 修复 |
| --- | --- | --- |
| 1 | stdio 最小环境在 adapter 层被 `{...process.env, ...server.env}` 合并回去，子进程仍拿网关凭据 | 新增 `inheritEnv` 显式语义并传至 SDK transport；`packages/mcp-client` 产物重建；新增 `src/stdio-environment.test.ts` 在真实 transport 构造边界断言（隔离 / 用户级继承各 1 例） |
| 2 | 密钥剥离只看顶层字段，URL query/userinfo 与 `args` 中的秘密仍落 `payload_json` | 新增 `sessionMcpConfigSchema`（strict）：拒绝 userinfo/query/fragment 与非 http(s) 端点、凭据类或含 shell 表达式的 `args`、未知嵌套字段；提案前拒绝且不落库 |
| 3 | `secretRef` 只校验命名空间、从不解析，却展示 `hasSecret: true` | 明确拒绝——会话凭据存储未实现即不接受引用，不再假装可用 |
| 4 | `skill` / `skill_mcp` 执行仍读用户级 `installed_skills`，会话技能显示可用但加载失败 / 回退执行用户版本 | 执行改从 **effective 会话快照**取 manifest；校验 `resourceRef` + `contentDigest` 与库中当前值一致；撤权即拒绝；内嵌 MCP 按会话选 transport，禁止同名用户回退 |
| 5 | 撤权只改库，未回收连接；等待连接的调用可在撤权后执行 | 撤权/会话删除调用 `invalidateSessionExtensionConnections`（复用 `buildSessionMcpKeyMarker` 匹配两个池）；MCP 调用在 connect 完成后、发送前复核当前配置与授权 |
| 6 | 执行已批准操作时不复核渠道开关 / 审批资格 / owner | `applyApprovedSessionExtensionOperation` 新增来源与策略复核，失败结算为 `authorization_changed` |
| 7 | `PATCH /sessions/:id/extensions` 在 ownership 后直接改策略，可绕过统一授权扩大继承范围 | 渠道不得经 PATCH 由 `explicit` 扩到 `inherit`；关闭管理或派生来源一律 403 |
| 8 | 生产确认路径未注入 `probeMcpServer`，MCP 必然 `configured_unavailable`；启动未恢复中断操作 | 路由注入会话探活（fresh connect + listTools）；`failInterruptedSessionExtensionOperations` + 过期收敛移到 `migrate()` 之后；移除路由注册期 DB 副作用 |
| 9 | pin 身份失效非 fail-closed（同名用户技能可顶替会话技能被注入） | `applyPinnedSnapshot` 同时匹配 `resourceRef` 与 `contentDigest`，缺失即丢弃；快照记录 `extensionRevision`，会话扩展变更后下一轮重建（无会话扩展的旧会话保持首轮契约） |

**本轮验证**：影响域 359 文件 / 2902 用例通过（0 失败，3 跳过）；`packages/mcp-client` 8 文件 / 28 用例；确认页 10 例；客户端 6 例；四端 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../final-gate.log`。

**仍未完成（不得勾选）**：T-21 真实渠道与浏览器验收；T-22 的 OAuth 轮换 / 网关级敏感信息全量扫描；OAuth 授权事务绑定会话身份（会话内仍拒绝 OAuth）；「引用设置页既有凭据」的复用路径。

### 2026-11-01 第三轮补齐（把「实现性缺口」做完，只剩硬阻塞）

上一轮列出的 6 项剩余缺口里，5 项已实现并验证：

| # | 补齐内容 | 关键实现 | 验证 |
| --- | --- | --- | --- |
| 1 | pin「按会话扩展 revision 下一轮重建」缺回归测试 | 判定抽成纯函数 `shouldRecapturePinnedSnapshot`（`skill/pinned-skills-prompt.ts`），`routes/stream.ts` 改为调用它 | `pinned-skills-snapshot-v2.test.ts` +4 例：未捕获必捕获 / 无会话扩展沿用首轮冻结 / revision 变化重建 / 老快照缺 revision 时重建 |
| 2 | 渠道结果回推是 best-effort | 新增 `session_extension_deliveries` 表 + `session-extension-delivery-store.ts` + `-dispatcher.ts`：入队即冻结文案、`operation_id` 主键去重、租约 CAS 领取、指数退避（上限 60s，5 次转 `dead`）、非渠道会话 `skipped` 终态、启动补偿限 30 分钟窗口且**刻意不含 `expired`**（避免重启把一批超时提案刷进渠道）。决策/取消改为入队 + 即时派发；`index.ts` 注册 2s 后台定时器与启动补偿 | 新增 `session-extension-delivery.test.ts` 9 例 + 渠道回推 5 例；覆盖并发领取、租约过期回收、迟到失败不改写、退避与 `dead`、补偿窗口、非渠道 `skipped` |
| 3 | `secretRef` 无真实解析（曾一律拒绝） | 新增 `session_extension_secrets` 表（复用既有 AES-256-GCM 信封加密 `ssh/ssh-secret-cipher`）+ `session-extension-secret-store.ts`；`secretRef` 需「归属本会话 + 声明 `secretBinding` 注入点 + 凭据真实存在」三条件；建连时解析并注入 header/env，解析失败**抛错**（不退回无凭据连接）；凭据 `updatedAt` 参与连接指纹，轮换即让旧连接失效；owner-only `PUT/DELETE /sessions/:id/extension-secrets/:name` | 新增 `session-extension-secret.test.ts` 9 例（明文不落库、轮换、级联清理、跨会话隔离、策略三条件）+ 路由 2 例（脱敏、管理员无写入权、非法名 400） |
| 4 | 完整会话面板与凭据表单 | `SessionExtensionPanelPage`（`/session-extensions/panel?session=`，ProtectedRoute 内 + 预加载登记）：继承策略、条目禁用/移除、凭据录入与删除、待确认提案入口；新增 `POST /sessions/:id/extensions/revoke`——**只开放收窄**（禁用 / 移除），启用必须重新提案确认；客户端补 `revoke` / `putSecret` / `deleteSecret` | 面板 5 例（只读语义、只有收窄按钮、凭据明文用后即清、渠道不能放宽继承）+ 路由 2 例 |
| 5 | 进程级中断恢复未验证 | 新增 `verify-session-extension-interrupt-recovery.ts` + `_fixture-session-extension-interrupt.ts`：子进程建提案→批准→置 `applying` 后挂起，父进程看到标记即 `SIGKILL`；新进程跑真实启动路径，必须改判 `failed/gateway_restart` **且**补上回执；连跑两次一致 | `bun run test:session-extension-interrupt` 连跑两次通过（`status=failed errorCode=gateway_restart delivery=pending`） |

**第三轮验证**：影响域 **361 文件 / 2939 用例通过**（0 失败，3 跳过）；`packages/mcp-client` 8 文件 / 28 用例；确认页 10 例 + 面板 5 例；客户端 6 例；四端 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../final-gate2.log`。

**唯一硬阻塞**：T-21（真实渠道试点 + 真实浏览器三视口验收）需要渠道凭据与公开确认地址，当前环境无法执行——不能以静态回归替代，故工作流保持未归档。

### 2026-11-01 第四轮：两轴复查的 P-1 / P-4 收口

第三轮复查提出 7 项，本轮收口 2 项实现性缺口：

| # | 问题 | 修复与验证 |
| --- | --- | --- |
| P-1 | 探活只是 `SessionExtensionApplyPorts` 上的**可选注入点**，漏传即按 `probe_not_configured` 结算——把「根本没验过」谎报成「配置已保存但不可用」。全仓只有路由层一处注入，属「靠调用方记得传」的接缝 | 抽成共享模块 `session-extension/session-extension-probe.ts`（先作废旧连接 → 再走真实目录构建），作为服务层**默认实现**；`route-support` 不再传端口；删除 `probe_not_configured` 整条分支。新增 `__tests__/.../session-extension-probe.test.ts` 锁定「回收先于取目录」与判定口径；**真实模型端到端在不注入任何端口下通过** |
| P-4 | 启动回执补偿按 `created_at` 只回看 30 分钟。提案 TTL 是 10 分钟，因此**网关停机超过约 20 分钟，崩溃前那批已结算回执会被静默丢掉**——方案要求的是「重启补偿」，实际是「有限窗口补偿」 | 改按**结算时刻 `updated_at`**（每条状态迁移都会推进它）筛，窗口放宽到 24 小时（`LEFT JOIN ... IS NULL` 已排除已有投递记录，放宽不会灌爆渠道）。保留 `expired` 排除并写明理由：批量超时收敛不是崩溃孤儿。新增「早建晚结算」用例——**修复前该用例失败 `expected +0 to be 1`，修复后通过**（先改回旧实现验证用例确实能捕获） |

同时新增手工端到端入口 `bun run test:live-e2e`（需 `PROBE_BASE_URL` / `PROBE_KEY` / `PROBE_MODEL`，**不进 CI**）。

**第四轮验证**：影响域 **362 文件 / 2943 用例通过**（0 失败，3 跳过）；四端 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../p1-p4-gate.log`。

### 2026-11-01 第五轮：上轮两项边界的收口

| # | 边界 | 修复与验证 |
| --- | --- | --- |
| 1 | 撤权/删除的连接回收是 fire-and-forget：接口返回成功时连接与子进程可能仍在释放中，「禁用即刻释放」不能按字面宣称 | `invalidateSessionExtensionConnections` → `async` 且真正 `await` 两个池；`revokeSessionSkill` / `revokeSessionMcp` → `Promise<MutateResult>`；并沿调用链全部传播：HTTP 撤权路由、模型工具 `skill_manage` / `mcp_manage_servers` 的 disable/remove（`revokeSessionScopeSkill` / `revokeSessionScopeMcp` / `revokeSessionScopeMcpAction` / `runSessionScopedMcpAction`）、会话删除路径。新增用例「撤权返回时连接已真的回收」：用可等待的假回收证明回收未完成前 `revoke` 不得返回——**fire-and-forget 实现下该断言会失败** |
| 2 | 技能分支没有真实模型端到端：安装走注册源（内置源指向 GitHub），离线跑不通 | `test:live-e2e` 增加技能分支，注册源指向**本地桩**：`registry_sources` 种一行 `url=http://127.0.0.1:<stub>`，桩对 `/skills/<id>.json` 返回带**内联 manifest** 的技能条目。安装器在 `entry.manifest` 存在时不发网络请求（`installer.ts` 的 `parseManifestFromEntry`），因此整条链路离线可跑。实测两分支均通过：MCP `configured_unavailable`/`probe_failed`，技能 `succeeded` |

**第五轮验证**：影响域 **362 文件 / 2944 用例通过**（0 失败，3 跳过）；session-extension + tools 域 105 文件 / 919 用例；真实模型端到端两分支通过；改动文件 ESLint 0 error；四端 typecheck 0 error。证据 `runtime/.../final-gate3.log`。

### 2026-11-01 第六轮：技能 manifest 取回路径的真实覆盖（含一处更正）

第五轮我在文档里写「技能分支的**安装包下载 / tarball 流程**仍未覆盖」——**这个说法是错的**。读 `packages/skill-registry/src/installer.ts` 可知：

- 安装器**没有 tarball / 解包步骤**；`parseManifestFromEntry` 要么用内联 `entry.manifest`，要么 `GET entry.manifestUrl` 取回文本并 `parseYaml`；
- `verifySignature` 在 MVP 里就是显式的 `throw new Error('Signature verification not implemented in MVP')`（生产链路传 `skipSignatureVerification: true` 直接返回）。

所以技能链路的全部 I/O 只有「取回 manifest」这一步。第五轮的桩给了内联 manifest，等于**短路**掉了这条路径（`parseManifestFromEntry` 见到 `entry.manifest` 直接返回），覆盖是不完整的。

本轮修正：桩的技能条目**只给 `manifestUrl`**（不给内联 manifest），manifest 由安装器自己取回；并在桩上加命中计数，断言 `manifestFetches >= 1` —— 把「确实走了取回路径」从推断变成证据。端到端实测：

```
{"stage":"apply-skill","applyKind":"succeeded","manifestFetches":1,"skills":["skill:session:e2e-skill#enabled=1"]}
```

单元层同路径此前已有覆盖（`packages/skill-registry/src/installer-fetch-timeout.test.ts` 的「正常返回 manifest 时透传解析」与超时 abort），本轮补的是**集成链路**。

### 2026-11-01 第七轮：注册源取回路径的核查与更正 + 鉴权分支覆盖

第六轮结尾我写「`file://` 型注册源（`installers/local.ts`）与 GitHub 型源的真实取回未在端到端覆盖」——**这个说法不成立**。读 `packages/skill-registry/src/client.ts` 可知：

- `fetchSkillDetailFromSource` **不看 `source.type`**，一律走 `${source.url}/skills/<id>.json` 的 HTTP 取回。类型只会影响 `buildHeaders`（auth: none / bearer / 自定义 header）。
- 包里确实有 `LocalInstaller.installFromLocalDir`（读 `${dir}/skill.yaml`），但它在 `services/` / `packages/` / `apps/` 中**没有任何调用方**，不在 `client.install()` 路径上——本功能根本不会调到它。

所以「按类型分派取回」这个模型本身是错的，真正未被覆盖的是**鉴权分支**。

本轮补上：E2E 的桩注册源改为带 `auth_json = {type:'bearer', token}`，桩记录收到的 `Authorization` 头并断言它等于 `Bearer <token>`——「配置了凭据但没发出去」与「发到错误的地方」都会因此在端到端里暴露。实测：

```
{"stage":"apply-skill","applyKind":"succeeded","manifestFetches":1,"registryAuth":"Bearer e2e-registry-token",...}
```

鉴权分支的**完整形态**放在单元层覆盖（比端到端更便宜也更精确）：新增 `packages/skill-registry/src/client-source-auth.test.ts`（10 例），用桩 fetch 直接断言**请求头本身**：

- 四种 `type`（official / community / enterprise / local）取回 URL 完全相同 → 把「类型不参与分派」钉成不变量，谁改成按类型分派会先在这里失败；
- 末尾斜杠不产生双斜杠；
- `auth` 缺省与 `type:'none'` 都不带任何凭据头；
- `bearer` → `Authorization: Bearer <token>`；
- `api-key` → 自定义头名，且断言序列化结果**不含** `Authorization`（凭据落到错误的头等于交给了一个不认识的端点）；
- 非 2xx 返回 `undefined` 而不抛错（上层按「源里没有」处理）。

该包全量：7 文件 / 38 用例通过；`bun run build` 退出码 0（测试文件未进产物，`dist` 无改动）。

### 2026-11-01 第八轮：第三次两轴复查的 4 项修复

第三次复查（Standards + Spec 两轴，基准 `38e81eda`）报 11 条，我逐条核实后**证伪 2 条**（React 导入 TS2686、`failSessionExtensionDelivery` 缺租约守卫），其余按 S2 → S4 → P-1 → P-2 修复：

| # | 问题 | 修复与验证 |
| --- | --- | --- |
| S2 | 两个新页面各自复制 `Phase`/`STATUS_LABELS`/`formatTime`，取数与提交写在页面内（违反 `apps/web/AGENTS.md:78/111/115`） | 拆成 `shared/`（展示常量 + `SessionExtensionNotice`）、`hooks/session-extension-hooks.ts`（取数/副作用）、`panel/sections.tsx`、`confirm/sections.tsx`；页面只剩组装。**顺带修掉面板「未登录」分支不可达**（`load` 早退后 phase 永远停在 `loading`）。15 例页面测试全部通过、文案逐字未变 |
| S4 | `stripSecretFields` / `describeOperationAction` / `makeSessionResourceId` 三处死代码，其中 `makeSessionResourceId` 命名与语义不符（返回裸 `randomUUID()`，与契约层 `buildSessionResourceRef` 不同源） | 全部删除 + 清理 3 处失效导入 + 修正 `runtime-policy.ts` 里引用已删函数的过时注释。**顺带发现并修掉 `purgeSessionExtensions` 漏删 `session_extension_secrets`**：该函数是「清空本会话扩展」，会话行还在，只靠 `sessions` 外键级联清不掉凭据——残留凭据会在重新启用后被继续使用，而用户以为已清掉 |
| P-1 | 渠道开启本能力后未切 `explicit`，仍全量继承用户级 MCP/技能（规格 `:34`） | 默认继承模式改为**来源感知**：渠道 + 开关已开 → `explicit`；`ensureSessionExtensionSettings` 建行用同一口径（否则首次提案建出的行会把刚生效的隔离反过来关掉）。个人会话与未开关渠道保持 `inherit`，用户显式写入的设置行永久优先 |
| P-2 | `origin.ts` 只读顶层 `channelId`（`buildChannelSessionMetadata` 从不写这个键），`origin.channelId` 恒 null、操作记录 `channel_id` 恒空 | 增加 `readNestedString`，从 `channel.id` 兜底读取 |

两条修复都配了**「旧实现下必失败」**的回归（临时回退后实测：`expected null to be 'plugin-42'`、`expected 'inherit' to be 'explicit'`），随后还原。

**第八轮验证**：影响域 **362 文件 / 2947 用例通过**（0 失败，3 跳过）；前端页面 15 例；四端 typecheck 0 error；改动文件 ESLint 0 error；真实模型端到端（MCP + 技能两分支）在 `explicit` 生效后仍通过。证据 `runtime/.../review-fix-gate.log`。

### 2026-11-01 第九轮：补上渠道启用界面（规格 :34 的另一半）

第八轮把「渠道开启即 `explicit`」的默认收敛做实了，但规格 `:34` 还有后半句——「启用界面展示哪些旧能力将不再继承，**确认前不切换**」——此前完全没有实现：开关只存在于渠道配置字段层（`channel-config.ts:86`），Web 侧没有任何文件引用它。

本轮新增 `apps/web/src/components/common/display/ChannelExtensionManagementSection.tsx`：

- 点击「开启会话级扩展管理」**只进入待确认态**（组件内部状态），不动草稿；
- 待确认态先列出「将不再继承」的用户级技能与 MCP——数据来自既有的 `/settings/mcp-servers` 与 `/skills/installed`（**不新增网关接口**），名称取值容错（`name` / `displayName` / `id` / `skillId` / `displayId`）；
- 读不到影响清单时**不阻断确认**，但如实显示「无法读取影响清单（原因）……请自行确认影响」——不假装没有影响；
- 只有点「确认开启」才 `onChange(true)`；点「取消」什么都不改（规格的「确认前不切换」）。

字段贯通：`ChannelSettingsEntry` / `ChannelDraft`（`channelExtensionManagementEnabled`）→ 草稿构建与回填 → `channels-tab-content` 注入影响清单读取器。**网关侧无需改动**：`channel-config.ts` 的 `??` 合并本来就保留显式 `false`。

验证：新增 7 例组件测试（待确认不改草稿、取消不改草稿、确认只写一次、清单展示、空清单、读取失败不阻断、已开启可关闭）；`apps/web` 全量 **647 文件 / 6626 用例通过**；渠道设置页与会话扩展页既有 143 例不回归。

### 2026-11-01 第十轮：第四次两轴复查的 4 项修复（含 2 项自引入回归）

第四次复查（Standards + Spec 两轴，基准 `38e81eda`）报 12 条；我逐条核实后**两条的定性被更正**（撤权守卫与 `purgeSessionExtensions`），其余按 P-1 → P-2 → P-3 → P-4 修复。**其中 4 条是我最近两轮改动引入或遗漏的**：

| # | 问题 | 修复与验证 |
| --- | --- | --- |
| P-1 | **建行默认值分叉，可静默撤销渠道隔离**：`ensureSessionExtensionSettings` 已改用来源感知默认值，但**另一处**建行点 `bumpRevisionInTransaction` 仍写死 `inherit`；两处都是 `INSERT ... ON CONFLICT DO NOTHING`，先到者决定 | 第二处改用 `resolveDefaultSessionExtensionInheritance`。新增回归「写入路径建行时也用来源感知默认值」——**旧实现下失败 `expected 'inherit' to be 'explicit'`** |
| P-2 | **接口报的策略与运行时相反**：`routes/session-extensions.ts` 用 `settings?.inheritance ?? 'inherit'`，绕过了来源感知默认值；渠道开关已开、尚无设置行时运行时判 `explicit`，接口/面板却报 `inherit` | 改用 `resolveSessionExtensionInheritance`。既有路由用例「返回来源、管理开关、继承模式与 revision」**原先断言 `inherit`，等于把缺陷固化成期望值**——已改为 `explicit` 并注明原因，该用例从此是 P-2 的回归 |
| P-3 | **界面承诺与实际行为矛盾**：关闭开关写着「恢复继承你的用户级技能与 MCP」，但关闭只停本能力，已按 `explicit` 建行的会话仍按「只用会话条目」运行 | 改文案而不改行为：**「恢复继承」等于关闭一个功能顺带把用户级技能 / MCP 放给渠道，方向是反的**。新增用例锁定修正后的承诺；「要改单个会话策略请走该会话面板」写进说明 |
| P-4 | **渠道发言者身份恒空**：`origin.ts` 读顶层 `channelActorId` / `actorId`，而 `buildChannelSessionMetadata` 把它写在 `channelActor.userId` 下 → `requester_actor_id` 恒 null | 增加嵌套兜底（`channelActor.userId` → `platformUserId`）。回归**旧实现下失败 `expected null to be 'u-actor-9'`** |

**顺带清理（复查同批提出）**：实现规格承诺的条目上限 `SESSION_EXTENSION_MAX_RESOURCES`（原先只是常量、无引用，现于两条提案路径生效，更新已有条目不计入新名额，且检查放在任何网络请求之前）；删除死文件 `session-extension-scope.ts`、从未读取的 `resuming` 字段、仅测试引用的重复审批判断 `canApproveSessionExtensionOperation`（其用例改测**生产**函数 `isSessionExtensionApprover`，此前测的是重复实现等于没测）、无生产调用方的 `purgeSessionExtensions`；派发器领取改用注入时钟（与回收口径一致）；修正 `session-mcp-resolution` / `session-skill-resolution` 中「调用前必须走这里」的注释分叉（生产实际是就地过滤，语义等价但不可互替）。

**两处定性更正（我核实后不同意原报告）**：
- 「撤权运行期复核无生产接点」——**不成立**。撤权在生产路径确实生效：MCP 侧按 `sessionEnabledById` 过滤并结合 `enabled`（`mcp/mcp-runtime.ts:190-199`），技能侧 `validateSession()` 内联校验 `enabled` 与 `contentDigest`（`skill/skill-mcp-tools.ts:128-140`），另有发送前复核。真实问题是**重复实现 + 注释分叉**，不是安全漏洞。
- 「`purgeSessionExtensions` 漏删凭据」——我上一轮把它说成生产缺陷，**那是错的**：该函数**没有生产调用方**，会话删除靠外键级联（已确认 `PRAGMA foreign_keys=ON` 且 `ON DELETE CASCADE` 已声明），凭据确实会被清。

**第十轮验证**：影响域 **362 文件 / 2948 用例通过**（0 失败，3 跳过）；`apps/web` 组件 8 例；四端 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../r4-gate.log`。

### 2026-11-01 第十一轮：S1 真正收口（不是改注释）+ 规格 §6 同步

第十轮我对 S1 只改了注释，理由是「生产就地过滤、语义等价」——**那只解释了两处为何都说得通，并没有消除重复**。本轮把它做完：

| 项 | 处理 |
| --- | --- |
| 逐字复制的五条件判断出现在 `skill/skill-tools.ts` 与 `skill/skill-mcp-tools.ts` | 抽成 **`resolveCurrentSessionSkillManifest`**（`session-extension/session-skill-resolution.ts`）：撤回时返回 `null`，可用时返回 manifest 本身。两个执行入口共用，测试直接打它 |
| **复制已经分叉**：`skill-tools` 检查条目自身 `enabled`，`skill-mcp-tools` 漏查 | 共享实现统一检查；内嵌 MCP 入口顺带补上此前缺失的那一项 |
| 三个「只被测试引用」的守卫 | 删除 `isSessionMcpServerEnabled` / `isSessionSkillUsable` / `isSessionSkillEmbeddedMcpAllowed` 及其用例——上一轮被点名的反模式就是「测了一个不在跑的实现」。MCP 的 `enabled = 0` 屏障由 `mcp/mcp-runtime.ts` 的解析与发送前复核承担；技能侧由共享决策函数承担 |
| 设计取舍 | 决策函数**返回 manifest 而非布尔值**：调用方需要就地收窄成非空（否则还要再取一次、再判一次，分叉又回来了）。这也是它比布尔谓词更合适的原因 |

新增用例覆盖：四条件齐备放行、条目被过滤 / 无 manifest / 库里已移除 / 库里禁用 / 快照摘要与库中不一致各自拒绝，以及**「manifest 正文被替换但摘要字段未同步更新」也必须拒绝**（摘要由正文重算，不能只比字段）。

规格 §6 的接口清单同步：补上实际存在的 `extensions/revoke`（只收窄）、`extension-secrets` PUT/DELETE（仅 owner、明文只上行）、`session-extension-admins` 读写，并逐条说明为什么必需——避免「规格说 6 条、代码里有 9 条」对不上账。

**第十一轮验证**：影响域 **362 文件 / 2950 用例通过**（0 失败，3 跳过）；本功能文件 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../r5-gate.log`。

### 2026-11-01 第十二轮：第五次两轴复查的修复（含一条 P1）

第五次复查（Standards + Spec，基准 `38e81eda`）报 10 条，我逐条核实后**全部属实**，按影响修复：

| # | 问题 | 修复与验证 |
| --- | --- | --- |
| **F1（P1）** | **会话条目可占用内置 MCP id，顶替内置端点**。合并层 `mcp/builtin-mcps.ts:171-173` 只保护 `virtual` / `adapter` 两类内置，kind 为 `system` 的内置（含 `open_websearch` / `grep_app` 这类**远程端点**）在配置存在时被**直接顶替**；`proposeSessionMcpUpsert` 不校验 id。规格 §3:48 明令「模型不得替换内置端点」，技能侧有 `builtinIds.has()` 保护，MCP 侧没有 | 提案阶段拒绝任何 `BUILTIN_MCP_IDS` 中的 id。回归：用 `open_websearch` + 攻击者 URL 提案——**旧实现下失败 `expected 'created' to be 'denied'`**，修复后拒绝且不落库，理由明确写「内置 MCP 不能由会话条目覆盖」 |
| **F2（P2）** | **确认页永远看不到端点主机名**。`buildSafePayloadPreview` 只回 `displayId/transport/command/hasSecret`，**没有 `endpointHost`**；而确认页明确读它渲染「端点」行——那一行是死代码。用户确认远程 MCP 时看不到请求发往哪里（与 F1 叠加后无法发现端点被换） | 预览补上 `endpointHost`（只取 host，路径与查询串不进预览）。回归断言 `endpointHost === 'mcp.example.com:8443'` 且响应体不含路径——**旧实现下失败 `expected null to be 'mcp.example.com:8443'`** |
| **F3（P2）** | **第十轮我改的文案又指了一条走不通的路**：写成「如需恢复继承请到对应会话的扩展面板调整」，但渠道会话在面板被禁用、网关对 channel→inherit 直接 403（`routes/session-extensions.ts:195-199`）——正是读这句话的人没有那条路 | 改为说明「渠道会话不允许改回继承（那会把所有者用户级技能 / MCP 放给群成员）」。回归同时断言**不出现**旧的两句错误文案 |
| **F4（P3）** | `expireStaleSessionExtensionOperations` 注释称「由启动流程与 `applying` 前复核调用」，实际只在启动调用一次 | 改正注释并说明执行前的过期由 CAS 的 `expires_at > now` 保证，不是靠这个函数 |
| **F5（P3）** | `transport ?? type` 的 `type` 兜底是**死分支**：会话配置由 `.strict()` 且无 `type` 键的 schema 校验，带 `type` 的配置进不来 | 删除全部 `type` 兜底并注明原因 |

**Standards 轴未修、留待处理**：`unknown → 非空字符串/记录` 的收敛函数在 9 处重复；`origin.source` 的类别判定有 4 份；skill/mcp 的撤权与执行是同形双实现；操作投影字段组三处重复；确认链接在 web 面板与网关通知各手拼一份（跨包 URL 契约，缓解手段是加契约测试而非抽公共常量）。这些是判断题，改动面大、收益是维护性，未在本轮动。

**第十二轮验证**：影响域 **362 文件 / 2952 用例通过**（0 失败，3 跳过）；前端组件 8 例；本功能文件 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../r6-gate.log`。

### 2026-11-01 第十三轮：第六次复查 —— 两轴反向审我上一轮的修复

这轮复查我特意让两轴**先审「上一轮修得对不对」**，并要求验证我判为「只是维护性问题」的几处重复**是否已经出现行为分叉**。结论：**上一轮 5 项修复里 3 项不完整或本身就是错的**，且分叉确实存在。

| # | 问题（打在我自己的修复上） | 修复 |
| --- | --- | --- |
| **G1（P1）** | **F1 可以用空白绕过**：`sessionMcpConfigSchema` 对 `id` 带 `.trim()`，而我的内置校验用的是**未 trim** 的原始值——`" open_websearch "` 不在内置清单里、顺利通过，落库后却变成 `open_websearch` 并顶替内置端点。等于我给「不得替换内置端点」留了个空白后缀的后门 | 调整顺序为**先按 schema 规范化、再判定**：内置校验、上限检查、`displayId` 一律用 `sanitized` 的值。回归：`" open_websearch "` + 攻击者 URL 必须被拒——**旧顺序下失败 `expected 'created' to be 'denied'`**；另加一条断言普通 id 的空白被规范化、落库值与库中 `displayId` 一致（不一致的后果是运行时静默过滤掉该条目，只表现为「探活不可用」） |
| **G2（P2）** | **F2 只做了一半，同一字段出现两个口径**：新加的详情预览用 `host`，而原有提案预览 `buildMcpPreview` 的 `safeHost` 返回 `host + pathname`——同一字段名在两页给出不同值（我还在新注释里写「路径不进预览」，与另一处自相矛盾） | 抽出**唯一实现** `resolveEndpointHost`（只到主机，含端口），两个预览共用；删掉 `host+pathname` 的旧口径 |
| **G3（P2）** | **F5 没删净**：`service.ts` 仍有两处 `?? readRequiredString(…, 'type')`，与「全部删除」的说法不符 | 删除这两处 |
| **G4（P2）** | **我上一轮改的注释本身是错的**：我写「执行前的过期判定由 CAS 的 `expires_at > now` 保证」，但实测 `markApplying` 的条件是 `status = 'approved'`、`settle` 是 `status = 'applying'`，**都没有** `expires_at` 条件。`expires_at > now` 只出现在决策阶段 | 按实测改写，并写明设计意图：TTL 管的是**确认窗口**，不是执行窗口——一旦在有效期内批准，后续执行不受 TTL 限制 |
| **G5（P2）** | **F1 的修复有旁路**：规格 §3:58 要求内嵌 MCP 走**与普通会话 MCP 相同的白名单**，但 `skill/skill-mcp-tools.ts` 只校 schema + 运行时策略，**没有内置 id 校验**——技能正文成了绕过 F1 的通道 | 内嵌 MCP 补上同一校验 |

**两轴独立提出的两条被推翻**：① 「确认页三个预览行是死代码」——不成立，`requiresLocalFiles`（技能预览 `service.ts:587`）与 `scope` / `effectiveFrom`（MCP 预览）网关**确实会返回**；② 「`deleteSessionExtensionData` 无调用点」——该函数**根本不存在**（`purgeSessionExtensions` 已在第十一轮删除）。

**已确认存在、本轮未修的行为分叉**（上一轮我把它们判为「只是维护性」，判轻了）：
- **`origin.source` 四份实现不一致**：`session/session-tool-visibility.ts:162-176` 只读**本会话** metadata，`session-extension-origin.ts:120-222` 走**祖先链**。后果：渠道派生的 `task` 子会话「工具可见 = true」但管理工具必拒（`resolveManageToolAncestorDenial`）→ 可见但必拒，与 `origin.ts` 自述「已修可见性」不符。
- **9 处 `unknown → 非空字符串/记录` 收敛函数不一致**：有的 trim、有的不 trim、有的「用 trim 判空却返回原值」。同一 `displayName` 在工具回执与渠道回执里显示不同。

这两项要做的是**收敛到单一实现**，涉及可见性判定与多模块收敛函数，属独立专项，未在轮次内顺手改。

**第十三轮验证**：影响域 **362 文件 / 2954 用例通过**（0 失败，3 跳过）；本功能文件 typecheck 0 error；改动文件 ESLint 0 error。证据 `runtime/.../r7-gate.log`。

**仍存在、未修的边界**：真实渠道试点与真实浏览器三视口验收（T-21，硬阻塞）；会话内 OAuth 绑定会话身份；网关级敏感信息全量扫描；`LocalInstaller`（本功能不调用，属包内独立 API）；上述两处行为分叉。

用户已于 2026-10-31 下达「实施」指令，下表为**实施状态**（`[x] ✅` 已完成 / `[ ] ⏸️` 显式未完成）。每项实施按最多 3 个变更文件的批次推进、每批先验证，具体落地文件与验证证据见下方「执行记录」。

### P0：冻结契约与安全门（前置阻塞）
- [x] T-01 ✅: 冻结契约：`session-extension-contract.ts`（类型/常量/状态机/资源身份编码）+ 渠道仅 session scope、管理员合取、stdio 默认关。
- [x] T-02 ✅: 基线：`skill-admin-tools` / `mcp-admin-tools` 既有 29 例全绿；新增渠道子会话绕过（fail）用例先行。
- [x] T-03 ✅: `session-extension-origin.ts`（祖先链来源解析 + 渠道子会话守卫）+ `session-extension-scope.ts`（请求级可信作用域）；两处管理工具入口叠加祖先链校验。
- [x] T-04 ✅: 迁移新增 5 张表（settings / skills / mcp / admins / operations）+ `session-extension-store.ts`（revision CAS）+ `session-extension-operation-store.ts`（单次消费状态机）。

### P1：共同基础后可并行的三条主线
- [x] T-05 ✅: `session-skill-source.ts`：注册源检索 + 固定内容快照（`contentDigest`），首期排除 `github:` / `claude-marketplace:` / `local:`，回传声明权限与内嵌 MCP 风险。
- [x] T-06 ✅: `session-skill-resolution.ts` + `skill-selection.ts` 叠加：`inherit` 追加 / `explicit` 只用会话集合；用户级硬撤权优先；内置不可被会话覆盖。
- [x] T-07 ✅: pin 快照 v2：`PinnedSkillsSnapshot.entries`（`resourceRef + contentDigest + schemaVersion`）。`EffectiveSkill` 增补 `resourceRef` / `contentDigest` 并由会话层填充；`applyPinnedSnapshot` 对带摘要的条目做**内容对齐**——摘要变化即不再注入（新内容不得冒充已固定内容），用户级条目保持「只固定成员」的历史语义；撤权优先于 pin；v1 快照与 `null`/空快照语义逐字不变。
- [x] T-08 ✅: `session-mcp-resolution.ts` + `mcp-runtime.getConfiguredMcpServersForSession` 重写：`explicit` 阻断用户配置继承，会话条目按 displayId 会话内优先。
- [x] T-09 ✅（mock 覆盖；真实进程级未验证）: 会话池键、缓存及 generation 回收机制已落地；迟到 connect、旧 pending 误删新 pending、撤销后默认重试复活已修复并有单测。2026-11-01 已把回收接入撤权与会话删除调用点，并在 MCP 调用发送前复核当前配置与授权。
- [x] T-10 ✅（范围收敛）: `session-extension-runtime-policy.ts`：stdio 需显式开关（`OPENAWORK_SESSION_EXTENSION_ALLOW_STDIO`，默认关）、会话内**拒绝 OAuth**（授权事务尚未绑定会话身份，fail-closed）、`secretRef` 必须属于本会话命名空间（`session:<会话ID>:<名称>`）、最小 stdio 环境（**不继承网关凭据类变量**）。连接池新增 `McpPoolConnectionOptions`：会话级调用 `maxAttempts = 1`（**非幂等调用不自动重放**），只读路径保留重试。OAuth 授权事务**绑定会话身份仍未实施**（当前以拒绝代替）。
- [x] T-11 ✅（范围收敛）: 内嵌 MCP 归属按 `resourceRef` 判定（`isSessionSkillEmbeddedMcpAllowed`）：技能禁用即撤销其 MCP，禁止同名用户 MCP 回退。完整 OAuth 授权链见 T-10 未完成项。
- [x] T-12 ✅: `session-extension-authorization.ts`：独立授权门（不受 yolo/渠道自动批准/永久授权影响）、渠道仅 session scope、管理员合取、内容一致性校验；审批人清单表 + owner 隐式。
- [x] T-13 ✅: 三阶段服务、revision/摘要复核、nonce CAS、会话探活（fresh connect + listTools）、启动中断恢复 + 过期收敛 + 回执补偿均已接线；结果投递改为持久化（见第三轮 §2），跨进程中断恢复由 `test:session-extension-interrupt` 验证。

### P2：管理工具、接口与用户确认
- [x] T-14 ✅: `skill_manage` / `mcp_manage_servers` 新增 `scope`、`search`、`resourceRef`；缺省 scope 保持历史拒绝语义（逐字不变），`scope: 'session'` 走提案流程且不写用户级配置。
- [x] T-15 ✅: `routes/session-extensions.ts`：状态读取 / 继承策略 PATCH（409 CAS）/ 提案 / 详情（脱敏预览）/ 确认 / 取消 / 管理员清单；全部 JWT + 会话归属校验。
- [x] T-16 ✅: `packages/web-client/src/session/session-extensions.ts` + 入口导出 + 契约测试（失败语义保留 403/404/409/410）。
- [x] T-17 ✅: `apps/web/src/pages/session-extensions/SessionExtensionConfirmPage.tsx`（路由 `/session-extensions/confirm`，注册进 `preloadable-route-modules.ts` 与 `App.tsx`，位于 `ProtectedRoute` 内）。展示目标/来源/版本/传输/端点主机名/风险/仅会话范围/有效期，确认与拒绝，终态禁用重复确认，同会话其他待处理提案一并列出；**不回显任何密钥**。全屏会话面板（在聊天页内管理扩展）未做，确认为独立页。
- [x] T-18 ✅（文案层 + 持久化回推）: `session-extension-confirmation.ts`：确认回执文案 + 链接构造（`OPENAWORK_PUBLIC_WEB_URL`）；未配置时**降级为面板指引、不伪造链接**；结果回执区分成功/不可用/拒绝/过期/取消。回推经 `session_extension_deliveries` 持久化并由后台派发器重试（见第三轮 §2）。渠道原生卡片（平台按钮 / 签名校验）仍留作后续适配。
- [x] T-19 ✅: 派生子会话只读（`isDescendantSessionOrigin` 拒绝提案但允许读）；撤权（`enabled=0`）为立即生效拒绝屏障并在解析时重复校验；`session-extension-scope.ts` 承载原请求者身份。

### P3：安全回归、试点与发布
- [x] T-20 ✅（本地静态回归）: 会话扩展域 **9 文件 / 104 用例**；影响域（tools/channels/routes/session/skill/mcp）**354 文件 / 2811 用例**全绿；typecheck 与 ESLint 0 error。
- [ ] T-21 ⏸️: 受控 MCP 与真实渠道试点 —— **未执行，唯一硬阻塞**。无渠道凭据、无公开确认地址；隔离矩阵已由内存 SQLite 用例覆盖，真实渠道闭环与真实浏览器三视口未验证。
- [ ] T-22（大部分已覆盖，剩两项）: 已覆盖——重启改判失败 + **真实 SIGKILL 进程级验证**（`test:session-extension-interrupt`）、revision 冲突、payload 篡改、探活失败、并发确认、过期、跨用户 404、池键/目录隔离、最小环境不含网关凭据（已贯通到真实 transport 构造边界）、迟到 connect 复活与旧尝试误删新 pending（generation + 单测）、租约过期回收与迟到失败不改写。**未覆盖**：OAuth 轮换（会话内仍拒绝 OAuth，授权事务未绑定会话身份）、网关级敏感信息全量扫描（只覆盖已知出口）。
- [x] T-23 ✅: `.env.example` 增加 `OPENAWORK_PUBLIC_WEB_URL`（含降级说明）；本文件记录迁移/回退边界；操作状态机自带审计字段（请求者、审批者、时间、错误码、结果）。
- [x] T-24 ✅: 状态已同步 workflow / runtime / index；区分实测（静态回归全绿）与未测（真实渠道、UI 页面、stdio 开关、OAuth 绑定）。

### 依赖与合并顺序

T-01 → T-02/T-03 → T-04；Skill T-05→T-06→T-07、MCP T-08→T-09→T-10、授权 T-12 可并行；T-11 依赖 T-06/T-09/T-10；T-13 依赖 T-04/T-12；T-14/T-15 依赖三主线与 T-11/T-13；T-15→T-16→T-17；T-18 依赖 T-13/T-17；T-19 依赖 T-14/T-18；T-20→T-21/T-22→T-23→T-24。分支可提前编写契约测试，不能提前开放功能开关。

### 影响文件与拆分纪律

- 存储：`services/agent-gateway/src/infra/db.ts` 的现迁移入口、会话删除恢复逻辑；新增扩展域 store，不在大文件堆实现。
- Skill：`skill/skill-admin-tools.ts`、`skill/skill-selection.ts`、`skill/skill-tools.ts`、`skill/pinned-skills-prompt.ts`。
- MCP：`mcp/mcp-admin-tools.ts`、`mcp/mcp-runtime.ts`、`mcp/mcp-tool-catalog.ts`、`mcp/mcp-server-authorization.ts`、OAuth store/provider、`skill/skill-mcp-connection-pool.ts`。
- 渠道/工具：`channels/router.ts`、`channels/channel-actor-scope.ts`、`channels/channel-member-acl.ts`、`session/session-tool-visibility.ts`、`tools/sandbox/permission-ladder.ts`、delegation、工具定义与能力目录。
- 新路由/客户端/页面：扩展域独立路由模块、`packages/web-client/src/`、Web 确认页/会话面板及对应测试；实现时再确定组件挂载点。
- 共享热点由协调者串行接线，Skill/MCP/授权实现者只写各自模块；大于 1500 行文件不继续追加域逻辑，优先抽取此次职责，不顺带重构无关文件。

### 验收矩阵与验证命令

- 隔离：同用户两会话、不同用户、不同渠道、同群不同 actor；同 ID 不同版本；explicit 空集合；必要内置项与旧会话兼容。
- 授权：无管理员、伪造 sender/链接、跨 session/owner、子代理、yolo/永久允许、重复 nonce、过期/撤权、审批后改配置、同时审批、单条拒绝不级联。
- 生命周期：禁用立即挡调用、旧目录不可复活、运行中删除、pending connect 结束、长任务、重启恢复、重复消息与网络重试、探活失败不能报告成功。
- 凭据：模型/日志/错误/通知不含 env/header/token/query secret；OAuth 跨会话回调、旧 revision、轮换、取消授权与 grant 删除范围。
- 体验：搜索→预览→确认→下一轮使用；拒绝/过期/取消/不可用均有反馈；375/768/1280 视口及手机确认链接可达。
- 定向 Vitest 与 Fastify inject 使用真实内存 SQLite；MCP 用受控本地测试服务，渠道仅 mock 传输层。至少一类已配置真实渠道实测，其他标记未测，不能伪造全渠道通过。
- 实施期：`bun run --filter @openAwork/agent-gateway test:unit`、受影响 verification、`bun run --filter @openAwork/web-client test`、`bun run --filter @openAwork/web test`、受影响包 typecheck、`bun run preflight`。本次仅文档，不运行这些业务验证。

## 执行记录（2026-10-31）

### 落地文件

新增（网关 `src/session-extension/`，12 个模块）：

- `session-extension-contract.ts`：冻结契约（类型 / 常量 / 状态机 / 资源身份编码）。
- `session-extension-store.ts`：设置行 + 技能 / MCP 条目 + revision CAS + 审批人清单 + 清理。
- `session-extension-operation-store.ts`：提案状态机（单次消费、幂等、过期、重启恢复）。
- `session-extension-origin.ts`：**祖先链**可信来源解析 + 既有工具文案兼容守卫 + 派生子会话判定。
- `session-extension-scope.ts`：请求级可信作用域（原请求者与审批者分离）。
- `session-extension-authorization.ts`：独立授权门（不受自动批准捷径影响）。
- `session-extension-service.ts`：提案 → 审批 → 执行编排（重算摘要、探活终态）。
- `session-extension-tools.ts`：会话作用域动作实现 + 管理员确认入口。
- `session-extension-route-support.ts`：路由支撑（脱敏预览 / 确认 / 取消）。
- `session-extension-confirmation.ts`：渠道确认回执与链接（未配置地址则降级）。
- `session-skill-source.ts` / `session-skill-resolution.ts` / `session-mcp-resolution.ts`：会话层解析。

新增（网关其余）：`routes/session-extensions.ts`；`infra/db.ts` 迁移段新增 5 张表。

修改（既有文件，均为**追加**语义，未改历史行为）：

- `skill/skill-admin-tools.ts`、`mcp/mcp-admin-tools.ts`：新增 `scope` / `search` / `resourceRef`；入口叠加祖先链守卫；`scope: 'session'` 分支。
- `mcp/mcp-runtime.ts`：`ConfiguredMCPServer.sessionScope`、`getMcpPoolKey` 会话隔离、`releaseSessionMcpConnections`、`getConfiguredMcpServersForSession` 重写。
- `mcp/mcp-tool-catalog.ts`：`clearCatalogSnapshotsMatching`。
- `skill/skill-mcp-connection-pool.ts`：`disconnectMatching`。
- `skill/skill-selection.ts`：叠加会话级技能层（新增 `session-extension` 来源标记）。
- `index.ts`：注册 `sessionExtensionsRoutes`。
- `packages/web-client/src/{index.ts,session/session-extensions.ts}`：客户端与导出。
- `.env.example`：`OPENAWORK_PUBLIC_WEB_URL`。

### 验证证据

- 会话扩展域：**11 文件 / 131 用例全绿**（存储 21 / 操作与编排 18 / 来源与授权 18 / 技能解析 9 / MCP 解析 6 / 池键隔离 6 / 工具作用域 7 / 路由 12 / 确认文案 8 / 运行时策略 16 / 执行记录相关 10）。
- pin 快照：`skill` 域 **17 文件 / 110 用例全绿**（含 v2 版本化 10 例，v1 兼容用例逐条保留）。
- 影响域回归：`tools` + `channels` + `routes` + `session` + `skill` + `mcp` + `session-extension` = **222 文件 / 1831 用例通过 / 0 失败**。
- Web 侧：确认页 **7 例**通过；`apps/web/src/routes` 4 例通过。
- typecheck：agent-gateway / web-client / apps-web 均 0 error（唯一错误为外部在途的 `orchestration-depth.test.ts`，与本任务无关）。
- ESLint（本次改动文件，含 apps/web 的 React Compiler 规则）0 error；Prettier 已格式化。

### 追加实施（第二轮）

- **T-07**：`pinned-skills-prompt.ts` 升级为快照 v2，新增 `PinnedSkillSnapshotEntry`。`selectPinnedCandidates` 必须**透传** `resourceRef` / `contentDigest`——否则快照拿不到内容标识（过程中实际踩到，已由用例锁定）。
- **T-10**：新增 `session-extension-runtime-policy.ts`。连接池 `createConnection` 的 `env` 处理存在**既有行为**（调用 `createCleanMcpEnvironment()` 时不传 server 自身 env），本次改为显式传入 `explicitEnv`，最小环境仅在 `envPolicy === 'minimal'` 时启用；用户级路径行为不变（回归全绿）。
- **T-17**：确认页刻意放在 `ProtectedRoute` 内且**不复用 `Layout`**——链接不是授权凭据，必须先登录；自带居中卡片是为了让渠道跳转过来的用户一眼看到决策项。确认页测试的 auth mock 路径比 `AboutPage.test.tsx` 深一层（`../../stores/...`），首次写错导致全部用例渲染成未登录态。

### 过程偏差与设计调整

- **D-1（新增任务外决策）**：保留既有工具的 `scope` 缺省语义为「用户级」，而不是把渠道默认改成会话级。这样历史上「渠道拒绝」的断言逐字不变，渠道启用是**显式开关**（`channelExtensionManagementEnabled`），避免升级即改变既有渠道行为。
- **D-2（加固超出原计划）**：新增 `isDescendantSessionOrigin` —— 派生子会话不仅不可见管理工具，连提案也被拒绝（读仍可用）。原计划只写「只读继承」，这里收紧到「只读 + 不可提案」。
- **D-3（实现顺序调整）**：原计划 T-17（Web 确认页）在 T-18（渠道回执）之前；实际先做 T-18 文案层，因为它是渠道闭环的最小可用交付，而 UI 页面属 `apps/web`，与网关改动的验证成本不同。
- **D-4（摘要校验加强）**：执行前对 payload **重算**摘要比对（而非复用提案时的值），使「payload 被改写」也能被拦截；补充了篡改用例。
- **D-5（未做但需显式登记）**：**剩 T-21（真实渠道试点）与 T-22 的进程级/轮换类故障注入**为未完成，不是「隐性待办」。T-07 / T-10 / T-17 已在第二轮补齐（T-10 的 OAuth **授权事务绑定会话身份**仍以「拒绝会话内 OAuth」这一 fail-closed 策略代替，属范围收敛而非遗漏）。
- **D-6（T-10 的范围收敛，需用户知悉）**：会话内 OAuth 当前是**拒绝**而不是「绑定会话后放行」。理由：现有 OAuth store 的 state / token 按「用户 + server」落库，没有会话维度；在本期不重构授权事务的前提下，允许它会退化成「会话 A 发起授权、会话 B 拿到 token」。恢复该能力的正确做法是把 state / grant 也纳入 `owner + session + resourceRef + revision`，属独立议题。

### 已知边界（必须在交付说明中保留）

- 本能力隔离的是**扩展配置、授权、版本与 MCP 客户端/子进程状态**，**不是** OS 级文件系统 / 网络沙箱；保留 Shell / 文件写入的宿主仍可能有超出扩展配置的接触面。
- stdio MCP 的**会话级**路径已收紧（显式开关 + 最小环境 + 不自动重放）；**用户级** stdio 保持既有行为不变（既有 `createCleanMcpEnvironment`），这是有意的不对称——用户级配置由用户在设置页填写，信任级别不同。
- 会话内**不接受 OAuth**（T-10 范围收敛）；需要 OAuth 的 MCP 请在设置页做用户级配置。
- 未配置 `OPENAWORK_PUBLIC_WEB_URL` 时，渠道回执只给面板指引；这是**有意降级**，不是缺陷。
- 真实渠道（Telegram / 飞书 / Discord）闭环、Web 确认页、移动端确认均**未验证**。

## Notes

- [x] P-01: 完成现状核查、历史方案对照及授权/生命周期只读设计复核。
- [x] P-02: 完成实施设计、24 项待办、依赖图、影响范围和验收矩阵。
- [x] P-03: 已登记索引并完成人工文档契约检查。
- [x] 已实施并验证：T-01…T-20、T-23、T-24（其中 T-18 为文案层、T-10 的 OAuth 为拒绝策略）。
- [ ] 未完成：**T-21（真实渠道试点）**；T-22 的**进程级击杀 / 迟到连接复活 / OAuth 轮换 / 网关级敏感信息扫描**未覆盖。以上为显式未完成项，不得当作已交付。
- Plan maintenance：2026-10-31 / 2026-11-01，本阶段工作流**不归档**——仍有显式未完成项，归档会掩盖剩余工作。
- Memory sync：已完成（`index.md` 新增 2 条架构决策 + 4 条陷阱）。
- 回退方式：渠道侧关闭 `channelExtensionManagementEnabled` 即停止新提案；已落库的会话扩展可用现有设置页 / 会话删除清理；`session_extension_*` 五张表均有 FK CASCADE，不做全局用户配置回滚。
- **上线前必须配置**：`OPENAWORK_PUBLIC_WEB_URL`（否则渠道回执只给面板指引）；如需会话内 stdio，另需 `OPENAWORK_SESSION_EXTENSION_ALLOW_STDIO=1`。
