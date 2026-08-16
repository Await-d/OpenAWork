# ThinkingConfig 协议升级说明

## 概述

当前项目的 `/v1/messages` 协议思考等级参数已升级，对齐参考实现（claude-code）的设计，同时保持向后兼容。

## 核心变更

### 1. 新增 `thinking` 参数（推荐）

新版 API 支持通过 `thinking` 对象参数直接控制思考模式：

```typescript
// 类型定义
type ThinkingConfig =
  | { type: 'adaptive' } // 自适应思考（Claude 4.6+）
  | { type: 'enabled'; budgetTokens: number } // 显式思考预算
  | { type: 'disabled' }; // 禁用思考
```

### 2. 支持 Adaptive Thinking

**Adaptive thinking** 是 Claude 4.6+ 的核心特性，模型根据任务复杂度自动调整思考深度：

```json
POST /v1/stream
{
  "message": "帮我重构这段代码",
  "model": "claude-sonnet-4-6",
  "thinking": { "type": "adaptive" },
  "clientRequestId": "req-123"
}
```

支持的模型：

- `claude-opus-4-6`
- `claude-sonnet-4-6`
- 未来 1P/Foundry 上的新模型

### 3. 向后兼容

旧版参数（`thinkingEnabled` + `reasoningEffort`）继续支持：

```json
POST /v1/stream
{
  "message": "分析这个问题",
  "model": "claude-sonnet-4",
  "thinkingEnabled": true,
  "reasoningEffort": "high",
  "clientRequestId": "req-456"
}
```

## API 使用示例

### 示例 1：Adaptive Thinking（推荐）

```bash
curl -X POST http://localhost:3000/v1/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "设计一个高可用的微服务架构",
    "model": "claude-sonnet-4-6",
    "thinking": { "type": "adaptive" },
    "clientRequestId": "req-001"
  }'
```

### 示例 2：显式思考预算

```bash
curl -X POST http://localhost:3000/v1/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "优化数据库查询性能",
    "model": "claude-opus-4",
    "thinking": {
      "type": "enabled",
      "budgetTokens": 16384
    },
    "clientRequestId": "req-002"
  }'
```

### 示例 3：禁用思考

```bash
curl -X POST http://localhost:3000/v1/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "快速回答这个问题",
    "model": "claude-sonnet-4",
    "thinking": { "type": "disabled" },
    "clientRequestId": "req-003"
  }'
```

### 示例 4：旧版参数（向后兼容）

```bash
curl -X POST http://localhost:3000/v1/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "message": "分析代码性能",
    "model": "claude-sonnet-4",
    "thinkingEnabled": true,
    "reasoningEffort": "high",
    "clientRequestId": "req-004"
  }'
```

## 参数对比

| 场景         | 新版 API                                             | 旧版 API（兼容）                                   |
| ------------ | ---------------------------------------------------- | -------------------------------------------------- |
| 自适应思考   | `thinking: { type: 'adaptive' }`                     | ❌ 不支持                                          |
| 中等强度思考 | `thinking: { type: 'enabled', budgetTokens: 8192 }`  | `thinkingEnabled: true, reasoningEffort: 'medium'` |
| 高强度思考   | `thinking: { type: 'enabled', budgetTokens: 16384 }` | `thinkingEnabled: true, reasoningEffort: 'high'`   |
| 禁用思考     | `thinking: { type: 'disabled' }`                     | `thinkingEnabled: false`                           |

## 预算映射表

当使用旧版 `reasoningEffort` 参数时，系统自动映射为 `budgetTokens`：

| reasoningEffort | budgetTokens (Anthropic) | budgetTokens (Gemini) | budgetTokens (Qwen) |
| --------------- | ------------------------ | --------------------- | ------------------- |
| `none`          | 0                        | 0                     | 0                   |
| `minimal`       | 1024                     | 1024                  | 512                 |
| `low`           | 4096                     | 4096                  | 2048                |
| `medium`        | 8192                     | 8192                  | 8192                |
| `high`          | 16384                    | 16384                 | 16384               |
| `xhigh`         | 31999                    | 24576                 | 32768               |
| `max`           | 31999                    | 24576                 | 32768               |

## Provider 支持情况

| Provider   | Adaptive | Enabled + Budget | Reasoning Effort | 备注                                           |
| ---------- | -------- | ---------------- | ---------------- | ---------------------------------------------- |
| Anthropic  | ✅       | ✅               | ✅               | 完整支持所有模式                               |
| OpenAI     | ❌       | ✅               | ✅               | 通过 `reasoningEffort` 参数                    |
| Gemini     | ❌       | ✅               | ✅               | 2.5+: `thinking_budget`; 3.x: `thinking_level` |
| DeepSeek   | ❌       | ✅               | ✅               | `thinking` + `reasoning_effort`                |
| Qwen       | ❌       | ✅               | ✅               | `enable_thinking` + `thinking_budget`          |
| Moonshot   | ❌       | ✅               | ❌               | `thinking: { type: 'enabled' }`                |
| OpenRouter | ❌       | ✅               | ✅               | 转发到上游 Provider                            |

