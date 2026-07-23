# Provider Catalog 扩展与自定义入口强化设计

**日期**: 2026-07-23  
**状态**: Draft for user review  
**范围**: 内置模型平台扩展 + 自定义提供商表单强化 + models.dev 自动发现导入  
**推荐方案**: B（一等公民 catalog + models.dev 发现层）

---

## 1. 背景与目标

OpenAWork 的 Provider 体系已有「单一事实来源」`PROVIDER_CATALOG`（`packages/agent-core/src/provider/catalog.ts`），当前内置：

- anthropic / openai / deepseek / gemini / ollama / openrouter / qwen / moonshot / mimo
- 另有 `custom` 类型与设置页「新增提供商」表单

缺口：

1. 常见国内外平台（Mistral、智谱、豆包、Groq、SiliconFlow、Azure、xAI、MiniMax、百川、混元、千帆等）未内置。
2. 「更多厂商自动接入」缺少 models.dev 发现/导入路径。
3. 自定义（`custom`）虽在类型下拉里，但缺少引导文案、baseUrl 必填校验与协议说明，入口感偏弱。

### 成功标准

1. 新增一等公民平台出现在「类型」下拉，选中后自动带出显示名、默认 baseUrl、协议、默认模型。
2. 用户可从 models.dev 发现并一键导入未内置厂商为 `custom` 提供商（带模型列表）。
3. 选 `custom` 时表单有清晰引导：baseUrl 必填、协议可选、可立刻加模型。
4. 不破坏现有用户已保存的 providers / active_selection。
5. 新增平台不要求改前端硬编码映射表（继续走 catalog UI 投影 + hydrate）。

---

## 2. 非目标（本批不做）

- Azure AD / Entra OAuth 完整企业鉴权（v1 仅 API Key + endpoint）。
- 百度千帆 AK/SK 签名体系（v1 仅 OpenAI 兼容模式预设）。
- 把 `ProviderType` 改成完全动态字符串（避免大范围类型与 thinking 推断回归）。
- 为每个新平台单独实现全新 thinking 协议分支（优先复用已有 style；未知则 `none`）。
- 自动付费开通 / 代管 API Key。
- 替换 models.dev 为其它目录源。

---

## 3. 一等公民平台清单

下列全部写入 `ProviderType` + `PROVIDER_CATALOG`。默认 **`enabledByDefault: false`**（避免空 key 污染默认列表）；用户在设置里添加/启用后再用。

| type          | displayName     | 默认 baseUrl                               | apiKeyEnv              | thinkingStyle                                        | aliases / notes                                               |
| ------------- | --------------- | ------------------------------------------ | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| `mistral`     | Mistral         | `https://api.mistral.ai/v1`                | `MISTRAL_API_KEY`      | `none`                                               | UI logo 已有 `logo-mistralai.svg`；aliases: `mistralai`       |
| `zhipu`       | 智谱 GLM        | `https://open.bigmodel.cn/api/paas/v4`     | `ZHIPU_API_KEY`        | `none`（保守）                                       | aliases: `glm`, `bigmodel`                                    |
| `doubao`      | 豆包 / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | `ARK_API_KEY`          | `none`                                               | aliases: `volcengine`, `ark`, `volces`；模型 id 常为接入点 id |
| `groq`        | Groq            | `https://api.groq.com/openai/v1`           | `GROQ_API_KEY`         | `none`                                               | OpenAI 兼容                                                   |
| `siliconflow` | SiliconFlow     | `https://api.siliconflow.cn/v1`            | `SILICONFLOW_API_KEY`  | 按 modelId 前缀推断（走现有 openai/custom 推断路径） | aliases: `silicon`                                            |
| `azure`       | Azure OpenAI    | 空（用户必填 resource endpoint）           | `AZURE_OPENAI_API_KEY` | `openai_effort`                                      | 部署名作为 modelId；placeholder 引导                          |
| `xai`         | xAI (Grok)      | `https://api.x.ai/v1`                      | `XAI_API_KEY`          | `openai_effort`                                      | aliases: `grok`                                               |
| `minimax`     | MiniMax         | `https://api.minimax.chat/v1`              | `MINIMAX_API_KEY`      | `none`                                               | 若官方端点变更，以 catalog 为准可热修                         |
| `baichuan`    | 百川            | `https://api.baichuan-ai.com/v1`           | `BAICHUAN_API_KEY`     | `none`                                               |                                                               |
| `hunyuan`     | 腾讯混元        | `https://api.hunyuan.cloud.tencent.com/v1` | `HUNYUAN_API_KEY`      | `none`                                               | aliases: `tencent-hunyuan`                                    |
| `qianfan`     | 百度千帆 / 文心 | `https://qianfan.baidubce.com/v2`          | `QIANFAN_API_KEY`      | `none`                                               | aliases: `wenxin`, `baidu`；兼容模式预设                      |

