# Agent Task 03: 修复 optionalArray 和 optionalNull 工具函数

## 任务目标
修复 `optionalArray` 和 `optionalNull` 工具函数在新版 Effect Schema 中的兼容性

## 当前问题
- TS2322: Type '...' is not assignable to type '...'
- TS2345: Argument of type '...' is not assignable to parameter of type '...'
- 这些工具函数的类型签名与新版 Schema API 不兼容

## 需要修复的文件
- src/protocols/shared.ts
- 所有使用 optionalArray/optionalNull 的文件

## 修复方案

### 1. 查看当前实现
```typescript
// 当前 shared.ts 中的实现
export const optionalArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.optional(Schema.Array(item))

export const optionalNull = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.optional(Schema.NullOr(schema))
```

### 2. 更新为新版 API
```typescript
// Effect 3.22.1 的正确签名
import { Schema } from "effect"

export const optionalArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.optional(Schema.Array(item), { exact: true })

export const optionalNull = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  Schema.optional(Schema.Union(Schema.Null, schema))
```

### 3. 检查所有使用位置
```bash
grep -rn "optionalArray\|optionalNull" src/
```

## 验收标准
- [ ] shared.ts 中的工具函数更新完成
- [ ] 所有使用位置的类型检查通过
- [ ] 编译错误减少

## 预计错误减少
约 60-80 个错误

## 执行时间
20 分钟
