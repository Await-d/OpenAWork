# OpenAWork 跨平台 Shell 架构设计

## 概述

OpenAWork 的跨平台 Shell 执行系统参考 Claude Code 权威仓库的设计，提供统一的接口来执行 Bash 和 PowerShell 命令，自动处理 Windows/macOS/Linux 平台差异。

## 设计目标

1. **统一接口**：为不同 Shell 类型（Bash/PowerShell）提供一致的调用接口
2. **自动适配**：根据平台自动选择合适的 Shell 和路径转换策略
3. **安全隔离**：支持沙箱模式执行不可信命令
4. **错误处理**：优雅处理超时、中止、退出码等场景
5. **可测试性**：模块化设计，便于单元测试和集成测试

## 架构设计

### 核心模块

```
packages/agent-core/src/utils/
├── platform.ts                    # 平台检测
└── shell/
    ├── shell-provider.ts          # Provider 抽象接口
    ├── bash-provider.ts           # Bash/Zsh Provider 实现
    ├── powershell-provider.ts     # PowerShell Provider 实现
    ├── shell-detection.ts         # Shell 自动检测
    ├── shell-executor.ts          # 统一执行器
    └── index.ts                   # 模块导出
```

### 层次结构

```
┌─────────────────────────────────────────────────┐
│           Agent Gateway / Tools                 │
│         (调用 executeShellCommand)               │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│         Shell Executor (shell-executor.ts)       │
│  - 命令执行入口                                   │
│  - Provider 选择和缓存                           │
│  - 子进程管理                                    │
└────────────────┬────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
┌───────▼──────┐  ┌──────▼──────────┐
│ BashProvider │  │ PowerShellProvider│
│              │  │                 │
│ - 命令构建   │  │ - 命令构建      │
│ - 路径转换   │  │ - Base64编码    │
│ - Extglob禁用│  │ - 退出码捕获    │
└──────────────┘  └─────────────────┘
```

### ShellProvider 接口

所有 Shell 类型都实现统一的 `ShellProvider` 接口：

```typescript
interface ShellProvider {
  type: ShellType; // 'bash' | 'powershell'
  shellPath: string; // Shell 可执行文件路径
  detached: boolean; // 是否以 detached 模式启动

  // 构建完整的 shell 命令
  buildExecCommand(command: string, options: ShellExecOptions): Promise<ShellCommandResult>;

  // 获取 spawn 参数
  getSpawnArgs(commandString: string): string[];

  // 获取环境变量覆盖
  getEnvironmentOverrides(command: string): Promise<Record<string, string>>;
}
```

## 平台支持

### 支持的平台

| 平台    | 默认 Shell | 备选 Shell | 路径转换        |
| ------- | ---------- | ---------- | --------------- |
| macOS   | Bash/Zsh   | -          | 不需要          |
| Linux   | Bash/Zsh   | -          | 不需要          |
| WSL     | Bash/Zsh   | -          | POSIX ↔ Windows |
| Windows | PowerShell | Git Bash   | Windows ↔ POSIX |

### 平台检测

```typescript
// 检测当前平台
const platform = getPlatform(); // 'macos' | 'windows' | 'wsl' | 'linux'

// 判断是否为 Windows 环境
if (isWindowsEnvironment()) {
  // Windows 或 WSL
}

// 判断是否支持 POSIX shell
if (supportsPosixShell()) {
  // 可以使用 bash/zsh 命令
}
```

## BashProvider 实现

### 核心功能

1. **路径转换**（Windows）
   - `C:\Users\...` → `/c/Users/...` (给 Git Bash)
   - `/c/Users/...` → `C:\Users\...` (给 Node.js)

2. **命令修正**
   - `2>nul` → `2>/dev/null`
   - 自动添加 `< /dev/null` 防止 stdin 等待

3. **安全机制**
   - 禁用 extglob: `shopt -u extglob`
   - 禁用 zsh 扩展通配: `setopt NO_EXTENDED_GLOB`

4. **CWD 跟踪**
   - 每个命令执行后保存工作目录：`pwd -P >| /tmp/openawork-{id}-cwd`

