# 260921-GUI-Agent集成方案

## Task Overview

借鉴 `bytedance/UI-TARS-desktop` 的 GUI Agent（computer-use）能力，为 OpenAWork 补齐「自然语言指令 → 视觉决策 → 多步操作 → 结果」的桌面自动化闭环。

- **来源项目**：`bytedance/UI-TARS-desktop` @ `c2ad42e`（Apache-2.0），已 sparse checkout 至 `temp/UI-TARS-desktop/`
- **分析产物**：`temp/gui-agent-integration-plan.md`（原始分析报告，含代码级证据）
- **本文档定位**：可执行的分阶段实施方案（T-XX 原子任务 + 验证契约 + Gate）
- **当前状态**：**方案阶段，未开始编码**；须通过 Gate 0（待决策项）后方可进入执行

## Complexity Assessment

- Atomic steps: 18+ → **+2**
- Parallel streams: yes（动作扩展 / 坐标数学 / 解析器移植 / Rust 驱动 四路可并行）→ **+2**
- Modules/systems/services: 6（agent-core、agent-gateway、apps/desktop、apps/web、shared-ui、shared）→ **+1**
- Long step (>5 min): yes（Rust 原生驱动、GUI Runner、真实端到端验证）→ **+1**
- Persisted review artifacts: yes（方案需评审并归档）→ **+1**
- OpenCode available: yes → **-1**
- **Total score: +6**
- **Chosen mode: Full orchestration**
- **Routing rationale**: 18+ 原子任务跨 6 个模块，含 Rust 原生与真实端到端验证的长步骤，方案需持久化供评审；按 skill 规则须 workflow doc + runtime dir + master_plan。

## Current Analysis

### 一、UI-TARS 可借鉴资产分级

| 资产 | 来源位置（temp 内） | 可移植性 | 借鉴价值 |
|---|---|---|---|
| 动作解析器 `actionParser` | `packages/ui-tars/action-parser/src/actionParser.ts`（330 行） | ★★★★★ 纯逻辑，仅依赖 `lodash.isnumber` | **极高** |
| 坐标归一化数学 | `actionParser.ts:191-240` + `sdk/src/utils.ts:29-56` | ★★★★★ 纯函数 | **极高** |
| 动作空间词表 | `sdk/src/constants.ts:55-66`（10 动作） | ★★★★★ 纯常量 | **高** |
| GUI 主循环 | `sdk/src/GUIAgent.ts:130-433` | ★★★★☆ 无 Electron 依赖，但含 `globalThis` 单例 | **高** |
| Operator 抽象 | `sdk/src/types.ts:66-73` | ★★★★★ 接口极简（2 方法） | **高** |
| 截图压缩策略 | `sdk/src/utils.ts:193-226` + `shared/src/constants/vlm.ts:9-15` | ★★★★★ | **高** |
| 动作别名归一化表 | `multimodal/gui-agent/shared/src/utils/actions.ts:46-137` | ★★★★★ 纯映射表 | **高** |
| 状态机 / 错误码 | `shared/src/types/agent.ts:10-53` | ★★★★☆ | **中** |
| 事件面 `onData/onError` | `sdk/src/types.ts:95-96` | ★★★☆☆ 增量语义需改造 | **中** |
| 新代强类型动作模型 | `multimodal/gui-agent/shared/src/types/actions.ts` | ★★★☆☆ 依赖 `@tarko/agent` | **中高**（设计参考） |
| Electron 宿主 / 云沙箱 | `apps/ui-tars/src/main/**`、`operator-aio/` | ☆ 不可移植 | **低**（仅参考） |

**基线选择：旧代 `packages/ui-tars/sdk`**。理由：自包含、零框架依赖、循环逻辑清晰，可直接嵌入 OpenAWork 工具执行层；新代 `multimodal/gui-agent/*` 建立在 `@tarko/agent` 上，会与 OpenAWork 自有状态机/网关/流式体系冲突。仅单独抄录新代的**动作别名归一化表**。

### 二、动作空间差距（UI-TARS vs OpenAWork）

UI-TARS 提示词动作空间（`sdk/src/constants.ts:55-66`）：`click / left_double / right_single / drag / hotkey / type / scroll / wait / finished / call_user`

OpenAWork `desktop_control` 现状（`services/agent-gateway/src/tools/desktop-control.ts:32-86`）：`status / screenshot / click / type / key / hotkey / scroll / wait`

