# Agent Task 02: 修复 Schema Union 类型推断问题

## 任务目标
修复 Schema.Union 在新版本中的类型推断和判别式联合类型问题

## 当前问题
- TS2339: Property 'role' does not exist on type 'never'
- TS2339: Property 'content' does not exist on type 'never'
- Union 类型的判别式字段无法正确推断

## 需要修复的文件
- src/protocols/openai-chat.ts (lines 310-320)
- src/protocols/openai-responses.ts
- src/schema/messages.ts
- src/schema/events.ts

## 修复方案

### 1. 问题根源
新版 Effect Schema 的 Union 需要显式指定判别式字段

### 2. 修复示例
```typescript
// 问题代码
const OpenAIChatMessage = Schema.Union([
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Union([...]) }),
  Schema.Struct({ role: Schema.Literal("assistant"), ... }),
  Schema.Struct({ role: Schema.Literal("tool"), ... }),
])

// 修复方案：添加类型注解
const OpenAIChatMessage = Schema.Union(
  Schema.Struct({ role: Schema.Literal("system"), content: Schema.String }),
  Schema.Struct({ role: Schema.Literal("user"), content: Schema.Union([...]) }),
  Schema.Struct({ role: Schema.Literal("assistant"), ... }),
  Schema.Struct({ role: Schema.Literal("tool"), ... }),
)
```

### 3. 处理判别式访问
```typescript
// 在使用 Union 类型的地方，添加类型守卫
const lowerMessages = (messages: OpenAIChatMessage[]) => {
  return messages.map(msg => {
    if ('role' in msg) {
      switch (msg.role) {
        case 'system': return { role: 'system', content: msg.content }
        // ...
      }
    }
  })
}
```

## 验收标准
- [ ] Union 类型的判别式字段可以正确访问
- [ ] 类型守卫添加完整
- [ ] 相关编译错误消除

## 预计错误减少
约 100-150 个错误

## 执行时间
30 分钟
