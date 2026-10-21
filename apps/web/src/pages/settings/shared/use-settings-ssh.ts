import React, { useEffect, useRef, useState } from 'react';
import { createSshClient } from '@openAwork/web-client';
import type { SSHDialogEntry } from '@openAwork/web-client';
import type { ArtifactItem, FileTreeNode, SSHConnectionEntry } from '@openAwork/shared-ui';
import { logger } from '../../../utils/log/logger.js';
import { resolveSshDialogRestore } from './settings-page-helpers.js';

interface UseSettingsSshOptions {
  gatewayUrl: string;
  token: string | null;
  sshConnections: SSHConnectionEntry[];
  setSshConnections: React.Dispatch<React.SetStateAction<SSHConnectionEntry[]>>;
  sshDialogs: SSHDialogEntry[];
  setSshDialogs: React.Dispatch<React.SetStateAction<SSHDialogEntry[]>>;
  sshDialogsReady: boolean;
}

/**
 * Settings 页远端 SSH 面板状态：当前路径/文件树/预览、连接选择、文件浏览与
 * 上传，以及重启后恢复上一次打开对话的 effect。
 */
/**
 * SSH 面板动作的统一包装：try → catch 交给 `onError`（**无 finally**）。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 try 内的值块（`??`、`?.`、`.map(...)`），本
 * hook 这处 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runSettingsSshActionOnce(ctx: {
  onError: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<void> {
  try {
    await ctx.run();
  } catch (error) {
    ctx.onError(error);
  }
}

export function useSettingsSsh({
  gatewayUrl,
  token,
  sshConnections,
  setSshConnections,
  sshDialogs,
  setSshDialogs,
  sshDialogsReady,
}: UseSettingsSshOptions) {
  const [sshCurrentPath, setSshCurrentPath] = useState('/');
  const [sshNodes, setSshNodes] = useState<FileTreeNode[]>([]);
  const [sshPreview, setSshPreview] = useState<(ArtifactItem & { content?: string }) | null>(null);
  const [activeSSHConnectionId, setActiveSSHConnectionId] = useState<string | null>(null);

  // 去 useCallback 包装：编译器会对函数表达式自动 memoize（引用稳定性与手写等价），
  // 而保留手写 memo 会让编译器报「Existing memoization could not be preserved」
  // 放弃优化整个 hook（本文件所有手写 useCallback 均已按此改造）。
  const loadSshFiles = async (connectionId: string, path: string) => {
    if (!token) return;
    // listFiles 在连接尚未握手成功时会抛 `SSH client not connected`，
    // 例如重启后 auto-reconnect 还没跑完就点开对话。这里兜底成清空面板 +
    // 记录日志，避免 unhandled rejection，让 UI 停在「已选中、未加载」态。
    // try/catch 下沉到模块级 `runSettingsSshActionOnce`（见其注释）。
    await runSettingsSshActionOnce({
      onError: (error) => {
        setSshNodes([]);
        setSshPreview(null);
        setSshCurrentPath(path);
        logger.warn('failed to load ssh files', error);
      },
      run: async () => {
        const sshClient = createSshClient(gatewayUrl);
        const entries = await sshClient.listFiles(token, connectionId, path);
        const nodes: FileTreeNode[] = entries.map((entry) => ({
          path: entry.path,
          name: entry.name,
          type: entry.kind,
        }));
        setSshNodes(nodes);
        setSshCurrentPath(path);
        const firstFile = nodes.find((node) => node.type === 'file');
        if (firstFile) {
          const previewPayload = await sshClient.readFile(token, connectionId, firstFile.path);
          setSshPreview({
            id: previewPayload.path,
            name: previewPayload.path.split('/').pop() ?? previewPayload.path,
            type: 'text',
            createdAt: Date.now(),
            sessionId: connectionId,
            content: previewPayload.content,
          });
        } else {
          setSshPreview(null);
        }
      },
    });
  };

  // 重启后恢复「上一次打开的 SSH 对话」：
  // 1. 优先选最近活跃的对话（sshDialogs 已按 pinned/lastOpenedAt 排好），让用户
  //    感觉面板从未关过；连接已删除的历史对话会被纯函数跳过；
  // 2. 没有可用对话时退化为「第一个 connected 的连接」；
  // 3. 都没有就保持空白，避免误把某个意料之外的连接拉到前台。
  // 注意：boot 时的 auto-reconnect 是 fire-and-forget，对话往往在握手完成前就
  // 回灌，所以只对「已 connected」的连接拉文件；未就绪的连接仅高亮选中，等用户
  // 手动点连接或 auto-reconnect 完成后再浏览。决策逻辑抽成纯函数便于单测，并
  // 等 `sshDialogsReady` 置位后再跑，避免对话尚未到达就被 fallback 抢先锁定。
  const sshDialogRestoredRef = useRef(false);
  useEffect(() => {
    if (sshDialogRestoredRef.current) return;
    if (activeSSHConnectionId) return;
    if (!token) return;
    if (!sshDialogsReady) return;
    if (sshConnections.length === 0) return;

    sshDialogRestoredRef.current = true;
    const decision = resolveSshDialogRestore(sshDialogs, sshConnections);
    if (!decision) return;
    setActiveSSHConnectionId(decision.connectionId);
    if (decision.shouldLoadFiles) {
      void loadSshFiles(decision.connectionId, decision.cwd);
    }
  }, [activeSSHConnectionId, loadSshFiles, sshConnections, sshDialogs, sshDialogsReady, token]);

  const addSshConnection = (entry: Omit<SSHConnectionEntry, 'id' | 'status'>) => {
    if (!token) return;
    void createSshClient(gatewayUrl)
      .create(token, entry as never)
      .then((connection) => {
        const next = connection as unknown as SSHConnectionEntry;
        setSshConnections((prev) => [...prev, next]);
        setActiveSSHConnectionId(next.id);
      });
  };

  const connectSsh = (id: string) => {
    if (!token) return;
    void createSshClient(gatewayUrl)
      .connect(token, id)
      .then(() => {
        setSshConnections((prev) =>
          prev.map((connection) =>
            connection.id === id ? { ...connection, status: 'connected' } : connection,
          ),
        );
        setActiveSSHConnectionId(id);
        return loadSshFiles(id, '/');
      })
      .catch((error: unknown) => logger.error('failed to connect ssh', error));
  };

  const disconnectSsh = (id: string) => {
    if (!token) return;
    void createSshClient(gatewayUrl)
      .disconnect(token, id)
      .then(() => {
        setSshConnections((prev) =>
          prev.map((connection) =>
            connection.id === id ? { ...connection, status: 'disconnected' } : connection,
          ),
        );
        if (activeSSHConnectionId === id) {
          setActiveSSHConnectionId(null);
          setSshNodes([]);
          setSshPreview(null);
          setSshCurrentPath('/');
        }
      });
  };

  const deleteSshConnection = (id: string) => {
    if (!token) return;
    void createSshClient(gatewayUrl)
      .remove(token, id)
      .then(() => {
        setSshConnections((prev) => prev.filter((connection) => connection.id !== id));
        // 网关删除连接时会级联删掉该连接的 dialog（上行 DDL ON DELETE CASCADE
        // + deleteSshDialogsByConnection），本地快照也要同步摘掉，否则对话
        // 芯片会残留并指向已不存在的连接。
        setSshDialogs((prev) => prev.filter((dialog) => dialog.connectionId !== id));
        if (activeSSHConnectionId === id) {
          setActiveSSHConnectionId(null);
          setSshNodes([]);
          setSshPreview(null);
          setSshCurrentPath('/');
        }
      })
      .catch((error: unknown) => logger.error('failed to delete ssh connection', error));
  };

  const browseSshPath = (path: string) => {
    if (!activeSSHConnectionId || !token) return;
    const node = sshNodes.find((item) => item.path === path);
    if (node?.type === 'directory') {
      void loadSshFiles(activeSSHConnectionId, path);
      return;
    }
    void createSshClient(gatewayUrl)
      .readFile(token, activeSSHConnectionId, path)
      .then((preview) =>
        setSshPreview({
          id: preview.path,
          name: preview.path.split('/').pop() ?? preview.path,
          type: 'text',
          createdAt: Date.now(),
          sessionId: activeSSHConnectionId,
          content: preview.content,
        }),
      );
  };

  const uploadSshFile = (file: File) => {
    if (!activeSSHConnectionId || !token) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(result);
      const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
      const contentBase64 = btoa(binary);
      void createSshClient(gatewayUrl)
        .upload(token, {
          connectionId: activeSSHConnectionId,
          path: `${sshCurrentPath.replace(/\/$/, '')}/${file.name}`,
          contentBase64,
        })
        .then(() => {
          void loadSshFiles(activeSSHConnectionId, sshCurrentPath);
        });
    };
    reader.readAsArrayBuffer(file);
  };

  return {
    sshCurrentPath,
    sshNodes,
    sshPreview,
    activeSSHConnectionId,
    setActiveSSHConnectionId,
    loadSshFiles,
    addSshConnection,
    connectSsh,
    disconnectSsh,
    deleteSshConnection,
    browseSshPath,
    uploadSshFile,
  };
}
