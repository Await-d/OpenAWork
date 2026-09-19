import type { ClientChannel, PseudoTtyOptions } from 'ssh2';

export interface SSHTerminalOptions {
  readonly cols: number;
  readonly rows: number;
}

export interface SSHTerminalClient {
  shell?: (
    window: PseudoTtyOptions,
    callback: (error: Error | undefined, channel: ClientChannel) => void,
  ) => void;
}

export class SSHTerminalError extends Error {
  override readonly name = 'SSHTerminalError';
}

/** 返回暂停的通道，调用方先注册终端记录与事件，再恢复读取。 */
export function openSSHTerminal(
  client: SSHTerminalClient,
  options: SSHTerminalOptions,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    if (!client.shell) {
      reject(new SSHTerminalError('SSH transport does not support interactive terminals'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new SSHTerminalError('SSH terminal open timed out after 30000ms'));
    }, 30_000);
    try {
      client.shell(
        { term: 'xterm-256color', cols: options.cols, rows: options.rows },
        (error, channel) => {
          if (settled) {
            channel?.destroy();
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (error) {
            reject(error);
            return;
          }
          channel.pause();
          resolve(channel);
        },
      );
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new SSHTerminalError(String(error)));
    }
  });
}