### 保留不变

现有：`anthropic` `openai` `deepseek` `gemini` `ollama` `openrouter` `qwen` `moonshot` `mimo` + `custom`。

### 默认模型策略

- 每个新平台 catalog 内置 **2–5 个**当前主流模型（id/label/基础能力位）。
- 若 models.dev 存在同名 provider id，则 `syncFromModelsDev` 继续合并实时模型（与现逻辑一致：`data?.[type] ?? data?.[builtin.id]`）。
- 对不上 models.dev id 的（如 `zhipu`/`doubao`/`siliconflow`），仅用 catalog 默认模型；用户可手动加模型或通过发现层导入。
- **Azure / 豆包**：默认模型可为占位说明型（例如 `your-deployment-name` / 示例接入点），并在 UI 提示「请替换为你的部署/接入点 ID」。

### models.dev id 对齐

| 我们的 type | models.dev 期望 key（若存在）    |
| ----------- | -------------------------------- |
| `mistral`   | `mistral`                        |
| `xai`       | `xai`                            |
| 其余        | 尽力匹配；匹配失败不影响内置预设 |

---

## 4. 架构

```
┌─────────────────────────────────────────────────────────────┐
│ settings UI (ProviderSettings)                              │
│  - 类型下拉 = getProviderUiList() + custom                  │
│  - custom 强化表单                                          │
│  - 「从 models.dev 发现更多」面板                           │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
   GET /settings/providers/catalog   GET /settings/providers/discover
   PUT  /settings/providers          POST /settings/providers/import-from-models-dev
                │                             │
                ▼                             ▼
        ProviderManagerImpl              models-dev cache
        + PROVIDER_CATALOG               (get/refresh)
```

### 单一事实来源不变

新增平台仍只改：

1. `packages/agent-core/src/provider/types.ts` → `ProviderType`
2. `packages/agent-core/src/provider/catalog.ts` → `PROVIDER_CATALOG` 条目
3. 可选 `apps/web/public/logo-<type>.svg`

预设、host 推断、UI 投影、thinking 风格解析继续从 catalog 派生。

---

## 5. 自定义入口强化（现有表单，不另开页面）

选中 `type === 'custom'`（新增时）时：

1. **名称**：placeholder「例如：公司中转 / LM Studio / vLLM」
2. **Base URL**：标记必填；保存前前端校验非空且为合法 URL（`http(s)://`）
3. **上游协议**：显式三选一 +「自动」（`undefined`）
   - Chat Completions
   - Responses
   - Anthropic Messages
4. **引导文案**（短提示）：
   - 适用于任意 OpenAI/Anthropic 兼容端点
   - 保存后可在模型列表里手动添加 model id
5. **可选快捷动作**：「保存并添加第一个模型」——保存 provider 后打开添加模型行（若现有 ModelManager 支持，则复用；否则保存后 focus 模型区）

后端 `addProviderFromPreset('custom', …)` 已支持空 baseUrl；本批在 **API 校验** 上对 custom 要求 `baseUrl` 非空（编辑更新同样适用），避免创建无法调用的空壳。

内置平台 baseUrl 允许沿用预设；Azure 因默认空，**添加时同样要求用户填写 baseUrl**。

---

## 6. models.dev 自动发现与导入

### 6.1 发现 API

`GET /settings/providers/discover`

响应草案：

