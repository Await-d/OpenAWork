import { emit } from '@tauri-apps/api/event';

export type NotificationActionType = 'open_session' | 'open_channel';

export interface NotificationAction {
  type: NotificationActionType;
  targetId: string;
}

export async function emitNotificationAction(action: NotificationAction): Promise<void> {
  await emit('notification-action', action);
}
