# Provider Catalog Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 11 个新模型平台内置进 `PROVIDER_CATALOG`，强化 custom/azure 添加入口，并提供 models.dev 发现与一键导入为 custom 的能力。

**Architecture:** 继续以 `packages/agent-core/src/provider/catalog.ts` 为单一事实来源；网关 `PROVIDER_TYPE_SET` 与前端 `BUILTIN_PROVIDER_TYPE_SET` 已从 catalog/UI 列表派生，新增条目后自动生效。发现/导入走新的 settings API，导入结果统一落为 `type: 'custom'`。自定义与 Azure 在保存前强制 baseUrl。

**Tech Stack:** TypeScript monorepo、Vitest、Fastify settings routes、React ProviderSettings、`@openAwork/web-client` settings client、models.dev JSON cache。

**Spec:** `docs/superpowers/specs/2026-07-23-provider-catalog-expansion-design.md`

## Global Constraints

- 新平台一律 `enabledByDefault: false`
- 不新增 thinking 协议分支（复用 `none` / `openai_effort`；聚合类靠 modelId 前缀推断）
- Azure / 千帆仅 OpenAI 兼容预设，不做 AAD / AK-SK 签名
- models.dev 导入一律 `type: 'custom'`
- 不破坏已有用户 `providers` / `active_selection` 语义
- 每个任务结束必须跑该任务相关测试并 commit

## File Map

