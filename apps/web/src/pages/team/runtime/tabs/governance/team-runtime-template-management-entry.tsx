import { useState } from 'react';
import { NewTeamTemplateModal } from '../../shell/modals/NewTeamTemplateModal.js';
import { PANEL_INSET_STYLE, PRIMARY_BUTTON_STYLE } from './team-runtime-settings-panel-shared.js';

export function TemplateManagementEntry() {
  const [showModal, setShowModal] = useState(false);

  return (
    <div style={PANEL_INSET_STYLE}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>模板管理</strong>
      </header>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
        创建、编辑团队会话模板，方便快速复用已有配置。
      </span>
      <div>
        <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={() => setShowModal(true)}>
          📋 模板管理
        </button>
      </div>
      {showModal ? <NewTeamTemplateModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}
