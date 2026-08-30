<verdict>FAIL</verdict>
<confidence>0.98</confidence>
<findings>

1. 月度用量持久化仅保存 input/output token，新增 cacheRead/cacheWrite token 未入库且查询 API 不返回。`persistMonthlyUsageRecord` 计算了缓存成本，但 INSERT/UPSERT 只写 `input_tokens`,`output_tokens`,`cost_usd`；表定义也无缓存列。证据：services/agent-gateway/src/session/usage-records-store.ts:38-44；services/agent-gateway/src/infra/db.ts:710-719；services/agent-gateway/src/routes/usage.ts:42-55。重启或月度查询后缓存 token 数量丢失，违反月度持久化/记录保真目标。
2. 数据校验总体健全：normalizeTokenCount 拒绝 NaN/Infinity/负数/非安全整数及 >1e9；normalizeOptionalTokenPrice 拒绝非有限、负数及 >1e6；models.dev 映射使用该校验。证据：packages/agent-core/src/provider/utils.ts:101-119；services/agent-gateway/src/provider/models-dev-discover.ts:82-90；services/agent-gateway/src/provider/provider-config.ts:127-141。
3. 团队流式/非流式路径将缓存 token 计入事件、成本并持久化，纯缓存调用不会被零 token 门槛过滤。证据：services/agent-gateway/src/routes/stream-team-events.ts:119-180；services/agent-gateway/src/routes/workflow-llm.ts:212-250；services/agent-gateway/src/team/team-usage-records-store.ts:147-193。
4. 兼容性风险（非阻塞）：RunUpstreamGenerateResult 新增必填 cacheReadTokens/cacheWriteTokens，测试和实现已更新；若包外消费者构造该结构将产生编译不兼容，但仓内检索未发现遗漏。
</findings>

<blocking_issues>

- violatedCriterion: 月度持久化必须保留缓存 token（cache_read/cache_write），并可供月度用量结果读取。observation: 月度表没有缓存列，持久化 UPSERT 和 /usage/records、/usage/breakdown 查询均丢弃缓存 token。evidencePointer: services/agent-gateway/src/infra/db.ts:710-719; services/agent-gateway/src/session/usage-records-store.ts:38-44; services/agent-gateway/src/routes/usage.ts:42-55.
</blocking_issues>
</verdict>
