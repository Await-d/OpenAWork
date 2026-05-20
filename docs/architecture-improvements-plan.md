# Agent Gateway 架构改进实施方案

> 参考 opencode 最新更新中 Server/API 和 Provider/Plugin 的设计模式，
> 针对 OpenAWork agent-gateway 提出 5 项可落地的改进方案。

---

## 方案 1：响应压缩（低成本高收益）

### 目标

对 JSON 响应启用 gzip/deflate 压缩，减少 session 列表、消息历史等大 payload 的传输量。

### 实现步骤

**1. 安装依赖**

```bash
pnpm add @fastify/compress
```

**2. 在 `src/index.ts` 注册插件（在 cors 之后、路由之前）**

```typescript
import compress from '@fastify/compress';

// 在 app.register(cors, ...) 之后
await app.register(compress, {
  // 只压缩 > 1KB 的响应
  threshold: 1024,
  // 排除 SSE 流（text/event-stream 不应压缩）
  encodings: ['gzip', 'deflate'],
  // 自定义：排除 SSE 和 WebSocket 升级请求
  onUnsupportedEncoding: (_encoding, _request, reply) => {
    reply.code(406).send({ error: 'Unsupported encoding' });
  },
});
```

**3. SSE 路由需要禁用压缩**

在 `stream-routes-plugin.ts` 的 SSE 端点中，确保流式响应不被压缩：

```typescript
// 在 reply.raw.writeHead 之前加上
reply.raw.setHeader('x-no-compression', '1');
// 或者在路由配置中：
app.get('/sessions/:id/stream/sse', {
  config: { compress: false }  // @fastify/compress 支持按路由禁用
}, async (request, reply) => { ... });

app.get('/sessions/:id/stream/attach', {
  config: { compress: false }
}, async (request, reply) => { ... });
```

**4. 验证**

```bash
curl -H "Accept-Encoding: gzip" http://localhost:3000/settings/providers \
  -H "Authorization: Bearer $TOKEN" --compressed -v 2>&1 | grep content-encoding
# 应输出: content-encoding: gzip
```

### 预期收益

- session 列表（含消息历史）JSON 通常 50-200KB，gzip 后约 5-20KB
- 零代码改动风险，Fastify 插件自动处理

---

## 方案 2：统一错误格式中间件

### 目标

消除各 handler 中重复的 `reply.status(400).send({error: ...})` 模式，
统一 API 错误响应格式为：

```json
{
  "name": "BadRequest" | "NotFound" | "Unauthorized" | "InternalError",
  "data": {
    "message": "Human-readable description",
    "kind": "Body" | "Query" | "Params" | null,
    "issues": [...] // optional, Zod validation issues
  }
}
```

### 实现步骤

**1. 创建 `src/infra/error-response.ts`**

```typescript
import { z } from 'zod';

export type ApiErrorName = 'BadRequest' | 'NotFound' | 'Unauthorized' | 'InternalError';

export interface ApiErrorResponse {
  name: ApiErrorName;
  data: {
    message: string;
    kind?: 'Body' | 'Query' | 'Params' | 'Headers' | null;
    issues?: z.ZodIssue[];
  };
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly response: ApiErrorResponse;

  constructor(
    statusCode: number,
    name: ApiErrorName,
    message: string,
    opts?: {
      kind?: ApiErrorResponse['data']['kind'];
      issues?: z.ZodIssue[];
    },
  ) {
    super(message);
    this.statusCode = statusCode;
    this.response = {
      name,
      data: { message, kind: opts?.kind ?? null, issues: opts?.issues },
    };
  }

  static badRequest(
    message: string,
    opts?: { kind?: ApiErrorResponse['data']['kind']; issues?: z.ZodIssue[] },
  ) {
    return new ApiError(400, 'BadRequest', message, opts);
  }

  static notFound(message: string) {
    return new ApiError(404, 'NotFound', message);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, 'Unauthorized', message);
  }
}
```

**2. 创建 `src/infra/error-handler.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { ApiError } from './error-response.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // 已知的 ApiError — 直接返回结构化响应
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(error.response);
    }

    // Fastify 内置的 schema validation 错误
    if (error.validation) {
      return reply.status(400).send({
        name: 'BadRequest',
        data: {
          message: error.message,
          kind: 'Body',
        },
      });
    }

    // 未知错误 — 不泄露内部信息
    request.log.error(error);
    return reply.status(500).send({
      name: 'InternalError',
      data: { message: 'Internal server error' },
    });
  });
}
```

