# 缓存上下文与多级上下文计费复查

日期：2026-08-25
范围：Fastify/TypeScript 主网关、Web、shared-ui、web-client。

## 结论

主网关与 Web 主链路通过。复查中发现并修复了：

- 月度 usage_records 原先没有完整累加缓存读写 token；现已迁移、写入、UPSERT 和 API 返回。
- 非流式 workflow 原先只发团队 usage 事件；现同时写入月度 usage_records。
- 设置/用量页原先丢失缓存读写单价和 contextWindow；现已解析并展示。
- 重复 modelId 原先可能命中错误 provider 价格；现由 providerId/modelId 组合优先匹配。
- 月度用量面板原先只显示普通输入/输出 token；现显示缓存读取/写入 token。

## 复查结果

| 复查面     | 结果            | 证据                                                                                                                |
| ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| 目标/约束  | 主 TS 链路 PASS | models.dev → ProviderManager → model-router → contextWindow；四类 token 计费、缺价回退、纯缓存不重复估算            |
| 运行 QA    | PASS            | Web 278 文件/1690 测试；shared-ui 8 文件/67 测试；生产构建成功；Chromium 1280x900 返回 HTTP 200 并生成 1280x900 PNG |
| 代码质量   | PASS（修复后）  | workflow 月度持久化与 providerId 价格匹配已补；agent-core/gateway/web/shared-ui/web-client 类型检查均 0             |
| 安全       | PASS            | 认证、userId 隔离、SQL 参数绑定、token/price 边界校验通过                                                           |
| 上下文挖掘 | 条件通过        | Fastify 主网关闭环；.NET 独立网关仍未同步，保留为非主网关后续工作                                                   |

## 非阻塞遗留项

1. `services/agent-gateway-dotnet/**` 仍未加入缓存价格、缓存 token 列和 contextWindow 契约。项目 AGENTS.md 将 Fastify 标为主网关，因此本轮不扩展该独立实现。
2. `/usage/breakdown` 当前仍是月度总额接口，未形成按模型拆分的缓存读/写成本明细；实际缓存 token 已在 records 与 UsageDashboard 可见，月度总额已包含四类费用。若产品需要按模型/费用类别审计，应后续增加组件费用列或按调用明细聚合。
3. Web 聊天预计费用保留了前端展示层公式；服务端账本仍以 `calculateTokenUsageCost` 为唯一计费源，前端价格来自受校验的 settings API。

## 关键验证

- agent-core provider utils：1 文件/4 测试通过。
- agent-gateway 缓存相关：7 文件/33 测试通过。
- Web 缓存价格/匹配：2 文件/5 测试通过；全量 Web 278 文件/1690 测试通过。
- shared-ui 缓存价格/用量展示：2 文件/3 测试通过；全量 shared-ui 8 文件/67 测试通过。
- `pnpm --filter @openAwork/web build`：exit 0。
- 五包 typecheck：全部 exit 0。
- `pnpm lint:eslint`、`pnpm format:check`、`git diff --check`：全部 exit 0。
- 四个验证产物与回滚验证：见 `.assistant/context-billing-p0-verification/VERIFICATION.txt`。
