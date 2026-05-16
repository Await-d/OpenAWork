/**
 * `/ssh/*` 客户端：连接管理、远端文件浏览、上传。
 *
 * 网关把 SSH 通道托管在 sidecar 里，前端只需要开关连接 + 浏览文件。
 */

import { authHeader, expectJson, expectOk, jsonAuthHeaders, withQuery } from './http.js';

export interface SSHConnectionEntry {
  id: string;
  host: string;
  port: number;
  username: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  [key: string]: unknown;
}

export interface SSHFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface SSHFilePreview {
  path: string;
  content: string;
}

export type CreateSSHConnectionInput = Omit<SSHConnectionEntry, 'id' | 'status'>;

export interface SSHClient {
  list(token: string, options?: { signal?: AbortSignal }): Promise<SSHConnectionEntry[]>;
  create(token: string, input: CreateSSHConnectionInput): Promise<SSHConnectionEntry>;
  connect(token: string, connectionId: string): Promise<void>;
  disconnect(token: string, connectionId: string): Promise<void>;
  bind(token: string, connectionId: string): Promise<void>;
  listFiles(token: string, connectionId: string, path: string): Promise<SSHFileEntry[]>;
  readFile(token: string, connectionId: string, path: string): Promise<SSHFilePreview>;
  upload(
    token: string,
    input: { connectionId: string; path: string; contentBase64: string },
  ): Promise<void>;
}

export function createSshClient(baseUrl: string): SSHClient {
  return {
    async list(token, options) {
      const response = await fetch(`${baseUrl}/ssh/connections`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      const data = await expectJson<{ connections: SSHConnectionEntry[] }>(response, 'ssh.list');
      return data.connections ?? [];
    },

    async create(token, input) {
      const response = await fetch(`${baseUrl}/ssh/connections`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      const data = await expectJson<{ connection: SSHConnectionEntry }>(response, 'ssh.create');
      return data.connection;
    },

    async connect(token, connectionId) {
      const response = await fetch(
        `${baseUrl}/ssh/connections/${encodeURIComponent(connectionId)}/connect`,
        { method: 'POST', headers: authHeader(token) },
      );
      await expectOk(response, 'ssh.connect');
    },

    async disconnect(token, connectionId) {
      const response = await fetch(
        `${baseUrl}/ssh/connections/${encodeURIComponent(connectionId)}/disconnect`,
        { method: 'POST', headers: authHeader(token) },
      );
      await expectOk(response, 'ssh.disconnect');
    },

    async bind(token, connectionId) {
      const response = await fetch(
        `${baseUrl}/ssh/connections/${encodeURIComponent(connectionId)}/bind`,
        { method: 'POST', headers: authHeader(token) },
      );
      await expectOk(response, 'ssh.bind');
    },

    async listFiles(token, connectionId, path) {
      const params = new URLSearchParams({ connectionId, path });
      const response = await fetch(withQuery(`${baseUrl}/ssh/files`, params), {
        headers: authHeader(token),
      });
      const data = await expectJson<{ entries: SSHFileEntry[] }>(response, 'ssh.listFiles');
      return data.entries ?? [];
    },

    async readFile(token, connectionId, path) {
      const params = new URLSearchParams({ connectionId, path });
      const response = await fetch(withQuery(`${baseUrl}/ssh/file`, params), {
        headers: authHeader(token),
      });
      const data = await expectJson<{ preview: SSHFilePreview }>(response, 'ssh.readFile');
      return data.preview;
    },

    async upload(token, input) {
      const response = await fetch(`${baseUrl}/ssh/upload`, {
        method: 'POST',
        headers: jsonAuthHeaders(token),
        body: JSON.stringify(input),
      });
      await expectOk(response, 'ssh.upload');
    },
  };
}
