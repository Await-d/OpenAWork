import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ChannelPermissionsEntry } from './channel-subscription-settings.types.js';

type SecurityPermissionKey = Exclude<keyof ChannelPermissionsEntry, 'readablePathPrefixes'>;

/**
 * 目录选择入口的三种形态：不渲染 / 可用 / 禁用（带原因）。
 * 供调用方按 `resolveDirectoryPickerAvailability()` 的结果直接构造。
 */
export type ChannelDirectoryPickerEntry =
  | { readonly kind: 'enabled'; readonly onPick: () => void }
  | { readonly kind: 'disabled'; readonly reason: string };

export type ReadablePathValidation =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

/**
 * 校验「可读取路径前缀」：必须是绝对路径。
 *
 * 前缀是与真实文件路径做 `startsWith` 比较的，相对路径永远匹配不上任何绝对路径
 * ——存进去只会让用户以为"配了不生效"。这里拦在输入侧并给出可操作的原因；
 * 末尾分隔符按后端前缀口径去掉（根路径 `/` 保留）。
 */
export function validateReadablePathPrefix(raw: string): ReadablePathValidation {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: '请输入路径后再添加。' };
  }
  const isPosixAbsolute = trimmed.startsWith('/');
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(trimmed);
  // UNC 路径（双分隔符开头，如 Windows 的 UNC 共享）同样是绝对路径，别拒。
  const isUnc = /^[\\/]{2}[^\\/]/.test(trimmed);
  if (!isPosixAbsolute && !isWindowsAbsolute && !isUnc) {
    return {
      ok: false,
      reason:
        '需填绝对路径，例如 /srv/data、C:\\data 或 \\\\server\\share；‘C:’ 这种盘符相对路径不行。',
    };
  }
  const stripped = trimmed.replace(/[\\/]+$/, '');
  // 盘符根必须连同分隔符一起保留：后端用 `resolve(prefix)` 做前缀匹配，而
  // `resolve('C:')` 指的是「C 盘当前目录」（会跟着进程 cwd 走），不是盘根——归一成
  // `C:` 会把前缀静默放大到用户并没有选择的目录。
  const value = /^[A-Za-z]:$/.test(stripped)
    ? `${stripped}\\`
    : stripped.length > 0
      ? stripped
      : trimmed;
  return { ok: true, value };
}

const PERMISSION_OPTIONS: Array<{
  key: SecurityPermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'allowReadHome',
    label: '允许读取数据目录',
    description:
      '允许代理读取 OpenAWork 数据目录内的文件（会话库、产物、日志等）；不是进程用户家目录，~/.ssh 之类凭据不在可读范围。',
  },
  {
    key: 'allowWriteOutside',
    label: '允许工作区外写入',
    description: '允许代理修改会话工作区之外的文件；只放宽写，主机根与全局白名单仍不可写。',
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
  /** 新增路径的校验失败原因；为 null 表示当前无错误。 */
  readPathError?: string | null;
  onNewReadPathChange: (value: string) => void;
  onAddReadablePath: () => void;
  /**
   * 目录选择入口：
   *   - `undefined` —— 不渲染（纯 Web 没有原生对话框）；
   *   - `enabled` —— 点击弹系统目录选择器并加入白名单；
   *   - `disabled` —— 渲染禁用按钮 + `reason`（桌面端但通道未就绪 / 远程网关模式）。
   */
  directoryPicker?: ChannelDirectoryPickerEntry | undefined;
  /** 一键清掉历史遗留的相对路径（它们永远匹配不到任何文件）。 */
  onRemoveInvalidReadPaths?: (() => void) | undefined;
  onReadPathKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onBooleanPermissionChange: (key: SecurityPermissionKey, value: boolean) => void;
  onReadablePathPrefixesChange: (value: string[]) => void;
}