```ts
{
  providers: Array<{
    id: string; // models.dev provider id
    name: string;
    api?: string; // base url if present
    env?: string[];
    modelCount: number;
    alreadyBuiltin: boolean; // 是否已在 PROVIDER_CATALOG type/alias 中
    sampleModels: Array<{ id: string; name: string }>; // 最多 5 个
  }>;
}
```

行为：

1. 读 models.dev 缓存（必要时 refresh，与现有 sync 路径一致）。
2. 过滤：排除已是一等公民 type / alias 的 id。
3. 排序：按 name；可把 modelCount 高的靠前。
4. 失败时：返回空列表 + message，不 500。

### 6.2 导入 API

`POST /settings/providers/import-from-models-dev`

```ts
// body
{ modelsDevProviderId: string; name?: string; enabled?: boolean }

// response
{ provider: AIProvider }
```

行为：

1. 从 models.dev 取该 provider。
2. 创建 **`type: 'custom'`** 的 AIProvider：
   - `id`: `custom-md-<modelsDevId>-<shortTs>`（避免与用户已有 custom 冲突）
   - `name`: body.name ?? models.dev name
   - `baseUrl`: models.dev `api` 字段；若无则空字符串并在响应里带 `warning`
   - `apiKeyEnv`: env[0]（若有）
   - `defaultModels`: 非 deprecated 模型映射为 `AIModelConfig`（复用 manager 的 createModelFromCatalog 逻辑）
3. 合并进用户 providers 并持久化（与现有 PUT providers 同一存储）。
4. `invalidateCatalog(userId)`。

**为何导入为 custom 而不是动态 ProviderType**：避免每次发现都扩展联合类型；thinking 仍可走 modelId 前缀推断。

### 6.3 UI

在 ProviderSettings 列表区或「新增提供商」旁增加：

- 按钮：「发现更多平台」
- 面板：可搜索列表（name/id），展示 modelCount、是否已有 baseUrl
- 操作：「导入」→ 调用 import API → 刷新 providers → 可选进入编辑填 API Key

已内置的平台在发现列表中标记「已内置」且禁用导入（或隐藏）。

---

## 7. 数据与兼容

| 项                      | 策略                                                     |
| ----------------------- | -------------------------------------------------------- |
| 已有用户 providers JSON | 只增不改；新 type 出现在可选预设，不强制注入             |
| `syncFromModelsDev`     | 仍只遍历 `BUILTIN_PROVIDER_TYPES`；新 type 自动纳入      |
| 前端 STATIC_FALLBACK    | 可补新 type 的 logo/glyph 兜底；非必须（hydrate 后覆盖） |
| 旧 `mistral` 纯 UI 别名 | 升级为一等公民后，`getProviderUiList` 不再过滤 mistral   |
| ProviderType 穷尽检查   | 所有 switch/Record 编译失败处一并补全                    |

可选轻量字段（若实现成本低）：

```ts
// AIProvider 可选扩展（非必须本批）
source?: { kind: 'models_dev'; providerId: string }
```

用于 UI 展示「来自 models.dev」；没有该字段也不影响功能。

---

## 8. Thinking / 协议

- 新平台优先复用：`none` | `openai_effort` | 现有 body 风格。
- SiliconFlow / 聚合类：providerType 为 siliconflow 时，`resolveThinkingStyle` 若无专用 style，则 **按 modelId 前缀推断**（与 openai/custom 相同逻辑扩展：对 siliconflow 也走 findCatalogEntryByModelId）。
- Azure：按 OpenAI effort。
- 不为本批新增网关 `provider-options` 新分支，除非联调发现必须（例如某厂商独有字段）。

上游协议：

- 默认 Chat Completions（OpenAI 兼容）。
- 无 Anthropic 双端点需求则单 upstream 即可。
- Azure：`chat_completions`（deployment 路径由现有 upstream 层处理；若当前网关对 Azure URL 形态支持不足，实现计划中单列验证项，必要时加最小适配，不做完整 Azure SDK）。

---

## 9. UI / Logo

