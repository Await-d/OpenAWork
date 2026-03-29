# .agentdocs/workflow/260319-ai-provider配置管理方案.md

## 任务概览

为系统设计完整的 AI Provider 配置管理层，参考 AIDotNet/OpenCowork 的 `provider-store.ts` 实现。
覆盖：21 个内置 Provider 预设（含国内）、五维 active 模型选择、价格元数据、requestOverrides、升级策略、OAuth 认证。

**归属包**：`packages/agent-core/src/provider/`

---

## Part 1：核心类型定义

```typescript
// packages/agent-core/src/provider/types.ts

// Provider 协议类型
export type ProviderType =
  | 'anthropic'          // Anthropic SDK
  | 'openai-chat'        // OpenAI Chat Completions API
  | 'openai-responses'   // OpenAI Responses API（o系列/Codex）
  | 'openai-images'      // OpenAI Image Generation
  | 'gemini'             // Google Gemini
  | 'vertex-ai'          // Google Vertex AI

// 模型分类
export type ModelCategory = 'chat' | 'image' | 'speech'

// 认证方式
export type AuthMode = 'apiKey' | 'oauth' | 'channel'

// 推理模式配置
export interface ThinkingConfig {
  bodyParams: Record<string, unknown>     // 追加到请求体的参数
  forceTemperature?: number               // 强制覆盖 temperature（如 Anthropic 推理需要 1）
  reasoningEffortLevels?: string[]        // 可选的推理强度等级
  defaultReasoningEffort?: string         // 默认推理强度
}

// 请求级别覆盖（高级用户使用）
export interface RequestOverrides {
  headers?: Record<string, string>         // 追加请求头
  body?: Record<string, unknown>           // 追加请求体字段
  omitBodyKeys?: string[]                  // 从请求体中移除的字段（如 GPT-5 不支持 temperature）
}

// OAuth 2.0 配置
export interface OAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientIdLocked?: boolean      // 禁止用户修改 clientId
  scope: string
  redirectPath: string
  redirectPort?: number
  usePkce?: boolean             // PKCE 流程（OpenAI Codex 使用）
  extraParams?: Record<string, string>
}

// Channel 认证（OpenAI 企业通道）
export interface ChannelConfig {
  channelToken?: string
  channelSecret?: string
}

// UI 配置
export interface ProviderUiConfig {
  hideOAuthSettings?: boolean
}

// 模型配置
export interface AIModelConfig {
  id: string
  name: string
  icon: string
  enabled: boolean

  // 能力
  contextLength?: number
  maxOutputTokens?: number
  supportsVision?: boolean
  supportsFunctionCall?: boolean
  supportsThinking?: boolean
  supportsComputerUse?: boolean   // Computer Use（GPT-5.4+）
  thinkingConfig?: ThinkingConfig

  // 分类（默认 'chat'）
  category?: ModelCategory

  // 协议覆盖（覆盖 Provider 级别的 type）
  type?: ProviderType

  // 定价（USD / 百万 tokens）
  inputPrice?: number
  outputPrice?: number
  cacheCreationPrice?: number
  cacheHitPrice?: number

  // 缓存控制
  enablePromptCache?: boolean
  enableSystemPromptCache?: boolean
  responseSummary?: 'auto' | 'concise' | 'detailed'

  // 服务级别
  serviceTier?: 'auto' | 'default' | 'priority' | 'flex'

  // WebSocket 传输偏好
  preferResponsesWebSocket?: boolean

  // 请求覆盖（模型级别）
  requestOverrides?: RequestOverrides
}

// Provider 实例
export interface AIProvider {
  id: string                        // 运行时 UUID
  builtinId?: string                // 内置 Provider ID（如 'anthropic'、'deepseek'）
  name: string
  type: ProviderType
  apiKey: string
  baseUrl: string
  enabled: boolean
  models: AIModelConfig[]
  defaultModel?: string             // 该 Provider 的默认选中模型
  createdAt: number

  // 认证
  requiresApiKey?: boolean
  authMode?: AuthMode
  oauthConfig?: OAuthConfig
  channelConfig?: ChannelConfig

  // 网络
  useSystemProxy?: boolean
  userAgent?: string

  // 覆盖
  requestOverrides?: RequestOverrides
  preferResponsesWebSocket?: boolean
  instructionsPrompt?: string       // Responses API instructions 字段

  // UI
  ui?: ProviderUiConfig
}

// 执行时的 Provider 配置（传给 API 调用层）
export interface ProviderConfig {
  type: ProviderType
  apiKey: string
  baseUrl?: string
  model: string
  providerId: string
  providerBuiltinId?: string
  category?: ModelCategory

  computerUseEnabled?: boolean
  serviceTier?: string
  requiresApiKey?: boolean
  useSystemProxy?: boolean
  userAgent?: string
  responseSummary?: string
  enablePromptCache?: boolean
  enableSystemPromptCache?: boolean
  requestOverrides?: RequestOverrides
  instructionsPrompt?: string
  preferResponsesWebSocket?: boolean
}
```

