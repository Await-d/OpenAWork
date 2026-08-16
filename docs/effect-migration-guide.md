# Gateway Effect 基础层迁移指南

本文记录 agent-gateway 当前可复用的 Effect 4 基础层。基础层是增量接入点：现有
Fastify、SQLite 和 Promise API 继续工作，新的运行时逻辑可以逐步使用 Effect
Service / Layer，而不必一次性重写入口。

## 依赖与编译配置

当前仓库统一使用 `effect@4.0.0-beta.83`。`@effect/platform-node` 与该版本的
peer dependency 对齐；不要在同一个包中混用 Effect 3 的 `@effect/platform`，否则
会得到两套不兼容的 `Context`、`Stream` 和运行时类型。

`packages/opencode-llm/tsconfig.json` 与 `services/agent-gateway/tsconfig.json`
显式开启了 `downlevelIteration`。这保持 Effect Generator 在不同 TypeScript 输出
目标下的迭代语义一致。

## Service 依赖图

```text
makeEffectRuntime
├── LoggerService       -> 可替换的结构化记录 sink
├── ConfigService       -> 环境变量边界解析后的 GatewayConfig
└── DiagnosticsService  -> 进程内计数器与事件快照
```

Service 定义位于 `services/agent-gateway/src/services/`，共享类型位于
`services/agent-gateway/src/types/effect-services.ts`。每个 live Layer 都可以在
测试中由 `Layer.succeed` 替换，不需要修改业务代码。

## 运行 Effect 程序

```ts
import { Effect } from 'effect';
import { ConfigService, makeEffectRuntime } from './runtime/effect-runtime.js';

const runtime = makeEffectRuntime();
const host = await runtime.runPromise(
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return yield* config.get('gatewayHost');
  }),
);
await runtime.dispose();
```

对于一次性的、只需要默认上下文的程序，可以使用 `runEffect`；需要 Service 的
程序应使用 `makeEffectRuntime` 返回的 `ManagedRuntime` 或 `runWithRuntime`。
长生命周期入口必须在关闭时调用 `dispose`，以释放未来 Layer 引入的资源。

## 配置边界

`loadGatewayConfig` 只在边界读取环境变量并转换为 `GatewayConfig`。端口必须是
`1..65535` 的整数，非法值回落到 `3000`；空主机名回落到 `127.0.0.1`。业务层
不要再次读取 `process.env`，而应通过 `ConfigService` 获取已经解析的值。

## 日志与诊断

`LoggerService.live({ sink })` 支持注入 sink，默认输出 JSON 记录。记录包含
`level`、`message`、可选 `fields` 和毫秒时间戳。`DiagnosticsService` 提供
`record`、`snapshot`、`reset` 三个 Effect 操作；计数器按事件名累加，适合为
stream、provider 和路由迁移增加低耦合运行指标。

## 增量迁移约束

1. 新代码优先返回 `Effect.Effect<A, E, R>`，在 Fastify 边界使用
   `ManagedRuntime.runPromise` 适配 Promise。
2. 不要把 Effect 4 API 与 Effect 3 API 混写。Effect 4 的运行函数位于
   `Effect.runPromise`，可复用 Layer 的运行时是 `ManagedRuntime.make`。
3. 现有 legacy API 保持原样；只有完成单元测试和真实运行面验证后，才把具体调用
   点切换到新的 Service。
4. Service 的实现通过 Layer 注入，禁止在业务函数中直接创建全局可变单例。
