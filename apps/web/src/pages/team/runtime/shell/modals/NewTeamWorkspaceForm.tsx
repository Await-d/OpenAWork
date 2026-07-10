import { XIcon } from '../../shared/TeamIcons.js';
import { NewTeamWorkspaceTemplateSection } from './NewTeamWorkspaceTemplateSection.js';
import type { WorkspaceAgentTemplatesState } from './use-new-team-workspace-agent-templates.js';
import {
  ACTIONS_ROW_STYLE,
  ERROR_STYLE,
  FIELD_ERROR_STYLE,
  FIELD_STYLE,
  FORM_HEADER_STYLE,
  FORM_PANE_STYLE,
  HEADER_DESC_STYLE,
  HEADER_TITLE_STYLE,
  HINT_STYLE,
  INPUT_ERROR_STYLE,
  INPUT_STYLE,
  LABEL_STYLE,
  PRIMARY_BUTTON_STYLE,
  SECONDARY_BUTTON_STYLE,
  TEXTAREA_STYLE,
} from './new-team-workspace-modal-config.js';

const DIRECTORY_PICKER_BUTTON_STYLE: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--accent-border)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--spacing-1)',
  flexShrink: 0,
};

interface NewTeamWorkspaceFormProps {
  readonly canSubmit: boolean;
  readonly defaultWorkingRoot: string;
  readonly description: string;
  readonly error: string | null;
  readonly name: string;
  readonly nameError: string | null;
  readonly submitting: boolean;
  readonly templates: WorkspaceAgentTemplatesState;
  readonly onClose: () => void;
  readonly onDefaultWorkingRootChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onNameChange: (value: string) => void;
  readonly onOpenPicker: () => void;
  readonly onSubmit: () => void;
}

export function NewTeamWorkspaceForm({
  canSubmit,
  defaultWorkingRoot,
  description,
  error,
  name,
  nameError,
  submitting,
  templates,
  onClose,
  onDefaultWorkingRootChange,
  onDescriptionChange,
  onNameChange,
  onOpenPicker,
  onSubmit,
}: NewTeamWorkspaceFormProps) {
  return (
    <div style={FORM_PANE_STYLE}>
      <div style={FORM_HEADER_STYLE}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="new-ws-title" style={HEADER_TITLE_STYLE}>
            填写工作区信息
          </div>
          <div style={HEADER_DESC_STYLE}>提交后立即生效，可在工作区列表中查看与切换。</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--fg-muted)',
            padding: 'var(--spacing-1)',
            cursor: 'pointer',
            display: 'inline-flex',
            borderRadius: 'var(--radius-xs)',
            flexShrink: 0,
          }}
          className="new-team-workspace-modal__icon-button"
        >
          <XIcon size={14} color="var(--fg-muted)" />
        </button>
      </div>

      <div style={FIELD_STYLE}>
        <label htmlFor="new-ws-name" style={LABEL_STYLE}>
          名称 <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          id="new-ws-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="例如：AILinkMarket"
          style={nameError ? INPUT_ERROR_STYLE : INPUT_STYLE}
          autoFocus
          maxLength={80}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? 'new-ws-name-error' : undefined}
        />
        {nameError ? (
          <span id="new-ws-name-error" style={FIELD_ERROR_STYLE} role="alert">
            <svg
              aria-hidden="true"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {nameError}
          </span>
        ) : (
          <span style={HINT_STYLE}>会显示在顶部切换器和会话列表头部。</span>
        )}
      </div>

      <div style={FIELD_STYLE}>
        <label htmlFor="new-ws-desc" style={LABEL_STYLE}>
          描述
        </label>
        <textarea
          id="new-ws-desc"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="一句话说明这个工作区的用途（可选）"
          style={TEXTAREA_STYLE}
          maxLength={300}
        />
      </div>

      <div style={FIELD_STYLE}>
        <label htmlFor="new-ws-root" style={LABEL_STYLE}>
          默认工作目录
        </label>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
          <input
            id="new-ws-root"
            type="text"
            value={defaultWorkingRoot}
            onChange={(event) => onDefaultWorkingRootChange(event.target.value)}
            placeholder="选择或输入项目根目录（可选）"
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            onClick={onOpenPicker}
            style={DIRECTORY_PICKER_BUTTON_STYLE}
            className="new-team-workspace-modal__directory-button"
            title="从工作区列表选择"
            aria-label="从工作区列表选择目录"
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>浏览</span>
          </button>
        </div>
        <span style={HINT_STYLE}>
          c/d/e
          派生的会话将默认绑定此目录；可在创建会话时单独覆盖。选择后会自动用文件夹名作为工作区名称。
        </span>
      </div>

      <NewTeamWorkspaceTemplateSection
        error={templates.error}
        loading={templates.loading}
        selectedTemplateIds={templates.selectedTemplateIds}
        templates={templates.templates}
        onToggleTemplate={templates.toggleTemplate}
      />

      {error ? (
        <div role="alert" style={ERROR_STYLE}>
          {error}
        </div>
      ) : null}

      <div style={ACTIONS_ROW_STYLE}>
        <button
          type="button"
          onClick={onClose}
          style={SECONDARY_BUTTON_STYLE}
          className="new-team-workspace-modal__secondary-button"
          disabled={submitting}
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSubmit}
          style={{
            ...PRIMARY_BUTTON_STYLE,
            opacity: canSubmit ? 1 : 0.6,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
          className="new-team-workspace-modal__primary-button"
          disabled={!canSubmit}
        >
          {submitting ? (
            '创建中…'
          ) : (
            <>
              <svg
                aria-hidden="true"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              创建工作区
            </>
          )}
        </button>
      </div>
    </div>
  );
}
