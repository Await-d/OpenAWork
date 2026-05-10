# 260509 — P2 并行 websearch rollout

属于 [260509-opencode借鉴升级总览](260509-opencode借鉴升级总览.md) 的 Phase 2。

## Task Overview

把 `web-search` 工具从单 provider 顺序调用升级成 **多 provider 并行 race + 第一有效结果赢**，对齐 opencode `a43d3e0e1` (#26227)。

## Current Analysis

`packages/agent-core/src/tools/web-search.ts` 当前是单 provider 顺序：

```ts
type WebSearchProvider = 'duckduckgo' | 'tavily' | 'exa' | 'serper' | 'searxng' | 'bocha' | 'zhipu' | 'google' | 'bing';
// switch (provider) { ... } 一次只调一个
```

问题：

- DuckDuckGo 频繁 rate-limit，单 provider 失败就整体失败
- 用户配多个 provider 也只能在不同会话里换，没法在同一次搜索里冗余
- 没有"哪个 provider 更快"的反馈信号

## Solution Design

### S1: 配置升级

`web-search` 配置增加多 provider 数组：

```ts
export interface WebSearchConfig {
  /** 旧字段保持兼容（被 providers 优先覆盖） */
  provider?: WebSearchProvider;
  apiKey?: string;
  baseUrl?: string;

  /** 新字段：并行 rollout */
  providers?: Array<{
    provider: WebSearchProvider;
    apiKey?: string;
    baseUrl?: string;
    /** 0–100 权重，控制并行 race 时的"领先窗口" */
    weight?: number;
  }>;

  /** 并行策略 */
  rolloutMode?: 'first-success' | 'merge' | 'sequential';

  maxResults?: number;
  timeout?: number;
}
```

`rolloutMode` 三档：
- `first-success`（默认）：所有 provider 同时发，第一个有效返回赢，其他 abort
- `merge`：等所有 provider（限 timeout 内），合并去重 URL，按权重排序，截 maxResults
- `sequential`：保持旧行为（向后兼容）

### S2: 并行执行

```ts
async function searchAcrossProviders(
  query: string,
  cfg: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  const providers = normalizeProviders(cfg);   // 兼容旧 provider 字段
  if (providers.length === 0) throw new Error('no provider configured');
  if (cfg.rolloutMode === 'sequential') {
    return searchSequential(query, providers, signal);
  }

  const controllers = providers.map(() => new AbortController());
  signal.addEventListener('abort', () => controllers.forEach(c => c.abort()));

  const promises = providers.map((p, i) =>
    searchOne(query, p, controllers[i].signal).then(
      r => ({ ok: true, result: r, provider: p.provider } as const),
      e => ({ ok: false, error: e, provider: p.provider } as const),
    ),
  );

  if (cfg.rolloutMode === 'merge') {
    const settled = await Promise.allSettled(promises);
    return mergeResults(settled, cfg);
  }

  // first-success
  const winner = await Promise.any(promises.map(p => p.then(r => r.ok ? r : Promise.reject(r))));
  controllers.forEach(c => c.abort());
  return winner.result;
}
```

注意：`Promise.any` 只在所有 provider 全失败时 reject，符合"全失败才 fail"语义。

### S3: 结果合并 (`merge` 模式)

去重键 = URL canonical 形式（去 utm_*，trailing slash 归一），保留最先出现的 title/snippet。按 provider 权重对结果加分。

### S4: 用量与可观察性

- 每次搜索写一条结构化日志：`{ providers, durations: { ddg: 800ms, tavily: 600ms }, winner: 'tavily', mode: 'first-success' }`
- 暴露最近 N 次搜索的 provider 成功率给 settings 页面（可后续做）

### S5: 测试覆盖

- mock fetch，测：
  - 1/3 provider 成功 → first-success 返回成功的
  - 全失败 → 抛出汇总错误（含每个 provider 的错误）
  - merge 模式：3 个 provider 各返 5 条结果，合并后去重排序
  - timeout：超过 cfg.timeout 还没赢家 → reject

## Complexity Assessment

- 原子步骤：5 → +2
- 并行流：单文件改动为主 → 0
- 模块：`packages/agent-core/src/tools/web-search.ts` + settings 类型定义 → 0
- 单步 >5 min：是（合并模式逻辑要小心）→ +1
- 需持久化 review → +1
- OpenCode 可用：否 → 0
- **合计：4 → Full orchestration**
- **Routing rationale**：跨进程/取消语义微妙，独立 workflow 收口

## Implementation Plan

### Phase 1: core 层类型与函数 ✅
- [x] T-WEB-01: 新增 `WebSearchMultiEntry` / `WebSearchMultiConfig` / `WebSearchRolloutMode` 类型（`packages/agent-core/src/tools/web-search.ts` 末尾），保留旧 `WebSearchConfig` 不改，向后兼容
- [x] T-WEB-02: 导出 `searchMultiProvider` + `canonicaliseSearchUrl`（`packages/agent-core/src/index.ts`），**不改 LLM-facing 工具 schema** — 让调用方（gateway）自行决定何时用多 provider，避免让 LLM 参与 apiKey 路由
- [x] T-WEB-03: 合并到现有 index.ts 的 `export { webSearchTool, ... }` 块

### Phase 2: 并行执行 ✅
- [x] T-WEB-04: `searchFirstSuccess` — `Promise.any` + 赢家抢先、其他 `AbortController.abort()` 终止
- [x] T-WEB-05: `searchMerge` — `Promise.allSettled` + `timeoutMs`、`canonicaliseSearchUrl` 去重（去 utm_/gclid/ref_ 等 tracking 参数、参数排序、末尾斜杠归一、host 小写），按 weight 降序排序，tie-break 用 provider 在 config 中的次序
- [x] T-WEB-06: parent signal + per-provider `AbortController`，parent abort 触发 forEach abort；merge 的 timeoutMs 独立计时器
- [x] T-WEB-BONUS: `searchSequential` 作为显式 fallback（保留旧 provider 顺序语义），默认 rolloutMode=`sequential` 向后兼容

### Phase 3: 验证 ✅
- [x] T-WEB-V-01: 14 项单元测试，覆盖：
  - `canonicaliseSearchUrl` 5 项（utm_/gclid strip、host 小写、trailing slash、参数排序、非 URL 回退）
  - sequential 的 fall-through + 组合错误
  - first-success 的赢家返回 + 全失败组合错误 + parent abort 传递
  - merge 的去重+weight 排序 + 空结果提示 + 全失败组合错误
  - 空 providers 列表拒绝
- [x] T-WEB-V-02: typecheck 通过 + agent-gateway 436/436 未受影响

### Phase 4: Settings UI — 推迟
- [ ] T-WEB-07: settings 页"并行 rollout"开关与 provider 列表（推迟到 UI 升级批次）
- [ ] T-WEB-08: 文档说明 `rolloutMode` 三档差异（已在 JSDoc 中注释，独立 README 推迟）

## Verification Commands

```bash
pnpm --filter @openawork/agent-core typecheck
pnpm --filter @openawork/agent-core exec vitest run src/tools/web-search.test.ts
```

## Risks & Rollback

- **API 配额加倍**：`first-success` 模式下所有 provider 同时计费，用户应明确知情。设置项默认走 `sequential`，并行需要显式开启
- **取消失败的 provider**：HTTP fetch abort 不一定立刻断网络层，但用户已经拿到 winner 结果，性能影响可忽略
- **错误聚合**：所有 provider 失败时把每个错误一起抛，避免误判

## Notes

- 不影响其它 web 工具（`webfetch` / `web_static`）
- 完成后在 `index.md` `Coding Conventions` 加："多 provider 工具默认顺序，并行 rollout 必须显式开启"