**3. 在 `src/index.ts` 中注册**

```typescript
import { registerErrorHandler } from './infra/error-handler.js';

// 在所有路由注册之前
registerErrorHandler(app);
```

**4. 逐步迁移 handler（示例）**

迁移前：

```typescript
const parsed = someSchema.safeParse(request.body);
if (!parsed.success) {
  return reply.status(400).send({ error: 'Invalid input', issues: parsed.error.issues });
}
```

迁移后：

```typescript
import { ApiError } from '../infra/error-response.js';

const parsed = someSchema.safeParse(request.body);
if (!parsed.success) {
  throw ApiError.badRequest('Invalid input', { kind: 'Body', issues: parsed.error.issues });
}
```

**5. 提供 Zod 解析辅助函数**

```typescript
// src/infra/parse-request.ts
import { z } from 'zod';
import { ApiError, type ApiErrorResponse } from './error-response.js';

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw ApiError.badRequest('Invalid request body', {
      kind: 'Body',
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw ApiError.badRequest('Invalid query parameters', {
      kind: 'Query',
      issues: result.error.issues,
    });
  }
  return result.data;
}

export function parseParams<T extends z.ZodType>(schema: T, params: unknown): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw ApiError.badRequest('Invalid path parameters', {
      kind: 'Params',
      issues: result.error.issues,
    });
  }
  return result.data;
}
```

### 迁移策略

- 新代码直接用 `throw ApiError.xxx()` + `parseBody/parseQuery`
- 旧代码逐文件迁移，两种风格可共存（error handler 兜底，旧的 `reply.send` 仍然生效）
- 前端统一按 `response.name` 字段判断错误类型

---

## 方案 3：Provider Catalog 缓存

### 目标

避免每次请求都 `createProviderManager(rawProviders, rawActiveSelection)` 重建索引。
启动时构建一次，配置变更时增量更新。

### 实现步骤

**1. 创建 `src/provider/provider-catalog.ts`**

```typescript
import type { AIProvider, ActiveSelection, AIModelConfig } from '@openAwork/agent-core';
import { ProviderManagerImpl } from '@openAwork/agent-core';
import { sqliteGet } from '../infra/db.js';

interface UserSettingRow {
  key: string;
  value: string;
}

interface CatalogEntry {
  manager: InstanceType<typeof ProviderManagerImpl>;
  providers: AIProvider[];
  activeSelection: ActiveSelection;
  builtAt: number;
}

// Per-user catalog cache
const catalogCache = new Map<string, CatalogEntry>();

// Cache TTL — rebuild if older than 30s (covers background model-dev refresh)
const CACHE_TTL_MS = 30_000;

function loadRawSettings(userId: string) {
  const providerRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'providers'`,
    [userId],
  );
  const selectionRow = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = 'active_selection'`,
    [userId],
  );
  return {
    rawProviders: providerRow?.value ? JSON.parse(providerRow.value) : null,
    rawSelection: selectionRow?.value ? JSON.parse(selectionRow.value) : null,
  };
}

export async function getCatalog(userId: string): Promise<CatalogEntry> {
  const existing = catalogCache.get(userId);
  if (existing && Date.now() - existing.builtAt < CACHE_TTL_MS) {
    return existing;
  }

  const { rawProviders, rawSelection } = loadRawSettings(userId);
  const manager = rawProviders
    ? new ProviderManagerImpl({ providers: rawProviders, active: rawSelection })
    : rawSelection
      ? new ProviderManagerImpl({ active: rawSelection })
      : new ProviderManagerImpl();

  await manager.syncFromModelsDev();
  const config = manager.getConfig();
  const entry: CatalogEntry = {
    manager,
    providers: config.providers,
    activeSelection: config.active,
    builtAt: Date.now(),
  };
  catalogCache.set(userId, entry);
  return entry;
}

/** 配置变更后调用，强制下次请求重建 */
export function invalidateCatalog(userId: string): void {
  catalogCache.delete(userId);
}

/** 获取 chat provider（热路径，用缓存） */
export async function getChatProvider(userId: string) {
  const catalog = await getCatalog(userId);
  const { provider, model } = catalog.manager.getChatProviderConfig();
  return { provider, modelId: model.id };
}

/** 获取 fast provider */
export async function getFastProvider(userId: string) {
  const catalog = await getCatalog(userId);
  const { provider, model } = catalog.manager.getFastProviderConfig();
  return { provider, modelId: model.id };
}

/** 获取指定 provider + model */
export async function getProviderForSelection(
  userId: string,
  selection?: { providerId?: string; modelId?: string },
) {
  const catalog = await getCatalog(userId);
  if (!selection?.providerId || !selection.modelId) {
    return getChatProvider(userId);
  }
  const provider = catalog.providers.find((p) => p.id === selection.providerId && p.enabled);
  const model = provider?.defaultModels.find((m) => m.id === selection.modelId && m.enabled);
  if (!provider || !model) return getChatProvider(userId);
  return { provider, modelId: model.id };
}
```

