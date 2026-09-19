import { expect, it } from 'vitest';
import { remoteDirectoryCommand } from '../../session/ssh-terminal-directory.js';

it('POSIX 工作目录保留空格并转义单引号', () => {
  expect(remoteDirectoryCommand('posix', "/srv/a'b c").command).toBe(
    "cd -- '/srv/a'\\''b c' || exit\n",
  );
});
it('PowerShell 使用 LiteralPath 与单引号转义', () => {
  expect(remoteDirectoryCommand('powershell', "C:\\a'b c").command).toContain(
    "Set-Location -LiteralPath 'C:\\a''b c'",
  );
});
it('CMD 跨盘切换并拒绝变量/命令扩展字符', () => {
  expect(remoteDirectoryCommand('cmd', 'D:\\Work Dir').command).toBe(
    'cd /d "D:\\Work Dir" || exit /b 1\r\n',
  );
  expect(() => remoteDirectoryCommand('cmd', 'D:\\%PATH%')).toThrow();
});
it.each(['posix', 'powershell', 'cmd'] as const)('%s 拒绝换行及 NUL', (shell) => {
  expect(() => remoteDirectoryCommand(shell, '/tmp\nwhoami')).toThrow();
  expect(() => remoteDirectoryCommand(shell, '/tmp\0')).toThrow();
});