---

## Part 2：内置 Provider 预设（21个）

### 2.1 国际 Provider

```typescript
// packages/agent-core/src/provider/presets/

// ── Anthropic ──────────────────────────────────────────────────
export const anthropicPreset: BuiltinProviderPreset = {
  builtinId: 'anthropic',
  name: 'Anthropic',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.anthropic.com',
  homepage: 'https://anthropic.com',
  apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  defaultModels: [
    { id: 'claude-opus-4-6',       name: 'Claude Opus 4.6',    icon: 'claude', enabled: true,  contextLength: 200_000, maxOutputTokens: 64_384, supportsVision: true, supportsFunctionCall: true,  inputPrice: 5,    outputPrice: 25,  cacheCreationPrice: 6.25,  cacheHitPrice: 0.5,  supportsThinking: true, thinkingConfig: { bodyParams: { thinking: { type: 'enabled', budget_tokens: 10000 } }, forceTemperature: 1 } },
    { id: 'claude-sonnet-4-6',     name: 'Claude Sonnet 4.6',  icon: 'claude', enabled: true,  contextLength: 200_000, maxOutputTokens: 64_384, supportsVision: true, supportsFunctionCall: true,  inputPrice: 3,    outputPrice: 15,  cacheCreationPrice: 3.75,  cacheHitPrice: 0.3,  supportsThinking: true, thinkingConfig: { bodyParams: { thinking: { type: 'enabled', budget_tokens: 10000 } }, forceTemperature: 1 } },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', icon: 'claude', enabled: true, contextLength: 200_000, maxOutputTokens: 8_192,  supportsVision: true, supportsFunctionCall: true, inputPrice: 1,    outputPrice: 5,   cacheCreationPrice: 1.25,  cacheHitPrice: 0.1,  supportsThinking: true },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', icon: 'claude', enabled: false, contextLength: 200_000, maxOutputTokens: 8_192, supportsVision: true, supportsFunctionCall: true, inputPrice: 0.8, outputPrice: 4, cacheCreationPrice: 1, cacheHitPrice: 0.08 },
  ],
}

// ── OpenAI ────────────────────────────────────────────────────
// 包含 GPT-5 系列、o系列推理、GPT-4.x、语音（speech）、图像（image）
// 完整列表见 openai-preset.ts（参考 OpenCowork openai.ts）

// ── Google ────────────────────────────────────────────────────
// Gemini 2.x 系列（gemini-2.5-pro、gemini-2.5-flash 等）

// ── DeepSeek ──────────────────────────────────────────────────
export const deepseekPreset: BuiltinProviderPreset = {
  builtinId: 'deepseek',
  name: 'DeepSeek',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  homepage: 'https://platform.deepseek.com',
  apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  defaultModels: [
    { id: 'deepseek-chat',     name: 'DeepSeek V3.2 (Chat)',     icon: 'deepseek', enabled: true,  contextLength: 128_000, maxOutputTokens: 8_192,  supportsFunctionCall: true,  inputPrice: 0.26, outputPrice: 0.38,  cacheCreationPrice: 0.26, cacheHitPrice: 0.026, supportsThinking: true, thinkingConfig: { bodyParams: { enable_thinking: true } } },
    { id: 'deepseek-reasoner', name: 'DeepSeek V3.2 (Reasoner)', icon: 'deepseek', enabled: true,  contextLength: 128_000, maxOutputTokens: 64_000, supportsFunctionCall: false, inputPrice: 0.7,  outputPrice: 2.5,   cacheCreationPrice: 0.7,  cacheHitPrice: 0.07  },
  ],
}

// ── OpenRouter ────────────────────────────────────────────────
// 代理多模型，默认空模型列表，用户自行添加

// ── Ollama （本地）────────────────────────────────────────────
export const ollamaPreset: BuiltinProviderPreset = {
  builtinId: 'ollama',
  name: 'Ollama',
  type: 'openai-chat',
  defaultBaseUrl: 'http://localhost:11434/v1',
  homepage: 'https://ollama.com',
  requiresApiKey: false,     // 本地服务不需要 API Key
  defaultModels: [],         // 用户自行添加本地模型
}

// ── Azure OpenAI ───────────────────────────────────────────────
// 需要 Deployment Name 而非 Model ID，baseUrl 包含 endpoint

// ── OpenAI Codex (OAuth) ───────────────────────────────────────
// OAuth 2.0 + PKCE，无需 API Key，通过 OpenAI 官方账号授权
```

