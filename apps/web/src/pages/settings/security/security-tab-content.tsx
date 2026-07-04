import React from 'react';
import {
  AttributionConfigUI,
  DiagnosticCard,
  PermissionHistory,
  PermissionRulesEditor,
  TelemetryConsentDialog,
} from '@openAwork/shared-ui';
import type {
  AttributionConfig,
  PermissionDecisionRecord,
  PermissionRuleEntry,
  PermissionCategoryMeta,
} from '@openAwork/shared-ui';
import type { DevtoolsSourceState, SettingsDiagnosticRecord } from '../state/settings-types.js';
import { groupDiagnosticsByFile } from '../state/settings-derived.js';
import { BP, SS, ST, UV } from '../shared/settings-section-styles.js';
import { NotificationPreferencePanel } from './notification-preference-panel.js';
import { useTelemetry } from '../../../hooks/use-telemetry.js';

interface SecurityTabContentProps {
  permissions: PermissionDecisionRecord[];
  permissionCategories: PermissionCategoryMeta[];
  permissionRules: PermissionRuleEntry[];
  onPermissionRulesChange: (rules: PermissionRuleEntry[]) => void;
  permissionRulesSaving?: boolean;
  attribution: AttributionConfig;
  setAttribution: React.Dispatch<React.SetStateAction<AttributionConfig>>;
  diagnostics: SettingsDiagnosticRecord[];
  diagnosticsSource: DevtoolsSourceState;
}

export function SecurityTabContent({
  permissions,
  permissionCategories,
  permissionRules,
  onPermissionRulesChange,
  permissionRulesSaving,
  attribution,
  setAttribution,
  diagnostics,
  diagnosticsSource,
}: SecurityTabContentProps) {
  const [telemetryDialogOpen, setTelemetryDialogOpen] = React.useState(false);
  const telemetry = useTelemetry();
  const groupedDiagnostics = groupDiagnosticsByFile(diagnostics);

  return (
    <>
      <NotificationPreferencePanel />
      <section style={SS}>
        <h3 style={ST}>权限规则</h3>
        <div style={UV}>
          <PermissionRulesEditor
            categories={permissionCategories}
            rules={permissionRules}
            onChange={onPermissionRulesChange}
            saving={permissionRulesSaving}
          />
        </div>
      </section>
      <section style={SS}>
        <h3 style={ST}>权限记录</h3>
        <div style={UV}>
          <PermissionHistory decisions={permissions} onExport={() => undefined} />
        </div>
      </section>
      <section style={SS}>
        <h3 style={ST}>遥测授权</h3>
        <div style={{ ...UV, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12,
              color: telemetry.isTelemetryEnabled ? 'var(--accent)' : 'var(--fg-muted)',
            }}
          >
            {telemetry.isLoading
              ? '加载中…'
              : telemetry.isTelemetryEnabled
                ? '已启用匿名遥测'
                : '遥测未启用'}
          </span>
          <button type="button" style={BP} onClick={() => setTelemetryDialogOpen(true)}>
            配置遥测
          </button>
        </div>
        <TelemetryConsentDialog
          open={telemetryDialogOpen}
          onAccept={() => {
            void telemetry.updateConsent('accepted');
            setTelemetryDialogOpen(false);
          }}
          onDecline={() => {
            void telemetry.updateConsent('declined');
            setTelemetryDialogOpen(false);
          }}
        />
      </section>
      <section style={SS}>
        <h3 style={ST}>归因配置</h3>
        <div style={UV}>
          <AttributionConfigUI
            coAuthoredBy={attribution.coAuthoredBy}
            assistedBy={attribution.assistedBy}
            authorName={attribution.authorName}
            onChange={setAttribution}
          />
        </div>
      </section>
      <section style={SS}>
        <h3 style={ST}>诊断信息</h3>
        {diagnosticsSource.status === 'error' && diagnosticsSource.error ? (
          <div
            style={{
              ...UV,
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border-default))',
              background: 'color-mix(in srgb, var(--danger) 10%, var(--bg-overlay))',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
              诊断信息加载失败
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-default)', wordBreak: 'break-word' }}>
              {diagnosticsSource.error}
            </div>
          </div>
        ) : groupedDiagnostics.length > 0 ? (
          groupedDiagnostics.map((group) => (
            <div key={group.filePath} style={UV}>
              <DiagnosticCard filePath={group.filePath} diagnostics={group.diagnostics} />
            </div>
          ))
        ) : (
          <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>暂无诊断数据</p>
        )}
      </section>
    </>
  );
}