## 迁移建议

### 对于新项目

推荐使用新版 `thinking` 参数：

```typescript
// TypeScript 客户端示例
const response = await fetch('/v1/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    message: '你的问题',
    model: 'claude-sonnet-4-6',
    thinking: { type: 'adaptive' }, // 推荐！
    clientRequestId: generateUUID(),
  }),
});
```

### 对于现有项目

旧版参数继续有效，无需立即迁移：

```typescript
// 现有代码无需修改
const response = await fetch('/v1/stream', {
  method: 'POST',
  body: JSON.stringify({
    message: '你的问题',
    model: 'claude-sonnet-4',
    thinkingEnabled: true, // 继续有效
    reasoningEffort: 'high', // 继续有效
    clientRequestId: generateUUID(),
  }),
});
```

建议在方便时迁移到新版 API，以获得 adaptive thinking 等新特性。

## 常见问题

### Q1: 为什么需要升级协议？

**A:** 参考实现（claude-code）使用 `ThinkingConfig` 联合类型支持 Anthropic 的 adaptive thinking 特性，这是 Claude 4.6+ 的核心能力。旧版的 `enabled: boolean` 设计无法表达 adaptive 模式。

### Q2: 旧版参数会被移除吗？

**A:** 不会。旧版参数（`thinkingEnabled` + `reasoningEffort`）将长期支持，保证向后兼容。

### Q3: 如何判断模型是否支持 adaptive thinking？

**A:** 当前支持 adaptive 的模型：

- `claude-opus-4-6`
- `claude-sonnet-4-6`
- 1P/Foundry 上的未来新模型默认支持

如果对不支持的模型使用 `type: 'adaptive'`，系统会自动降级为 `type: 'enabled'` + 默认预算（8192）。

### Q4: `thinking` 和 `thinkingEnabled` 同时存在时，哪个优先？

**A:** `thinking` 参数优先。如果同时提供，`thinkingEnabled` 和 `reasoningEffort` 会被忽略。

### Q5: 如何在团队模板中配置 adaptive thinking？

**A:** 在团队模板的 metadata 中设置：

```json
{
  "thinkingConfig": {
    "type": "adaptive"
  }
}
```

## 技术细节

### 类型定义

```typescript
// 新版 ThinkingConfig（对齐参考实现）
export type ThinkingConfig =
  { type: 'adaptive' } | { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };

// 扩展配置（内部使用）
export interface ExtendedThinkingConfig {
  config: ThinkingConfig;
  effort?: ReasoningEffort;
  providerType: string;
  supportsThinking: boolean;
}
```

### 内部实现

1. **请求解析**：`stream.ts` 中的 `streamRequestSchema` 同时接受新旧参数
2. **配置构建**：`stream-model-round.ts` 优先使用 `thinking`，回退到旧版参数
3. **Provider 适配**：`provider-options.ts` 将 `ThinkingConfig` 转换为各家厂商的实际参数
4. **Adaptive 降级**：不支持 adaptive 的模型自动降级为 `enabled` + 默认预算

### 参考实现对齐

| 特性                               | 参考实现 | 当前项目 | 状态            |
| ---------------------------------- | -------- | -------- | --------------- |
| `type: 'adaptive'`                 | ✅       | ✅       | ✅ 已对齐       |
| `type: 'enabled'` + `budgetTokens` | ✅       | ✅       | ✅ 已对齐       |
| `type: 'disabled'`                 | ✅       | ✅       | ✅ 已对齐       |
| 旧版兼容                           | ❌       | ✅       | ✅ 超越参考实现 |
| 跨 Provider 支持                   | ❌       | ✅       | ✅ 超越参考实现 |

## 相关文件

- `services/agent-gateway/src/v2-runtime/upstream/thinking-config.ts` — 类型定义和工具函数
- `services/agent-gateway/src/v2-runtime/upstream/provider-options.ts` — Provider 适配逻辑
- `services/agent-gateway/src/routes/stream.ts` — 请求参数 schema
- `services/agent-gateway/src/routes/stream-model-round.ts` — 配置构建和传递

## 更新日志

- **2026-08-14**: 初始版本，对齐参考实现的 `ThinkingConfig` 设计
- 支持 `adaptive` / `enabled` / `disabled` 三种模式
- 保持旧版 `thinkingEnabled` + `reasoningEffort` 向后兼容
- 新增 `modelSupportsAdaptiveThinking()` 判定逻辑