export function ChannelSecuritySection({
  permissions,
  newReadPath,
  readPathError = null,
  onNewReadPathChange,
  onAddReadablePath,
  directoryPicker,
  onRemoveInvalidReadPaths,
  onReadPathKeyDown,
  onBooleanPermissionChange,
  onReadablePathPrefixesChange,
}: ChannelSecuritySectionProps) {
  // 历史体检：相对路径存进白名单后永远匹配不到绝对文件路径（前缀比较），
  // 用户只会看到「配了不生效」，所以逐条标出来并提供一键清理。
  const invalidPrefixes = permissions.readablePathPrefixes.filter(
    (prefix) => !validateReadablePathPrefix(prefix).ok,
  );
  // 输入过程中的实时提示：格式不对时当场标出，而不是等点了「添加路径」才报错。
  const trimmedNewReadPath = newReadPath.trim();
  const liveValidation =
    trimmedNewReadPath.length === 0 ? null : validateReadablePathPrefix(trimmedNewReadPath);
  const liveInvalidReason =
    liveValidation !== null && !liveValidation.ok ? liveValidation.reason : null;
  const canSubmitReadPath = trimmedNewReadPath.length > 0 && liveInvalidReason === null;

  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">安全边界</h4>
          <div className="channel-muted">
            把工具权限显式写进通道配置，在执行链路中做强约束。路径类放宽只作用于「会话工作区之外」：
            通道会话未绑定工作目录时，边界是默认工作目录（Documents/OpenAWork）；已绑定则用绑定的目录。
            主机根与全局白名单永不放宽。
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
            按绝对路径前缀放宽**读**（不影响写）。未开启“允许读取数据目录”时，可用它补充精确白名单。
          </div>
          <div className="channel-path-entry">
            <input
              value={newReadPath}
              onChange={(event) => onNewReadPathChange(event.target.value)}
              onKeyDown={onReadPathKeyDown}
              placeholder="/srv/data 或 C:\\data"
              aria-invalid={liveInvalidReason !== null || readPathError !== null}
              aria-describedby={
                liveInvalidReason !== null || readPathError !== null
                  ? 'channel-read-path-error'
                  : undefined
              }
            />
            <button
              type="button"
              className="channel-button channel-button--ghost"
              disabled={!canSubmitReadPath}
              onClick={onAddReadablePath}
            >
              添加路径
            </button>
            {directoryPicker ? (
              <button
                type="button"
                className="channel-button channel-button--ghost"
                disabled={directoryPicker.kind === 'disabled'}
                title={directoryPicker.kind === 'disabled' ? directoryPicker.reason : undefined}
                onClick={directoryPicker.kind === 'enabled' ? directoryPicker.onPick : undefined}
              >
                选择目录…
              </button>
            ) : null}
          </div>
          {directoryPicker?.kind === 'disabled' ? (
            <div className="channel-field__hint">{directoryPicker.reason}</div>
          ) : null}
          {liveInvalidReason !== null || readPathError !== null ? (
            <div id="channel-read-path-error" className="channel-notice">
              {liveInvalidReason ?? readPathError}
            </div>
          ) : null}
          {invalidPrefixes.length > 0 ? (
            <div className="channel-notice">
              有 {invalidPrefixes.length}{' '}
              条历史路径不是绝对路径，永远匹配不到文件；建议改用绝对路径。
              {onRemoveInvalidReadPaths ? (
                <button
                  type="button"
                  className="channel-button channel-button--ghost"
                  onClick={onRemoveInvalidReadPaths}
                >
                  移除无效项
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="channel-path-list">
            {permissions.readablePathPrefixes.length === 0 ? (
              <span className="channel-mini-badge">暂未设置路径白名单</span>
            ) : (
              permissions.readablePathPrefixes.map((prefix) => {
                const invalid = !validateReadablePathPrefix(prefix).ok;
                return (
                  <span
                    key={prefix}
                    className="channel-path-pill"
                    title={invalid ? '不是绝对路径，永远不会匹配到文件' : undefined}
                  >
                    {prefix}
                    {invalid ? (
                      <span style={{ color: 'var(--danger, #d9534f)' }}>（相对路径，不生效）</span>
                    ) : null}
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
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
