# OpenCode LLM 错误处理和重试机制

完整的错误处理能力，用于构建高可用的 LLM 应用。

## 功能特性

### 1. 智能重试策略

- **指数退避**：自动增加重试间隔时间
- **抖动**：防止惊群效应
- **可配置的重试条件**：根据错误类型决定是否重试
- **基于 Effect**：函数式错误处理

```typescript
import { withRetry } from '@openAwork/opencode-llm/error';

const effect = withRetry(myLLMCall(), {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
});
```

### 2. 断路器模式

防止级联失败和雪崩效应：

- **CLOSED**：正常状态，请求通过
- **OPEN**：故障状态，快速失败
- **HALF_OPEN**：恢复测试状态

```typescript
import { createCircuitBreaker } from '@openAwork/opencode-llm/error';

const program = Effect.gen(function* () {
  const breaker = yield* createCircuitBreaker({
    failureThreshold: 5,
    timeoutMs: 60000,
  });

  const result = yield* breaker.protect(myLLMCall());
  return result;
});
```

### 3. 优雅降级

主模型失败时自动切换到备用模型：

```typescript
import { withFallback } from '@openAwork/opencode-llm/error';

const result =
  yield *
  withFallback(primaryModel, request, (model, req) => LLM.generate(req), {
    fallbackModels: [fallback1, fallback2],
    shouldFallback: (error) => ErrorClassifier.isRetryable(error),
  });
```

### 4. 统一错误处理器

整合所有策略的高级 API：

```typescript
import { createResilientExecutor, HIGH_AVAILABILITY_STRATEGY } from '@openAwork/opencode-llm/error';

const executor = createResilientExecutor({
  model,
  request,
  execute: (m, r) => LLM.generate(r),
  strategy: HIGH_AVAILABILITY_STRATEGY,
});

const result = yield * executor;
```

## 预设策略

### AGGRESSIVE_RETRY_STRATEGY

适用于开发/测试环境：

- 5 次重试
- 快速退避（500ms 起始）
- 禁用断路器

### CONSERVATIVE_RETRY_STRATEGY

适用于生产环境：

- 3 次重试
- 慢速退避（2s 起始）
- 启用断路器

### HIGH_AVAILABILITY_STRATEGY

最高可用性：

- 启用重试
- 启用断路器
- 启用降级

### FAIL_FAST_STRATEGY

快速失败（延迟敏感场景）：

- 禁用所有容错机制

## 错误分类

```typescript
import { ErrorClassifier } from '@openAwork/opencode-llm/error';

// 检查错误类型
ErrorClassifier.isNetworkError(error);
ErrorClassifier.isRateLimitError(error);
ErrorClassifier.isAuthenticationError(error);
ErrorClassifier.isContextOverflowError(error);
ErrorClassifier.isRetryable(error);

// 获取重试延迟
const retryAfter = ErrorClassifier.getRetryAfterMs(error);
```

## 最佳实践

1. **生产环境**：使用 `CONSERVATIVE_RETRY_STRATEGY` 或 `HIGH_AVAILABILITY_STRATEGY`
2. **开发环境**：使用 `AGGRESSIVE_RETRY_STRATEGY` 快速发现问题
3. **实时交互**：使用 `FAIL_FAST_STRATEGY` 避免等待
4. **批处理**：使用 `HIGH_AVAILABILITY_STRATEGY` 确保完成

## 架构设计

错误处理策略按层次应用：

```
断路器（最外层，快速失败）
  └── 降级（次外层，模型级别容错）
      └── 重试（最内层，请求级别容错）
```

这种设计确保：

- 断路器可以立即阻止有问题的服务
- 降级在重试失败后提供备选方案
- 重试处理瞬时错误
