# Agent Task 04: 修复缺失的依赖模块和导入路径

## 任务目标
补全缺失的依赖文件并修复所有模块导入错误

## 当前问题
- TS2307: Cannot find module '...' or its corresponding type declarations
- 约 27 个模块导入错误

## 需要修复的文件清单

### 1. 缺失的核心文件
从 OpenCode 源码复制以下文件：
```bash
- src/llm.ts
- src/cache-policy.ts
- src/tool-runtime.ts
- src/utils/ (整个目录)
```

### 2. 复制命令
```bash
cd /e/01.Projects/OpenAWork
cp temp/opencode/packages/llm/src/llm.ts packages/opencode-llm/src/
cp temp/opencode/packages/llm/src/cache-policy.ts packages/opencode-llm/src/
cp temp/opencode/packages/llm/src/tool-runtime.ts packages/opencode-llm/src/
cp -r temp/opencode/packages/llm/src/utils packages/opencode-llm/src/
```

### 3. 修复导入扩展名
确保所有导入路径都有 .js 扩展名：
```bash
cd packages/opencode-llm/src
find . -name "*.ts" -exec sed -i -E "s/(from ['\"]\.\.?\/[^'\"]*[^.js])['\"]$/\1.js'/g" {} +
```

### 4. 验证导入
```bash
grep -rn "Cannot find module" 
```

## 验收标准
- [ ] 所有缺失文件复制完成
- [ ] TS2307 错误全部消除
- [ ] 导入路径规范统一

## 预计错误减少
约 30-40 个错误

## 执行时间
15 分钟
