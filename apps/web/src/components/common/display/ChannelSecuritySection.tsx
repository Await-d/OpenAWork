import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ChannelPermissionsEntry } from './channel-subscription-settings.types.js';

type SecurityPermissionKey = Exclude<keyof ChannelPermissionsEntry, 'readablePathPrefixes'>;

const PERMISSION_OPTIONS: Array<{
  key: SecurityPermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'allowReadHome',
    label: '允许读取 Home',
    description: '允许代理读取用户目录内的文件。',
  },
  {
    key: 'allowWriteOutside',
    label: '允许工作区外写入',
    description: '允许代理修改工作区之外的文件。',
  },
  {
    key: 'allowShell',
    label: '允许 Shell',
    description: '允许代理运行终端命令与脚本。',
  },
  {
    key: 'allowSubAgents',
    label: '允许子代理',
    description: '允许代理继续派生子任务协作执行。',
  },
];

interface ChannelSecuritySectionProps {
  permissions: ChannelPermissionsEntry;
  newReadPath: string;
  onNewReadPathChange: (value: string) => void;
  onAddReadablePath: () => void;
  onReadPathKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBooleanPermissionChange: (key: SecurityPermissionKey, value: boolean) => void;
  onReadablePathPrefixesChange: (value: string[]) => void;
}

export function ChannelSecuritySection({
  permissions,
  newReadPath,
  onNewReadPathChange,
  onAddReadablePath,
  onReadPathKeyDown,
  onBooleanPermissionChange,
  onReadablePathPrefixesChange,
}: ChannelSecuritySectionProps) {
  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">安全边界</h4>
          <div className="channel-muted">
            把工具权限显式写进通道配置，便于后续在执行链路中做强约束。
          </div>
        </div>
      </div>
      <div className="channel-section__body" style={{ display: 'grid', gap: 14 }}>
        <div className="channel-tool-grid">
          {PERMISSION_OPTIONS.map((option) => (
            <label key={option.key} className="channel-check-card">
              <input
                type="checkbox"
                checked={Boolean(permissions[option.key])}
                onChange={(event) => onBooleanPermissionChange(option.key, event.target.checked)}
              />
              <div>
                <div className="channel-check-card__title">{option.label}</div>
                <div className="channel-check-card__desc">{option.description}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="channel-field">
          <div className="channel-field__label">可读取路径前缀</div>
          <div className="channel-field__hint">
            当未开启“允许读取 Home”时，可通过这里补充精确白名单路径。
          </div>
          <div className="channel-path-entry">
            <input
              value={newReadPath}
              onChange={(event) => onNewReadPathChange(event.target.value)}
              onKeyDown={onReadPathKeyDown}
              placeholder="/workspace 或 /home/user/project"
            />
            <button
              type="button"
              className="channel-button channel-button--ghost"
              onClick={onAddReadablePath}
            >
              添加路径
            </button>
          </div>
          <div className="channel-path-list">
            {permissions.readablePathPrefixes.length === 0 ? (
              <span className="channel-mini-badge">暂未设置路径白名单</span>
            ) : (
              permissions.readablePathPrefixes.map((prefix) => (
                <span key={prefix} className="channel-path-pill">
                  {prefix}
                  <button
                    type="button"
                    onClick={() =>
                      onReadablePathPrefixesChange(
                        permissions.readablePathPrefixes.filter((item) => item !== prefix),
                      )
                    }
                  >
                    移除
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
