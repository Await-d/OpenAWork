import {
  ChannelMemberAclEditor,
  validateMemberAclDocumentForSave,
} from './ChannelMemberAclEditor.js';
import type {
  ChannelDescriptorField,
  ChannelDescriptorTool,
  ChannelPermissionsEntry,
} from './channel-subscription-settings.types.js';

interface ChannelAccessConfigSectionProps {
  configSchema: readonly ChannelDescriptorField[];
  config: Record<string, string>;
  visibleSecrets: Record<string, boolean>;
  onToggleSecret: (fieldKey: string) => void;
  onConfigChange: (key: string, value: string) => void;
  toolOptions: readonly ChannelDescriptorTool[];
  permissions: ChannelPermissionsEntry;
}

function parseBooleanConfig(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function ChannelAccessConfigSection({
  configSchema,
  config,
  visibleSecrets,
  onToggleSecret,
  onConfigChange,
  toolOptions,
  permissions,
}: ChannelAccessConfigSectionProps) {
  const genericFields = configSchema.filter(
    (field) => field.key !== 'memberAclJson' && field.key !== 'requireMentionInGroup',
  );
  const mentionField = configSchema.find((field) => field.key === 'requireMentionInGroup');
  const memberAclField = configSchema.find((field) => field.key === 'memberAclJson');
  const memberAclValue = memberAclField ? (config[memberAclField.key] ?? '') : '';
  const memberAclReadyToSave = validateMemberAclDocumentForSave(memberAclValue);

  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">接入参数</h4>
          <div className="channel-muted">
            字段由 Gateway 的渠道描述符下发，和实际后端实现保持一致。
          </div>
        </div>
      </div>
      <div className="channel-section__body" style={{ display: 'grid', gap: 16 }}>
        {genericFields.length > 0 ? (
          <div className="channel-grid-fields">
            {genericFields.map((field) => (
              <div key={field.key} className="channel-field">
                <div className="channel-field__label">
                  {field.label}
                  {field.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                </div>
                {field.description ? (
                  <div className="channel-field__hint">{field.description}</div>
                ) : null}
                <div className="channel-field__input-wrap">
                  <input
                    type={
                      field.type === 'secret' && !visibleSecrets[field.key] ? 'password' : 'text'
                    }
                    value={config[field.key] ?? ''}
                    onChange={(event) => onConfigChange(field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                  {field.type === 'secret' ? (
                    <button
                      type="button"
                      className="channel-field__secret-toggle"
                      onClick={() => onToggleSecret(field.key)}
                    >
                      {visibleSecrets[field.key] ? '隐藏' : '显示'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {mentionField ? (
          <div className="channel-inline-panel">
            <div className="channel-field__label">群消息触发策略</div>
            {mentionField.description ? (
              <div className="channel-field__hint">{mentionField.description}</div>
            ) : null}
            <label className="channel-tool-gate channel-tool-gate--compact">
              <input
                type="checkbox"
                checked={parseBooleanConfig(config[mentionField.key])}
                onChange={(event) =>
                  onConfigChange(mentionField.key, event.target.checked ? 'true' : '')
                }
              />
              <div>
                <div className="channel-check-card__title">仅在明确 @ 机器人时触发</div>
                <div className="channel-check-card__desc">
                  适合群聊、频道或多人会话场景，减少无关消息误触发。
                </div>
              </div>
            </label>
          </div>
        ) : null}

        {memberAclField ? (
          <div className="channel-inline-panel">
            <div className="channel-field__label">群成员访问控制</div>
            <div className="channel-field__hint">
              {memberAclField.description ??
                '为指定 senderId 单独收紧或放开回复、搜索、文件与 Shell 能力。'}
            </div>
            <ChannelMemberAclEditor
              value={memberAclValue}
              onChange={(nextValue) => onConfigChange(memberAclField.key, nextValue)}
              toolOptions={toolOptions}
              basePermissions={permissions}
            />
            {memberAclValue.trim().length > 0 && !memberAclReadyToSave ? (
              <div className="channel-notice channel-notice--neutral">
                当前 ACL 仍有未完成规则或字段格式错误，请先补齐每条成员的 senderId 再保存。
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
