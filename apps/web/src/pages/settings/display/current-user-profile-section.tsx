import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  getCurrentUserDisplayName,
  useCurrentUserProfileStore,
} from '../../../stores/user-profile/current-user-profile.js';

const SECTION_CARD: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 16,
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
};

const SECTION_HEADER: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--fg-strong)',
  marginBottom: 16,
  letterSpacing: '-0.01em',
};

const FIELD_LABEL_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fg-strong)',
};

const FIELD_HINT_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  padding: '0 12px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  border: '1px solid var(--accent)',
  background: 'var(--accent-subtle)',
  color: 'var(--accent)',
  borderRadius: 8,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  border: '1px solid var(--border-default)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  borderRadius: 8,
  padding: '10px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 100ms cubic-bezier(0.4, 0, 0.2, 1)',
};

function buildSyncStatusLabel(syncStatus: string): string {
  if (syncStatus === 'loading') {
    return '正在读取远端昵称…';
  }
  if (syncStatus === 'saving') {
    return '正在保存昵称…';
  }
  if (syncStatus === 'error') {
    return '昵称同步失败';
  }
  if (syncStatus === 'synced') {
    return '昵称已同步';
  }
  return '尚未同步';
}

export function CurrentUserProfileSection() {
  const email = useAuthStore((state) => state.email) ?? '';
  const nickname = useCurrentUserProfileStore((state) => state.nickname);
  const syncStatus = useCurrentUserProfileStore((state) => state.syncStatus);
  const errorMessage = useCurrentUserProfileStore((state) => state.errorMessage);
  const saveNickname = useCurrentUserProfileStore((state) => state.saveNickname);
  const [draftNickname, setDraftNickname] = useState(nickname ?? '');

  useEffect(() => {
    setDraftNickname(nickname ?? '');
  }, [nickname]);

  const normalizedDraft = useMemo(() => {
    const trimmed = draftNickname.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [draftNickname]);

  const currentDisplayName = useMemo(
    () =>
      getCurrentUserDisplayName({
        email,
        nickname: normalizedDraft,
      }),
    [email, normalizedDraft],
  );

  const unchanged = (nickname ?? null) === normalizedDraft;
  const saving = syncStatus === 'saving';
  const canSave = email.length > 0 && !saving && !unchanged;

  const handleSave = async () => {
    if (!canSave) {
      return;
    }

    await saveNickname(normalizedDraft);
  };

  const handleReset = async () => {
    setDraftNickname('');
    await saveNickname(null);
  };

  return (
    <section style={SECTION_CARD}>
      <h3 style={SECTION_HEADER}>身份展示</h3>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={FIELD_LABEL_STYLE}>当前账号</span>
          <span style={FIELD_HINT_STYLE}>{email || '未登录'}</span>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <label htmlFor="display-nickname" style={FIELD_LABEL_STYLE}>
            昵称
          </label>
          <input
            id="display-nickname"
            type="text"
            value={draftNickname}
            maxLength={40}
            placeholder="留空时回退为邮箱"
            onChange={(event) => setDraftNickname(event.target.value)}
            style={INPUT_STYLE}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-muted)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <span style={FIELD_HINT_STYLE}>
            chat 与 team 中与当前用户相关的展示，会优先使用这个昵称。
          </span>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={FIELD_LABEL_STYLE}>预览</span>
          <span style={FIELD_HINT_STYLE}>{currentDisplayName}</span>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              ...PRIMARY_BUTTON_STYLE,
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={(e) => {
              if (canSave) {
                e.currentTarget.style.background = 'var(--accent-muted)';
              }
            }}
            onMouseLeave={(e) => {
              if (canSave) {
                e.currentTarget.style.background = 'var(--accent-subtle)';
              }
            }}
          >
            {saving ? '保存中…' : '保存昵称'}
          </button>
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={saving || (nickname ?? null) === null}
            style={{
              ...SECONDARY_BUTTON_STYLE,
              opacity: saving || (nickname ?? null) === null ? 0.5 : 1,
              cursor: saving || (nickname ?? null) === null ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!saving && (nickname ?? null) !== null) {
                e.currentTarget.style.background = 'var(--bg-surface)';
                e.currentTarget.style.borderColor = 'var(--border-emphasis)';
              }
            }}
            onMouseLeave={(e) => {
              if (!saving && (nickname ?? null) !== null) {
                e.currentTarget.style.background = 'var(--bg-overlay)';
                e.currentTarget.style.borderColor = 'var(--border-default)';
              }
            }}
          >
            恢复邮箱展示
          </button>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={FIELD_HINT_STYLE}>{buildSyncStatusLabel(syncStatus)}</span>
          {errorMessage ? (
            <span style={{ ...FIELD_HINT_STYLE, color: 'var(--complement)' }}>{errorMessage}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
