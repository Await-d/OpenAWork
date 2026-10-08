/**
 * 工作区选择弹窗的「本地文件夹 / SSH 远端目录」双来源接线。
 *
 * 侧栏头部 ＋ 与 ChatPage 的绑定入口都需要**同等完整**的选择器：既能浏览本地
 * 目录，也能切到 SSH 远端（连接列表、新建/编辑连接、测试连接、远端建目录）。
 * 这套接线此前只存在于 ChatPage 内联实现里，侧栏只能挂本地弹窗 —— 于是同一个
 * 「选择工作区」在不同入口能力不一致。这里把它收敛成 hook：
 *
 * - 只依赖 `gatewayUrl` + `token`，**不依赖 `useWorkspace`**，因此在侧栏里复用
 *   不会重复触发「解析会话工作区」的请求（那会与 ChatPage 抢同一份状态）；
 * - 「选中之后怎么落地」（改会话绑定 / 只改全局选中值）由调用方通过
 *   `onSelectLocal` / `onSelectSsh` 收口，本hook 只负责弹窗与数据源。
 *
 * ChatPage 目前仍用内联实现（它的落地逻辑还耦合绑定锁与首屏就绪态），后续可
 * 迁移到本 hook；迁移前两者行为以本 hook 为准。
 */

import { useCallback, useMemo, useState } from 'react';
import { createSshClient, createWorkspaceClient } from '@openAwork/web-client';
import { toast } from '../feedback/ToastNotification.js';
import type { SshConnectionDraft } from './SshConnectionCreateForm.js';
import type { FileTreeNode, WorkspacePickerModalProps } from './WorkspacePickerModal.js';
import type {
  SshPickerConnection,
  SshWorkspacePickerModalProps,
  SshWorkspaceSelection,
} from './SshWorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from './workspace-picker-data-source.js';

/** 弹窗来源：本地文件夹 / SSH 远端目录。 */
export type WorkspacePickerSource = 'local' | 'ssh';

export interface UseWorkspacePickerSourcesOptions {
  readonly gatewayUrl: string;
  readonly token: string | null;
  /** 本地来源的初始目录（通常是当前工作区根）。 */
  readonly initialPath?: string | undefined;
  /** SSH 来源预选中的连接 id（草稿态已选连接）。 */
  readonly initialSshConnectionId?: string | null | undefined;
  /** 打开时默认落在哪个来源；默认本地。 */
  readonly initialSource?: WorkspacePickerSource;
  /** 选中本地目录后的落地收口；抛错时弹窗保持打开以便展示错误。 */
  readonly onSelectLocal: (path: string) => Promise<void> | void;
  /** 选中 SSH 远端目录后的落地收口；抛错时弹窗保持打开。 */
  readonly onSelectSsh: (selection: SshWorkspaceSelection) => Promise<void> | void;
  /**
   * 本地来源的数据源覆盖。
   *
   * 默认走 `buildWorkspacePickerDataSource`。ChatPage 已经通过 `useWorkspace`
   * 持有同一套能力（且带会话/SSH 读取身份），注入它可保证迁移前后行为逐字节一致。
   */
  readonly localSource?: {
    readonly fetchTree?: WorkspacePickerModalProps['fetchTree'];
    readonly createDirectory?: WorkspacePickerModalProps['createDirectory'];
    readonly validatePath?: WorkspacePickerModalProps['validatePath'];
    readonly loading?: boolean;
  };
  /** SSH 来源的数据源覆盖；默认直连 SSH 客户端。 */
  readonly sshSource?: {
    readonly fetchTree?: SshWorkspacePickerModalProps['fetchTree'];
    readonly createDirectory?: SshWorkspacePickerModalProps['createDirectory'];
  };
}

export interface UseWorkspacePickerSourcesResult {
  readonly isOpen: boolean;
  readonly source: WorkspacePickerSource;
  /** 打开本地来源；`create` 表示直接展开「新建文件夹」表单。 */
  readonly openLocal: (mode?: 'browse' | 'create') => void;
  /** 直接以SSH 来源打开（并懒加载连接列表）。 */
  readonly openSsh: () => void;
  readonly close: () => void;
  /** 从本地来源切到 SSH 来源（弹窗内「使用 SSH 远端目录」按钮）。 */
  readonly switchToSsh: () => void;
  /** 从 SSH 来源切回本地来源。 */
  readonly switchToLocal: () => void;
  /** 已加载的 SSH 连接列表（懒加载，未切到 SSH 来源时为空）。 */
  readonly sshConnections: readonly SshPickerConnection[];
  /** 可直接展开给 `<WorkspacePickerModal {...localPickerProps} />`。 */
  readonly localPickerProps: WorkspacePickerModalProps;
  /** 可直接展开给 `<SshWorkspacePickerModal {...sshPickerProps} />`。 */
  readonly sshPickerProps: SshWorkspacePickerModalProps;
}

