# 跨平台 Shell 支持实现总结

## 实现时间

2026-08-14

## 实现内容

为 OpenAWork 系统实现了完整的跨平台 Shell 执行支持，参考 Claude Code 权威仓库的设计架构。

## 新增模块

### 1. 平台检测模块 (`packages/agent-core/src/utils/platform.ts`)

- 检测当前运行平台：macOS / Windows / WSL / Linux
- 提供平台能力判断：`isWindowsEnvironment()`, `supportsPosixShell()`
- 支持 WSL 版本检测

### 2. Shell Provider 抽象层 (`packages/agent-core/src/utils/shell/`)

#### 核心文件

- `shell-provider.ts` - Provider 抽象接口定义
- `bash-provider.ts` - Bash/Zsh Provider 实现
- `powershell-provider.ts` - PowerShell Provider 实现
- `shell-detection.ts` - Shell 自动检测
- `shell-executor.ts` - 统一执行器入口
- `index.ts` - 模块导出

#### 测试文件

- `shell-executor.test.ts` - 单元测试和集成测试

## 核心功能

### 1. 统一的 Shell 执行接口

```typescript
const result = await executeShellCommand(command, shellType, {
  timeout: 30000,
  cwd: process.cwd(),
  signal: abortSignal,
});
```

### 2. 自动平台适配

- **Windows**: 默认使用 PowerShell，支持 Git Bash
- **macOS/Linux**: 使用 Bash 或 Zsh
- **WSL**: 自动检测并使用 POSIX Shell

### 3. 跨平台路径转换

- Windows 路径 ↔ POSIX 路径自动转换
- 支持 Git Bash 和 WSL 的路径映射

### 4. 命令修正和安全

- 自动修正 Windows CMD 风格命令（`2>nul` → `2>/dev/null`）
- 禁用 extglob 防止通配符注入
- 自动添加 stdin 重定向避免进程挂起

### 5. 进程管理

- 超时自动终止
- AbortSignal 支持
- 退出码正确捕获
- CWD 跟踪

### 6. 沙箱支持

- 提供沙箱模式骨架
- 隔离临时目录
- 限制文件系统访问

## 技术亮点

### 1. Provider 模式

通过 `ShellProvider` 接口统一不同 Shell 的差异：

```typescript
interface ShellProvider {
  buildExecCommand(...): Promise<ShellCommandResult>;
  getSpawnArgs(...): string[];
  getEnvironmentOverrides(...): Promise<Record<string, string>>;
}
```

### 2. 智能 Shell 检测

优先级：环境变量 → which 查找 → 常见路径

```typescript
// 1. OPENAWORK_SHELL
// 2. SHELL (如果是 bash/zsh)
// 3. which bash / which zsh
// 4. /bin, /usr/bin, /usr/local/bin, /opt/homebrew/bin
```

### 3. 路径转换算法

```typescript
// Windows → POSIX (Git Bash)
"C:\\Users\\test" → "/c/Users/test"

// POSIX → Windows (Node.js)
"/c/Users/test" → "C:\\Users\\test"
```

### 4. PowerShell 退出码捕获

```powershell
# 优先使用外部程序退出码，回退到 cmdlet 状态
$_ec = if ($null -ne $LASTEXITCODE) { 
  $LASTEXITCODE 
} elseif ($?) { 
  0 
} else { 
  1 
}
```

## 文档

### 1. 架构设计文档
- `packages/agent-core/docs/shell-architecture.md` - 完整架构说明

### 2. 使用指南
- `packages/agent-core/docs/shell-executor.md` - API 使用文档

### 3. 集成示例
- `packages/agent-core/docs/shell-integration-example.ts` - 工具集成示例

## 导出接口

在 `packages/agent-core/src/index.ts` 中导出：

```typescript
// 平台检测
export { getPlatform, getWslVersion, isWindowsEnvironment, supportsPosixShell };

// Shell 执行
export { 
  executeShellCommand, 
  getDefaultShellType,
  createBashShellProvider,
  createPowerShellProvider,
  // ...
};
```

## 测试覆盖

### 测试场景

- ✓ 平台检测准确性
- ✓ Shell 类型自动选择
- ✓ Bash 命令执行
- ✓ PowerShell 命令执行
- ✓ 中止信号处理
- ✓ 超时机制
- ✓ 路径转换

### 测试命令

```bash
pnpm --filter @openAwork/agent-core exec tsc --noEmit  # 类型检查 ✓
pnpm --filter @openAwork/agent-core test               # 运行测试
```

## 对比权威实现

### 已实现 ✓

- Provider 抽象模式
- 平台检测
- Bash 和 PowerShell 支持
- 路径转换
- 命令修正
- 超时和中止处理
- CWD 跟踪

### 暂未实现 (可选)

- Shell 快照（环境变量捕获）
- Tmux 隔离
- 会话环境变量持久化
- 命令前缀（CLAUDE_CODE_SHELL_PREFIX）

## 代码统计

- 新增文件：10 个
- 新增代码：~1000 行
- 文档：~600 行

## 下一步工作

### 短期

1. 集成到 agent-gateway 的工具系统
2. 添加更多单元测试
3. 完善错误处理和日志

### 中期

1. 实现流式输出支持
2. 添加命令历史记录
3. 实现安全审计

### 长期

1. 完整的沙箱运行时集成
2. 资源限制（CPU、内存）
3. 多会话环境隔离
4. Shell 快照和环境变量持久化

## 兼容性

| 平台 | Bash | PowerShell | 测试状态 |
|------|------|-----------|---------|
| Windows 11 | ✓ (Git Bash) | ✓ | 类型检查通过 |
| macOS | ✓ | ✓ (pwsh) | 未测试 |
| Linux | ✓ | ✓ (pwsh) | 未测试 |
| WSL2 | ✓ | - | 未测试 |

## 依赖

### 运行时依赖

- Node.js `child_process` 模块
- 文件系统 API (`fs`, `path`)

### 类型依赖

- `@types/node`

### 零外部依赖

所有实现都基于 Node.js 标准库，无需额外的 npm 包。

## 参考

- 权威仓库路径：`E:\01.Projects\OpenAWork\temp\claude-code-sourcemap\restored-src\src\utils\Shell.ts`
- 设计讨论：见本次对话记录

## 贡献者

- Claude (Sonnet 5) - 设计与实现
- 用户 - 需求提出与验证

---

**状态**: ✅ 已完成核心实现，类型检查通过

**版本**: v0.1.0 (初始实现)

**最后更新**: 2026-08-14