### 命令构建流程

```
原始命令
  ↓ rewriteWindowsNullRedirect
修正 Windows 风格重定向
  ↓ shouldAddStdinRedirect
判断是否需要 stdin 重定向
  ↓ quoteShellCommand
引号转义 + stdin 重定向
  ↓ getDisableExtglobCommand
添加 extglob 禁用
  ↓ eval + pwd 跟踪
构建完整命令字符串
```

## PowerShellProvider 实现

### 核心功能

1. **退出码捕获**

   ```powershell
   $_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }
   ```
   - 优先使用 `$LASTEXITCODE`（外部程序）
   - 回退到 `$?`（cmdlet 成功状态）

2. **Base64 编码**（沙箱模式）
   - UTF-16LE 编码避免引号转义问题
   - 使用 `-EncodedCommand` 参数

3. **CWD 跟踪**
   ```powershell
   (Get-Location).Path | Out-File -FilePath '...' -Encoding utf8 -NoNewline
   ```

### 启动参数

```powershell
pwsh -NoProfile -NonInteractive -Command <command>
```

- `-NoProfile`: 不加载用户配置（更快、更一致）
- `-NonInteractive`: 非交互模式
- `-Command`: 执行命令字符串

## Shell 检测策略

### Bash/Zsh 检测优先级

1. `OPENAWORK_SHELL` 环境变量
2. `SHELL` 环境变量（如果是 bash/zsh）
3. `which bash` / `which zsh` 查找结果
4. 常见路径：`/bin`, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`

### PowerShell 检测优先级

1. `pwsh` (PowerShell Core 7+, 跨平台)
2. `powershell` (Windows PowerShell 5.x)
3. 系统路径：`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`

## 执行流程

### 标准执行流程

```typescript
// 1. 选择 Shell 类型
const shellType = getDefaultShellType(); // 'bash' | 'powershell'

// 2. 执行命令
const result = await executeShellCommand(command, shellType, {
  timeout: 30000,
  cwd: process.cwd(),
  signal: controller.signal,
});

// 3. 监听输出
result.process.stdout?.on('data', (data) => {
  console.log(data.toString());
});

// 4. 等待完成
result.process.on('exit', (code) => {
  console.log(`Exit code: ${code}`);
});
```

### 内部实现

```typescript
async function executeShellCommand(command, shellType, options) {
  // 1. 获取 Provider（带缓存）
  const provider = await getProvider(shellType);

  // 2. 构建命令
  const { commandString, cwdFilePath } = await provider.buildExecCommand(command, {
    id,
    sandboxTmpDir,
    useSandbox,
  });

  // 3. 获取环境变量
  const envOverrides = await provider.getEnvironmentOverrides(command);

  // 4. 启动子进程
  const childProcess = spawn(provider.shellPath, provider.getSpawnArgs(commandString), {
    env,
    cwd,
    detached: provider.detached,
    windowsHide: true,
  });

  // 5. 返回结果
  return { process: childProcess, cwdFilePath, provider };
}
```

## 错误处理

### 超时处理

```typescript
const result = await executeShellCommand('sleep 100', 'bash', {
  timeout: 10000, // 10 秒后自动终止
});
```

### 中止信号

```typescript
const controller = new AbortController();

const result = await executeShellCommand('long-task', 'bash', {
  signal: controller.signal,
});

