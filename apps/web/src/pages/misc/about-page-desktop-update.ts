import { tauriInvoke } from '../settings/shared/settings-page-helpers.js';

export async function openDesktopUpdatePanel(): Promise<void> {
  await tauriInvoke<void>('open_update_panel', {
    autoStart: true,
  });
}