**2. 在 settings PUT 路由中 invalidate**

```typescript
// src/routes/settings.ts — PUT /settings/providers handler 末尾
import { invalidateCatalog } from '../provider/provider-catalog.js';

// 保存完成后
invalidateCatalog(user.sub);
```

**3. 替换 stream.ts 中的调用**

```typescript
// 迁移前
const providerConfig = await getProviderConfigForSelection(rawProviders, rawSelection, override);

// 迁移后
import { getProviderForSelection } from '../provider/provider-catalog.js';
const providerConfig = await getProviderForSelection(user.sub, override);
```

### 预期收益

- stream 请求热路径减少 ~5-10ms（避免每次 JSON.parse + ProviderManager 构建）
- 内存开销极小（每用户一个 ProviderManager 实例）
- 配置变更时自动失效，无一致性风险

---

## 方案 4：路由 Schema/Handler 分离

### 目标

将路由文件拆分为「Schema 定义」和「业务逻辑」两层，为自动 OpenAPI 文档生成铺路。

### 目录结构

```
src/routes/
├── schemas/              # 纯类型定义，无业务逻辑
│   ├── sessions.ts       # session 相关的 request/response schemas
│   ├── settings.ts       # settings 相关
│   ├── stream.ts         # stream 相关
│   ├── providers.ts      # provider 相关
│   └── common.ts         # 共享类型（分页、错误等）
├── handlers/             # 纯业务逻辑
│   ├── sessions.ts
│   ├── settings.ts
│   └── ...
├── sessions.ts           # 路由注册（胶水层，引用 schema + handler）
├── settings.ts
└── ...
```

### 实现步骤

**1. 创建 `src/routes/schemas/common.ts`**

```typescript
import { z } from 'zod';

// 统一分页参数
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// 统一 ID 参数
export const sessionIdParam = z.object({
  id: z.string().uuid(),
});

// 统一成功响应包装
export const okResponse = z.object({ ok: z.literal(true) });

// 统一错误响应
export const errorResponse = z.object({
  name: z.enum(['BadRequest', 'NotFound', 'Unauthorized', 'InternalError']),
  data: z.object({
    message: z.string(),
    kind: z.enum(['Body', 'Query', 'Params', 'Headers']).nullable().optional(),
    issues: z.array(z.any()).optional(),
  }),
});
```

**2. 创建 `src/routes/schemas/settings.ts`（示例）**

```typescript
import { z } from 'zod';
import {
  providerSettingsBodySchema,
  providerSettingsQuerySchema,
} from '../../provider/provider-config.js';

export const settingsSchemas = {
  'GET /settings/providers': {
    query: providerSettingsQuerySchema,
    response: z.object({
      providers: z.array(z.any()), // 引用已有 schema
      activeSelection: z.any(),
      defaultThinking: z.any(),
      imageGenerationDefaults: z.any(),
    }),
  },
  'PUT /settings/providers': {
    body: providerSettingsBodySchema,
    response: z.object({
      providers: z.array(z.any()),
      activeSelection: z.any(),
      defaultThinking: z.any(),
      imageGenerationDefaults: z.any(),
    }),
  },
} as const;
```

**3. 创建 `src/routes/handlers/settings.ts`（示例）**

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../infra/auth.js';
import { parseBody, parseQuery } from '../../infra/parse-request.js';
import { settingsSchemas } from '../schemas/settings.js';
import { getCatalog, invalidateCatalog } from '../../provider/provider-catalog.js';

export async function getProviders(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload;
  const query = parseQuery(settingsSchemas['GET /settings/providers'].query, request.query);
  const catalog = await getCatalog(user.sub);
  // ... 业务逻辑
  return reply.send({ providers: catalog.providers, activeSelection: catalog.activeSelection });
}