// 手动中止
controller.abort();
```

### 退出码处理

```typescript
result.process.on('exit', (code, signal) => {
  if (code === 0) {
    console.log('成功');
  } else if (signal) {
    console.log(`被信号终止: ${signal}`);
  } else {
    console.log(`失败，退出码: ${code}`);
  }
});
```

## 沙箱支持

沙箱模式通过限制文件系统访问来隔离命令执行：

```typescript
const result = await executeShellCommand('rm -rf /', 'bash', {
  useSandbox: true, // 启用沙箱
  timeout: 30000,
});
```

### 沙箱特性

- 限制可访问的文件系统路径
- 隔离临时目录（`TMPDIR`）
- 防止破坏性操作影响系统

## 环境变量

### 自动设置的环境变量

| 变量        | Bash     | PowerShell | 说明                  |
| ----------- | -------- | ---------- | --------------------- |
| `SHELL`     | ✓        | -          | Shell 路径            |
| `OPENAWORK` | ✓        | ✓          | 标记为 OpenAWork 进程 |
| `TMPDIR`    | ✓ (沙箱) | ✓ (沙箱)   | 临时目录              |

### 用户自定义

通过 `env` 选项传递额外环境变量：

```typescript
const result = await executeShellCommand('echo $MY_VAR', 'bash', {
  env: { MY_VAR: 'custom value' },
});
```

## 性能优化

### Provider 缓存

Provider 在首次创建后会被缓存，避免重复的 Shell 检测：

```typescript
// 第一次调用：检测 Shell
const result1 = await executeShellCommand('cmd1', 'bash');

// 后续调用：使用缓存
const result2 = await executeShellCommand('cmd2', 'bash');
```

### 重置缓存

测试时可以重置缓存：

```typescript
resetProviderCache();
```

## 测试策略

### 单元测试

- 平台检测逻辑
- 路径转换函数
- 命令修正函数

### 集成测试

- 实际执行简单命令（echo, pwd）
- 超时处理
- 中止信号处理
- 跨平台兼容性

### 测试命令

```bash
pnpm --filter @openAwork/agent-core test src/utils/shell/shell-executor.test.ts
```

## 使用示例

### 基本用法

```typescript
import { executeShellCommand, getDefaultShellType } from '@openAwork/agent-core';

const shellType = getDefaultShellType();
const result = await executeShellCommand('echo "Hello"', shellType);
```

### 集成到工具系统

```typescript
import { ToolRegistry } from '@openAwork/agent-core';
import { shellCommandToolDefinition } from './shell-tool';

const registry = new ToolRegistry();
registry.register(shellCommandToolDefinition);
```

## 未来扩展

### 计划支持的特性

1. **流式输出**：实时返回命令输出给 LLM
2. **命令历史**：记录执行的命令历史
3. **安全审计**：命令执行前的安全扫描
4. **资源限制**：CPU、内存、磁盘使用限制
5. **多会话支持**：为每个 Agent 会话维护独立的 Shell 环境

### 可能的改进

1. **更智能的 Shell 选择**：根据命令内容自动选择最合适的 Shell
2. **命令补全**：基于历史和文件系统的命令补全
3. **错误诊断**：更详细的错误信息和修复建议
4. **性能监控**：命令执行时间、资源使用统计

## 对比权威实现

### 已实现的功能

✓ Provider 抽象模式
✓ 平台检测
✓ Bash 和 PowerShell 支持
✓ 路径转换
✓ 命令修正
✓ 超时和中止处理
✓ CWD 跟踪

### 暂未实现的功能

- Shell 快照（环境变量捕获）
- Tmux 隔离
- 会话环境变量
- 命令前缀（CLAUDE_CODE_SHELL_PREFIX）
- 管道命令的 stdin 重定向重排

### 实现差异

| 功能       | 权威实现 | OpenAWork 实现 | 说明                 |
| ---------- | -------- | -------------- | -------------------- |
| Shell 快照 | ✓        | -              | 暂时简化，未来可添加 |
| Tmux 隔离  | ✓        | -              | 非核心功能           |
| 路径转换   | ✓        | ✓              | 完全实现             |
| 命令修正   | ✓        | ✓              | 完全实现             |
| 沙箱支持   | ✓        | ✓ (骨架)       | 需要实际沙箱运行时   |

## 相关文档

- [Shell 执行模块使用指南](./shell-executor.md)
- [集成示例](./shell-integration-example.ts)
- [工具系统设计](../../docs/tool-system.md)

## 参考资料

- Claude Code 权威仓库：`temp/claude-code-sourcemap/restored-src/src/utils/Shell.ts`
- Provider 接口设计：`temp/claude-code-sourcemap/restored-src/src/utils/shell/shellProvider.ts`