### 2.2 国内 Provider（8 个）

| builtinId | 名称 | defaultEnabled | 备注 |
|-----------|------|----------------|------|
| `qwen` | 通义千问 | false | Qwen Max/Plus/Turbo |
| `qwen-coding` | 通义千问（代码）| false | Qwen Coder Plus/Turbo，CodingPreset 模式 |
| `moonshot` | 月之暗面 Moonshot | false | Moonshot v1 8K/32K/128K |
| `minimax` | MiniMax | false | MiniMax Text-01，100万 context |
| `minimax-coding` | MiniMax（代码）| false | CodingPreset 模式 |
| `baidu` | 百度文心 | false | ERNIE 4.5 系列 |
| `bigmodel` | 智谱 BigModel | false | GLM-4 Plus/Flash + GLM Z1 推理 |
| `siliconflow` | 硅基流动 | false | 代理多模型，价格低 |
| `xiaomi` | 小米 AI | false | MiMo-7B-RL 推理模型 |

**CodingPreset 模式**：同一 Provider（如 Qwen）可注册两个实例——通用对话实例和代码专用实例（不同默认模型、不同 instructionsPrompt），用户可在「快速模式」中选择代码实例。

---

## Part 3：五维 Active 模型选择

```typescript
// packages/agent-core/src/provider/manager.ts

export interface ActiveSelection {
  // 主对话（功能最强）
  chat: { providerId: string; modelId: string } | null;
  // 快速模式（轻量/便宜，用于 cron/auto-reply 等）
  fast: { providerId: string; modelId: string } | null;
  // 翻译（可独立配置，默认 fallback 到 chat）
  translation: { providerId: string; modelId: string } | null;
  // 语音识别（category='speech' 模型）
  speech: { providerId: string; modelId: string } | null;
  // 图像生成（category='image' 模型）
  image: { providerId: string; modelId: string } | null;
}

export interface ProviderManager {
  // CRUD
  listProviders(): AIProvider[];
  addProviderFromPreset(builtinId: string): string | null;
  updateProvider(id: string, patch: Partial<AIProvider>): void;
  removeProvider(id: string): void;
  toggleProviderEnabled(id: string): void;

  // 模型管理
  addModel(providerId: string, model: AIModelConfig): void;
  updateModel(providerId: string, modelId: string, patch: Partial<AIModelConfig>): void;
  removeModel(providerId: string, modelId: string): void;
  toggleModelEnabled(providerId: string, modelId: string): void;

  // 五维 active 选择
  setActiveChat(providerId: string, modelId?: string): void;
  setActiveFast(providerId: string, modelId?: string): void;
  setActiveTranslation(providerId: string, modelId?: string): void;
  setActiveSpeech(providerId: string, modelId?: string): void;
  setActiveImage(providerId: string, modelId?: string): void;

  // 获取 ProviderConfig（传给 API 调用层）
  getChatProviderConfig(): ProviderConfig | null;
  getFastProviderConfig(): ProviderConfig | null;
  getTranslationProviderConfig(): ProviderConfig | null;  // fallback 到 chat
  getSpeechProviderConfig(): ProviderConfig | null;
  getImageProviderConfig(): ProviderConfig | null;
  getProviderConfigById(providerId: string, modelId: string): ProviderConfig | null;

  // 升级时同步内置预设（保留用户 enabled 状态）
  syncBuiltinPresets(): void;
}
```

---

