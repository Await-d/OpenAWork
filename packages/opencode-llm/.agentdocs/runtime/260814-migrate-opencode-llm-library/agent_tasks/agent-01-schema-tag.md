# Agent Task 01: 修复 Schema.tag API 和类型标签

## 任务目标
修复 Effect 3.22.1 中 `Schema.tag()` API 的使用方式变更

## 当前问题
Effect 旧版使用 `Schema.tag("value")` 创建字面量标签，新版需要使用 `Schema.Literal("value")`

## 需要修复的文件
- src/protocols/openai-chat.ts
- src/protocols/openai-responses.ts
- src/protocols/anthropic-messages.ts
- src/protocols/bedrock-converse.ts

## 修复方案

### 1. 查找所有 Schema.tag 使用
```bash
grep -rn "Schema.tag(" src/protocols/
```

### 2. 替换规则
```typescript
// 旧版 API
type: Schema.tag("function")

// 新版 API
type: Schema.Literal("function")
```

### 3. 批量替换命令
```bash
cd /e/01.Projects/OpenAWork/packages/opencode-llm/src
find . -name "*.ts" -exec sed -i 's/Schema\.tag(\([^)]*\))/Schema.Literal(\1)/g' {} +
```

## 验收标准
- [ ] 所有 `Schema.tag()` 替换为 `Schema.Literal()`
- [ ] 相关文件编译通过
- [ ] 类型推断正确

## 预计错误减少
约 40-50 个错误

## 执行时间
15 分钟
