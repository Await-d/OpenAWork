import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  getCurrentUserDisplayName,
  useCurrentUserProfileStore,
} from '../../../stores/user-profile/current-user-profile.js';
import { SS, ST } from '../shared/settings-section-styles.js';

const FIELD_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--fg-default)',
};

const FIELD_HINT_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg-muted)',
  lineHeight: 1.5,
};

const INPUT_STYLE: CSSProperties = {
  width: '100%',
  minHeight: 38,
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--fg-strong)',
  padding: '0 12px',
  fontSize: 13,
  outline: '2px solid transparent',
  outlineOffset: 2,
  boxSizing: 'border-box',
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  border: '1px solid color-mix(in oklch, var(--accent) 40%, transparent)',
  background: 'color-mix(in oklch, var(--accent) 16%, var(--bg-overlay) 84%)',
  color: 'var(--fg-strong)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  border: '1px solid var(--border-default)',
  background: 'transparent',
  color: 'var(--fg-default)',
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
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
    <section style={SS}>
      <h3 style={ST}>身份展示</h3>
      <div style={{ display: 'grid', gap: 14 }}>
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
          />
          <span style={FIELD_HINT_STYLE}>
            chat 与 team 中与“当前用户”相关的展示，会优先使用这个昵称。
          </span>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={FIELD_LABEL_STYLE}>预览</span>
          <span style={FIELD_HINT_STYLE}>{currentDisplayName}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              ...PRIMARY_BUTTON_STYLE,
              opacity: canSave ? 1 : 0.55,
              cursor: canSave ? 'pointer' : 'not-allowed',
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
              opacity: saving || (nickname ?? null) === null ? 0.55 : 1,
              cursor: saving || (nickname ?? null) === null ? 'not-allowed' : 'pointer',
            }}
          >
            恢复邮箱展示
          </button>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span style={FIELD_HINT_STYLE}>{buildSyncStatusLabel(syncStatus)}</span>
          {errorMessage ? (
            <span style={{ ...FIELD_HINT_STYLE, color: 'var(--danger)' }}>{errorMessage}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