| 缺失动作 | 说明 | 实现成本 |
|---|---|---|
| `drag` | 拖拽（起点→终点） | 中（需 down/move/up 序列） |
| `mouse_move` | 单纯移动 | 低 |
| `press` / `release` | 独立按键按下/抬起 | 低 |
| `long_press` | 长按 | 低（组合 down + wait + up） |
| `open_app` | 启动应用 | 高（安全风险大，**建议不做**） |

另缺**归一化坐标输入**（现仅收绝对 `x/y`）。

### 三、OpenAWork 对接面（已具备，无需重建）

| 能力 | 位置 | 说明 |
|---|---|---|
| 工具契约 | `packages/agent-core/src/tools/tool-contract.ts:4-30` | `execute(input, signal)` + `timeout`（默认 30s） |
| 截图回传模型 | `tool-contract.ts:28` `ToolCallResult.attachments?: InputImageContent[]` | 现成通道 |
| 截图 → artifact | `services/agent-gateway/src/tools/desktop-screenshot-artifact.ts:58-93` | 返回 `input_image` 附件 |
| artifact → base64 | `services/agent-gateway/src/session/stream-session-title.ts:61-86` | 网关自动解析 |
| 视觉能力探测 | `packages/opencode-llm/src/provider/*.ts` `supportsVision` | **仅表示「能看图」，不表示「能输出坐标」** |
| 插件门控 | `services/agent-gateway/src/tools/plugin-tool-settings.ts:58-60` | `isDesktopControlPluginEnabledForUser` |
| 外层 agent 循环 | `services/agent-gateway/src/routes/stream.ts:2734` | `for (let round = 1; ; round += 1)` |
| 工具执行入口 | `services/agent-gateway/src/tools/tool-sandbox.ts` | 权限 + 审计 + 门控 |
| 桌面控制桥 | `apps/desktop/src-tauri/src/desktop_control_bridge.rs` | Tauri loopback HTTP + Bearer |
| 各平台驱动 | `apps/desktop/src-tauri/src/desktop_control_native_{macos,windows,linux}.rs` | shell 命令 |

### 四、核心障碍

1. **模型层缺「坐标输出」能力声明**：`supportsVision` ≠ grounding 能力，需新增显式能力位。
2. **循环归属冲突**：GUI 需「截图→VLM→动作」内循环，与现有 `runModelRound` 轮次模型语义不同，必须封装。
3. **超时预算不足**：工具默认 30s，GUI 循环需 300s+。
4. **动作面缺失**：见上表。
5. **无坐标输入通道**：`click` 仅接受绝对像素。

## Solution Design

### 三形态对比

#### 方案 A：GUI Agent 作为单个工具（`computer_use`）

```
外层模型 → computer_use(instruction) → [内嵌循环: 截图→VLM→动作→执行 ×N] → 结果 + 关键截图
```

| 维度 | 评价 |
|---|---|
| 改动量 | 小 — 1 个工具 + 1 个 Runner 模块 |
| 复用现有链路 | ✅ 权限门控 / 审计 / 插件开关 / 截图 artifact 全复用 |
| 进度可见性 | ❌ 外层模型看不到中间步骤 |
| 内层 VLM 计费 | ❌ 绕过 `runModelRound`，需自接用量统计 |
| 超时 | ⚠️ 需 300s+，长任务仍会断 |

#### 方案 B：GUI Agent 作为独立 Runner / 子会话

```
外层模型 → computer_use → 创建 GUI 子会话（类似 task 工具）
                              └─ GUI Runner 内循环 → 每步事件 → SSE → 前端可见
```

| 维度 | 评价 |
|---|---|
| 改动量 | 大 — 需接入会话持久化、事件投影、SSE、取消机制 |
| 进度可见性 | ✅ 每步实时推送 |
| 内层 VLM 计费 | ✅ 走统一 Provider/用量链 |
| 超时 | ✅ 后台运行，不受工具 timeout 限制 |

#### 方案 C：主模型直接输出动作（否决）

把 GUI 动作作为普通工具暴露给主模型，由其自行看图决策。否决理由：通用 LLM grounding 能力远弱于专用 GUI 模型；每步占用主上下文导致 token 爆炸；与 `desktop_control` 职责重叠造成工具面混乱。

### 推荐路线：A → B 分阶段

| 阶段 | 形态 | 改动量 | 目标 |
|---|---|---|---|
| **Phase 0** | 能力补齐 | 小 | `desktop_control` 具备 GUI Agent 所需动作面与坐标协议 |
| **Phase 1** | 方案 A（工具形态） | 中 | 跑通「自然语言 → 多步自动操作 → 结果」闭环 |
| **Phase 2** | 方案 B（Runner 形态） | 大 | 进度实时可见、可取消、用量入账、前端可视化 |