| File                                                                                | Responsibility                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/provider/types.ts`                                         | 扩展 `ProviderType` 联合类型                                                                  |
| `packages/agent-core/src/provider/catalog.ts`                                       | 11 个 catalog 条目 + 默认模型 + aliases/hostnames                                             |
| `packages/agent-core/src/provider/catalog.test.ts`                                  | 别名/host/条目完整性测试                                                                      |
| `packages/agent-core/src/provider/manager.ts`                                       | siliconflow 走 modelId thinking 推断；import 辅助可复用 createModelFromCatalog 逻辑（若抽出） |
| `packages/shared-ui/src/models/provider-catalog-ui.ts`                              | STATIC_FALLBACK 补齐；`getProviderUiList` 不再过滤 mistral                                    |
| `packages/shared-ui/src/models/ProviderSettings.tsx`                                | custom/azure 校验与引导；发现面板 UI                                                          |
| `services/agent-gateway/src/routes/settings.ts`                                     | discover / import-from-models-dev 路由                                                        |
| `services/agent-gateway/src/provider/models-dev-discover.ts`（新建）                | 发现列表与导入构建逻辑（可测纯函数）                                                          |
| `services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts`（新建） | 发现/导入单测                                                                                 |
| `packages/web-client/src/infra/settings.ts`                                         | 客户端 discover/import 方法                                                                   |
| `packages/web-client/src/infra/settings.test.ts`                                    | 客户端方法测试                                                                                |
| `apps/web/src/pages/settings/...`                                                   | 接线 discover/import 回调（若 ProviderSettings 需 props）                                     |
| `packages/agent-core/AGENTS.md`                                                     | 更新 ProviderType 列表文档                                                                    |
| 可选 `apps/web/public/logo-*.svg`                                                   | 新 logo；无 logo 用 fallbackGlyph                                                             |

---

### Task 1: 扩展 ProviderType + catalog 条目（P0 核心）

**Files:**

- Modify: `packages/agent-core/src/provider/types.ts`
- Modify: `packages/agent-core/src/provider/catalog.ts`
- Modify: `packages/agent-core/src/provider/catalog.test.ts`
- Modify: `packages/agent-core/AGENTS.md`

**Interfaces:**

- Produces: `ProviderType` 含  
  `'mistral' | 'zhipu' | 'doubao' | 'groq' | 'siliconflow' | 'azure' | 'xai' | 'minimax' | 'baichuan' | 'hunyuan' | 'qianfan'`  
  （保留原有类型 + `custom`）
- Produces: `PROVIDER_CATALOG` 增加 11 条；`getCatalogEntry` / presets 自动覆盖

- [ ] **Step 1: 写失败测试（新 type 存在于 catalog）**

在 `catalog.test.ts` 末尾追加：

```ts
describe('provider catalog expansion (2026-07-23)', () => {
  const expectedNewTypes = [
    'mistral',
    'zhipu',
    'doubao',
    'groq',
    'siliconflow',
    'azure',
    'xai',
    'minimax',
    'baichuan',
    'hunyuan',
    'qianfan',
  ] as const;

  it('包含全部新增一等公民 type 且默认不启用', () => {
    for (const type of expectedNewTypes) {
      const entry = getCatalogEntry(type);
      expect(entry, type).toBeDefined();
      expect(entry!.enabledByDefault).toBe(false);
      expect(entry!.defaultModels.length).toBeGreaterThan(0);
      expect(getDefaultUpstream(entry!)).toBeDefined();
    }
  });

  it('别名归一到新 type', () => {
    expect(normalizeProviderAlias('glm')).toBe('zhipu');
    expect(normalizeProviderAlias('bigmodel')).toBe('zhipu');
    expect(normalizeProviderAlias('grok')).toBe('xai');
    expect(normalizeProviderAlias('volcengine')).toBe('doubao');
    expect(normalizeProviderAlias('ark')).toBe('doubao');
    expect(normalizeProviderAlias('silicon')).toBe('siliconflow');
    expect(normalizeProviderAlias('mistralai')).toBe('mistral');
    expect(normalizeProviderAlias('wenxin')).toBe('qianfan');
    expect(normalizeProviderAlias('baidu')).toBe('qianfan');
  });

  it('host 反推覆盖新平台', () => {
    expect(inferProviderTypeFromHostname('api.mistral.ai')).toBe('mistral');
    expect(inferProviderTypeFromHostname('api.x.ai')).toBe('xai');
    expect(inferProviderTypeFromHostname('api.groq.com')).toBe('groq');
    expect(inferProviderTypeFromHostname('open.bigmodel.cn')).toBe('zhipu');
    expect(inferProviderTypeFromHostname('api.siliconflow.cn')).toBe('siliconflow');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
cd /home/await/project/OpenAWork && pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
```

Expected: FAIL（`getCatalogEntry('mistral')` 等为 undefined）

- [ ] **Step 3: 扩展 `ProviderType`**

`packages/agent-core/src/provider/types.ts` 改为：

```ts
export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'ollama'
  | 'openrouter'
  | 'qwen'
  | 'moonshot'
  | 'mimo'
  | 'mistral'
  | 'zhipu'
  | 'doubao'
  | 'groq'
  | 'siliconflow'
  | 'azure'
  | 'xai'
  | 'minimax'
  | 'baichuan'
  | 'hunyuan'
  | 'qianfan'
  | 'custom';
```

- [ ] **Step 4: 在 `PROVIDER_CATALOG` 追加 11 个条目**

在 `catalog.ts` 的 `mimo` 条目之后、`]` 之前插入（保持现有条目风格）。每个条目字段齐全：`type/displayName/enabledByDefault/apiKeyEnv?/hostnames?/ui/upstreams/thinkingStyle/defaultModels`。

**条目要点（实现时按此表填，模型 id 可微调但至少 2 个）：**

1. **mistral**
   - baseUrl `https://api.mistral.ai/v1`
   - env `MISTRAL_API_KEY`
   - hostnames `['api.mistral.ai']`
   - logo `/logo-mistralai.svg`，glyph `M`，aliases `['mistralai']`，prefixes `['mistral','mixtral','codestral','pixtral']`
   - thinking `none`
   - models: `mistral-large-latest`, `mistral-small-latest`, `codestral-latest`（tools true）

2. **zhipu**
   - baseUrl `https://open.bigmodel.cn/api/paas/v4`
   - env `ZHIPU_API_KEY`
   - hostnames `['open.bigmodel.cn']`
   - glyph `智`，aliases `['glm','bigmodel']`，prefixes `['glm']`
   - thinking `none`
   - models: `glm-4.5`, `glm-4-flash`（tools true）

3. **doubao**
   - baseUrl `https://ark.cn-beijing.volces.com/api/v3`
   - env `ARK_API_KEY`
   - hostnames `['ark.cn-beijing.volces.com']`
   - glyph `豆`，aliases `['volcengine','ark','volces']`，prefixes `['doubao','ep-']`
   - thinking `none`
   - models: 占位
     - `ep-your-endpoint-id` label `（请替换为方舟接入点 ID）` enabled true
     - 可再加一个示例 `doubao-seed-1.6` 若希望有可读名（enabled true, tools true）

4. **groq**
   - baseUrl `https://api.groq.com/openai/v1`
   - env `GROQ_API_KEY`
   - hostnames `['api.groq.com']`
   - glyph `Gq`，prefixes `['llama','mixtral','gemma','openai/gpt-oss']`（按需）
   - thinking `none`
   - models: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`（tools true）

5. **siliconflow**
   - baseUrl `https://api.siliconflow.cn/v1`
   - env `SILICONFLOW_API_KEY`
   - hostnames `['api.siliconflow.cn']`
   - glyph `Si`，aliases `['silicon']`
   - thinking `none`（请求路径靠 modelId 推断，见 Task 2）
   - models: `deepseek-ai/DeepSeek-V3`, `Qwen/Qwen2.5-7B-Instruct`（tools true）

6. **azure**
   - baseUrl `''`（用户必填）
   - env `AZURE_OPENAI_API_KEY`
   - 无 hostnames（用户自定义 resource）
   - glyph `Az`
   - thinking `openai_effort`
   - upstream protocol `chat_completions`
   - models: `gpt-4o` label `（部署名请改成你的 deployment）` tools/vision true

7. **xai**
   - baseUrl `https://api.x.ai/v1`
   - env `XAI_API_KEY`
   - hostnames `['api.x.ai']`
   - glyph `x`，aliases `['grok']`，prefixes `['grok']`
   - thinking `openai_effort`
   - models: `grok-3`, `grok-3-mini`（tools true；thinking 按能力设 supportsThinking）

8. **minimax**
   - baseUrl `https://api.minimax.chat/v1`
   - env `MINIMAX_API_KEY`
   - hostnames `['api.minimax.chat']`
   - glyph `MM`，prefixes `['minimax','MiniMax']`
   - thinking `none`
   - models: `MiniMax-Text-01`, `abab6.5s-chat`（tools true）

9. **baichuan**
   - baseUrl `https://api.baichuan-ai.com/v1`
   - env `BAICHUAN_API_KEY`
   - hostnames `['api.baichuan-ai.com']`
   - glyph `百`，prefixes `['Baichuan','baichuan']`
   - thinking `none`
   - models: `Baichuan4`, `Baichuan3-Turbo`（tools true）

10. **hunyuan**
    - baseUrl `https://api.hunyuan.cloud.tencent.com/v1`
    - env `HUNYUAN_API_KEY`
    - hostnames `['api.hunyuan.cloud.tencent.com']`
    - glyph `混`，aliases `['tencent-hunyuan']`，prefixes `['hunyuan']`
    - thinking `none`
    - models: `hunyuan-turbos-latest`, `hunyuan-lite`（tools true）

11. **qianfan**
    - baseUrl `https://qianfan.baidubce.com/v2`
    - env `QIANFAN_API_KEY`
    - hostnames `['qianfan.baidubce.com']`
    - glyph `千`，aliases `['wenxin','baidu']`，prefixes `['ernie','ernie-']`
    - thinking `none`
    - models: `ernie-4.0-8k`, `ernie-speed-8k`（tools true）

每个条目 `enabledByDefault: false`。`ui.logoUrl` 仅在文件真实存在时填写；否则只靠 `fallbackGlyph`。

- [ ] **Step 5: 更新 AGENTS.md 中的 ProviderType 列表**

`packages/agent-core/AGENTS.md` 里写死的联合类型字符串改为包含全部新 type。

- [ ] **Step 6: 跑测试通过**

```bash
pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
```

Expected: PASS（含原有 + 新增用例）

- [ ] **Step 7: Commit**

```bash
git add packages/agent-core/src/provider/types.ts \
  packages/agent-core/src/provider/catalog.ts \
  packages/agent-core/src/provider/catalog.test.ts \
  packages/agent-core/AGENTS.md
git commit -m "$(cat <<'EOF'
feat(provider): 内置 11 个新模型平台到 catalog

新增 mistral/zhipu/doubao/groq/siliconflow/azure/xai/minimax/baichuan/hunyuan/qianfan，默认禁用，扩展 ProviderType。
EOF
)"
```

---

### Task 2: siliconflow（及聚合类）thinking 按 modelId 推断

**Files:**

- Modify: `packages/agent-core/src/provider/catalog.ts`（`resolveThinkingStyle` / `catalogModelSupportsThinking`）
- Modify: `packages/agent-core/src/provider/catalog.test.ts`
- Modify: `services/agent-gateway/src/v2-runtime/upstream/provider-options.ts`（若仅依赖 catalog 则可能无需改；确认 `openai || custom` 分支是否需加入 `siliconflow`）

**Interfaces:**

- Consumes: `resolveThinkingStyle(providerType, modelId?)`
- Produces: `siliconflow` + 已知前缀 modelId → 真实厂商 style

- [ ] **Step 1: 写失败测试**

```ts
it('siliconflow 按 modelId 前缀推断 thinking 风格', () => {
  expect(resolveThinkingStyle('siliconflow', 'deepseek-ai/DeepSeek-V3')).toBe('deepseek_thinking');
  expect(resolveThinkingStyle('siliconflow', 'Qwen/Qwen2.5-7B-Instruct')).toBe(
    'qwen_enable_thinking',
  );
  expect(resolveThinkingStyle('siliconflow', 'totally-unknown-model')).toBe('none');
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
```

- [ ] **Step 3: 实现推断**

在 `resolveThinkingStyle` 中，把：

```ts
if (normalized === 'openai' || normalized === 'custom') {
```

扩展为：

```ts
if (normalized === 'openai' || normalized === 'custom' || normalized === 'siliconflow') {
```

fallback：

```ts
if (normalized === 'openai') return 'openai_effort';
return 'none'; // custom + siliconflow
```

对 `catalogModelSupportsThinking` 做同样扩展（与 style 解析对齐）。

检查 `provider-options.ts` 中：

```ts
normalizedProviderType === 'openai' || normalizedProviderType === 'custom';
```

若该分支负责 body flatten / thinking 下发入口，同步加入 `siliconflow`，否则 siliconflow 有 style 也下发不出去。

- [ ] **Step 4: 跑测通过**

```bash
pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
# 若改了 provider-options，再跑相关 gateway 单测
pnpm --filter agent-gateway test:unit -- src/v2-runtime 2>/dev/null || true
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/provider/catalog.ts \
  packages/agent-core/src/provider/catalog.test.ts \
  services/agent-gateway/src/v2-runtime/upstream/provider-options.ts
git commit -m "$(cat <<'EOF'
fix(provider): siliconflow 按 modelId 推断 thinking 风格

聚合平台复用 openai/custom 的前缀推断路径，未知模型保持 none。
EOF
)"
```

---

### Task 3: 前端 STATIC_FALLBACK 与 mistral 一等公民

**Files:**

- Modify: `packages/shared-ui/src/models/provider-catalog-ui.ts`

**Interfaces:**

- Produces: `getProviderUiList()` 含 mistral 与全部新 type（hydrate 前兜底）
- Produces: 不再过滤 `mistral`

- [ ] **Step 1: 调整 `getProviderUiList` 过滤**

把：

```ts
return catalogEntries.filter((entry) => entry.type !== 'claude' && entry.type !== 'mistral');
```

改为：

```ts
// 仅过滤纯 UI 别名；mistral 已是一等公民，不再排除
return catalogEntries.filter((entry) => entry.type !== 'claude');
```

注意：原注释把 mistral 当「历史 UI 兜底、不在 catalog」。Task 1 后 mistral 在 catalog 中，必须能出现在类型下拉。

- [ ] **Step 2: 扩展 STATIC_FALLBACK**

为 11 个新 type 各加一条（至少 `type/displayName/fallbackGlyph`，有 logo 则 `logoUrl`，有 aliases/prefixes 则带上），与 catalog 元数据一致。保留现有 anthropic/openai/… 条目。

`mistral` 条目已存在则更新 aliases；删除「Mistral 不在内置 catalog」的过时注释。

- [ ] **Step 3: 手动/单测确认列表**

若 shared-ui 无现成单测，可在 agent-core 已有 `getProviderCatalogUi` 测试外，加一个极小 shared-ui 测或临时 node 脚本；最低要求：

```bash
pnpm --filter @openAwork/shared-ui test
pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
```

Expected: PASS / passWithNoTests

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/models/provider-catalog-ui.ts
git commit -m "$(cat <<'EOF'
feat(ui): 扩展 provider catalog 静态兜底并放出 mistral

新增平台离线首屏可显示；mistral 作为一等公民进入类型下拉。
EOF
)"
```

---

### Task 4: 强化 custom / azure 表单校验（P0）

**Files:**

- Modify: `packages/shared-ui/src/models/ProviderSettings.tsx`

**Interfaces:**

- Consumes: `ProviderEditData`
- Produces: 提交前校验；custom 引导 UI

- [ ] **Step 1: 在 `ProviderForm` 增加本地错误状态与校验函数**

在 `ProviderForm` 内：

```ts
const [formError, setFormError] = useState<string | null>(null);

function requiresBaseUrl(type: string): boolean {
  return type === 'custom' || type === 'azure';
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function handleSubmit() {
  const base = form.baseUrl.trim();
  if (requiresBaseUrl(form.type)) {
    if (!base) {
      setFormError(
        form.type === 'azure'
          ? 'Azure OpenAI 必须填写资源 endpoint（例如 https://{resource}.openai.azure.com）'
          : '自定义提供商必须填写 Base URL',
      );
      return;
    }
    if (!isValidHttpUrl(base)) {
      setFormError('Base URL 必须是合法的 http(s) 地址');
      return;
    }
  }
  setFormError(null);
  onSubmit({
    ...form,
    name: form.name.trim(),
    baseUrl: base,
    apiKey: form.apiKey.trim(),
  });
}
```

把保存按钮 `onClick={() => onSubmit(form)}` 改为 `onClick={handleSubmit}`。

- [ ] **Step 2: custom 引导文案 + placeholder**

当 `form.type === 'custom'`（或 `azure`）时，在表单顶部或 Base URL 下显示短说明：

- custom：`适用于任意 OpenAI / Anthropic 兼容端点（中转、LM Studio、vLLM 等）。保存后请在模型列表添加 model id。`
- azure：`填写 Azure 资源 endpoint；模型 id 使用部署名（deployment name）。`

调整 placeholder：

- custom name: `例如：公司中转 / LM Studio`
- azure baseUrl: `https://{resource}.openai.azure.com` 或带 `/openai/v1` 的实际可用形态（与网关现有兼容行为一致；若不确定，用资源根 URL 并在说明中提示可按代理文档调整）

- [ ] **Step 3: 显示 formError**

在按钮行上方：

```tsx
{
  formError ? (
    <div style={{ color: 'var(--danger, #ef4444)', fontSize: 12 }}>{formError}</div>
  ) : null;
}
```

- [ ] **Step 4: 类型切换时清空错误**

在 type `onChange` 里 `setFormError(null)`。

- [ ] **Step 5: 冒烟**

```bash
pnpm --filter @openAwork/shared-ui test
# 若有 typecheck 脚本
pnpm --filter @openAwork/shared-ui exec tsc --noEmit -p tsconfig.json 2>/dev/null || true
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/models/ProviderSettings.tsx
git commit -m "$(cat <<'EOF'
feat(ui): 强化自定义与 Azure 提供商表单校验

custom/azure 强制合法 Base URL，并补充接入引导文案。
EOF
)"
```

---

### Task 5: models.dev 发现与导入核心逻辑（P1）

**Files:**

- Create: `services/agent-gateway/src/provider/models-dev-discover.ts`
- Create: `services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts`

**Interfaces:**

```ts
export interface DiscoverProviderItem {
  id: string;
  name: string;
  api?: string;
  env?: string[];
  modelCount: number;
  alreadyBuiltin: boolean;
  sampleModels: Array<{ id: string; name: string }>;
}

export function listDiscoverableProviders(
  data: ModelsDevData,
  options?: { includeBuiltin?: boolean },
): DiscoverProviderItem[];

export function buildCustomProviderFromModelsDev(
  data: ModelsDevData,
  modelsDevProviderId: string,
  overrides?: { name?: string; enabled?: boolean },
): AIProvider; // throws Error with code-friendly message if missing
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  listDiscoverableProviders,
  buildCustomProviderFromModelsDev,
} from '../../provider/models-dev-discover.js';
import type { ModelsDevData } from '@openAwork/agent-core';

const sample: ModelsDevData = {
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    api: 'https://api.mistral.ai/v1',
    env: ['MISTRAL_API_KEY'],
    models: {
      'mistral-small-latest': { id: 'mistral-small-latest', name: 'Mistral Small' },
    },
  },
  together: {
    id: 'together',
    name: 'Together',
    api: 'https://api.together.xyz/v1',
    env: ['TOGETHER_API_KEY'],
    models: {
      'meta-llama/Llama-3-8b': {
        id: 'meta-llama/Llama-3-8b',
        name: 'Llama 3 8B',
        tool_call: true,
      },
      old: { id: 'old', name: 'Old', status: 'deprecated' },
    },
  },
};

describe('models-dev-discover', () => {
  it('默认排除已是内置 catalog 的 provider', () => {
    const list = listDiscoverableProviders(sample);
    expect(list.find((p) => p.id === 'mistral')).toBeUndefined();
    const together = list.find((p) => p.id === 'together');
    expect(together).toBeDefined();
    expect(together!.modelCount).toBe(1); // deprecated 不计
    expect(together!.sampleModels[0]?.id).toBe('meta-llama/Llama-3-8b');
    expect(together!.alreadyBuiltin).toBe(false);
  });

  it('从 models.dev 构建 custom provider', () => {
    const provider = buildCustomProviderFromModelsDev(sample, 'together');
    expect(provider.type).toBe('custom');
    expect(provider.baseUrl).toContain('together');
    expect(provider.defaultModels.some((m) => m.id === 'meta-llama/Llama-3-8b')).toBe(true);
    expect(provider.defaultModels.some((m) => m.id === 'old')).toBe(false);
    expect(provider.id.startsWith('custom-md-together-')).toBe(true);
  });

  it('未知 id 抛错', () => {
    expect(() => buildCustomProviderFromModelsDev(sample, 'nope')).toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: 跑测确认失败**

```bash
pnpm --filter agent-gateway test:unit -- src/__tests__/provider/models-dev-discover.test.ts
```

Expected: FAIL module not found

- [ ] **Step 3: 实现 `models-dev-discover.ts`**

要点：

```ts
import {
  PROVIDER_CATALOG,
  normalizeProviderAlias,
  type AIProvider,
  type AIModelConfig,
  type ModelsDevData,
  type ModelsDevModel,
} from '@openAwork/agent-core';

function builtinIdSet(): Set<string> {
  const set = new Set<string>();
  for (const entry of PROVIDER_CATALOG) {
    set.add(entry.type.toLowerCase());
    for (const alias of entry.ui.aliases ?? []) {
      set.add(alias.toLowerCase());
    }
  }
  return set;
}

export function listDiscoverableProviders(
  data: ModelsDevData,
  options?: { includeBuiltin?: boolean },
): DiscoverProviderItem[] {
  const builtins = builtinIdSet();
  const includeBuiltin = options?.includeBuiltin === true;
  const items: DiscoverProviderItem[] = [];

  for (const [id, provider] of Object.entries(data)) {
    const key = id.toLowerCase();
    const alreadyBuiltin = builtins.has(key) || builtins.has(normalizeProviderAlias(key));
    if (alreadyBuiltin && !includeBuiltin) continue;

    const models = Object.entries(provider.models ?? {}).filter(
      ([, m]) => m.status !== 'deprecated',
    );
    items.push({
      id: provider.id || id,
      name: provider.name || id,
      ...(provider.api ? { api: provider.api } : {}),
      ...(provider.env ? { env: [...provider.env] } : {}),
      modelCount: models.length,
      alreadyBuiltin,
      sampleModels: models.slice(0, 5).map(([mid, m]) => ({
        id: mid,
        name: m.name || mid,
      })),
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function mapLiveModel(modelId: string, live: ModelsDevModel): AIModelConfig {
  return {
    id: modelId,
    label: live.name || modelId,
    enabled: live.status !== 'deprecated',
    contextWindow: live.limit?.context,
    maxOutputTokens: live.limit?.output,
    supportsTools: live.tool_call ?? false,
    supportsVision: live.modalities?.input?.includes('image') ?? false,
    supportsThinking: live.reasoning ?? false,
    inputPricePerMillion: live.cost?.input,
    outputPricePerMillion: live.cost?.output,
  };
}

export function buildCustomProviderFromModelsDev(
  data: ModelsDevData,
  modelsDevProviderId: string,
  overrides?: { name?: string; enabled?: boolean },
): AIProvider {
  const live =
    data[modelsDevProviderId] ??
    Object.values(data).find(
      (p) =>
        p.id === modelsDevProviderId || p.id?.toLowerCase() === modelsDevProviderId.toLowerCase(),
    );
  if (!live) {
    throw new Error(`models.dev provider not found: ${modelsDevProviderId}`);
  }

  const now = new Date().toISOString();
  const short = now.replace(/\D/g, '').slice(-8);
  const safeId = modelsDevProviderId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const models = Object.entries(live.models ?? {})
    .filter(([, m]) => m.status !== 'deprecated')
    .map(([mid, m]) => mapLiveModel(mid, m));

  return {
    id: `custom-md-${safeId}-${short}`,
    type: 'custom',
    name: overrides?.name?.trim() || live.name || modelsDevProviderId,
    enabled: overrides?.enabled ?? true,
    baseUrl: live.api ?? '',
    ...(live.env?.[0] ? { apiKeyEnv: live.env[0] } : {}),
    defaultModels: models,
    createdAt: now,
    updatedAt: now,
  };
}
```

注意：`AIProvider.apiKeyEnv` 对 custom 在 `sanitizeProviderApiKeyEnv` 中会被清掉（ALLOWED 仅 builtin）。导入时 **API Key 仍靠用户粘贴**；`apiKeyEnv` 可选不写，或写了也被 sanitize 掉——测试不要依赖 custom 保留 apiKeyEnv。更稳妥：实现里不设置 `apiKeyEnv`，只在 discover 列表展示 `env` 提示用户。

修正 `buildCustomProviderFromModelsDev`：**不要**设置 `apiKeyEnv`。

- [ ] **Step 4: 跑测通过**

```bash
pnpm --filter agent-gateway test:unit -- src/__tests__/provider/models-dev-discover.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add services/agent-gateway/src/provider/models-dev-discover.ts \
  services/agent-gateway/src/__tests__/provider/models-dev-discover.test.ts
git commit -m "$(cat <<'EOF'
feat(gateway): models.dev 发现列表与 custom 导入构建

纯函数实现可单测的 discover/import 核心，排除已内置平台。
EOF
)"
```

---

### Task 6: Gateway 路由 discover / import

**Files:**

- Modify: `services/agent-gateway/src/routes/settings.ts`
- Modify: 可能的 import 列表顶部

**Interfaces:**

- `GET /settings/providers/discover` → `{ providers: DiscoverProviderItem[] }`
- `POST /settings/providers/import-from-models-dev`  
  body: `{ modelsDevProviderId: string; name?: string; enabled?: boolean }`  
  → `{ provider: AIProvider; providers: AIProvider[]; activeSelection: ... }`  
  （返回完整列表便于前端一次刷新）

- [ ] **Step 1: 注册 GET discover**

在现有 `POST /settings/providers/sync` 附近增加：

```ts
app.get('/settings/providers/discover', { onRequest: [requireAuth] }, async (request, reply) => {
  const { step, child } = startRequestWorkflow(request, 'settings.providers.discover');
  const loadStep = child('load-models-dev');
  let data: ModelsDevData;
  try {
    data = await getModelsDevData(); // 已有 export：get as getModelsDevData
  } catch (err) {
    loadStep.fail(err instanceof Error ? err.message : String(err));
    step.fail('models.dev unavailable');
    return reply.status(502).send({ providers: [], message: '无法加载 models.dev' });
  }
  loadStep.succeed();
  const providers = listDiscoverableProviders(data);
  step.succeed(undefined, { providers: providers.length });
  return reply.send({ providers });
});
```

确认 `settings.ts` 已从 `@openAwork/agent-core` 导入 `getModelsDevData`（或 `get as getModelsDevData`）。若仅有 `refreshModelsDevDataOrThrow`，补：

```ts
import {
  // existing...
  getModelsDevData,
} from '@openAwork/agent-core';
```

（以 package 实际 export 名为准：`get as getModelsDevData` 已在 agent-core index 导出。）

- [ ] **Step 2: 注册 POST import**

```ts
app.post(
  '/settings/providers/import-from-models-dev',
  { onRequest: [requireAuth] },
  async (request, reply) => {
    const user = request.user as JwtPayload;
    const { step, child } = startRequestWorkflow(request, 'settings.providers.import-models-dev');

    const body = request.body as {
      modelsDevProviderId?: string;
      name?: string;
      enabled?: boolean;
    };
    if (!body?.modelsDevProviderId || typeof body.modelsDevProviderId !== 'string') {
      step.fail('bad request');
      return reply.status(400).send({ message: 'modelsDevProviderId is required' });
    }

    const data = await getModelsDevData();
    let imported;
    try {
      imported = buildCustomProviderFromModelsDev(data, body.modelsDevProviderId, {
        name: body.name,
        enabled: body.enabled,
      });
    } catch (err) {
      step.fail('not found');
      return reply.status(404).send({
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // 读现有 providers + selection，追加 imported，materialize，写回
    const providerRow = sqliteGet<UserSettingRow>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
      [user.sub],
    );
    const selectionRow = sqliteGet<UserSettingRow>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
      [user.sub],
    );

    const existingRaw = parseStoredJson(providerRow?.value);
    const existingList = Array.isArray(existingRaw) ? existingRaw : [];
    const mergedRaw = [...existingList, imported];

    const { providers, activeSelection } = await materializeProviderConfig(
      mergedRaw,
      parseStoredJson(selectionRow?.value),
    );

    sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [user.sub, JSON.stringify(providers)],
    );
    sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [user.sub, JSON.stringify(activeSelection)],
    );

    invalidateCatalog(user.sub);
    step.succeed(undefined, { providerId: imported.id });
    return reply.send({ provider: imported, providers, activeSelection });
  },
);
```

复用文件内已有 `parseStoredJson` / `materializeProviderConfig` / `invalidateCatalog` / `sqliteGet` / `sqliteRun`。

- [ ] **Step 3: 手工或单测路由（若有 route 测试框架则补；否则靠 discover 单元 + 类型检查）**

```bash
pnpm --filter agent-gateway test:unit -- src/__tests__/provider/models-dev-discover.test.ts
pnpm --filter agent-gateway exec tsc --noEmit -p tsconfig.json 2>/dev/null | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add services/agent-gateway/src/routes/settings.ts
git commit -m "$(cat <<'EOF'
feat(gateway): 暴露 providers discover 与 import-from-models-dev API

支持从 models.dev 发现未内置平台并导入为 custom。
EOF
)"
```

---

### Task 7: web-client 方法

**Files:**

- Modify: `packages/web-client/src/infra/settings.ts`
- Modify: `packages/web-client/src/infra/settings.test.ts`（若有 mock 模式）

**Interfaces:**

```ts
// SettingsClient 接口新增：
discoverProviders(token: string, options?: { signal?: AbortSignal }): Promise<unknown>;
importProviderFromModelsDev(
  token: string,
  payload: { modelsDevProviderId: string; name?: string; enabled?: boolean },
  options?: { signal?: AbortSignal },
): Promise<unknown>;
```

- [ ] **Step 1: 在接口与实现中增加方法**

```ts
async discoverProviders(token, options) {
  const response = await fetchWithTimeout(`${baseUrl}/settings/providers/discover`, {
    headers: authHeader(token),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new HttpError(`发现 Provider 失败（HTTP ${response.status}）`, response.status);
  }
  return (await response.json()) as unknown;
},

async importProviderFromModelsDev(token, payload, options) {
  return performSettingsRequest<unknown>({
    actionLabel: '从 models.dev 导入 Provider',
    request: () =>
      fetchWithTimeout(`${baseUrl}/settings/providers/import-from-models-dev`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(payload),
        signal: options?.signal,
      }),
  });
},
```

- [ ] **Step 2: 补 settings.test.ts 用例（mock fetch）**

仿照现有 `putProviders` 测试：assert URL/method/body。

- [ ] **Step 3: 跑测**

```bash
pnpm --filter @openAwork/web-client test -- src/infra/settings.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/web-client/src/infra/settings.ts packages/web-client/src/infra/settings.test.ts
git commit -m "$(cat <<'EOF'
feat(web-client): 增加 discover/import provider API 封装
EOF
)"
```

---

### Task 8: ProviderSettings 发现面板 + Web 接线

**Files:**

- Modify: `packages/shared-ui/src/models/ProviderSettings.tsx`
- Modify: `apps/web/src/pages/settings/connection/connection-tab-content.tsx`
- Modify: `apps/web/src/pages/settings/SettingsPage.tsx`（若回调定义在此）

**Interfaces:**

```ts
// ProviderSettingsProps 新增 optional：
onDiscoverProviders?: () => Promise<{
  providers: Array<{
    id: string;
    name: string;
    api?: string;
    modelCount: number;
    sampleModels?: Array<{ id: string; name: string }>;
  }>;
}>;
onImportDiscoveredProvider?: (modelsDevProviderId: string) => Promise<void>;
```

- [ ] **Step 1: UI 状态**

在 `ProviderSettings` 组件内：

```ts
const [discoverOpen, setDiscoverOpen] = useState(false);
const [discoverLoading, setDiscoverLoading] = useState(false);
const [discoverError, setDiscoverError] = useState<string | null>(null);
const [discoverItems, setDiscoverItems] = useState<
  Array<{ id: string; name: string; api?: string; modelCount: number }>
>([]);
const [importingId, setImportingId] = useState<string | null>(null);
const [discoverQuery, setDiscoverQuery] = useState('');
```

- [ ] **Step 2: 「发现更多平台」按钮**

放在提供商列表标题旁 / 「新增提供商」旁；仅当 `onDiscoverProviders` 存在时渲染。

点击：

```ts
async function openDiscover() {
  if (!onDiscoverProviders) return;
  setDiscoverOpen(true);
  setDiscoverLoading(true);
  setDiscoverError(null);
  try {
    const res = await onDiscoverProviders();
    setDiscoverItems(res.providers ?? []);
  } catch (e) {
    setDiscoverError(e instanceof Error ? e.message : String(e));
  } finally {
    setDiscoverLoading(false);
  }
}
```

- [ ] **Step 3: 面板内容**

- 搜索 input 过滤 name/id
- 列表：name、modelCount、api 截断
- 按钮「导入」→ `onImportDiscoveredProvider?.(id)`，期间 `importingId` 禁用重复点
- 成功后可关闭面板或保留并 toast 文案「已导入，请填写 API Key」

样式沿用现有 `var(--bg-raised)` / border / accent，不引入新设计系统。

- [ ] **Step 4: SettingsPage / connection-tab 接线**

```ts
onDiscoverProviders={async () => {
  const data = (await createSettingsClient(gatewayUrl).discoverProviders(token)) as {
    providers: Array<...>;
  };
  return { providers: data.providers ?? [] };
}}
onImportDiscoveredProvider={async (modelsDevProviderId) => {
  const data = (await createSettingsClient(gatewayUrl).importProviderFromModelsDev(token, {
    modelsDevProviderId,
  })) as { providers?: AIProviderRef[]; activeSelection?: ActiveSelectionRef };
  if (data.providers) {
    providersRef.current = data.providers;
    setProviders(data.providers);
  }
  if (data.activeSelection) {
    // 与 saveProviders 一致地同步 selection
    ...
  }
}}
```

把 props 传到 `connection-tab-content` → `ProviderSettings`。

- [ ] **Step 5: typecheck / 相关测试**

```bash
pnpm --filter @openAwork/shared-ui test
pnpm --filter @openAwork/web-client test -- src/infra/settings.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/models/ProviderSettings.tsx \
  apps/web/src/pages/settings/connection/connection-tab-content.tsx \
  apps/web/src/pages/settings/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
feat(settings): 提供商发现与一键导入 UI

从 models.dev 发现未内置平台并导入为 custom，导入后刷新本地列表。
EOF
)"
```

---

### Task 9: 回归与文档收尾

**Files:**

- Modify: `docs/superpowers/specs/2026-07-23-provider-catalog-expansion-design.md`（状态改为 Implemented / 附实现日期，可选）
- 可选: README 模型平台列表若有硬编码则更新

- [ ] **Step 1: 跑核心测试套件**

```bash
pnpm --filter @openAwork/agent-core test -- src/provider/catalog.test.ts
pnpm --filter agent-gateway test:unit -- src/__tests__/provider/models-dev-discover.test.ts
pnpm --filter @openAwork/web-client test -- src/infra/settings.test.ts
pnpm --filter @openAwork/shared-ui test
```

Expected: 全部 PASS

- [ ] **Step 2: 手动验收清单（实现者勾选）**

1. 设置 → 模型：类型下拉可见 mistral/zhipu/…/qianfan/custom
2. 选 custom 不填 baseUrl → 无法保存并有中文错误
3. 选 azure 不填 baseUrl → 同上
4. 选 groq → 自动 baseUrl `https://api.groq.com/openai/v1`
5. 「发现更多平台」列出非内置项；导入 together（或当前 models.dev 上存在的某 id）后列表出现 custom-md-…
6. 原有 anthropic/openai 会话不受影响

- [ ] **Step 3: Commit 收尾（若有文档/小修）**

```bash
git add -A docs/superpowers packages/agent-core/AGENTS.md
git commit -m "$(cat <<'EOF'
docs(provider): 标记 catalog 扩展实现完成并核对验收项
EOF
)"
```

---

## Spec Coverage Check

| Spec 要求                         | Task                 |
| --------------------------------- | -------------------- |
| 11 个一等公民 + ProviderType      | Task 1               |
| enabledByDefault false            | Task 1               |
| aliases / hostnames               | Task 1               |
| siliconflow modelId thinking 推断 | Task 2               |
| STATIC_FALLBACK + mistral 下拉    | Task 3               |
| custom/azure 表单强化             | Task 4               |
| discover 纯逻辑                   | Task 5               |
| discover/import API               | Task 6               |
| web-client                        | Task 7               |
| 发现 UI + 接线                    | Task 8               |
| 回归验收                          | Task 9               |
| Azure/千帆深度鉴权                | 明确不在本计划（P2） |
| 新 thinking 协议分支              | 不在本计划           |

## Placeholder Scan

无 TBD/TODO 步骤；默认模型 id 在 Task 1 表中已给出可落地值。

## Type Consistency

- `DiscoverProviderItem` / `buildCustomProviderFromModelsDev` 在 Task 5 定义，Task 6–8 复用同名。
- 导入 provider `type` 恒为 `'custom'`，`id` 前缀 `custom-md-`。
- 前端 props：`onDiscoverProviders` / `onImportDiscoveredProvider`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-provider-catalog-expansion.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派一个新 subagent，任务间 review，迭代快
2. **Inline Execution** — 本会话按 executing-plans 批量执行并设检查点

**Which approach?**
