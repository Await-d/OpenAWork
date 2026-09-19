import { posix, win32 } from 'node:path';
import { SSHTerminalError, type SSHConnectionManager } from '@openAwork/agent-core';

export type RemoteShell = 'posix' | 'powershell' | 'cmd';

export async function detectRemoteShell(
  manager: SSHConnectionManager,
  connectionId: string,
): Promise<RemoteShell> {
  const result = await manager.execCommand(connectionId, 'echo $PSVersionTable.PSEdition', {
    timeoutMs: 10_000,
  });
  if (result.timedOut) throw new SSHTerminalError('SSH 远程 Shell 探测超时。');
  if (/^(Desktop|Core)$/m.test(result.stdout.trim())) return 'powershell';
  const comspec = await manager.execCommand(connectionId, 'echo %COMSPEC%', { timeoutMs: 10_000 });
  if (comspec.timedOut) throw new SSHTerminalError('SSH 远程 Shell 探测超时。');
  return /[\\/]cmd\.exe\s*$/im.test(comspec.stdout) ? 'cmd' : 'posix';
}

export function remoteDirectoryCommand(
  shell: RemoteShell,
  cwd: string,
): { cwd: string; command: string } {
  if (/[\r\n\0]/.test(cwd)) throw new SSHTerminalError('SSH 工作目录包含无效字符。');
  switch (shell) {
    case 'posix': {
      const normalized = posix.normalize(cwd);
      const quoted = `'${normalized.replace(/'/g, `'\\''`)}'`;
      return { cwd: normalized, command: `cd -- ${quoted} || exit\n` };
    }
    case 'powershell': {
      const quoted = `'${cwd.replace(/'/g, "''")}'`;
      return {
        cwd,
        command: `try { Set-Location -LiteralPath ${quoted} -ErrorAction Stop } catch { Write-Error $_; exit 1 }\r\n`,
      };
    }
    case 'cmd': {
      if (/["%!^&|<>]/.test(cwd)) throw new SSHTerminalError('CMD 工作目录包含不支持的控制字符。');
      const normalized = win32.normalize(cwd);
      return { cwd: normalized, command: `cd /d "${normalized}" || exit /b 1\r\n` };
    }
  }
}
