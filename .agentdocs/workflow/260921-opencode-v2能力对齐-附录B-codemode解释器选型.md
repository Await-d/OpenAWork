# 附录 B：CodeMode 解释器选型对比

- **关联主方案**：[260921-opencode-v2能力对齐.md](260921-opencode-v2能力对齐.md)（Phase 3 / T-08…T-12，D-1 = 全量）
- **结论先行**：首选 **移植上游自研解释器**（纯 TS，零原生依赖，兼容 `bun build --compile`）；备选 `quickjs-emscripten`（WASM）；**明确排除** `isolated-vm` 与 `node:vm`。

## B.1 上游实现事实（v2.0.12）

- **位置**：`packages/codemode/src/interpreter/*`，**15 个文件 / 4262 行**（`interpreter.ts`/`objects.ts`/`promises.ts`/`generators.ts`/`native.ts`/`intrinsics.ts`/`references.ts`/`scope.ts`/`extensions.ts`/`callback.ts`/`execute.ts`/`globals.ts`/`limits.ts`/`model.ts`/`errors.ts`）
- **性质**：**手写的 JS 子集解释器**，不是 `eval`/`vm`
- **全局白名单**（`globals.ts`，显式表驱动）：`tools`、`search`、`Object/Array/Math/JSON/console/Promise/Symbol/Number/String/Boolean/Date/RegExp/Map/Set/URL/URLSearchParams/Headers/Uint8Array/TextEncoder/TextDecoder`、`parseInt/parseFloat/isFinite/isNaN`、`encodeURI*`/`decodeURI*`、`atob/btoa`、`crypto`、各类 `Error`
- **禁用**：`require`/`import`/定时器/文件系统；`Function` 构造器**显式抛错**（`fn.constructor === Function` 仍成立，但调用即拒绝）
- **限额**（`limits.ts`）：`MAX_STRING_LENGTH=1<<24`、`MAX_ARRAY_LENGTH=10_000_000`、`MAX_PENDING_PROMISES=10_000`、`MAX_VALUE_DEPTH=32`
- **调用级限额**（`codemode.ts:27-40,134-136`）：`timeoutMs`、`maxToolCalls`、`maxOutputBytes`
- **工具桥**：JSON 进出，程序值不越界；`tools.<ns>.<tool>` 与 `tools.<ns>["tool"]` 路径；内置 `search` 分词加权排序

## B.2 候选方案对比

| 维度 | ① 移植上游解释器（纯 TS） | ② quickjs-emscripten（WASM） | ③ isolated-vm（V8 isolate） | ④ node:vm | ⑤ 子进程隔离 |
|---|---|---|---|---|---|
| 隔离强度 | 强（白名单全局、无动态代码） | 强（WASM 沙箱） | 最强（独立 isolate） | **弱：官方明示非安全边界** | 强（进程级） |
| Bun / `bun build --compile` | ✅ 无原生依赖，直接可用 | ⚠️ 需验证 WASM 内嵌到单二进制 | ❌ 原生 addon，编译二进制不可用 | ✅ 但无隔离 | ✅ |
| Node `dev:node` | ✅ | ✅ | ✅ | ✅ | ✅ |
| 新增依赖 | 0 | 1 个 WASM 包（~MB 级） | 原生模块（构建链） | 0 | 0 |
| 执行性能 | 解释执行，慢于 V8；工具编排够用 | 中（WASM 解释） | 接近原生 | 原生 | 每次起进程开销大 |
| 现代 JS 覆盖 | 上游已覆盖常用子集 | 覆盖较全（QuickJS） | 完整 V8 | 完整 V8 | 完整 |
| async/Promise/工具桥 | 上游已实现（Effect 生成器 + promises） | 需自建 host↔VM handle 桥，async 复杂 | 需自建引用桥 | 直接 | JSON over stdio |
| 与 Effect 栈契合 | ✅ 上游本就是 Effect | ⚠️ 需适配层 | ⚠️ | ✅ | ⚠️ |
| 维护/安全成本 | **最高**（4k+ 行自维护 + 审计） | 低（社区维护） | 低 | — | 中 |
| 与「移植 opencode-llm」策略一致 | ✅ | ❌ | ❌ | ❌ | ❌ |

## B.3 推荐与理由

- **首选 ①**：与 D-1「全量立项」及既有「移植上游」策略一致；**零原生依赖**是硬约束——本仓网关需在 Bun（dev + 桌面 sidecar 单二进制）与 Node（`dev:node`）双运行时可用，`isolated-vm` 类原生 addon 会直接破坏 `bun build --compile`。上游解释器已是 Effect 实现，与本仓栈天然契合。
- **备选 ②**：若希望降低 4k+ 行自维护成本，`quickjs-emscripten` 可行，但**进入执行前必须先验证两点**：① WASM 能否内嵌进 `bun build --compile` 产物；② async/Promise 与工具桥的互操作成本。
- **排除 ③ `isolated-vm`**：原生 addon，与桌面 sidecar 单二进制冲突。
- **排除 ④ `node:vm`**：Node 官方文档明确「不是安全机制」，可被逃逸，不可用于不可信模型代码。
- **⑤ 子进程隔离**：可作**纵深防御的第二层**（如执行环境再套无 FS/无网络的 worker），不作首选（每次调用进程开销大、工具桥协议自建）。

## B.4 与现有系统的接缝（必须遵守）

1. **权限不可绕过**：CodeMode 内每次工具调用**仍必须**经过 `tools/tool-sandbox.ts` 的 `ensurePermissionForTool` 与白名单；CodeMode 的目录预算/资源限额是**额外**约束层，不替代权限门。
2. **输出截断复用**：`execute` 的输出仍走 `tool-output-truncator.ts`；`maxOutputBytes` 是其**内层**上限。
3. **工具快照一致性**：CodeMode 目录应基于**每个请求**的可见工具快照渲染（对齐上游「每请求捕获 definitions/executors」），避免与沙箱白名单/权限映射不一致。
4. **fail-closed 三登记**：`execute` 本身必须同时登记 `tool-definitions.ts` + 沙箱白名单 + 权限类别映射，否则会被 fail-closed 拒绝。
5. **子代理/团队会话**：需明确 `execute` 在 team 会话、clarify 模式、渠道路径下的可见性策略（复用现有 `session-tool-visibility.ts` 模式）。

## B.5 主要风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 解释器逃逸 | 自研解释器若有实现缺陷，可能突破沙箱 | 全局白名单 + 禁 `Function` + 限额 + 安全评审；必要时叠加子进程隔离 |
| 移植工作量 | 4262 行 + 依赖 `catalog`/`instructions`/`web` 模块 | 分批：先解释器内核 + 工具桥，再目录预算/增量指令 |
| WASM 打包 | 若选 ②，单二进制内嵌未验证 | T-08 前做 spike 验证，不通过则回退 ① |
| 上下文收益不达预期 | 全量工具面下目录预算可能反而更贵 | 先做目录预算与 `search` 的实测对比，再决定暴露面 |
