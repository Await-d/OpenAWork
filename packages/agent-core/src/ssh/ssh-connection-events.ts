import type { SSHConnection } from './ssh-connection-manager.js';

export interface SSHConnectionEvent {
  readonly connectionId: string;
  readonly status: SSHConnection['status'];
  readonly intentional: boolean;
  readonly error?: string;
}

export class SSHConnectionError extends Error {
  override readonly name = 'SSHConnectionError';
}