| 平台    | logo                                                                   |
| ------- | ---------------------------------------------------------------------- |
| mistral | 已有 `/logo-mistralai.svg` → catalog 指向它或复制为 `logo-mistral.svg` |
| 其余    | 新增简单 SVG 或仅用 `fallbackGlyph`；不阻塞功能                        |

前端 `provider-catalog-ui.ts` STATIC_FALLBACK 建议同步补条目，保证离线首屏有名字/字形。

---

## 10. 测试计划

### agent-core

- catalog：每个新条目有 default upstream + ≥1 model（现有通用测试会覆盖）。
- presets 与 catalog 一一对应。
- `normalizeProviderAlias`：`glm`→`zhipu`，`grok`→`xai`，`volcengine`→`doubao` 等。
- `inferProviderTypeFromHostname`：新 hostnames。
- `resolveThinkingStyle`：新 type + 代理场景回归（不破坏现有用例）。

### gateway

- `GET /settings/providers/catalog` 含新 type。
- `GET /settings/providers/discover` 排除 builtin、含外部 id。
- `POST .../import-from-models-dev` 创建 custom + 模型列表；未知 id → 4xx。
- custom / azure 缺 baseUrl → 校验错误（若加了服务端校验）。

### shared-ui / web

- 类型下拉含新平台与 custom。
- custom 未填 baseUrl 不能提交。
- 发现面板导入后列表出现新 provider（组件测或轻量集成）。

---

## 11. 实现分期

### P0（本批必做）

1. 扩展 `ProviderType` + `PROVIDER_CATALOG`（11 个新平台）+ 默认模型 + aliases/hostnames。
2. 更新 catalog 测试与任何穷尽 switch。
3. 强化 custom（及 azure）表单校验与引导文案。
4. Logo：mistral 复用；其它可用 glyph 兜底。
5. STATIC_FALLBACK 补齐（可选但建议）。

### P1（本批尽量一起做，与「自动接入」直接相关）

1. `GET /settings/providers/discover`
2. `POST /settings/providers/import-from-models-dev`
3. ProviderSettings 发现/导入 UI
4. 导入后 invalidate + 前端刷新

### P2（可跟进）

1. Azure 部署路径深度适配验证与修补
2. 千帆/火山高级鉴权
3. 各平台更准的 thinking style
4. `AIProvider.source` 元数据
5. 更多 logo SVG

---

## 12. 风险与缓解

| 风险                  | 缓解                                       |
| --------------------- | ------------------------------------------ |
| 厂商 baseUrl 变更     | 集中在 catalog；用户可改 baseUrl           |
| models.dev 无国内厂商 | 一等公民自带默认模型；发现层仅覆盖有数据的 |
| Azure URL/部署形态    | v1 文档化 + 连通性测试；P2 专项            |
| ProviderType 膨胀     | 可接受；发现层用 custom 控制增长           |
| 默认模型过时          | models.dev 合并 + 用户可删改               |

---

## 13. 关键文件（实现时）

- `packages/agent-core/src/provider/types.ts`
- `packages/agent-core/src/provider/catalog.ts`
- `packages/agent-core/src/provider/catalog.test.ts`
- `packages/agent-core/src/provider/presets.ts`（通常无需手改，由 catalog 派生）
- `packages/agent-core/src/provider/manager.ts`（import 映射复用；siliconflow thinking 推断若需小改）
- `packages/shared-ui/src/models/provider-catalog-ui.ts`
- `packages/shared-ui/src/models/ProviderSettings.tsx`
- `services/agent-gateway/src/routes/settings.ts`
- 可能：`services/agent-gateway/src/provider/provider-config.ts`
- 可选：`apps/web/public/logo-*.svg`

---

## 14. 决议摘要

| 决议         | 选择                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| 总体方案     | B：一等公民 + models.dev 发现                                                              |
| 一等公民     | mistral, zhipu, doubao, groq, siliconflow, azure, xai, minimax, baichuan, hunyuan, qianfan |
| 自定义入口   | 强化现有表单，不新开页                                                                     |
| 发现导入形态 | 导入为 `custom` + 模型列表                                                                 |
| Azure/千帆   | 兼容预设 only                                                                              |
| 默认启用     | 新平台 `enabledByDefault: false`                                                           |