export async function putProviders(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtPayload;
  const body = parseBody(settingsSchemas['PUT /settings/providers'].body, request.body);
  // ... 保存逻辑
  invalidateCatalog(user.sub);
  return reply.send({ ... });
}
```

**4. 路由注册文件变为薄胶水层**

```typescript
// src/routes/settings.ts（重构后）
import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../infra/auth.js';
import * as handlers from './handlers/settings.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/settings/providers', { onRequest: [requireAuth] }, handlers.getProviders);
  app.put('/settings/providers', { onRequest: [requireAuth] }, handlers.putProviders);
  // ...
}
```

**5. 自动 OpenAPI 文档生成**

```bash
pnpm add @fastify/swagger @fastify/swagger-ui
```

```typescript
// src/infra/openapi.ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: { title: 'OpenAWork Agent Gateway', version: '0.5.8' },
      servers: [{ url: 'http://localhost:3000' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
```

### 迁移策略

- 新路由直接按 schema/handler 分离写
- 旧路由按优先级逐个迁移（settings → sessions → stream）
- 路由注册文件保持 Fastify plugin 签名不变，对 `index.ts` 零影响
- Schema 文件可被前端 SDK 生成器（如 `openapi-typescript`）消费

---

## 方案 5：Provider 插件化

### 目标

将 provider 特有逻辑（协议选择、header 注入、认证方式）从 `model-router.ts` 的大函数中抽出，
每个 provider 一个独立模块，通过 hook 机制组合。

### 架构设计

```
src/provider/
├── provider-plugin.ts        # 插件接口定义 + 注册表
├── plugins/
│   ├── anthropic.ts          # Anthropic 特有逻辑
│   ├── openai.ts             # OpenAI 特有逻辑
│   ├── deepseek.ts           # DeepSeek 特有逻辑
│   ├── gemini.ts             # Google Gemini
│   ├── openrouter.ts         # OpenRouter
│   └── custom.ts             # 通用 OpenAI-compatible
├── model-router.ts           # 精简后的路由核心
├── provider-config.ts        # 不变
└── provider-catalog.ts       # 方案 3 的缓存层
```

### 实现步骤

**1. 定义插件接口 `src/provider/provider-plugin.ts`**

```typescript
import type { AIProvider, AIModelConfig } from '@openAwork/agent-core';
import type { ModelRouteConfig } from './model-router.js';
import type { UpstreamProtocol } from '../routes/upstream-protocol.js';

/** Provider 插件可以 hook 的生命周期事件 */
export interface ProviderPluginHooks {
  /**
   * 解析上游协议 — 返回 undefined 表示不处理，交给下一个插件或默认逻辑
   */
  'resolve.protocol'?: (ctx: {
    model: string;
    provider: AIProvider;
    baseUrl: string;
  }) => UpstreamProtocol | undefined;

  /**
   * 注入请求 headers — 在发送到上游前调用
   */
  'request.headers'?: (ctx: {
    model: string;
    provider: AIProvider;
    headers: Record<string, string>;
  }) => void;

  /**
   * 注入请求 body 字段 — 在发送到上游前调用
   */
  'request.body'?: (ctx: {
    model: string;
    provider: AIProvider;
    body: Record<string, unknown>;
  }) => void;

  /**
   * 解析 API key — 返回 undefined 表示不处理
   */
  'resolve.apiKey'?: (ctx: { provider: AIProvider }) => string | undefined;

  /**
   * 模型过滤/增强 — 可以修改模型列表
   */
  'models.filter'?: (ctx: { provider: AIProvider; models: AIModelConfig[] }) => AIModelConfig[];
}

export interface ProviderPlugin {
  /** 匹配的 provider type（如 'anthropic', 'openai'） */
  readonly providerType: string;
  readonly hooks: ProviderPluginHooks;
}
```

**2. 插件注册表**

```typescript
// src/provider/provider-plugin.ts（续）

const pluginRegistry: ProviderPlugin[] = [];

export function registerProviderPlugin(plugin: ProviderPlugin): void {
  pluginRegistry.push(plugin);
}

export function getPluginsForProvider(providerType: string): ProviderPlugin[] {
  return pluginRegistry.filter((p) => p.providerType === providerType || p.providerType === '*');
}

/** 执行 hook 链 — 第一个返回非 undefined 的结果胜出 */
export function runHookFirst<K extends keyof ProviderPluginHooks>(
  hookName: K,
  providerType: string,
  ctx: Parameters<NonNullable<ProviderPluginHooks[K]>>[0],
): ReturnType<NonNullable<ProviderPluginHooks[K]>> | undefined {
  for (const plugin of getPluginsForProvider(providerType)) {
    const fn = plugin.hooks[hookName] as ((c: typeof ctx) => unknown) | undefined;
    if (!fn) continue;
    const result = fn(ctx);
    if (result !== undefined) return result as any;
  }
  return undefined;
}

/** 执行 hook 链 — 所有插件都执行（用于 mutation 类 hook） */
export function runHookAll<K extends keyof ProviderPluginHooks>(
  hookName: K,
  providerType: string,
  ctx: Parameters<NonNullable<ProviderPluginHooks[K]>>[0],
): void {
  for (const plugin of getPluginsForProvider(providerType)) {
    const fn = plugin.hooks[hookName] as ((c: typeof ctx) => void) | undefined;
    if (!fn) continue;
    try {
      fn(ctx);
    } catch (err) {
      console.warn(`[provider-plugin] ${plugin.providerType}.${hookName} threw:`, err);
    }
  }
}
```

**3. 实现 Anthropic 插件 `src/provider/plugins/anthropic.ts`**

```typescript
import { registerProviderPlugin } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'anthropic',
  hooks: {
    'resolve.protocol': () => 'anthropic_messages',

    'request.headers': ({ headers }) => {
      // Anthropic beta features
      headers['anthropic-beta'] = [
        'interleaved-thinking-2025-05-14',
        'fine-grained-tool-streaming-2025-05-14',
      ].join(',');
    },

    'resolve.apiKey': ({ provider }) => {
      if (provider.apiKey) return provider.apiKey;
      return process.env['ANTHROPIC_API_KEY'] ?? undefined;
    },
  },
});
```

**4. 实现 OpenAI 插件 `src/provider/plugins/openai.ts`**

```typescript
import { registerProviderPlugin } from '../provider-plugin.js';

