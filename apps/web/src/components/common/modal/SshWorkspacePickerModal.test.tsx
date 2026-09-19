// @vitest-environment jsdom

import { useState } from 'react';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SshWorkspacePickerModal, {
  buildSshConnectionFormValues,
  type SshPickerConnection,
} from './SshWorkspacePickerModal.js';
import type { FileTreeNode } from './WorkspacePickerModal.js';
import type { SshConnectionDraft } from './SshConnectionCreateForm.js';

type ModalProps = ComponentProps<typeof SshWorkspacePickerModal>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CONNECTED: SshPickerConnection = {
  id: 'conn-1',
  name: 'alpha',
  host: '10.0.0.1',
  port: 22,
  username: 'deploy',
  status: 'connected',
  authType: 'password',
  hasPassword: true,
};

const CREATED: SshPickerConnection = {
  id: 'conn-2',
  name: 'beta',
  host: '10.0.0.9',
  port: 22,
  username: 'deploy',
  // 对应 ChatPage 新建后「尽力自动连接成功」的主路径。
  status: 'connected',
  authType: 'password',
  hasPassword: true,
};

const UPDATED: SshPickerConnection = { ...CONNECTED, host: '10.0.0.2' };

function renderModal(overrides: Partial<ModalProps> = {}): ModalProps {
  const props: ModalProps = {
    isOpen: true,
    onClose: () => {},
    connections: [CONNECTED],
    onSelect: async () => {},
    fetchTree: async () => [],
    createDirectory: async () => {},
    ...overrides,
  };

  render(<SshWorkspacePickerModal {...props} />);
  return props;
}

/**
 * 展开新建表单：弹窗打开时会先浏览一次远端目录（browsing 期间按钮禁用），
 * 因此先等按钮可用再点击，避免误判为「入口未渲染」。
 */
async function openCreateForm(): Promise<void> {
  const createButton = screen.getByTestId('ssh-picker-create-connection') as HTMLButtonElement;
  await waitFor(() => {
    expect(createButton.disabled).toBe(false);
  });
  fireEvent.click(createButton);
  await screen.findByTestId('ssh-connection-create-form');
}

function fillCreateForm(): void {
  fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: '10.0.0.9' } });
  fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'deploy' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'p@ss' } });
}

/** 展开「编辑配置」表单（等连接选中 + 浏览结束、按钮可用后再点击）。 */
async function openEditForm(): Promise<void> {
  const editButton = (await screen.findByTestId('ssh-picker-edit-connection')) as HTMLButtonElement;
  await waitFor(() => {
    expect(editButton.disabled).toBe(false);
  });
  fireEvent.click(editButton);
  await screen.findByTestId('ssh-connection-create-form');
}

