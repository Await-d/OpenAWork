import React from 'react';
import {
  AttributionConfigUI,
  DiagnosticCard,
  PermissionHistory,
  TelemetryConsentDialog,
} from '@openAwork/shared-ui';
import type { AttributionConfig, PermissionDecisionRecord } from '@openAwork/shared-ui';
import type { DevtoolsSourceState, SettingsDiagnosticRecord } from '../settings-types.js';
import { groupDiagnosticsByFile } from '../settings-derived.js';
import { BP, SS, ST, UV } from './settings-section-styles.js';
import { NotificationPreferencePanel } from './notification-preference-panel.js';

interface SecurityTabContentProps {
  permissions: PermissionDecisionRecord[];
  attribution: AttributionConfig;
  setAttribution: React.Dispatch<React.SetStateAction<AttributionConfig>>;
  diagnostics: SettingsDiagnosticRecord[];
  diagnosticsSource: DevtoolsSourceState;
}

export function SecurityTabContent({
  permissions,
  attribution,
  setAttribution,
  diagnostics,
  diagnosticsSource,
}: SecurityTabContentProps) {
  const [telemetryDialogOpen, setTelemetryDialogOpen] = React.useState(false);
  const groupedDiagnostics = groupDiagnosticsByFile(diagnostics);

  return (
    <>
      <NotificationPreferencePanel />
      <section style={SS}>
        <h3 style={ST}>权限记录</h3>
        <div style={UV}>
          <PermissionHistory decisions={permissions} onExport={() => undefined} />
        </div>
      </section>
      <section style={SS}>
        <h3 style={ST}>遥测授权</h3>
        <button type="button" style={BP} onClick={() => setTelemetryDialogOpen(true)}>
          配置遥测
        </button>
        <TelemetryConsentDialog
          open={telemetryDialogOpen}
          onAccept={() => {
            localStorage.setItem('telemetry_consent_shown', '1');
            setTelemetryDialogOpen(false);
          }}
          onDecline={() => {
            localStorage.setItem('telemetry_consent_shown', '0');
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
              border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border))',
              background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
              诊断信息加载失败
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>
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
          <p style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无诊断数据</p>
        )}
      </section>
    </>
  );
}
