# 跨平台 Shell 执行模块

OpenAWork 的跨平台 Shell 执行模块提供统一的接口来执行 Bash 和 PowerShell 命令，自动处理 Windows/macOS/Linux 平台差异。

## 核心特性

- **统一接口**：通过 `ShellProvider` 抽象层统一 Bash 和 PowerShell 的差异
- **自动检测**：在 Windows 上自动查找 Git Bash / WSL / PowerShell
- **路径转换**：自动处理 Windows 原生路径 ↔ POSIX 路径的转换
- **命令修正**：自动修正 Windows CMD 风格的命令（如 `2>nul` → `2>/dev/null`）
- **沙箱支持**：支持沙箱模式安全执行不可信命令
- **环境变量管理**：正确设置 `SHELL`、`TMPDIR` 等关键变量

## 快速开始

### 基本用法

```typescript
import { executeShellCommand, getDefaultShellType } from '@openAwork/agent-core';

// 自动选择平台默认 Shell（Windows 用 PowerShell，其他用 Bash）
const shellType = getDefaultShellType();

// 执行命令
const result = await executeShellCommand('echo "Hello World"', shellType, {
  timeout: 5000,
  cwd: process.cwd(),
});

// 监听输出
result.process.stdout?.on('data', (data) => {
  console.log(data.toString());
});

// 监听退出
result.process.on('exit', (code) => {
  console.log(`Process exited with code ${code}`);
});
```

### 指定 Shell 类型

```typescript
import { executeShellCommand } from '@openAwork/agent-core';

// 显式使用 Bash
const bashResult = await executeShellCommand('ls -la', 'bash');

// 显式使用 PowerShell
const psResult = await executeShellCommand('Get-ChildItem', 'powershell');
```

### 中止命令执行

```typescript
const controller = new AbortController();

const result = await executeShellCommand('long-running-command', 'bash', {
  signal: controller.signal,
});

// 5 秒后中止
setTimeout(() => controller.abort(), 5000);
```

### 超时控制

```typescript
const result = await executeShellCommand('sleep 100', 'bash', {
  timeout: 10000, // 10 秒超时
});
```

## 平台检测

```typescript
import { getPlatform, isWindowsEnvironment, supportsPosixShell } from '@openAwork/agent-core';

// 获取当前平台
const platform = getPlatform(); // 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'

// 检查是否为 Windows 环境
if (isWindowsEnvironment()) {
  console.log('Running on Windows or WSL');
}

// 检查是否支持 POSIX shell
if (supportsPosixShell()) {
  console.log('Can use bash/zsh commands');
}
```

## Shell 检测

```typescript
import { findSuitableShell, findPowerShell, isPowerShellAvailable } from '@openAwork/agent-core';

// 查找 Bash/Zsh
const shellPath = await findSuitableShell();
console.log(`Found shell: ${shellPath}`);

// 查找 PowerShell
const psPath = await findPowerShell();
console.log(`Found PowerShell: ${psPath}`);

// 检查 PowerShell 是否可用
if (await isPowerShellAvailable()) {
  console.log('PowerShell is available');
}
```

## 环境变量

### Bash 优先级

Shell 检测按以下优先级查找：

1. `OPENAWORK_SHELL` - OpenAWork 专用覆盖
2. `SHELL` - 用户默认 Shell（如果是 bash/zsh）
3. `which` 查找结果
4. 常见安装路径：`/bin`, `/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`

### PowerShell 优先级

1. `pwsh` (PowerShell Core 7+, 跨平台)
2. `powershell` (Windows PowerShell 5.x, 仅 Windows)
3. Windows 系统路径：`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`

## 高级用法

### 自定义 Provider

```typescript
import { createBashShellProvider, createPowerShellProvider } from '@openAwork/agent-core';

// 创建自定义 Bash Provider
const bashProvider = createBashShellProvider('/usr/local/bin/zsh');

// 构建命令
const { commandString, cwdFilePath } = await bashProvider.buildExecCommand('echo "Hello"', {
  id: 'test-001',
  useSandbox: false,
});

// 获取 spawn 参数
const spawnArgs = bashProvider.getSpawnArgs(commandString);

// 获取环境变量
const env = await bashProvider.getEnvironmentOverrides('echo "Hello"');
```

### 沙箱模式

```typescript
const result = await executeShellCommand('rm -rf /', 'bash', {
  useSandbox: true, // 启用沙箱隔离
  timeout: 30000,
});
```

## 架构设计

### Provider 模式

```
ShellProvider (接口)
    ├── BashShellProvider
    │   ├── 路径转换 (Windows POSIX 路径)
    │   ├── 命令修正 (2>nul → 2>/dev/null)
    │   ├── Extglob 禁用
    │   └── CWD 跟踪
    └── PowerShellProvider
        ├── Base64 编码 (沙箱模式)
        ├── 退出码捕获 ($LASTEXITCODE)
        └── CWD 跟踪
```

### 执行流程

```
executeShellCommand()
    ↓
1. 获取 Provider (根据 shellType)
    ↓
2. 构建命令 (buildExecCommand)
    ↓
3. 获取环境变量 (getEnvironmentOverrides)
    ↓
4. 启动子进程 (spawn)
    ↓
5. 返回结果 (process + cwdFilePath)
```

## 注意事项

### Windows 路径处理

在 Git Bash 中执行命令时，路径会自动转换：

- `C:\Users\...` → `/c/Users/...` (给 bash)
- `/c/Users/...` → `C:\Users\...` (给 Node.js)

### 命令修正

某些 Windows CMD 风格的命令会被自动修正：

```bash
# 修正前
command 2>nul

# 修正后
command 2>/dev/null
```

### Stdin 重定向

非交互式命令会自动添加 `< /dev/null`，防止进程等待标准输入：

```bash
# 自动添加
grep pattern file < /dev/null
```

排除的交互式命令：`vim`, `nano`, `emacs`, `less`, `more`, `top`, `htop`

### CWD 跟踪

每个命令执行后会自动保存当前工作目录到临时文件：

- Bash: `pwd -P >| /tmp/openawork-{id}-cwd`
- PowerShell: `(Get-Location).Path | Out-File ...`

## 测试

运行测试套件：

```bash
pnpm --filter @openAwork/agent-core test src/utils/shell/shell-executor.test.ts
```

## 示例

### 跨平台文件列表

```typescript
import { executeShellCommand, getDefaultShellType } from '@openAwork/agent-core';

const shellType = getDefaultShellType();
const command = shellType === 'bash' ? 'ls -la' : 'Get-ChildItem';

const result = await executeShellCommand(command, shellType);

result.process.stdout?.on('data', (data) => {
  console.log(data.toString());
});
```

### 错误处理

```typescript
try {
  const result = await executeShellCommand('invalid-command', 'bash', {
    timeout: 5000,
  });

  result.process.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`Command failed with code ${code}`);
    }
  });

  result.process.stderr?.on('data', (data) => {
    console.error(data.toString());
  });
} catch (error) {
  console.error('Failed to execute command:', error);
}
```

## 相关文档

- [工具系统设计](../../docs/tool-system.md)
- [环境变量配置](../../docs/environment.md)
- [沙箱安全](../../docs/sandbox.md)
