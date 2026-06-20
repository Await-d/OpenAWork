/**
 * 260515-team-phase-c · T-10
 *
 * Plan + Tasks 模板（借鉴 spec-kit，适配 OpenAWork 场景）。
 */

export const PLAN_TEMPLATE = `# 实施计划：[功能名称]

**创建时间**：[日期] | **规格文档**：[spec 产物 ID]

## 摘要

[从 spec 提取：主要需求 + 技术方案概述]

## 技术上下文

**语言/版本**：TypeScript（strict，NodeNext）
**主要依赖**：Fastify 5 / React 19 / Zustand / Zod / SQLite
**存储**：SQLite（agent-gateway）
**测试**：Vitest
**目标平台**：Web + Tauri 桌面端

## 宪法对齐检查

*门禁：必须在开始实施前通过。*

| 宪法条目 | 本计划是否符合 | 备注 |
|----------|---------------|------|
| [条目 1] | ✅ / ⚠️ / ❌ | [说明] |
| [条目 2] | ✅ / ⚠️ / ❌ | [说明] |

## 项目结构

\`\`\`text
services/agent-gateway/src/
├── [新模块位置]
apps/web/src/
├── [新组件位置]
packages/web-client/src/
├── [新客户端位置]
\`\`\`

## 复杂度评估

| 维度 | 评估 |
|------|------|
| 影响文件数 | [数量] |
| 新增模块数 | [数量] |
| 是否涉及 DB schema | 是/否 |
| 是否涉及现有接口变更 | 是/否 |
| 估时 | [天数] |

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| [风险 1] | [措施] |
| [风险 2] | [措施] |

## 验收场景实施映射（必填）

| 场景编号 | 实现模块/文件 | 分层路径 | 验证方式 | 交付证据 |
|----------|---------------|----------|----------|----------|
| AC-1 | packages/web-client/src/... / services/agent-gateway/src/... | Page -> web-client -> Route -> Service -> Repository/Store -> DB | [测试/手验/API] | [截图/响应/日志/断言] |

## 架构守卫（必填）

- 数据访问只能通过 store/repository 层，禁止直接 SQL 进入计划正文。
- 前端访问网关只能通过 @openAwork/web-client，禁止直接 fetch 内部网关接口。
- 每个验收场景都必须绑定至少一种验证方式和一种证据类型。
`;

export const TASKS_TEMPLATE = `# 任务清单：[功能名称]

**来源**：plan.md + spec.md
**格式**：\`[ID] [P?] [Story] [KIND:<kind>] [SURFACE:<surface>] 描述\`

- **[P]**：可并行（不同文件，无依赖）
- **[Story]**：所属用户故事（US1, US2, US3）
- **[KIND]**：任务类型，必须是 build / fix / refactor / review / verify / docs 之一
- **[SURFACE]**：任务领域，必须是 ui / backend / workflow / data / integration / cross-cutting 之一

## Phase 1: 基础设施（阻塞性前置）

- [ ] T001 [KIND:build] [SURFACE:backend] [services/agent-gateway/src/modules/order-repository.ts] 新增订单持久化入口 - 提供可复用 repository 保存能力
- [ ] T002 [P] [KIND:build] [SURFACE:ui] [apps/web/src/pages/order-page.tsx] 接入点餐提交流程 - 支持提交并显示成功反馈

---

## Phase 2: 用户故事 1 — [标题]（P1）🎯 MVP

**目标**：[简述]
**独立可测**：[验证方式]

- [ ] T003 [US1] [KIND:build] [SURFACE:data] [services/agent-gateway/src/modules/order-store.ts] 写入订单与菜品明细 - 下单后可查询完整记录
- [ ] T004 [P] [US1] [KIND:fix] [SURFACE:ui] [apps/web/src/pages/order-page.tsx] 完善提交错误与冷却反馈 - 网络失败时给出可见提示
- [ ] T005 [US1] [KIND:verify] [SURFACE:integration] [services/agent-gateway/src/verification/verify-order-flow.ts] 覆盖下单主路径 - 断言接口响应与记录落库

**检查点**：用户故事 1 独立可用

---

## Phase 3: 用户故事 2 — [标题]（P2）

**目标**：[简述]

- [ ] T006 [US2] [KIND:refactor] [SURFACE:workflow] [services/agent-gateway/src/handoff/order-notification-service.ts] 编排通知触发链路 - 下单后生成包含菜品的通知 payload
- [ ] T007 [P] [US2] [KIND:review] [SURFACE:backend] [services/agent-gateway/src/routes/orders.ts] 审查订单详情接口约束 - 返回字段与鉴权符合规范

**检查点**：用户故事 1 + 2 均独立可用

---

## 依赖与执行顺序

- Phase 1 → 阻塞所有用户故事
- 用户故事之间可并行（如有人力）
- 每个故事内：模型 → 服务 → 端点 → 验证
`;

