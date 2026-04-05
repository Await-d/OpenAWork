import React from 'react';
import { BP, SS, ST } from './settings-section-styles.js';
import { useNotificationPreferences } from './use-notification-preferences.js';

const QUIET_BUTTON: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const ERROR_CARD: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--danger) 42%, var(--border))',
  background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export function NotificationPreferencePanel() {
  const {
    browserPermission,
    draft,
    isDirty,
    items,
    loadError,
    loading,
    resetPreferences,
    requestBrowserPermission,
    saveError,
    savePreferences,
    saving,
    togglePreference,
  } = useNotificationPreferences();

  return (
    <section style={SS}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={ST}>通知偏好</h3>
        <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
          站内通知中心始终保留全部提醒；这里控制的是页面不在前台时的浏览器提醒强度。
        </div>
      </div>

      <div
        style={{
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--bg-2) 78%, var(--surface))',
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>浏览器提醒授权</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
            {browserPermission === 'granted'
              ? '当前浏览器已允许本站发送系统提醒。'
              : browserPermission === 'denied'
                ? '浏览器已阻止本站发送系统提醒，请在站点权限中手动开启。'
                : browserPermission === 'unsupported'
                  ? '当前环境不支持浏览器 Notification API。'
                  : '如需后台提醒，请在这里显式授权浏览器通知。'}
          </div>
        </div>
        {browserPermission === 'default' ? (
          <button onClick={() => void requestBrowserPermission()} style={BP} type="button">
            启用浏览器提醒
          </button>
        ) : browserPermission === 'granted' ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--accent-text)',
              background: 'var(--accent)',
              borderRadius: 999,
              padding: '6px 10px',
              alignSelf: 'flex-start',
            }}
          >
            已授权
          </span>
        ) : null}
      </div>

      {loadError ? (
        <div style={ERROR_CARD}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
            通知偏好加载失败
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>
            {loadError}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {items.map((item) => {
          const enabled = draft[item.eventType];
          return (
            <label
              key={item.eventType}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                borderRadius: 14,
                border: enabled
                  ? '1px solid color-mix(in srgb, var(--accent) 45%, var(--border))'
                  : '1px solid var(--border)',
                background: enabled
                  ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))'
                  : 'color-mix(in srgb, var(--bg-2) 82%, var(--surface))',
                padding: '14px 16px',
                minHeight: 148,
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6 }}>
                    {item.description}
                  </div>
                </div>
                <span
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: enabled ? 'var(--accent-text)' : 'var(--text-3)',
                    background: enabled ? 'var(--accent)' : 'var(--bg-3)',
                    borderRadius: 999,
                    padding: '6px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {enabled ? '提醒中' : '静默'}
                </span>
              </div>

              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  仅在页面隐藏时触发浏览器 Notification API
                </div>
                <input
                  aria-label={item.label}
                  checked={enabled}
                  disabled={loading || saving}
                  onChange={() => togglePreference(item.eventType)}
                  style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  type="checkbox"
                />
              </div>
            </label>
          );
        })}
      </div>

      {saveError ? (
        <div style={ERROR_CARD}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>保存失败</div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-word' }}>
            {saveError}
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {loading ? '正在同步通知偏好…' : isDirty ? '有未保存的通知偏好变更' : '通知偏好已同步'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            disabled={!isDirty || saving}
            onClick={resetPreferences}
            style={QUIET_BUTTON}
            type="button"
          >
            撤销更改
          </button>
          <button
            disabled={loading || saving || !isDirty}
            onClick={() => void savePreferences()}
            style={BP}
            type="button"
          >
            {saving ? '保存中…' : '保存通知偏好'}
          </button>
        </div>
      </div>
    </section>
  );
}