describe('SshWorkspacePickerModal', () => {
  it('未提供 onCreateConnection 时不渲染新建连接入口', async () => {
    const fetchTree = vi.fn(async () => []);
    renderModal({ fetchTree });

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('conn-1', '/');
    });
    expect(screen.queryByTestId('ssh-picker-create-connection')).toBeNull();
  });

  it('无连接时提示可直接新建连接', async () => {
    renderModal({ connections: [], onCreateConnection: vi.fn(async () => CREATED) });

    await waitFor(() => {
      expect(screen.getByText(/点击「新建连接」/)).toBeTruthy();
    });
    expect(screen.getByTestId('ssh-picker-create-connection')).toBeTruthy();
  });

  it('新建连接成功后自动选中并读取其根目录', async () => {
    const onCreateConnection = vi.fn(async (_draft: SshConnectionDraft) => CREATED);
    const fetchTree = vi.fn(async () => []);

    // 模拟 ChatPage：新建成功后把新连接写回列表（props 更新），
    // 验证选中项不会被默认连接覆盖、且立刻读取新连接根目录。
    function Harness() {
      const [connections, setConnections] = useState<SshPickerConnection[]>([CONNECTED]);
      return (
        <SshWorkspacePickerModal
          isOpen
          onClose={() => {}}
          connections={connections}
          onSelect={async () => {}}
          fetchTree={fetchTree}
          createDirectory={async () => {}}
          onCreateConnection={async (draft) => {
            const created = await onCreateConnection(draft);
            setConnections((previous) => [...previous, created]);
            return created;
          }}
        />
      );
    }

    render(<Harness />);

    await openCreateForm();
    fillCreateForm();
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onCreateConnection).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.9', username: 'deploy', authType: 'password' }),
      );
    });

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('conn-2', '/');
    });
    // 保存成功后自动收起表单，新连接成为当前选中项。
    expect(screen.queryByTestId('ssh-connection-create-form')).toBeNull();
    expect((screen.getByLabelText('SSH 连接') as HTMLSelectElement).value).toBe('conn-2');
  });

  it('新建失败时就地展示错误且不改动当前连接', async () => {
    const onCreateConnection = vi.fn(async () => {
      throw new Error('保存 SSH 连接失败：主机不可达');
    });
    const fetchTree = vi.fn(async () => []);
    renderModal({ onCreateConnection, fetchTree });

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('conn-1', '/');
    });

    await openCreateForm();
    fillCreateForm();
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-connection-create-error').textContent).toContain('主机不可达');
    });
    expect(screen.getByTestId('ssh-connection-create-form')).toBeTruthy();
    expect((screen.getByLabelText('SSH 连接') as HTMLSelectElement).value).toBe('conn-1');
  });

  it('未提供编辑 / 测试回调时不渲染对应按钮', async () => {
    const fetchTree = vi.fn(async () => []);
    renderModal({ fetchTree });

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('conn-1', '/');
    });
    expect(screen.queryByTestId('ssh-picker-edit-connection')).toBeNull();
    expect(screen.queryByTestId('ssh-picker-test-connection')).toBeNull();
  });

  it('测试连接成功后显示成功提示', async () => {
    const onTestConnection = vi.fn(async (_connectionId: string) => undefined);
    const fetchTree = vi.fn(async () => []);
    renderModal({ onTestConnection, fetchTree });

    const testButton = (await screen.findByTestId(
      'ssh-picker-test-connection',
    )) as HTMLButtonElement;
    await waitFor(() => {
      expect(testButton.disabled).toBe(false);
    });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(onTestConnection).toHaveBeenCalledWith('conn-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('ssh-picker-connection-notice').textContent).toContain('连接成功');
    });
  });

  it('测试连接失败时就地展示失败原因', async () => {
    const onTestConnection = vi.fn(async (_connectionId: string) => {
      throw new Error('SSH 握手失败：认证被拒绝');
    });
    renderModal({ onTestConnection, fetchTree: vi.fn(async () => []) });

    const testButton = (await screen.findByTestId(
      'ssh-picker-test-connection',
    )) as HTMLButtonElement;
    await waitFor(() => {
      expect(testButton.disabled).toBe(false);
    });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByTestId('ssh-picker-connection-notice').textContent).toContain(
        '认证被拒绝',
      );
    });
  });

  it('编辑配置回填当前连接，提交留空密码即沿用已保存凭据', async () => {
    const onUpdateConnection = vi.fn(
      async (_connectionId: string, _draft: SshConnectionDraft) => UPDATED,
    );
    renderModal({ onUpdateConnection, fetchTree: vi.fn(async () => []) });

    await openEditForm();

    expect((screen.getByLabelText('连接名称') as HTMLInputElement).value).toBe('alpha');
    expect((screen.getByLabelText('主机地址') as HTMLInputElement).value).toBe('10.0.0.1');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');

    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: '10.0.0.2' } });
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onUpdateConnection).toHaveBeenCalledWith('conn-1', {
        name: 'alpha',
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        authType: 'password',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('ssh-picker-connection-notice').textContent).toContain(
        '连接配置已更新',
      );
    });
  });

  it('buildSshConnectionFormValues 按已保存凭据选择私钥来源', () => {
    const keyConnection: SshPickerConnection = {
      ...CONNECTED,
      authType: 'key',
      hasPassword: false,
      privateKeyPath: null,
    };

    expect(buildSshConnectionFormValues({ ...keyConnection, hasPrivateKey: true }).keySource).toBe(
      'paste',
    );
    expect(
      buildSshConnectionFormValues({
        ...keyConnection,
        privateKeyPath: '/home/deploy/.ssh/id_ed25519',
      }).keySource,
    ).toBe('path');
    expect(buildSshConnectionFormValues(keyConnection).keySource).toBe('paste');
  });

  it('编辑已保存私钥的连接时默认粘贴模式，留空提交沿用已保存凭据', async () => {
    const keyConnection: SshPickerConnection = {
      ...CONNECTED,
      authType: 'key',
      hasPassword: false,
      hasPrivateKey: true,
      privateKeyPath: null,
    };
    const onUpdateConnection = vi.fn(async (_connectionId: string, _draft: SshConnectionDraft) => ({
      ...keyConnection,
      host: '10.0.0.2',
    }));
    renderModal({
      connections: [keyConnection],
      onUpdateConnection,
      fetchTree: vi.fn(async () => []),
    });

    await openEditForm();

    expect(screen.getByLabelText('私钥来源')).toBeTruthy();
    expect((screen.getByLabelText('私钥内容') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('私钥内容（留空则不修改）')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onUpdateConnection).toHaveBeenCalledWith('conn-1', {
        name: 'alpha',
        host: '10.0.0.1',
        port: 22,
        username: 'deploy',
        authType: 'key',
      });
    });
  });

  it('编辑已保存口令的公钥 + 密码连接时各类凭据均可留空沿用', async () => {
    const keyConnection: SshPickerConnection = {
      ...CONNECTED,
      authType: 'key-password',
      hasPassword: true,
      hasPrivateKey: true,
      hasPassphrase: true,
      privateKeyPath: null,
    };
    const onUpdateConnection = vi.fn(
      async (_connectionId: string, _draft: SshConnectionDraft) => keyConnection,
    );
    renderModal({
      connections: [keyConnection],
      onUpdateConnection,
      fetchTree: vi.fn(async () => []),
    });

    await openEditForm();

    expect(screen.getByLabelText('密码')).toBeTruthy();
    expect(screen.getByText('密码（留空则不修改）')).toBeTruthy();
    expect(screen.getByLabelText('私钥内容')).toBeTruthy();
    expect(screen.getByLabelText('私钥口令')).toBeTruthy();
    expect(screen.getByText('私钥口令（留空则不修改）')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onUpdateConnection).toHaveBeenCalledWith('conn-1', {
        name: 'alpha',
        host: '10.0.0.1',
        port: 22,
        username: 'deploy',
        authType: 'key-password',
      });
    });
  });

  it('新建成功但未连通时提示尚未连通，且不读取远端目录', async () => {
    const disconnected: SshPickerConnection = { ...CREATED, status: 'disconnected' };
    const onCreateConnection = vi.fn(async (_draft: SshConnectionDraft) => disconnected);
    const fetchTree = vi.fn(async () => []);
    renderModal({ onCreateConnection, fetchTree });

    await openCreateForm();
    fillCreateForm();
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-picker-connection-notice').textContent).toContain('尚未连通');
    });
    expect(fetchTree).not.toHaveBeenCalledWith('conn-2', '/');
  });

  it('连接列表刷新（测试连接）不会把已浏览的远端目录重置回根目录', async () => {
    const onTestConnection = vi.fn(async (_connectionId: string) => undefined);
    const fetchTree = vi.fn(async (_connectionId: string, path: string): Promise<FileTreeNode[]> =>
      path === '/' ? [{ name: 'srv', path: '/srv', type: 'directory' }] : [],
    );

    // 模拟 ChatPage：测试连接后刷新连接列表（新对象引用会触发弹窗内的列表 effect）。
    function Harness() {
      const [connections, setConnections] = useState<SshPickerConnection[]>([CONNECTED]);
      return (
        <SshWorkspacePickerModal
          isOpen
          onClose={() => {}}
          connections={connections}
          onSelect={async () => {}}
          fetchTree={fetchTree}
          createDirectory={async () => {}}
          onTestConnection={async (connectionId) => {
            await onTestConnection(connectionId);
            setConnections((previous) => previous.map((item) => ({ ...item })));
          }}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(await screen.findByText('srv'));
    await waitFor(() => {
      expect((screen.getByLabelText('远端路径输入') as HTMLInputElement).value).toBe('/srv');
    });

    const testButton = (await screen.findByTestId(
      'ssh-picker-test-connection',
    )) as HTMLButtonElement;
    await waitFor(() => {
      expect(testButton.disabled).toBe(false);
    });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByTestId('ssh-picker-connection-notice').textContent).toContain('连接成功');
    });
    // 仍停留在 /srv：列表刷新只同步连接，不会把路径拉回根目录；
    // 测试连通后复读的也是当前路径（而不是 '/'）。
    expect((screen.getByLabelText('远端路径输入') as HTMLInputElement).value).toBe('/srv');
    expect(fetchTree.mock.calls.map(([, path]) => path)).toEqual(['/', '/srv', '/srv']);
  });
});
