import { z } from 'zod';
import { sqliteGet, sqliteRun } from '../infra/db.js';

interface UserSettingRow {
  value: string;
}

const nicknameSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return value;
}, z.string().min(1).max(40).nullable());

export const USER_PROFILE_SETTINGS_KEY = 'user_profile_v1';

export const userProfileSettingsRecordSchema = z.object({
  nickname: nicknameSchema.default(null),
  updatedAt: z.string().optional(),
});

export const userProfileSettingsUpdateSchema = z.object({
  nickname: nicknameSchema.optional(),
});

export type UserProfileSettingsRecord = z.infer<typeof userProfileSettingsRecordSchema>;

export type UserProfileSettingsUpdateInput = z.infer<typeof userProfileSettingsUpdateSchema>;

const DEFAULT_USER_PROFILE_SETTINGS: UserProfileSettingsRecord =
  userProfileSettingsRecordSchema.parse({});

function parseStoredUserProfile(value: string | undefined): UserProfileSettingsRecord {
  if (!value) {
    return DEFAULT_USER_PROFILE_SETTINGS;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    const result = userProfileSettingsRecordSchema.safeParse(parsed);
    return result.success ? result.data : DEFAULT_USER_PROFILE_SETTINGS;
  } catch {
    return DEFAULT_USER_PROFILE_SETTINGS;
  }
}

export function resolveUserDisplayName(input: {
  readonly email: string;
  readonly nickname: string | null | undefined;
}): string {
  return input.nickname ?? input.email;
}

export function loadUserProfileSettings(userId: string): UserProfileSettingsRecord {
  const row = sqliteGet<UserSettingRow>(
    `SELECT value FROM user_settings WHERE user_id = ? AND key = ?`,
    [userId, USER_PROFILE_SETTINGS_KEY],
  );
  return parseStoredUserProfile(row?.value);
}

export function saveUserProfileSettings(
  userId: string,
  input: UserProfileSettingsUpdateInput,
): UserProfileSettingsRecord {
  const existing = loadUserProfileSettings(userId);
  const nextSettings: UserProfileSettingsRecord = {
    ...existing,
    ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
    updatedAt: new Date().toISOString(),
  };

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, USER_PROFILE_SETTINGS_KEY, JSON.stringify(nextSettings)],
  );

  return nextSettings;
}
