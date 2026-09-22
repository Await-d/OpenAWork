# OpenAWork Gateway (.NET)

> **状态：未启用 / 不在维护范围。**
>
> 该 .NET 版网关是历史并行实现，当前**不参与**仓库的构建、类型检查、测试与 CI，也不再随功能迭代同步。产品侧决定「.NET 版本不需要管理」。
>
> **后续所有功能改动只需在 TypeScript 网关 `services/agent-gateway` 内进行，本目录无需同步调整。**
>
> 如需重新启用，请先在 CI 与根脚本中显式接入，并补齐与 TS 网关的语义对齐（例如会话回退等已明确不镜像的行为，见 `docs/architecture/adr-turn-rollback-hard-delete.md`）。

## 事实依据（截至本次备注）

- 根 `package.json`（含 `workspaces` 字段）未声明任何 `dotnet` 脚本；`.github/workflows/` 无任何 .NET 构建或测试任务。
- 仓库根 `README.md` 仍将其列为「.NET 方案」，但仅作结构说明，不代表处于维护状态。
- 与 TS 网关的差异已有正式记录：`docs/architecture/adr-turn-rollback-hard-delete.md` 明确 `.NET` 网关不在支持范围。

## 目录结构

```
services/agent-gateway-dotnet/
├── OpenAWork.Gateway.DotNet.sln
├── Directory.Build.props
├── scripts/                 # 本地手动构建 / 冒烟脚本（非 CI 入口）
│   ├── publish-sidecar.sh
│   ├── smoke-sidecar.sh
│   └── verify-local.sh
├── src/
│   ├── OpenAWork.Gateway.Host/               # HTTP/WS 入口（Program.cs）
│   ├── OpenAWork.Gateway.Application/        # 用例 / MediatR
│   ├── OpenAWork.Gateway.Contracts/
│   ├── OpenAWork.Gateway.Domain/
│   ├── OpenAWork.Gateway.Infrastructure/
│   ├── OpenAWork.Gateway.Persistence.EFCore/
│   ├── OpenAWork.Gateway.Persistence.Sqlite/
│   └── OpenAWork.Gateway.Persistence.PostgreSql/
└── tests/
    ├── OpenAWork.Gateway.UnitTests/
    ├── OpenAWork.Gateway.IntegrationTests/
    └── OpenAWork.Gateway.ScenarioVerification/
```

> 本备注仅用于说明现状，不改变任何运行时行为。维护者请勿在未重新启用 CI 的情况下把 TS 网关的功能改动镜像到这里。