const OPENAI_OFFICIAL_HOSTS = new Set(['api.openai.com']);

registerProviderPlugin({
  providerType: 'openai',
  hooks: {
    'resolve.protocol': ({ baseUrl }) => {
      try {
        const url = new URL(baseUrl);
        if (OPENAI_OFFICIAL_HOSTS.has(url.hostname)) return 'responses';
      } catch {
        /* ignore */
      }
      return 'chat_completions';
    },

    'resolve.apiKey': ({ provider }) => {
      if (provider.apiKey) return provider.apiKey;
      return process.env['OPENAI_API_KEY'] ?? process.env['AI_API_KEY'] ?? undefined;
    },
  },
});
```

**5. 精简 `model-router.ts` 的 `resolveModelRoute`**

```typescript
import { runHookFirst, runHookAll } from './provider-plugin.js';

export function resolveModelRoute(request: ModelRequest): ModelRouteConfig {
  const model = request.model === 'default'
    ? (process.env['AI_DEFAULT_MODEL'] ?? 'gpt-4o')
    : request.model;

  const builtin = BUILTIN_MODEL_INDEX.get(model);
  const provider = builtin?.provider;
  const providerType = provider?.type ?? inferProviderType(model);

  // 1. 协议解析 — 插件优先，fallback 到默认逻辑
  const baseUrl = resolveBaseUrl(provider);
  const protocol = runHookFirst('resolve.protocol', providerType ?? '', {
    model, provider: provider!, baseUrl,
  }) ?? 'chat_completions';

  // 2. API key 解析 — 插件优先
  const apiKey = (provider && runHookFirst('resolve.apiKey', providerType ?? '', {
    provider,
  })) ?? process.env['AI_API_KEY'] ?? '';

  // 3. Headers 注入
  const headers: Record<string, string> = {};
  if (provider && providerType) {
    runHookAll('request.headers', providerType, { model, provider, headers });
  }

  return { model, apiBaseUrl: baseUrl, apiKey, upstreamProtocol: protocol, ... };
}
```

**6. 启动时加载所有插件**

```typescript
// src/provider/plugins/index.ts
import './anthropic.js';
import './openai.js';
import './deepseek.js';
import './gemini.js';
import './openrouter.js';
import './custom.js';
```

```typescript
// src/index.ts — 在路由注册之前
import './provider/plugins/index.js';
```

**7. 新增 provider 的流程**

以 DigitalOcean 为例（参考 opencode 的实现）：

```typescript
// src/provider/plugins/digitalocean.ts
import { registerProviderPlugin } from '../provider-plugin.js';

