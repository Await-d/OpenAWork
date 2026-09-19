import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderIcon } from '../../file-editor/preview/FileIcon.js';
import { getParentPath, joinDirectoryPath } from '../../../utils/workspace-path.js';
import type { FileTreeNode } from './WorkspacePickerModal.js';
import SshConnectionCreateForm from './SshConnectionCreateForm.js';
import type { SshConnectionDraft, SshConnectionFormValues } from './SshConnectionCreateForm.js';

/** 选择器所需的最小连接信息（与 web-client 的 SSHConnectionEntry 结构兼容）。 */
export interface SshPickerConnection {
  id: string;
  name?: string | null;
  host: string;
  port: number;
  username: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** 以下字段用于「编辑配置」回填；连接列表端点会一并返回。 */
  authType?: 'password' | 'key' | 'key-password' | 'agent';
  privateKeyPath?: string | null;
  /** 网关侧是否已保存凭据（密码或 agent）；决定编辑时密码能否留空沿用。 */
  hasPassword?: boolean;
  /** 网关侧是否已保存私钥内容；决定编辑时「粘贴私钥」能否留空沿用。 */
  hasPrivateKey?: boolean;
  /** 网关侧是否已保存私钥口令；决定编辑时口令的标签文案。 */
  hasPassphrase?: boolean;
}

export interface SshWorkspaceSelection {
  connectionId: string;
  path: string;
}

export interface SshWorkspacePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  connections: SshPickerConnection[];
  onSelect: (selection: SshWorkspaceSelection) => Promise<void>;
  fetchTree: (connectionId: string, path: string) => Promise<FileTreeNode[]>;
  createDirectory: (connectionId: string, path: string) => Promise<void>;
  /** 「改用本地文件夹」入口；未提供时不渲染该按钮。 */
  onSwitchToLocalSource?: () => void;
  /**
   * 新建 SSH 连接并持久化到网关的 SSH 连接表；成功后返回新连接用于自动选中。
   * 未提供时不渲染「新建连接」入口（其它调用点不受影响）。
   */
  onCreateConnection?: (draft: SshConnectionDraft) => Promise<SshPickerConnection>;
  /**
   * 更新已有连接的配置（PATCH /ssh/connections/:id）；成功后返回更新后的连接。
   * 未提供时不渲染「编辑配置」入口。
   */
  onUpdateConnection?: (
    connectionId: string,
    draft: SshConnectionDraft,
  ) => Promise<SshPickerConnection>;
  /**
   * 测试连接：建立一次 SSH 会话验证配置是否可用，失败时抛出错误信息。
   * 未提供时不渲染「测试连接」入口。
   */
  onTestConnection?: (connectionId: string) => Promise<void>;
  initialConnectionId?: string | null;
  initialPath?: string;
  loadingConnections?: boolean;
}

function pickDefaultConnection(
  connections: SshPickerConnection[],
  preferredId: string | null | undefined,
): SshPickerConnection | null {
  if (preferredId) {
    const preferred = connections.find((connection) => connection.id === preferredId);
    if (preferred) return preferred;
  }
  return (
    connections.find((connection) => connection.status === 'connected') ?? connections[0] ?? null
  );
}

function connectionLabel(connection: SshPickerConnection): string {
  const name = connection.name?.trim();
  const target = `${connection.username}@${connection.host}:${connection.port}`;
  return name && name.length > 0 ? `${name}（${target}）` : target;
}

/** 由已有连接构造编辑表单的初始值（密码不回显，留空即不修改）。 */
export function buildSshConnectionFormValues(
  connection: SshPickerConnection,
): SshConnectionFormValues {
  return {
    name: connection.name ?? '',
    host: connection.host,
    port: String(connection.port),
    username: connection.username,
    authType: connection.authType ?? 'password',
    password: '',
    privateKeyPath: connection.privateKeyPath ?? '',
    privateKey: '',
    passphrase: '',
    keySource: connection.hasPrivateKey ? 'paste' : connection.privateKeyPath ? 'path' : 'paste',
  };
}

/** 编辑时密码能否留空沿用：网关侧已保存密码或使用 SSH Agent 认证时允许。 */
function canReuseStoredPassword(connection: SshPickerConnection): boolean {
  return connection.authType === 'agent' || connection.hasPassword === true;
}

