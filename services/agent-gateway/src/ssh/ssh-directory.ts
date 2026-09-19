import { SSHTerminalError } from '@openAwork/agent-core';
import type { RemoteShell } from '../session/ssh-terminal-directory.js';

export function remoteMkdirCommand(shell: RemoteShell, path: string): string {
  if (/[\r\n\0]/.test(path) || !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path)) {
    throw new SSHTerminalError('SSH 创建目录需要有效的远端绝对路径。');
  }
  switch (shell) {
    case 'posix':
      if (!path.startsWith('/')) throw new SSHTerminalError('POSIX 目录必须以 / 开头。');
      return `mkdir -p -- '${path.replace(/'/g, `'\\''`)}'`;
    case 'powershell':
      return `try { [System.IO.Directory]::CreateDirectory('${path.replace(/'/g, "''")}') | Out-Null } catch { Write-Error $_; exit 1 }`;
    case 'cmd':
      if (/["%!^&|<>]/.test(path)) throw new SSHTerminalError('CMD 目录包含不支持的控制字符。');
      return `if not exist "${path}\\." mkdir "${path}"`;
  }
}
