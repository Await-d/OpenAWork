import { expect, it } from 'vitest';
import { remoteMkdirCommand } from '../../ssh/ssh-directory.js';

it('POSIX 创建目录转义命令字符', () => {
  expect(remoteMkdirCommand('posix', "/tmp/a'b")).toBe("mkdir -p -- '/tmp/a'\\''b'");
});
it('Windows 创建目录不使用 POSIX mkdir', () => {
  expect(remoteMkdirCommand('powershell', "C:\\a'b")).toContain("CreateDirectory('C:\\a''b')");
  expect(remoteMkdirCommand('cmd', 'D:\\Work Dir')).toBe(
    'if not exist "D:\\Work Dir\\." mkdir "D:\\Work Dir"',
  );
});
it.each(['relative', '/tmp\ncmd', '/tmp\0'])('拒绝非法目录 %s', (path) => {
  expect(() => remoteMkdirCommand('posix', path)).toThrow();
});
it('CMD 拒绝变量展开', () => {
  expect(() => remoteMkdirCommand('cmd', 'C:\\%PATH%')).toThrow();
});
