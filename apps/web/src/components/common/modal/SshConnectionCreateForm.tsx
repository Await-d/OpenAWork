/**
 * SshConnectionCreateForm — 在「选择 SSH 远端工作区」弹窗内新建 / 编辑 SSH 连接。
 *
 * 字段与网关的 `connectionCreateSchema` / `connectionUpdateSchema` 对齐：
 * name / host / port / username / authType / password / privateKeyPath。
 * 提交后连接会持久化到网关的 SSH 连接表，下次打开弹窗或输入框上方的
 * 工作区菜单即可直接选择复用，无需再去设置页重复录入。
 *
 * 编辑模式下密码留空表示沿用已保存的凭据（网关 patch 语义：未提供的字段保持原值）。
 */

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { SSHAuthType } from '@openAwork/web-client';

export interface SshConnectionDraft {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SSHAuthType;
  password?: string;
  privateKeyPath?: string;
}

export interface SshConnectionCreateFormProps {
  /** 提交并持久化；抛错时表单就地展示错误，成功后由父组件关闭表单。 */
  onSubmit: (draft: SshConnectionDraft) => Promise<void>;
  onCancel: () => void;
  /** 外部动作（如浏览远端目录）进行中时禁用交互。 */
  busy?: boolean;
  /** 新建（默认）或编辑已有连接：影响标题、说明与提交按钮文案。 */
  mode?: 'create' | 'edit';
  /** 编辑模式下的回填值；由父组件按选中的连接构造。 */
  initialValues?: Partial<SshConnectionFormValues>;
  /**
   * 密码留空是否允许提交（编辑且已保存凭据时为 true）：
   * 允许时留空表示沿用网关侧已保存的凭据，不会清空。
   */
  passwordOptional?: boolean;
}

/** 表单原始输入（全部为字符串，便于做逐项校验）。 */
export interface SshConnectionFormValues {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: SSHAuthType;
  password: string;
  privateKeyPath: string;
}

const AUTH_TYPE_OPTIONS: Array<{ value: SSHAuthType; label: string }> = [
  { value: 'password', label: '密码' },
  { value: 'key', label: '私钥文件' },
  { value: 'agent', label: 'SSH Agent' },
];

const INITIAL_VALUES: SshConnectionFormValues = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
};

/**
 * 校验并归一化表单输入。返回 `{ error }` 或 `{ draft }`，纯函数便于单测。
 * 名称留空时回落到主机地址——网关的 `name` 为必填且长度至少为 1。
 * `passwordOptional` 为 true（编辑且已保存凭据）时，密码留空返回不含 password
 * 的草稿，网关按「未提供即保留」处理，不会清空已保存的凭据。
 */
export function resolveSshConnectionDraft(
  values: SshConnectionFormValues,
  options: { passwordOptional?: boolean } = {},
): { error: string } | { draft: SshConnectionDraft } {
  const host = values.host.trim();
  if (!host) {
    return { error: '请填写主机地址' };
  }

  const username = values.username.trim();
  if (!username) {
    return { error: '请填写用户名' };
  }

  const port = Number.parseInt(values.port.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { error: '端口需为 1-65535 之间的整数' };
  }

  const name = values.name.trim() || host;

  if (values.authType === 'password') {
    if (!values.password) {
      if (!options.passwordOptional) {
        return { error: '请填写密码，或改用私钥文件 / SSH Agent 认证' };
      }
      return { draft: { name, host, port, username, authType: 'password' } };
    }
    return {
      draft: { name, host, port, username, authType: 'password', password: values.password },
    };
  }

  if (values.authType === 'key') {
    const privateKeyPath = values.privateKeyPath.trim();
    if (!privateKeyPath) {
      return { error: '请填写私钥文件路径' };
    }
    return { draft: { name, host, port, username, authType: 'key', privateKeyPath } };
  }

  return { draft: { name, host, port, username, authType: 'agent' } };
}

const FIELD_STYLE: CSSProperties = {
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  padding: '0 10px',
  outline: 'none',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};

const LABEL_TEXT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-muted)',
  fontWeight: 500,
};

const FIELD_WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
};