const STATUS_LABEL: Record<SshPickerConnection['status'], string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  error: '连接失败',
};

/** 连接操作提示（测试连接 / 保存配置）的颜色映射。 */
const CONNECTION_NOTICE_COLOR: Record<'success' | 'warning' | 'error', string> = {
  success: 'var(--success)',
  warning: 'var(--warning, var(--accent))',
  error: 'var(--danger)',
};

export default function SshWorkspacePickerModal({
  isOpen,
  onClose,
  connections,
  onSelect,
  fetchTree,
  createDirectory,
  onSwitchToLocalSource,
  onCreateConnection,
  onUpdateConnection,
  onTestConnection,
  initialConnectionId,
  initialPath,
  loadingConnections = false,
}: SshWorkspacePickerModalProps) {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<FileTreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [creatingDirectory, setCreatingDirectory] = useState(false);
  const [creatingConnection, setCreatingConnection] = useState(false);
  const [updatingConnection, setUpdatingConnection] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [showCreateDirectoryForm, setShowCreateDirectoryForm] = useState(false);
  const [showCreateConnectionForm, setShowCreateConnectionForm] = useState(false);
  /** 非空表示当前处于「编辑配置」模式：值为正在编辑的连接 id。 */
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  /** 连接操作（新建 / 编辑 / 测试连接）的结果提示。 */
  const [connectionNotice, setConnectionNotice] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [newDirectoryName, setNewDirectoryName] = useState('');
  /**
   * 弹窗打开期间期望选中的连接：用户手动切换或新建连接后写入，
   * 这样连接列表刷新（新建后重新拉取）时不会跳回默认项。
   */
  const preferredConnectionIdRef = useRef<string | null>(null);
  /**
   * 当前浏览状态对应的连接 id。列表刷新（测试连接 / 保存配置后都会重新拉取）
   * 时若选中项未变，直接复用已浏览的目录，不重置回根目录。
   */
  const initializedConnectionIdRef = useRef<string | null>(null);

  const busy =
    browsing ||
    confirming ||
    creatingDirectory ||
    creatingConnection ||
    updatingConnection ||
    testingConnection ||
    loadingConnections;

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === connectionId) ?? null,
    [connectionId, connections],
  );

  const canGoUp = useMemo(() => {
    if (!currentPath) return false;
    return getParentPath(currentPath) !== null;
  }, [currentPath]);

  const openDirectory = useCallback(
    async (targetConnectionId: string, path: string) => {
      setBrowsing(true);
      setError(null);
      try {
        const nodes = await fetchTree(targetConnectionId, path);
        setCurrentPath(path);
        setPathInput(path);
        setDirectories(nodes.filter((node) => node.type === 'directory'));
      } catch (err) {
        setError(err instanceof Error ? err.message : '无法读取远端目录');
      } finally {
        setBrowsing(false);
      }
    },
    [fetchTree],
  );

  useEffect(() => {
    if (!isOpen) {
      setConnectionId(null);
      setCurrentPath(null);
      setDirectories([]);
      setError(null);
      setPathInput('');
      setBrowsing(false);
      setConfirming(false);
      setCreatingDirectory(false);
      setCreatingConnection(false);
      setUpdatingConnection(false);
      setTestingConnection(false);
      setShowCreateDirectoryForm(false);
      setShowCreateConnectionForm(false);
      setEditingConnectionId(null);
      setConnectionNotice(null);
      setNewDirectoryName('');
      preferredConnectionIdRef.current = null;
      initializedConnectionIdRef.current = null;
      return;
    }

    const nextConnection = pickDefaultConnection(
      connections,
      preferredConnectionIdRef.current ?? initialConnectionId,
    );
    if (!nextConnection) {
      setError(
        loadingConnections
          ? null
          : onCreateConnection
            ? '尚未配置 SSH 连接。点击「新建连接」填写主机信息，保存后即可直接使用。'
            : '尚未配置 SSH 连接。请先在设置 → 工作区 → SSH 连接中添加。',
      );
      return;
    }
    preferredConnectionIdRef.current = nextConnection.id;
    // 列表刷新导致的重跑（测试连接 / 保存配置后父组件都会重新拉取）：
    // 选中项未变时只同步 id，保留用户已经浏览到的远端目录。
    if (initializedConnectionIdRef.current === nextConnection.id) {
      return;
    }

    initializedConnectionIdRef.current = nextConnection.id;
    setConnectionId(nextConnection.id);
    const startPath = initialPath && initialPath.startsWith('/') ? initialPath : '/';
    setCurrentPath(startPath);
    setPathInput(startPath);
    void openDirectory(nextConnection.id, startPath);
  }, [
    connections,
    initialConnectionId,
    initialPath,
    isOpen,
    loadingConnections,
    onCreateConnection,
    openDirectory,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleOpenPathInput() {
    if (!connectionId) {
      setError('请先选择一个 SSH 连接');
      return;
    }
    const candidatePath = pathInput.trim();
    if (!candidatePath) {
      setError('请输入远端绝对路径');
      return;
    }
    if (!candidatePath.startsWith('/')) {
      setError('远端路径必须是绝对路径（以 / 开头）');
      return;
    }
    await openDirectory(connectionId, candidatePath);
  }

  async function handleGoUp() {
    if (!connectionId || !currentPath) return;
    const parentPath = getParentPath(currentPath);
    if (!parentPath) return;
    await openDirectory(connectionId, parentPath);
  }

  async function handleChangeConnection(nextConnectionId: string) {
    preferredConnectionIdRef.current = nextConnectionId;
    initializedConnectionIdRef.current = nextConnectionId;
    setConnectionId(nextConnectionId);
    setError(null);
    setShowCreateDirectoryForm(false);
    setShowCreateConnectionForm(false);
    setEditingConnectionId(null);
    setConnectionNotice(null);
    setNewDirectoryName('');
    await openDirectory(nextConnectionId, '/');
  }

  /**
   * 新建连接：交给上层持久化到网关的 SSH 连接表（并尽力自动连接）。
   * 成功后立即选中新连接；已连通则读取其根目录，未连通则提示先测试连通。
   * 失败时向上抛出，由表单就地展示错误。
   */
  async function handleCreateConnection(draft: SshConnectionDraft) {
    if (!onCreateConnection) {
      return;
    }

    setCreatingConnection(true);
    setError(null);
    try {
      const created = await onCreateConnection(draft);
      preferredConnectionIdRef.current = created.id;
      initializedConnectionIdRef.current = created.id;
      setConnectionId(created.id);
      setShowCreateConnectionForm(false);
      if (created.status === 'connected') {
        await openDirectory(created.id, '/');
      } else {
        setConnectionNotice({
          tone: 'warning',
          message: '连接已保存，但尚未连通；点「测试连接」验证后即可浏览远端目录',
        });
      }
    } finally {
      setCreatingConnection(false);
    }
  }

  /**
   * 更新当前连接的配置：交给上层 PATCH 到网关（连接列表随之刷新）。
   * 已连通时按新配置重建的会话复读当前路径；未连通则只提示保存成功。
   * 失败时向上抛出，由表单就地展示错误。
   */
  async function handleUpdateConnection(draft: SshConnectionDraft) {
    if (!onUpdateConnection || !editingConnectionId) {
      return;
    }

    setUpdatingConnection(true);
    setError(null);
    try {
      const updated = await onUpdateConnection(editingConnectionId, draft);
      preferredConnectionIdRef.current = updated.id;
      initializedConnectionIdRef.current = updated.id;
      setConnectionId(updated.id);
      setEditingConnectionId(null);
      if (updated.status === 'connected') {
        setConnectionNotice({ tone: 'success', message: '连接配置已更新' });
        // 连接客户端已按新配置重建，复读当前路径而不是强制回到根目录。
        await openDirectory(updated.id, currentPath ?? '/');
      } else {
        // 未连接时远端目录本就不可读，这里只提示保存成功，避免误报读取错误。
        setConnectionNotice({
          tone: 'warning',
          message: '连接配置已更新；点「测试连接」验证连通后可浏览远端目录',
        });
      }
    } finally {
      setUpdatingConnection(false);
    }
  }

  /**
   * 测试连接：让网关实际握手一次远端（`/ssh/connections/:id/connect`），
   * 成功 / 失败都就地提示，便于在绑定前确认配置可用。
   */
  async function handleTestConnection(targetConnectionId: string) {
    if (!onTestConnection) {
      return;
    }

    setTestingConnection(true);
    setConnectionNotice(null);
    try {
      await onTestConnection(targetConnectionId);
      setConnectionNotice({ tone: 'success', message: '连接成功，远端可用' });
      // 连通后同步刷新当前目录：既让「先测试再浏览」的路径立刻可用，
      // 也能把此前因未连接而失败的目录读取纠正过来。
      if (currentPath) {
        await openDirectory(targetConnectionId, currentPath);
      }
    } catch (err) {
      setConnectionNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : '连接失败，请检查主机与凭据',
      });
    } finally {
      setTestingConnection(false);
    }
  }

  /** 连接操作按钮（新建 / 编辑 / 测试）的统一样式：`active` 表示对应的展开态。 */
  function connectionActionButtonStyle(active: boolean): React.CSSProperties {
    return {
      height: 28,
      padding: '0 10px',
      borderRadius: 8,
      border: '1px solid var(--border-default)',
      background: active ? 'var(--accent-subtle)' : 'transparent',
      color: active ? 'var(--accent)' : 'var(--fg-default)',
      fontSize: 11,
      fontWeight: 600,
      cursor: busy ? 'not-allowed' : 'pointer',
      opacity: busy ? 0.5 : 1,
      flexShrink: 0,
    };
  }

  async function handleCreateDirectory() {
    if (!connectionId || !currentPath) {
      setError('请先打开一个远端目录，再新建文件夹');
      return;
    }
    const name = newDirectoryName.trim();
    if (!name) {
      setError('请输入文件夹名称');
      return;
    }
    if (name === '.' || name === '..' || /[\\/]/.test(name)) {
      setError('文件夹名称不能包含路径分隔符');
      return;
    }

    const nextPath = joinDirectoryPath(currentPath, name);
    setError(null);
    setCreatingDirectory(true);
    try {
      await createDirectory(connectionId, nextPath);
      await openDirectory(connectionId, nextPath);
      setShowCreateDirectoryForm(false);
      setNewDirectoryName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建远端文件夹失败');
    } finally {
      setCreatingDirectory(false);
    }
  }

  async function handleSelectCurrent() {
    if (!connectionId || !selectedConnection || !currentPath) {
      setError('当前没有可选择的远端文件夹');
      return;
    }
    setError(null);
    setConfirming(true);
    try {
      await onSelect({ connectionId, path: currentPath });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定远端工作区失败');
    } finally {
      setConfirming(false);
    }
  }
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        type="button"
        aria-label="关闭对话框"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'color-mix(in srgb, var(--bg-base) 50%, transparent)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          border: 'none',
          cursor: 'default',
          padding: 0,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择 SSH 远端工作区文件夹"
        style={{
          position: 'relative',
          zIndex: 1,
          width: 560,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: '24px 24px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
            选择 SSH 远端工作区
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ssh-picker-action"
            disabled={busy}
            style={{
              background: 'none',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
              color: 'var(--fg-muted)',
              padding: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <label
              htmlFor="ssh-picker-connection"
              style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}
            >
              SSH 连接
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {selectedConnection && onTestConnection && (
                <button
                  type="button"
                  data-testid="ssh-picker-test-connection"
                  className="ssh-picker-action"
                  disabled={busy}
                  onClick={() => {
                    void handleTestConnection(selectedConnection.id);
                  }}
                  style={connectionActionButtonStyle(false)}
                >
                  {testingConnection
                    ? '测试中…'
                    : selectedConnection.status === 'connected'
                      ? '重新连接'
                      : '测试连接'}
                </button>
              )}
              {selectedConnection && onUpdateConnection && (
                <button
                  type="button"
                  data-testid="ssh-picker-edit-connection"
                  className="ssh-picker-action"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setConnectionNotice(null);
                    setShowCreateConnectionForm(false);
                    setEditingConnectionId((value) =>
                      value === selectedConnection.id ? null : selectedConnection.id,
                    );
                  }}
                  style={connectionActionButtonStyle(editingConnectionId === selectedConnection.id)}
                >
                  {editingConnectionId === selectedConnection.id ? '收起编辑' : '编辑配置'}
                </button>
              )}
              {onCreateConnection && (
                <button
                  type="button"
                  data-testid="ssh-picker-create-connection"
                  className="ssh-picker-action"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setConnectionNotice(null);
                    setEditingConnectionId(null);
                    setShowCreateConnectionForm((value) => !value);
                  }}
                  style={connectionActionButtonStyle(showCreateConnectionForm)}
                >
                  {showCreateConnectionForm ? '收起新建连接' : '+ 新建连接'}
                </button>
              )}
            </div>
          </div>
          <select
            id="ssh-picker-connection"
            aria-label="SSH 连接"
            className="ssh-picker-select"
            disabled={busy || connections.length === 0}
            value={connectionId ?? ''}
            onChange={(event) => {
              void handleChangeConnection(event.currentTarget.value);
            }}
            style={{
              height: 36,
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-elevated, var(--bg-overlay))',
              color: 'var(--fg-strong)',
              padding: '0 12px',
              outline: 'none',
              fontSize: 12,
            }}
          >
            {connections.length === 0 && <option value="">（暂无可用连接）</option>}
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionLabel(connection)} · {STATUS_LABEL[connection.status]}
              </option>
            ))}
          </select>

          {connectionNotice && (
            <span
              data-testid="ssh-picker-connection-notice"
              role={connectionNotice.tone === 'error' ? 'alert' : 'status'}
              style={{
                fontSize: 11,
                lineHeight: 1.5,
                color: CONNECTION_NOTICE_COLOR[connectionNotice.tone],
              }}
            >
              {connectionNotice.message}
            </span>
          )}

          {showCreateConnectionForm && onCreateConnection && (
            <SshConnectionCreateForm
              mode="create"
              onSubmit={handleCreateConnection}
              onCancel={() => {
                setShowCreateConnectionForm(false);
              }}
              busy={busy}
            />
          )}

          {editingConnectionId && selectedConnection && onUpdateConnection && (
            <SshConnectionCreateForm
              key={editingConnectionId}
              mode="edit"
              initialValues={buildSshConnectionFormValues(selectedConnection)}
              passwordOptional={canReuseStoredPassword(selectedConnection)}
              privateKeyOptional={selectedConnection.hasPrivateKey === true}
              passphraseOptional={selectedConnection.hasPassphrase === true}
              onSubmit={handleUpdateConnection}
              onCancel={() => {
                setEditingConnectionId(null);
              }}
              busy={busy}
            />
          )}
        </div>

        {selectedConnection && selectedConnection.status !== 'connected' && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--warning, var(--accent))',
              lineHeight: 1.5,
            }}
          >
            该连接当前{STATUS_LABEL[selectedConnection.status]}。可点上方「测试连接」恢复握手，
            或用「编辑配置」检查主机与凭据；未连接时工具调用无法在远端执行。
          </span>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-default)',
            background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-overlay))',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 600 }}>
              远端路径
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              输入框同步显示当前远端目录，也可以直接编辑远端绝对路径后打开。
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              aria-label="远端路径输入"
              className="ssh-picker-input"
              value={pathInput}
              onChange={(event) => {
                setPathInput(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleOpenPathInput();
                }
              }}
              placeholder="例如：/home/deploy/projects/app"
              disabled={busy}
              title={currentPath ?? pathInput}
              style={{
                flex: '1 1 260px',
                minWidth: 0,
                height: 38,
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                padding: '0 12px',
                outline: 'none',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              onClick={() => void handleGoUp()}
              className="ssh-picker-action"
              disabled={!canGoUp || busy}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--fg-default)',
                fontSize: 12,
                fontWeight: 600,
                cursor: !canGoUp || busy ? 'not-allowed' : 'pointer',
                opacity: !canGoUp || busy ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              上一级
            </button>
            <button
              type="button"
              onClick={() => void handleOpenPathInput()}
              className="ssh-picker-action"
              disabled={busy || pathInput.trim().length === 0}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 10,
                border: '1px solid var(--border-default)',
                background: 'var(--bg-overlay)',
                color: 'var(--fg-strong)',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy || pathInput.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity: busy || pathInput.trim().length === 0 ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              打开路径
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 220,
            maxHeight: 320,
            overflowY: 'auto',
            border: '1px solid var(--border-default)',
            borderRadius: 10,
            padding: 10,
            background: 'var(--bg-2, var(--bg-base))',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              paddingBottom: 8,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                当前远端目录
              </span>
              <span
                title={currentPath ?? undefined}
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 11,
                  color: 'var(--fg-muted)',
                }}
              >
                {currentPath ?? '尚未打开目录'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowCreateDirectoryForm((value) => !value);
              }}
              className="ssh-picker-action"
              disabled={!connectionId || !currentPath || busy}
              style={{
                height: 32,
                padding: '0 12px',
                borderRadius: 8,
                border: '1px solid var(--border-default)',
                background: showCreateDirectoryForm ? 'var(--accent-subtle)' : 'var(--bg-overlay)',
                color: showCreateDirectoryForm ? 'var(--accent)' : 'var(--fg-strong)',
                fontSize: 12,
                fontWeight: 600,
                cursor: !connectionId || !currentPath || busy ? 'not-allowed' : 'pointer',
                opacity: !connectionId || !currentPath || busy ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              {showCreateDirectoryForm ? '收起' : '新建远端文件夹'}
            </button>
          </div>

          {showCreateDirectoryForm && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                paddingBottom: 8,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <input
                type="text"
                aria-label="远端文件夹名称"
                className="ssh-picker-input"
                value={newDirectoryName}
                onChange={(event) => {
                  setNewDirectoryName(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreateDirectory();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    setShowCreateDirectoryForm(false);
                    setNewDirectoryName('');
                  }
                }}
                placeholder="文件夹名称，例如：my-project"
                disabled={busy}
                style={{
                  flex: '1 1 220px',
                  minWidth: 0,
                  height: 34,
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-strong)',
                  padding: '0 12px',
                  outline: 'none',
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={() => void handleCreateDirectory()}
                className="ssh-picker-action"
                disabled={busy || newDirectoryName.trim().length === 0}
                style={{
                  height: 34,
                  padding: '0 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--fg-on-accent)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy || newDirectoryName.trim().length === 0 ? 'not-allowed' : 'pointer',
                  opacity: busy || newDirectoryName.trim().length === 0 ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                {creatingDirectory ? '创建中…' : '创建'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateDirectoryForm(false);
                  setNewDirectoryName('');
                }}
                className="ssh-picker-action"
                disabled={busy}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--fg-muted)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                取消
              </button>
            </div>
          )}

          {browsing ? (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>正在读取远端文件夹…</div>
          ) : directories.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
              当前远端目录下没有可进入的子文件夹
            </div>
          ) : (
            directories
              .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
              .map((directory) => (
                <button
                  key={directory.path}
                  type="button"
                  onClick={() => {
                    if (connectionId) {
                      void openDirectory(connectionId, directory.path);
                    }
                  }}
                  className="ssh-picker-dir-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    minHeight: 34,
                    padding: '4px 10px',
                    borderRadius: 7,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: 'var(--fg-strong)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <FolderIcon size={14} name={directory.name} />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    {directory.name}
                  </span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0, opacity: 0.5 }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))
          )}
        </div>

        {error && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <div>
            {onSwitchToLocalSource && (
              <button
                type="button"
                onClick={onSwitchToLocalSource}
                className="ssh-picker-action"
                disabled={busy}
                style={{
                  height: 34,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'transparent',
                  color: 'var(--fg-default)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                改用本地文件夹
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              className="ssh-picker-action"
              disabled={busy}
              style={{
                height: 34,
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid var(--border-default)',
                background: 'transparent',
                color: 'var(--fg-muted)',
                fontSize: 12,
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.5 : 1,
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSelectCurrent()}
              className="ssh-picker-action"
              disabled={busy || !currentPath || !connectionId}
              style={{
                height: 34,
                padding: '0 18px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent)',
                color: 'var(--fg-on-accent)',
                fontSize: 12,
                fontWeight: 600,
                cursor: busy || !currentPath || !connectionId ? 'not-allowed' : 'pointer',
                opacity: busy || !currentPath || !connectionId ? 0.5 : 1,
              }}
            >
              {confirming ? '绑定中…' : '选择当前远端文件夹'}
            </button>
          </div>
        </div>
      </div>
      <style>{`
        .ssh-picker-action:focus-visible,
        .ssh-picker-input:focus-visible,
        .ssh-picker-select:focus-visible,
        .ssh-picker-dir-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
          box-shadow: 0 0 0 4px var(--accent-subtle);
        }
        .ssh-picker-action:not(:disabled):hover {
          border-color: var(--border-emphasis);
        }
        .ssh-picker-dir-btn:not(:disabled):hover {
          background: var(--accent-subtle);
          border-color: var(--accent-border);
        }
      `}</style>
    </div>
  );
}