registerProviderPlugin({
  providerType: 'digitalocean',
  hooks: {
    'resolve.protocol': () => 'chat_completions',

    'resolve.apiKey': ({ provider }) => {
      // DigitalOcean 用 Model Access Key
      return provider.apiKey ?? process.env['DIGITALOCEAN_MAK'] ?? undefined;
    },

    'request.headers': ({ headers }) => {
      headers['User-Agent'] = 'openAwork-gateway/0.5.8';
    },

    'models.filter': ({ models }) => {
      // 可以在这里注入 router 模型
      return models;
    },
  },
});
```

### 迁移策略

- 先实现插件框架 + 3 个核心插件（anthropic, openai, custom）
- `model-router.ts` 中的 `resolveUpstreamProtocol` 调用改为 `runHookFirst`
- 旧逻辑作为 fallback 保留，插件返回 `undefined` 时走旧路径
- 逐步把 `anthropic-betas.ts` 等散落的 provider 特有逻辑收归插件

---

## 实施路线图

| 阶段     | 方案                          | 预计工时 | 风险               |
| -------- | ----------------------------- | -------- | ------------------ |
| Week 1   | 方案 1（压缩）                | 0.5 天   | 极低               |
| Week 1   | 方案 2（错误中间件）          | 1 天     | 低                 |
| Week 2   | 方案 3（Catalog 缓存）        | 1.5 天   | 低                 |
| Week 3-4 | 方案 4（Schema/Handler 分离） | 3-5 天   | 中（需逐文件迁移） |
| Week 4-6 | 方案 5（Provider 插件化）     | 5-7 天   | 中（需回归测试）   |

### 验收标准

1. **压缩**：`/settings/providers` 响应带 `content-encoding: gzip`，SSE 流不压缩 ✅
2. **错误中间件**：所有 4xx/5xx 响应格式统一为 `{name, data: {message, ...}}` ✅
3. **Catalog 缓存**：stream 请求 p99 延迟降低 5-10ms，`PUT /settings/providers` 后立即生效 ✅
4. **Schema 分离**：`/docs` 端点返回有效 OpenAPI 3.0 spec ✅
5. **Provider 插件化**：新增 provider 只需一个文件 + 一行 import，不改 model-router 核心 ✅

---

## 实施完成记录

### 新增文件清单

```
src/infra/
├── error-response.ts          # ApiError 类 + 工厂方法
├── error-handler.ts           # 全局 Fastify 错误处理
├── parse-request.ts           # parseBody / parseQuery / parseParams
└── openapi.ts                 # @fastify/swagger 注册

src/provider/
├── provider-catalog.ts        # 带 TTL 缓存的 Catalog 服务
├── provider-plugin.ts         # 插件框架 + 注册表 + hook 调度
└── plugins/
    ├── index.ts               # 入口（加载所有插件）
    ├── anthropic.ts           # Anthropic 协议 + headers + key
    ├── openai.ts              # OpenAI 协议选择 + key
    ├── deepseek.ts            # DeepSeek
    ├── gemini.ts              # Google Gemini
    ├── openrouter.ts          # OpenRouter headers + key
    ├── nvidia.ts              # NVIDIA origin header
    └── custom.ts              # 通用 OpenAI-compatible

src/routes/schemas/
├── common.ts                  # 通用 schema（分页、错误格式）
└── providers.ts               # Provider API schema
```

### 修改文件清单

- `src/index.ts` — +compress, +swagger, +errorHandler, +plugins
- `src/provider/model-router.ts` — +runHookFirst/runHookAll 集成
- `src/routes/settings.ts` — +invalidateCatalog, +parseBody
- `src/routes/sessions.ts` — 全量迁移到 parseBody/parseQuery/ApiError
- `src/routes/permissions.ts` — 全量迁移
- `src/routes/questions.ts` — 全量迁移
- `src/routes/commands.ts` — 全量迁移
- `src/routes/agents.ts` — 全量迁移
- `src/routes/workspace.ts` — 全量迁移
- `src/routes/artifacts.ts` — 全量迁移
- `src/routes/pairing.ts` — 全量迁移
- `src/routes/session-shared-read-routes.ts` — 全量迁移
- `src/routes/team-handoffs.ts` — 全量迁移
- `src/routes/skill-selection.ts` — 全量迁移
- `src/routes/team-phase-a.ts` — 部分迁移
- `src/routes/workflows.ts` — 部分迁移
- `src/routes/team-workflows-crud.ts` — 部分迁移
- `package.json` — +@fastify/compress, +@fastify/swagger, +@fastify/swagger-ui

```

```