## Part 4：关键工具函数

### 4.1 URL 规范化

```typescript
export function normalizeProviderBaseUrl(baseUrl: string, type: ProviderType): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (type === 'anthropic') return trimmed.replace(/\/v1(?:\/messages)?$/i, '')
  if (type === 'gemini' || type === 'vertex-ai') return trimmed.replace(/\/openai$/i, '')
  return trimmed
}
```

### 4.2 请求覆盖合并 + GPT-5 自动修复

```typescript
export function buildRequestOverrides(
  providerOverrides?: RequestOverrides,
  modelOverrides?: RequestOverrides,
  modelId?: string
): RequestOverrides | undefined {
  const merged = mergeRequestOverrides(providerOverrides, modelOverrides)
  // GPT-5 系列不支持 temperature，自动加入 omitBodyKeys
  if (modelId && /^gpt-5/i.test(modelId.split('/').pop() ?? '')) {
    const omit = new Set(merged?.omitBodyKeys ?? [])
    omit.add('temperature')
    return { ...merged, omitBodyKeys: Array.from(omit) }
  }
  return merged
}
```

### 4.3 升级时保留用户配置（mergeBuiltinModels）

```typescript
export function mergeBuiltinModels(
  existingModels: AIModelConfig[],
  presetModels: AIModelConfig[]
): AIModelConfig[] {
  const existingById = new Map(existingModels.map((m) => [m.id, m]))
  const presetIds = new Set(presetModels.map((m) => m.id))

  // 内置模型：以 preset 定义为准（更新价格/能力），但保留用户的 enabled 状态
  const merged = presetModels.map((preset) => {
    const existing = existingById.get(preset.id)
    if (!existing) return { ...preset }
    return { ...existing, ...preset, enabled: existing.enabled }  // enabled 由用户控制
  })

  // 用户自定义模型（不在 preset 中的）完整保留
  for (const m of existingModels) {
    if (!presetIds.has(m.id)) merged.push(m)
  }
  return merged
}
```

### 4.4 Token 成本计算

```typescript
export interface TokenUsageCost {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheHitTokens?: number;
  totalCostUsd: number;
  breakdown: { inputCost: number; outputCost: number; cacheCreationCost: number; cacheHitCost: number };
}

export function calculateTokenCost(
  model: AIModelConfig,
  usage: Omit<TokenUsageCost, 'totalCostUsd' | 'breakdown'>
): TokenUsageCost {
  const M = 1_000_000
  const inputCost         = ((model.inputPrice         ?? 0) * usage.inputTokens)                       / M
  const outputCost        = ((model.outputPrice        ?? 0) * usage.outputTokens)                      / M
  const cacheCreationCost = ((model.cacheCreationPrice ?? 0) * (usage.cacheCreationTokens ?? 0))        / M
  const cacheHitCost      = ((model.cacheHitPrice      ?? 0) * (usage.cacheHitTokens     ?? 0))         / M
  return { ...usage, totalCostUsd: inputCost + outputCost + cacheCreationCost + cacheHitCost,
    breakdown: { inputCost, outputCost, cacheCreationCost, cacheHitCost } }
}
```

---

## Part 5：OAuth 2.0 + PKCE 流程

```typescript
// packages/agent-core/src/provider/oauth.ts

export interface OAuthFlowManager {
  startFlow(config: OAuthConfig): Promise<OAuthTokens>;
  refreshToken(config: OAuthConfig, refreshToken: string): Promise<OAuthTokens>;
  revokeToken(config: OAuthConfig, token: string): Promise<void>;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

// 桌面端：Tauri shell.open(authorizeUrl) + localhost:redirectPort callback server
// 移动端：Expo WebBrowser.openAuthSessionAsync + deep link scheme
// 存储：SecureStore（accessToken + refreshToken，不入 SQLite 明文）
```

---

## Part 6：Provider 配置页 UI

