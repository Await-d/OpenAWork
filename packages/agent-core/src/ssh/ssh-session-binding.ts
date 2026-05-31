import type {
  SSHConnectionManager,
  ExecResult,
  SSHFileEntry,
  SSHFilePreview,
} from './ssh-connection-manager.js';

export interface SSHBoundSession {
  sessionId: string;
  sshConnectionId: string;
}

export interface SSHToolProxy {
  execCommand(command: string): Promise<ExecResult>;
  readFile(remotePath: string): Promise<SSHFilePreview>;
  writeFile(remotePath: string, content: string | Uint8Array): Promise<void>;
  listFiles(remotePath: string): Promise<SSHFileEntry[]>;
}

export function createSSHToolProxy(
  sshManager: SSHConnectionManager,
  connectionId: string,
): SSHToolProxy {
  return {
    execCommand(command: string): Promise<ExecResult> {
      return sshManager.execCommand(connectionId, command);
    },
    readFile(remotePath: string): Promise<SSHFilePreview> {
      return sshManager.readFile(connectionId, remotePath);
    },
    writeFile(remotePath: string, content: string | Uint8Array): Promise<void> {
      return sshManager.writeFile(connectionId, remotePath, content);
    },
    listFiles(remotePath: string): Promise<SSHFileEntry[]> {
      return sshManager.listFiles(connectionId, remotePath);
    },
  };
}

export class SSHSessionBindingRegistry {
  private bindings = new Map<string, string>();

  bind(sessionId: string, sshConnectionId: string): void {
    this.bindings.set(sessionId, sshConnectionId);
  }

  unbind(sessionId: string): void {
    this.bindings.delete(sessionId);
  }

  getConnectionId(sessionId: string): string | undefined {
    return this.bindings.get(sessionId);
  }

  isBound(sessionId: string): boolean {
    return this.bindings.has(sessionId);
  }

  /**
   * Enumerate every (sessionId, connectionId) pair currently held in
   * memory. Used by the gateway boot reconciler to project persisted
   * bindings into the in-memory registry, and by tests inspecting state.
   */
  entries(): SSHBoundSession[] {
    return [...this.bindings.entries()].map(([sessionId, sshConnectionId]) => ({
      sessionId,
      sshConnectionId,
    }));
  }

  /**
   * Drop every binding pointing at a given connection. Called when a
   * connection is deleted so the in-memory registry can't hand out a
   * stale proxy after the underlying ssh client is gone.
   */
  unbindByConnection(connectionId: string): void {
    for (const [sessionId, value] of this.bindings) {
      if (value === connectionId) this.bindings.delete(sessionId);
    }
  }

  resolveProxy(sessionId: string, sshManager: SSHConnectionManager): SSHToolProxy | undefined {
    const connectionId = this.bindings.get(sessionId);
    if (!connectionId) return undefined;
    const status = sshManager.getStatus(connectionId);
    if (status !== 'connected') return undefined;
    return createSSHToolProxy(sshManager, connectionId);
  }
}

export const sshSessionBindings = new SSHSessionBindingRegistry();
