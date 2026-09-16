// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SshConnectionCreateForm, {
  resolveSshConnectionDraft,
  type SshConnectionDraft,
  type SshConnectionFormValues,
} from './SshConnectionCreateForm.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BASE_VALUES: SshConnectionFormValues = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
};

describe('resolveSshConnectionDraft', () => {
  it('名称留空时回落到主机地址', () => {
    expect(
      resolveSshConnectionDraft({
        ...BASE_VALUES,
        host: ' 10.0.0.2 ',
        username: 'deploy',
        password: 'secret',
      }),
    ).toEqual({
      draft: {
        name: '10.0.0.2',
        host: '10.0.0.2',
        port: 22,
        username: 'deploy',
        authType: 'password',
        password: 'secret',
      },
    });
  });

  it('缺少主机 / 用户名或端口非法时返回错误', () => {
    expect(
      resolveSshConnectionDraft({ ...BASE_VALUES, username: 'deploy', password: 'x' }),
    ).toEqual({ error: '请填写主机地址' });
    expect(resolveSshConnectionDraft({ ...BASE_VALUES, host: 'h', password: 'x' })).toEqual({
      error: '请填写用户名',
    });
    expect(
      resolveSshConnectionDraft({
        ...BASE_VALUES,
        host: 'h',
        username: 'u',
        port: '70000',
        password: 'x',
      }),
    ).toEqual({ error: '端口需为 1-65535 之间的整数' });
  });

  it('密码认证缺密码、私钥认证缺路径时返回错误', () => {
    expect(resolveSshConnectionDraft({ ...BASE_VALUES, host: 'h', username: 'u' })).toEqual({
      error: '请填写密码，或改用私钥文件 / SSH Agent 认证',
    });
    expect(
      resolveSshConnectionDraft({ ...BASE_VALUES, host: 'h', username: 'u', authType: 'key' }),
    ).toEqual({ error: '请填写私钥文件路径' });
  });

  it('Agent 认证不携带密码与私钥字段', () => {
    expect(
      resolveSshConnectionDraft({
        ...BASE_VALUES,
        host: 'h',
        username: 'u',
        authType: 'agent',
        password: 'ignored',
        privateKeyPath: '/tmp/key',
      }),
    ).toEqual({ draft: { name: 'h', host: 'h', port: 22, username: 'u', authType: 'agent' } });
  });

  it('passwordOptional 时密码留空返回不含 password 的草稿（沿用已保存凭据）', () => {
    expect(
      resolveSshConnectionDraft(
        { ...BASE_VALUES, host: 'h', username: 'u' },
        {
          passwordOptional: true,
        },
      ),
    ).toEqual({ draft: { name: 'h', host: 'h', port: 22, username: 'u', authType: 'password' } });
  });
});

describe('SshConnectionCreateForm', () => {
  it('填写完整信息后提交归一化的连接草稿', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SshConnectionCreateForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('连接名称'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: '10.0.0.2' } });
    fireEvent.change(screen.getByLabelText('端口'), { target: { value: '2222' } });
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'deploy' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'p@ss' } });
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'prod',
        host: '10.0.0.2',
        port: 2222,
        username: 'deploy',
        authType: 'password',
        password: 'p@ss',
      });
    });
  });

  it('校验失败时就地提示且不提交', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SshConnectionCreateForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-connection-create-error').textContent).toContain(
        '请填写主机地址',
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('切换到私钥认证后改为展示私钥路径输入', () => {
    render(<SshConnectionCreateForm onSubmit={async () => {}} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('认证方式'), { target: { value: 'key' } });

    expect(screen.getByLabelText('私钥文件路径')).toBeTruthy();
    expect(screen.queryByLabelText('密码')).toBeNull();
  });

  it('保存失败时就地展示错误信息', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('保存 SSH 连接失败：主机不可达');
    });
    render(<SshConnectionCreateForm onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('主机地址'), { target: { value: '10.0.0.2' } });
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'deploy' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'p@ss' } });
    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-connection-create-error').textContent).toContain('主机不可达');
    });
  });

  it('编辑模式回填初始值、允许密码留空并展示编辑态文案', async () => {
    const onSubmit = vi.fn(async (_draft: SshConnectionDraft) => undefined);
    render(
      <SshConnectionCreateForm
        mode="edit"
        initialValues={{
          name: 'alpha',
          host: '10.0.0.1',
          port: '2222',
          username: 'deploy',
          authType: 'password',
        }}
        passwordOptional
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText('编辑 SSH 连接配置')).toBeTruthy();
    expect((screen.getByLabelText('连接名称') as HTMLInputElement).value).toBe('alpha');
    expect((screen.getByLabelText('主机地址') as HTMLInputElement).value).toBe('10.0.0.1');
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('密码（留空则不修改）')).toBeTruthy();

    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'alpha',
        host: '10.0.0.1',
        port: 2222,
        username: 'deploy',
        authType: 'password',
      });
    });
  });

  it('编辑但未保存过凭据时仍要求填写密码', async () => {
    const onSubmit = vi.fn(async (_draft: SshConnectionDraft) => undefined);
    render(
      <SshConnectionCreateForm
        mode="edit"
        initialValues={{ host: '10.0.0.1', username: 'deploy', authType: 'password' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('ssh-connection-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('ssh-connection-create-error').textContent).toContain('请填写密码');
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
