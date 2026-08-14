# Agent Task 05: 修复 Effect.fn 和 Effect.gen 函数签名

## 任务目标
修复 Effect.fn 和 Effect.gen 在新版本中的类型签名和使用方式

## 当前问题
- TS2554: Expected X arguments, but got Y
- TS2488: Type must satisfy the constraint
- Effect.fn 和 Effect.gen 的类型推断问题

## 需要修复的文件
- src/protocols/openai-chat.ts
- src/protocols/openai-responses.ts
- src/protocols/anthropic-messages.ts
- src/protocols/bedrock-converse.ts
- src/protocols/utils/*.ts

## 修复方案

### 1. Effect.fn 签名更新
```typescript
// 旧版
const lowerOptions = Effect.fn("lowerOptions")(function* (request: LLMRequest) {
  // ...
})

// 新版 - 添加类型注解
const lowerOptions: (request: LLMRequest) => Effect.Effect<Options, ProviderError> = 
  Effect.fn("lowerOptions")(function* (request) {
    // ...
  })
```

### 2. Effect.gen 返回类型
```typescript
// 确保 generator 函数正确返回 Effect 类型
const step = (state: State, event: Event) =>
  Effect.gen(function* () {
    // 使用 yield* 而不是 yield
    const result = yield* someEffect
    return [newState, events] as const
  })
```

### 3. 批量检查
```bash
grep -rn "Effect.fn\|Effect.gen" src/protocols/
```

## 验收标准
- [ ] 所有 Effect.fn 有正确的类型注解
- [ ] 所有 Effect.gen 返回类型正确
- [ ] TS2554 和 TS2488 错误消除

## 预计错误减少
约 80-100 个错误

## 执行时间
25 分钟