```
设置 → AI 平台
  ├─ 活跃选择面板（顶部常驻）
  │   ├─ 主对话：    [Anthropic ▼] [Claude Sonnet 4.6 ▼]  $3/$15 per M
  │   ├─ 快速模式：  [DeepSeek  ▼] [DeepSeek V3.2 Chat ▼]  $0.26/$0.38 per M
  │   ├─ 翻译：      [跟随主对话 / 自定义]
  │   ├─ 语音识别：  [OpenAI ▼]    [GPT-4o Transcribe ▼]
  │   └─ 图像生成：  [OpenAI ▼]    [DALL-E 3 ▼]
  │
  ├─ Provider 列表
  │   ├─ ● Anthropic       sk-ant-•••••   [编辑]
  │   ├─ ● DeepSeek        sk-•••••       [编辑]
  │   ├─ ○ Google Gemini   未配置         [配置]
  │   ├─ ● Ollama（本地）  无需 Key       [管理模型]
  │   ├─ ○ 通义千问        未配置         [配置]  （国内分组）
  │   └─ [+ 添加 Provider]
  │
  └─ Provider 详情（编辑页）
      ├─ 基础：名称 / API Key / Base URL
      ├─ 认证：API Key / [OAuth 授权按钮]
      ├─ 高级：requestOverrides JSON 编辑器（折叠）
      ├─ 系统代理开关
      └─ 模型列表：启用/禁用 + 自定义模型
```

---

## 实施计划

### Phase PR1（W2-W3）

- [x] PR-01 ✅：`packages/agent-core/src/provider/types.ts` — 完整类型定义
- [x] PR-02 ✅：21 个内置 Provider 预设（`presets/` 目录，每文件一个 Provider）
- [x] PR-03 ✅：`ProviderManager` 实现（CRUD + 五维 active + syncBuiltinPresets）
- [x] PR-04 ✅：工具函数（normalizeBaseUrl / mergeBuiltinModels / buildRequestOverrides / calculateTokenCost）
- [x] PR-05 ✅：`OAuthFlowManager`（桌面端 Tauri + 移动端 Expo）
- [x] PR-06 ✅：Provider 持久化（SecureStore 存 API Key，SQLite 存其余）

### Phase PR2（W5-W6）

- [x] PR-07 ✅：Provider 设置页 UI（活跃选择面板 + Provider 列表）
- [x] PR-08 ✅：模型管理 UI（启用/禁用 + 添加自定义 + 价格展示）
- [x] PR-09 ✅：OAuth 授权 UI + token 刷新逻辑
- [x] PR-10 ✅：成本概览 UI（当月已用 + 模型单价）
- [x] PR-11 ✅：本月 Token 用量聚合（消费模块 VII 的 TokenUsageCost）

**验收标准**
- 21 个内置 Provider 全部可配置，国内 Provider 默认关闭
- 五维 active 选择独立生效（主对话/快速/翻译/语音/图像各自独立切换）
- 升级后用户自定义模型和 enabled 状态保留（mergeBuiltinModels）
- GPT-5 系列请求自动移除 temperature（buildRequestOverrides omitBodyKeys）
- Anthropic baseUrl 自动规范化
- Token 成本计算误差 < 0.01%（与官方文档定价对齐）
- OAuth 流程（Codex）桌面端 + 移动端均可完成授权

---

## 与现有方案集成边界

| 集成点 | 现有方案 | 本文档新增 |
|--------|---------|----------|
| 模型路由层 | T-12（类型路由） | 五维 active + `getProviderConfigById` |
| Token 成本监控 | 模块 VII（只有设计） | `calculateTokenCost()` 完整实现 |
| 国内 Provider | 未提及 | 9 个国内预设 |
| OAuth 认证 | MCP Skill OAuth（部分）| 完整 OAuth 2.0 + PKCE |
| 升级策略 | 未设计 | `mergeBuiltinModels`（用户配置不丢）|
| URL 规范化 | 未设计 | `normalizeProviderBaseUrl` |
| requestOverrides | 未设计 | 三层合并（provider + model + GPT-5 auto）|
| 推理模式 | 未设计 | `ThinkingConfig`（Claude/GPT-5/DeepSeek）|

---

## 备注

- 本方案参考 AIDotNet/OpenCowork `src/renderer/src/stores/provider-store.ts` + `stores/providers/`（v0.6.0）。
- API Key 存储：桌面端 Tauri Stronghold / 系统 Keychain；移动端 Expo SecureStore；不入 SQLite 明文。
- 国内 Provider 默认 `defaultEnabled: false`，用户可在设置中开启。
- Ollama `requiresApiKey: false`，模型列表由用户从 `ollama list` 手动同步或自动拉取（HTTP `/api/tags`）。
- Memory sync: completed
