import { SSHTerminalError } from '@openAwork/agent-core';
import { resolveSshSessionTarget } from '../ssh/ssh-session-target.js';
import { detectRemoteShell, remoteDirectoryCommand } from './ssh-terminal-directory.js';
import { peekSshService } from '../ssh/ssh-service.js';
import { attachSshTerminalProcess } from './ssh-terminal-process.js';
import {
  spawnPersistentTerminal,
  type SpawnPersistentTerminalInput,
  type SpawnPersistentTerminalResult,
} from './persistent-terminals.js';

export async function spawnSessionTerminal(
  input: SpawnPersistentTerminalInput,
): Promise<SpawnPersistentTerminalResult> {
  const target = resolveSshSessionTarget(input.sessionId, input.userId);
  if (!target) return spawnPersistentTerminal({ ...input, cwd: input.cwd || process.cwd() });
  const { connectionId } = target;
  const service = peekSshService();
  if (!service || !service.getConnection(input.userId, connectionId)) {
    throw new SSHTerminalError('SSH 连接不存在或不属于当前用户。');
  }
  const manager = service.getManager();
  if (manager.getStatus(connectionId) !== 'connected') {
    throw new SSHTerminalError('SSH 连接已断开，请重新连接后创建终端。');
  }
  if (!manager.openTerminal) throw new SSHTerminalError('SSH 连接不支持交互终端。');
  if (input.shellProfileId) {
    throw new SSHTerminalError('SSH 终端使用远程默认 Shell，请勿选择本地 Shell 配置。');
  }
  const cwd = input.cwd || target.workingDirectory || '.';
  const shell = await detectRemoteShell(manager, connectionId);
  const directory = remoteDirectoryCommand(shell, cwd);
  const checked = await manager.execCommand(connectionId, directory.command, { timeoutMs: 10_000 });
  if (checked.timedOut || checked.exitCode !== 0) {
    throw new SSHTerminalError(
      `SSH 工作目录不可访问：${cwd}。${checked.timedOut ? '目录检查超时' : checked.stderr.trim()}`,
    );
  }
  const channel = await manager.openTerminal(connectionId, { cols: 80, rows: 24 });
  try {
    return spawnPersistentTerminal({
      ...input,
      cwd: directory.cwd,
      processFactory: (options) => {
        const terminal = attachSshTerminalProcess(channel, options);
        terminal.write(directory.command);
        return terminal;
      },
    });
  } catch (error) {
    channel.destroy();
    throw error;
  }
}