export default function SshConnectionCreateForm({
  onSubmit,
  onCancel,
  busy = false,
  mode = 'create',
  initialValues,
  passwordOptional = false,
}: SshConnectionCreateFormProps) {
  const [values, setValues] = useState<SshConnectionFormValues>(() => ({
    ...INITIAL_VALUES,
    ...initialValues,
  }));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isEdit = mode === 'edit';

  const disabled = busy || submitting;

  function patchValues(patch: Partial<SshConnectionFormValues>): void {
    setValues((previous) => ({ ...previous, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const resolved = resolveSshConnectionDraft(values, { passwordOptional });
    if ('error' in resolved) {
      setError(resolved.error);
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(resolved.draft);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : isEdit ? '更新 SSH 连接失败' : '保存 SSH 连接失败',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      data-testid="ssh-connection-create-form"
      data-mode={mode}
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid var(--accent-border)',
        background: 'color-mix(in srgb, var(--accent-subtle) 40%, var(--bg-overlay))',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, color: 'var(--fg-strong)', fontWeight: 600 }}>
          {isEdit ? '编辑 SSH 连接配置' : '新建 SSH 连接'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          {isEdit
            ? '修改会直接写回网关的 SSH 连接表；密码留空表示沿用已保存的凭据。'
            : '保存后会写入网关的 SSH 连接表，下次可直接选择使用，无需重复录入。'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...FIELD_WRAP_STYLE, flex: '1 1 220px' }}>
          <span style={LABEL_TEXT_STYLE}>名称（可选）</span>
          <input
            type="text"
            className="ssh-picker-input"
            aria-label="连接名称"
            placeholder="留空则使用主机地址"
            value={values.name}
            onChange={(event) => patchValues({ name: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            style={FIELD_STYLE}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...FIELD_WRAP_STYLE, flex: '1 1 220px' }}>
          <span style={LABEL_TEXT_STYLE}>主机地址 *</span>
          <input
            type="text"
            className="ssh-picker-input"
            aria-label="主机地址"
            placeholder="例如：10.0.0.2 或 dev.example.com"
            value={values.host}
            onChange={(event) => patchValues({ host: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            style={FIELD_STYLE}
          />
        </label>
        <label style={{ ...FIELD_WRAP_STYLE, flex: '0 1 120px' }}>
          <span style={LABEL_TEXT_STYLE}>端口 *</span>
          <input
            type="text"
            inputMode="numeric"
            className="ssh-picker-input"
            aria-label="端口"
            placeholder="22"
            value={values.port}
            onChange={(event) => patchValues({ port: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            style={FIELD_STYLE}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...FIELD_WRAP_STYLE, flex: '1 1 220px' }}>
          <span style={LABEL_TEXT_STYLE}>用户名 *</span>
          <input
            type="text"
            className="ssh-picker-input"
            aria-label="用户名"
            placeholder="例如：deploy"
            value={values.username}
            onChange={(event) => patchValues({ username: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            style={FIELD_STYLE}
          />
        </label>
        <label style={{ ...FIELD_WRAP_STYLE, flex: '0 1 160px' }}>
          <span style={LABEL_TEXT_STYLE}>认证方式</span>
          <select
            className="ssh-picker-select"
            aria-label="认证方式"
            value={values.authType}
            onChange={(event) => {
              patchValues({ authType: event.currentTarget.value as SSHAuthType });
            }}
            disabled={disabled}
            style={FIELD_STYLE}
          >
            {AUTH_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {values.authType === 'password' && (
        <label style={FIELD_WRAP_STYLE}>
          <span style={LABEL_TEXT_STYLE}>
            {isEdit && passwordOptional ? '密码（留空则不修改）' : '密码 *'}
          </span>
          <input
            type="password"
            className="ssh-picker-input"
            aria-label="密码"
            placeholder={
              isEdit && passwordOptional
                ? '留空表示沿用已保存的凭据'
                : '仅在网关侧加密保存，前端不回显'
            }
            value={values.password}
            onChange={(event) => patchValues({ password: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="new-password"
            style={FIELD_STYLE}
          />
        </label>
      )}

      {values.authType === 'key' && (
        <label style={FIELD_WRAP_STYLE}>
          <span style={LABEL_TEXT_STYLE}>私钥文件路径 *</span>
          <input
            type="text"
            className="ssh-picker-input"
            aria-label="私钥文件路径"
            placeholder="例如：/home/you/.ssh/id_ed25519"
            value={values.privateKeyPath}
            onChange={(event) => patchValues({ privateKeyPath: event.currentTarget.value })}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            style={FIELD_STYLE}
          />
        </label>
      )}

      {values.authType === 'agent' && (
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', lineHeight: 1.5 }}>
          使用网关所在机器的 ssh-agent 完成认证，请确认密钥已加入 agent。
        </span>
      )}

      {error && (
        <span
          data-testid="ssh-connection-create-error"
          style={{ fontSize: 11, color: 'var(--danger)' }}
        >
          {error}
        </span>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
          className="ssh-picker-action"
          disabled={disabled}
          style={{
            height: 32,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--border-default)',
            background: 'transparent',
            color: 'var(--fg-muted)',
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          取消
        </button>
        <button
          type="submit"
          data-testid="ssh-connection-create-submit"
          className="ssh-picker-action"
          disabled={disabled}
          style={{
            height: 32,
            padding: '0 14px',
            borderRadius: 8,
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            fontSize: 12,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {submitting ? '保存中…' : isEdit ? '保存修改' : '保存并连接'}
        </button>
      </div>
    </form>
  );
}