export function useWorkspacePickerSources({
  gatewayUrl,
  token,
  initialPath,
  initialSshConnectionId,
  initialSource = 'local',
  onSelectLocal,
  onSelectSsh,
  localSource,
  sshSource,
}: UseWorkspacePickerSourcesOptions): UseWorkspacePickerSourcesResult {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<WorkspacePickerSource>(initialSource);
  const [createMode, setCreateMode] = useState(false);
  const [sshConnections, setSshConnections] = useState<SshPickerConnection[]>([]);
  const [sshConnectionsLoading, setSshConnectionsLoading] = useState(false);

  // 本地数据源与 token 无关地固定在 client 上，token 变化时才重建。
  const defaultLocalDataSource = useMemo(
    () =>
      buildWorkspacePickerDataSource({
        client: createWorkspaceClient(gatewayUrl),
        token,
      }),
    [gatewayUrl, token],
  );

  /** 懒加载 SSH 连接列表：切到 SSH 来源时才拉取，避免每次打开弹窗都打网关。 */
  const loadSshConnections = useCallback(async (): Promise<void> => {
    if (!token) {
      setSshConnections([]);
      return;
    }
    setSshConnectionsLoading(true);
    try {
      setSshConnections(await createSshClient(gatewayUrl).list(token));
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '加载 SSH 连接失败', 'error');
      setSshConnections([]);
    } finally {
      setSshConnectionsLoading(false);
    }
  }, [gatewayUrl, token]);

  const openLocal = useCallback((mode: 'browse' | 'create' = 'browse'): void => {
    setCreateMode(mode === 'create');
    setSource('local');
    setIsOpen(true);
  }, []);

  const switchToSsh = useCallback((): void => {
    setSource('ssh');
    void loadSshConnections();
  }, [loadSshConnections]);

  const openSsh = useCallback((): void => {
    setCreateMode(false);
    setSource('ssh');
    setIsOpen(true);
    void loadSshConnections();
  }, [loadSshConnections]);

  const switchToLocal = useCallback((): void => {
    setSource('local');
  }, []);

  /** 统一关闭：来源复位，避免下次打开停在 SSH 模式。 */
  const close = useCallback((): void => {
    setIsOpen(false);
    setSource(initialSource);
    setCreateMode(false);
  }, [initialSource]);

  /**
   * 新建 SSH 连接：入库后尽力自动握手一次，让用户立刻能浏览远端目录。
   * 自动连接失败不向上抛错（连接已入库），只提示可在设置里重试。
   */
  const createSshConnection = useCallback(
    async (draft: SshConnectionDraft): Promise<SshPickerConnection> => {
      if (!token) {
        throw new Error('未登录，无法保存 SSH 连接。');
      }

      const client = createSshClient(gatewayUrl);
      const created = await client.create(token, {
        name: draft.name,
        host: draft.host,
        port: draft.port,
        username: draft.username,
        authType: draft.authType,
        ...(draft.password ? { password: draft.password } : {}),
        ...(draft.authType === 'key' || draft.authType === 'key-password'
          ? draft.privateKey
            ? { privateKey: draft.privateKey, privateKeyPath: null }
            : draft.privateKeyPath
              ? { privateKeyPath: draft.privateKeyPath, privateKey: null }
              : {}
          : {}),
        ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
      });

      let resolved: SshPickerConnection = created;
      try {
        await client.connect(token, created.id);
        // create 返回的是「创建时」的状态；connect 未抛错即握手成功，
        // 不按握手结果推进的话弹窗会误判为未连通而不去读远端目录。
        resolved = { ...created, status: 'connected' };
      } catch (error: unknown) {
        toast(
          `连接已保存，但自动连接失败：${error instanceof Error ? error.message : '未知错误'}`,
          'warning',
        );
      }

      await loadSshConnections();
      return resolved;
    },
    [gatewayUrl, loadSshConnections, token],
  );

  /**
   * 更新已有连接配置（PATCH /ssh/connections/:id）。
   * 未提供的字段按「保留原值」处理，因此编辑表单里留空的密码不会清空已存凭据。
   */
  const updateSshConnection = useCallback(
    async (connectionId: string, draft: SshConnectionDraft): Promise<SshPickerConnection> => {
      if (!token) {
        throw new Error('未登录，无法更新 SSH 连接。');
      }

      const updated = await createSshClient(gatewayUrl).update(token, connectionId, {
        name: draft.name,
        host: draft.host,
        port: draft.port,
        username: draft.username,
        authType: draft.authType,
        ...(draft.password !== undefined ? { password: draft.password } : {}),
        ...(draft.authType === 'key' || draft.authType === 'key-password'
          ? draft.privateKey
            ? { privateKey: draft.privateKey, privateKeyPath: null }
            : draft.privateKeyPath
              ? { privateKeyPath: draft.privateKeyPath, privateKey: null }
              : {}
          : {}),
        ...(draft.passphrase ? { passphrase: draft.passphrase } : {}),
      });

      await loadSshConnections();
      return updated;
    },
    [gatewayUrl, loadSshConnections, token],
  );

  /** 测试连接：让网关实际握手一次远端，随后刷新列表同步状态。 */
  const testSshConnection = useCallback(
    async (connectionId: string): Promise<void> => {
      if (!token) {
        throw new Error('未登录，无法测试 SSH 连接。');
      }
      await createSshClient(gatewayUrl).connect(token, connectionId);
      await loadSshConnections();
    },
    [gatewayUrl, loadSshConnections, token],
  );

  const fetchSshTree = useCallback(
    async (connectionId: string, path: string): Promise<FileTreeNode[]> => {
      if (!token) {
        throw new Error('未登录，无法读取远端目录。');
      }
      const entries = await createSshClient(gatewayUrl).listFiles(token, connectionId, path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.kind,
      }));
    },
    [gatewayUrl, token],
  );

  const createSshDirectory = useCallback(
    async (connectionId: string, path: string): Promise<void> => {
      if (!token) {
        throw new Error('未登录，无法创建远端目录。');
      }
      await createSshClient(gatewayUrl).mkdir(token, { connectionId, path });
    },
    [gatewayUrl, token],
  );

  const localPickerProps = useMemo<WorkspacePickerModalProps>(
    () => ({
      isOpen: isOpen && source === 'local',
      onClose: close,
      onSelect: async (path: string) => {
        // 落地收口抛错时不在此关闭：弹窗要保持打开才能把错误展示给用户。
        await onSelectLocal(path);
        close();
      },
      fetchRootPath: defaultLocalDataSource.fetchRootPath,
      fetchWorkspaceRoots: defaultLocalDataSource.fetchWorkspaceRoots,
      fetchTree: localSource?.fetchTree ?? defaultLocalDataSource.fetchTree,
      createDirectory: localSource?.createDirectory ?? defaultLocalDataSource.createDirectory,
      validatePath: localSource?.validatePath ?? defaultLocalDataSource.validatePath,
      loading: localSource?.loading,
      initialPath,
      initialCreateMode: createMode,
      onSwitchToSshSource: switchToSsh,
    }),
    [
      close,
      createMode,
      defaultLocalDataSource,
      initialPath,
      isOpen,
      localSource,
      onSelectLocal,
      source,
      switchToSsh,
    ],
  );

  const sshPickerProps = useMemo<SshWorkspacePickerModalProps>(
    () => ({
      isOpen: isOpen && source === 'ssh',
      onClose: close,
      connections: sshConnections,
      loadingConnections: sshConnectionsLoading,
      onSelect: async (selection: SshWorkspaceSelection) => {
        await onSelectSsh(selection);
        close();
      },
      fetchTree: sshSource?.fetchTree ?? fetchSshTree,
      createDirectory: sshSource?.createDirectory ?? createSshDirectory,
      onSwitchToLocalSource: switchToLocal,
      onCreateConnection: createSshConnection,
      onUpdateConnection: updateSshConnection,
      onTestConnection: testSshConnection,
      initialConnectionId: initialSshConnectionId ?? null,
    }),
    [
      close,
      createSshConnection,
      createSshDirectory,
      fetchSshTree,
      initialSshConnectionId,
      isOpen,
      source,
      sshConnections,
      sshConnectionsLoading,
      sshSource,
      switchToLocal,
      testSshConnection,
      updateSshConnection,
    ],
  );

  return {
    isOpen,
    source,
    openLocal,
    openSsh,
    close,
    switchToSsh,
    switchToLocal,
    sshConnections,
    localPickerProps,
    sshPickerProps,
  };
}