### 关键架构决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 目标环境 | **本地桌面优先**（远端另立项） | 复用现有 Tauri 桥，无需新建执行通道 |
| 模型路径 | 路径 A → B → C 递进（决策 1 待定） | 零成本起步，按 grounding 精度升级 |
| 移植基线 | 旧代 `packages/ui-tars/sdk` | 自包含、零框架依赖；新代 `@tarko/agent` 与自有体系冲突 |
| 控制执行层 | **保留** Tauri 桥 + 系统命令 | Linux 覆盖更好、零第三方依赖、安全边界清晰 |
| GUI 循环的 VLM 调用 | 走 OpenAWork Provider 层 | 统一密钥/用量/审计 |
| 模型选择 | 新增 `supportsGuiGrounding` 能力位 | 避免通用模型跑出低成功率 |
| 截图回传 | 复用 `attachments: InputImageContent[]` | 现成通道 |
| 图片窗口 | `MAX_IMAGE_LENGTH = 5` 滑动窗口 | 控制 token 成本 |
| 权限 | 复用插件门控 + `ensurePermissionForTool` | 不新增权限体系 |
| 循环上限 | `MAX_LOOP_COUNT = 100` | 防失控 |

## Implementation Plan

### Phase 0：能力补齐（低风险，独立可交付）

- [ ] **T-01** 新增坐标换算模块 `packages/agent-core/src/gui/coordinates.ts`：实现 `0–1000 → 0–1 → 像素中心`（含 DPR）；统一坐标语义为「逻辑截图尺寸」
- [ ] **T-02** 移植动作解析器 `packages/agent-core/src/gui/action-parser.ts`：去 `lodash.isnumber`（改 `Number.isFinite`）、去 `console.error`（改 logger）、去 `any`/`ts-ignore`、补 `.js` 扩展名
- [ ] **T-03** 新增 `packages/agent-core/src/gui/action-types.ts`：动作类型联合 + 抄录新代别名归一化表（`left_click → click` 等）
- [ ] **T-04** 扩展 `desktop_control` Zod schema：新增 `drag` / `mouse_move` / `press` / `release` / `long_press`（`services/agent-gateway/src/tools/desktop-control.ts:32-86`）
- [ ] **T-05** `desktop-tool-parameters.ts` 支持归一化坐标输入：`box: [x1,y1,x2,y2]`（0–1000）与绝对 `x/y` 二选一
- [ ] **T-06** 三平台 Rust 驱动补齐 `drag` / `mouse_move` / `press` / `release`（`apps/desktop/src-tauri/src/desktop_control_native_{macos,windows,linux}.rs`），并让 `status` 能力位正确上报
- [ ] **T-07** 前端插件面板文案对齐新动作（`apps/web/src/pages/settings/plugins/plugins-tab-content.tsx`）

**Phase 0 不改架构，纯增量，可独立发版。**

### Phase 1：`computer_use` 工具（方案 A）

**新增模块**（`packages/agent-core/src/gui/`，遵守 1500 行/文件上限与 kebab-case）：

```
packages/agent-core/src/gui/
├── coordinates.ts          # T-01
├── action-parser.ts        # T-02
├── action-types.ts         # T-03
├── constants.ts            # T-08
├── operator.ts             # T-09
├── screenshot-scaler.ts    # T-10
├── gui-agent-runner.ts     # T-11
└── index.ts                # 统一导出
```

**执行层适配**（`services/agent-gateway/src/tools/gui/`）：

```
desktop-control-operator.ts   # T-12
computer-use-tool.ts          # T-13
```

- [ ] **T-08** `constants.ts`：动作空间 prompt 模板 + 像素上限（V1.0=2700×28²、Doubao=5120×28²、V1.5=16384×28²）+ 循环上限
- [ ] **T-09** `operator.ts`：`Operator` 抽象（`screenshot()` / `execute()`）+ `OperatorCapabilities`
- [ ] **T-10** `screenshot-scaler.ts`：移植像素上限压缩（`utils.ts:193-226`），复用项目现有图像库，**不新增 `jimp` 依赖**
- [ ] **T-11** `gui-agent-runner.ts`：移植主循环（`GUIAgent.ts:130-433`）——**必须去除 `globalThis` 单例**（改用实例级上下文），回调改为事件发射器，按职责拆分避免单文件超限
- [ ] **T-12** `desktop-control-operator.ts`：把现有 `desktopControlManager` 包装为 `Operator`
- [ ] **T-13** `computer-use-tool.ts`：`ToolDefinition` 定义 + 注册（`timeout: 300000`）
- [ ] **T-14** 新增 `supportsGuiGrounding` 能力位（`packages/opencode-llm/src/provider/*.ts`）+ 无可用模型时明确报错；支持三路径切换（A 通用模型 / B 云端 GUI endpoint / C 本地部署）
- [ ] **T-14b** 权限接线：复用现有 `permissionMode`（默认 `ask`）+ 插件门控，**不新增权限机制**（决策 3）
- [ ] **T-15** 内层 VLM 调用接入用量统计（复用 `token-usage`）
- [ ] **T-16** 端到端验证脚本：真实桌面跑通 `computer_use("打开系统设置")`