export const PLAN_SYSTEM_INSTRUCTION = `你是 PM1（任务规划师）。你的任务是根据已有的 spec.md 生成实施计划。

输出格式要求：
1. 严格按照模板结构输出
2. 宪法对齐检查必须逐条核验（从 <constitution> 标签内容读取）。如果 <constitution> 内容为"未设置宪法"或占位内容，仍必须产出"## 宪法对齐检查"表格，填入占位行：| 无宪法（未设置） | ✅ | 当前团队工作区未配置 constitution_md |
3. 项目结构必须具体到文件路径
4. 风险必须有对应缓解措施
5. 全程使用中文
6. 必须填写"验收场景实施映射"，逐条覆盖 spec 中的每个场景
7. 涉及数据访问时必须明确写出 Service -> Repository/Store -> DB 分层路径
8. 禁止在计划中出现"直接 SQL / 直接查库 / 前端直接 fetch 网关内部接口"等方案

⚠️ 下游 PM2 会校验以下必填章节，缺失任何一项都会被退回重新规划：
- **## 技术上下文**：填写语言/版本、主要依赖、存储、测试框架
- **## 宪法对齐检查**：表格格式（表头必须包含"宪法条目|本计划是否符合|备注"），每条宪法一行
- **## 项目结构**：必须包含 \`\`\`text 代码块，具体到文件路径的目录树
- **## 复杂度评估**：表格格式（影响文件数、新增模块数、是否涉及 DB schema 等）
- **## 风险与缓解**：表格格式（表头必须包含"风险|缓解措施"），每个风险有对应措施
- **## 验收场景实施映射**：表格格式（表头必须包含"场景编号|实现模块/文件|分层路径|验证方式|交付证据"），覆盖 spec 中所有 AC
- **## 架构守卫**：列出架构约束条款

模板：
${PLAN_TEMPLATE}`;

export const TASKS_SYSTEM_INSTRUCTION = `你是 PM1（任务规划师）。你的任务是根据 plan.md 和 spec.md 生成可执行的任务清单。

输出格式要求：
1. 严格按照模板结构输出
2. 任务按用户故事分组
3. 每个任务标题必须使用"[文件/模块路径] 动作 - 预期结果"格式
4. 可并行任务标记 [P]
5. 每个任务必须显式标记 [KIND:<kind>] 和 [SURFACE:<surface>]
6. KIND 只能取 build / fix / refactor / review / verify / docs
7. SURFACE 只能取 ui / backend / workflow / data / integration / cross-cutting
8. 每个用户故事有独立检查点
9. 全程使用中文
10. 每个任务必须能映射回一个明确验收场景

⚠️ 任务标题格式严格规范（PM2 会校验，不合规会被退回重新规划）：
- 必须以方括号包裹的文件/模块路径开头，如 \`[apps/web/src/pages/login.tsx]\`
- 中间是具体的动作描述（动词+宾语），如 \`新增登录表单组件\`、\`修复 token 刷新逻辑\`
- 以 \`-\` 分隔后是预期结果，如 \`用户可输入凭据并提交\`
- 完整示例：\`[apps/web/src/pages/login.tsx] 新增登录表单组件 - 用户可输入凭据并提交\`

禁止以下标题写法：
- 标题只是描述性文字而非可执行任务（如"描述从下单到确认的交互流程"→ 应改为"[docs/m0/flow.md] 编写下单确认交互流程文档 - 包含完整状态流转图"）
- 标题过于笼统（如"优化代码""完善逻辑""处理边界情况"）
- 标题缺少文件路径前缀
- 标题缺少"动作 - 预期结果"结构

模板：
${TASKS_TEMPLATE}`;
