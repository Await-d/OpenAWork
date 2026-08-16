import { describe, it, expect, beforeEach } from 'vitest';
import { getPlatform, isWindowsEnvironment, supportsPosixShell } from '../platform.js';
import { executeShellCommand, getDefaultShellType, resetProviderCache } from './shell-executor.js';

describe('跨平台 Shell 执行', () => {
  beforeEach(() => {
    resetProviderCache();
  });

  describe('平台检测', () => {
    it('应该正确识别当前平台', () => {
      const platform = getPlatform();
      expect(['macos', 'windows', 'wsl', 'linux', 'unknown']).toContain(platform);
    });

    it('应该正确判断是否为 Windows 环境', () => {
      const isWindows = isWindowsEnvironment();
      expect(typeof isWindows).toBe('boolean');
    });

    it('应该正确判断是否支持 POSIX shell', () => {
      const supportsPosix = supportsPosixShell();
      expect(typeof supportsPosix).toBe('boolean');
    });
  });

  describe('Shell 类型选择', () => {
    it('应该根据平台返回默认 Shell 类型', () => {
      const shellType = getDefaultShellType();
      expect(['bash', 'powershell']).toContain(shellType);
    });

    it('Windows 平台应该默认使用 PowerShell', () => {
      if (getPlatform() === 'windows') {
        expect(getDefaultShellType()).toBe('powershell');
      }
    });

    it('非 Windows 平台应该默认使用 Bash', () => {
      const platform = getPlatform();
      if (platform !== 'windows') {
        expect(getDefaultShellType()).toBe('bash');
      }
    });
  });

  describe('Bash 命令执行', () => {
    it('应该能执行简单的 echo 命令', async () => {
      if (!supportsPosixShell()) {
        return; // 跳过不支持 POSIX shell 的平台
      }

      const result = await executeShellCommand('echo "Hello OpenAWork"', 'bash', {
        timeout: 5000,
      });

      expect(result.process).toBeDefined();
      expect(result.provider.type).toBe('bash');
      expect(result.cwdFilePath).toBeDefined();

      // 等待进程完成
      await new Promise<void>((resolve, reject) => {
        let stdout = '';
        result.process.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        result.process.on('exit', (code) => {
          if (code === 0) {
            expect(stdout).toContain('Hello OpenAWork');
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });
    }, 10000);

    it('应该正确处理 pwd 命令', async () => {
      if (!supportsPosixShell()) {
        return;
      }

      const result = await executeShellCommand('pwd', 'bash', { timeout: 5000 });

      await new Promise<void>((resolve, reject) => {
        let stdout = '';
        result.process.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        result.process.on('exit', (code) => {
          if (code === 0) {
            expect(stdout.trim()).toBeTruthy();
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });
    }, 10000);
  });

  describe('PowerShell 命令执行', () => {
    it('应该能执行简单的 Write-Output 命令', async () => {
      if (getPlatform() !== 'windows') {
        return; // PowerShell 主要在 Windows 上使用
      }

      const result = await executeShellCommand('Write-Output "Hello OpenAWork"', 'powershell', {
        timeout: 5000,
      });

      expect(result.process).toBeDefined();
      expect(result.provider.type).toBe('powershell');
      expect(result.cwdFilePath).toBeDefined();

      await new Promise<void>((resolve, reject) => {
        let stdout = '';
        result.process.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        result.process.on('exit', (code) => {
          if (code === 0) {
            expect(stdout).toContain('Hello OpenAWork');
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });
    }, 10000);

    it('应该正确处理 Get-Location 命令', async () => {
      if (getPlatform() !== 'windows') {
        return;
      }

      const result = await executeShellCommand('Get-Location', 'powershell', {
        timeout: 5000,
      });

      await new Promise<void>((resolve, reject) => {
        let stdout = '';
        result.process.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        result.process.on('exit', (code) => {
          if (code === 0) {
            expect(stdout.trim()).toBeTruthy();
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });
      });
    }, 10000);
  });

  describe('中止信号处理', () => {
    it('应该能通过 AbortSignal 中止命令执行', async () => {
      if (!supportsPosixShell()) {
        return;
      }

      const controller = new AbortController();
      const result = await executeShellCommand('sleep 10', 'bash', {
        signal: controller.signal,
        timeout: 30000,
      });

      // 立即中止
      setTimeout(() => controller.abort(), 100);

      await new Promise<void>((resolve) => {
        result.process.on('exit', () => {
          expect(result.process.killed).toBe(true);
          resolve();
        });
      });
    }, 10000);
  });

  describe('超时处理', () => {
    it('应该在超时后终止进程', async () => {
      if (!supportsPosixShell()) {
        return;
      }

      const result = await executeShellCommand('sleep 10', 'bash', {
        timeout: 1000, // 1 秒超时
      });

      await new Promise<void>((resolve) => {
        result.process.on('exit', () => {
          expect(result.process.killed).toBe(true);
          resolve();
        });
      });
    }, 10000);
  });
});