**`computer_use` 工具签名（草案）**：

```ts
inputSchema = z.object({
  instruction: z.string().min(1),                       // 自然语言任务
  maxSteps: z.number().int().min(1).max(100).optional(),
  modelId: z.string().optional(),                       // 指定 GUI 模型
});
outputSchema = z.string();  // JSON: { success, steps, summary, lastScreenshotArtifactId }
```

### Phase 2：GUI Runner / 子会话（方案 B）

> **范围**：仅本地桌面。远端沙箱执行通道**不在本方案**，需另行立项（决策 2）。

- [ ] **T-17** 新增 `GuiAgentRunner`，注册为后台子会话（参考 `task` 工具的子会话机制）
- [ ] **T-18** 每步产出事件（screenshot / action / status）接入 session event 投影 + SSE
- [ ] **T-19** 前端 GUI 执行可视化面板（截图时间线 + 动作列表），`packages/shared-ui` + `apps/web`
- [ ] **T-20** 取消 / 暂停（`abort()` 映射到现有取消机制）
- [ ] **T-21** 用量入账：内层 VLM token 计入会话用量

## 验证契约

| 阶段 | 验证方式 | 通过标准 |
|---|---|---|
| T-01 | 单测 | `0-1000 → 像素`、`0-1 → 像素`、DPR=2 三种输入输出精确值 |
| T-02 | 单测（移植上游测试） | 多动作拆分、坐标框/点解析、别名归一化、异常回退 |
| T-04/T-05 | schema 单测 | 新旧两种坐标输入均正确换算 |
| T-06 | 手工 + `status` 断言 | 三平台能力位正确；drag/move/press 真实生效 |
| T-16 | 真实端到端 | 真实桌面完成任务；无 GUI 模型时返回明确错误 |
| T-15 | 用量观测 | 单任务 token 消耗在可接受区间 |
| T-17~T-21 | 真实端到端 | 取消/暂停可用；事件流前端正确渲染；用量与实际一致 |

**门禁**：`pnpm typecheck` + `pnpm lint` + 各包单测全绿；改动文件 ESLint 0 error。

## 代码资产映射表

| 源（UI-TARS） | 目标（OpenAWork） | 改造要求 |
|---|---|---|
| `action-parser/src/actionParser.ts` | `agent-core/src/gui/action-parser.ts` | 去 `lodash.isnumber`；去 `console.error`；补 `.js` |
| `sdk/src/utils.ts:193-226` | `agent-core/src/gui/screenshot-scaler.ts` | 用项目图像库替换 `jimp` |
| `sdk/src/utils.ts:29-56` | `agent-core/src/gui/coordinates.ts` | 统一坐标语义注释（logical） |
| `sdk/src/constants.ts:55-66` | `agent-core/src/gui/constants.ts` | 按 OpenAWork 能力裁剪动作空间 |
| `sdk/src/GUIAgent.ts:130-433` | `agent-core/src/gui/gui-agent-runner.ts` | **必须**去 `globalThis` 单例；改事件发射器；拆文件 |
| `sdk/src/types.ts:66-73` | `agent-core/src/gui/operator.ts` | 保留 2 方法契约 |
| `multimodal/.../utils/actions.ts:46-137` | `agent-core/src/gui/action-types.ts` | 仅抄别名映射表 |

**AGENTS.md 强制改造项**：禁止 `@ts-ignore` / `@ts-expect-error` / `any`（源码 `GUIAgent.ts:1`、`Model.ts:211`、`actionParser.ts:317`、`useContext.ts:11` 均含）；禁止空 catch；禁止裸 `Error`（改用 `src/error/`）；禁止从 `dist/` 导入；文件 ≤1500 行；命名 kebab-case；导入带 `.js`；导出经 `src/index.ts`。

## 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 通用模型无 grounding 能力 | 成功率极低 | T-14 能力位；未配置 GUI 模型时工具直接报错 |
| 坐标语义不一致（DPR） | 点击偏移 | T-01 统一为逻辑尺寸；单测锁定 |
| 内层 VLM 绕过用量统计 | 成本不可见 | T-15 接入；Phase 2 完善 |
| 每步截图导致 token 爆炸 | 成本失控 | 像素上限压缩 + 5 图滑动窗口 |
| 工具 timeout 截断长任务 | 中途失败 | Phase 1 设 300s；Phase 2 改后台 Runner |
| 失控循环 | 破坏用户环境 | 循环上限 + 可取消 + 危险动作二次确认 |
| 安全：可操作任意应用 | 高风险 | 强制插件门控 + 权限阶梯（`ask` 默认）+ 审计日志 |
| 与 `desktop_automation` 混淆 | 工具面混乱 | 明确边界：`desktop_control`=OS 级；`desktop_automation`=浏览器 DOM 级；`computer_use`=视觉闭环（复用前者执行层） |
| 上游停更 | 维护困难 | 只借鉴算法与协议，不引入上游依赖，代码自持 |

## Gate 0：决策记录

| # | 决策项 | 结论 | 日期 |
|---|---|---|---|
| 1 | GUI 模型路径 | ⏸️ **待用户选择**（见下节三路径分析） | — |
| 2 | 目标环境 | ✅ **本地桌面优先**；远端沙箱列为后续独立立项（架构预留，不在本方案范围） | 2026-09-21 |
| 3 | 权限档位 | ✅ **沿用现有权限体系**：复用 `permissionMode`（默认 `ask`）+ 现有插件门控，**不新增权限机制** | 2026-09-21 |
| 4 | 图像处理依赖 | ✅ **复用现有图像库**，不新增 `jimp` 等依赖 | 2026-09-21 |
| 5 | Phase 0 交付顺序 | ✅ Phase 0 先行独立交付（低风险、可独立验证） | 2026-09-21 |
| — | 开发时机 | ⏸️ **暂不开发**（用户指示：先调整方案决策） | 2026-09-21 |

## 决策 1 分析：GUI 模型三路径

**背景**：`click(start_box='[x1,y1,x2,y2]')` 依赖模型的 **grounding（视觉定位）**能力。OpenAWork 现有 `supportsVision` 只声明「能看图」，**不声明「能输出坐标」**，故需明确路径。

| 路径 | 做法 | 需外跑模型 | 精度 | 复杂度 | 成本 |
|---|---|---|---|---|---|
| **A. 复用现有 Provider** | 用现有视觉模型（GPT-4o/Claude/Gemini 等）按 UI-TARS prompt 格式约束输出 | ❌ 否 | 低-中 | 低 | 现有额度 |
| **B. 接云端 GUI 模型 API** | 配置提供 grounding 的 OpenAI 兼容 endpoint（如 Doubao-UI-TARS 等） | ❌ 否 | 高 | 低 | 按调用计费 |
| **C. 本地部署开源权重** | 本地跑 UI-TARS-1.5-7B（vLLM/Ollama，需 GPU） | ✅ 是 | 高 | 高 | 硬件+运维 |

**关键结论**：
- 路径 A / B **均无需自建部署**，是**现成能力**（Provider 体系已支持自定义 endpoint；`input_image` 通道与 `attachments` 已具备）。
- UI-TARS 新代 SDK 本身即支持 prompt-engineering 路线（`GUIAgentToolCallEngine`），证明不接专用模型亦可运行，仅精度打折。
- **推荐推进顺序**：Phase 1 起步走 **路径 A**（零成本验证骨架）→ 精度不足则切 **路径 B**（配置即用）→ 仅在需要完全离线 / 数据不出本地时才考虑 **路径 C**。
- 三路径**均不需改动架构**；仅需新增 `supportsGuiGrounding` 能力位区分模型。

**真正难点不在代码**，而在模型 grounding 质量、每步截图的成本与延迟。


## Notes

- 本方案基于 `temp/gui-agent-integration-plan.md` 的代码级分析（4 路并行 explore + librarian 外部调研）重组而成
- 所有 UI-TARS 代码位置引用均为 `temp/UI-TARS-desktop/` 内相对路径；该目录已被 `.gitignore` 忽略
- 上游关键陷阱：`README` 称 `maxLoopCount` 默认 25，代码实际为 **100**；`Conversation.screenshotContext.size` 注释称 physical 但实为逻辑尺寸，与 `InvokeParams.screenContext`（logical）需统一
- 上游 `actionParser` 无动作枚举，是通用 `^(\w+)\((.*)\)$` 语法解析器；动作词表由 prompt / operator 决定
- 执行前须通过 Gate 0 + 用户显式批准（Gate 1：Plan First）


