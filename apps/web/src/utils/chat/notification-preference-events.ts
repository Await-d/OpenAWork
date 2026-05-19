const NOTIFICATION_PREFERENCES_REFRESH_EVENT = 'openawork:notification-preferences-refresh';

export function requestNotificationPreferenceRefresh(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFERENCES_REFRESH_EVENT));
}

export function subscribeNotificationPreferenceRefresh(handler: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = () => {
    handler();
  };
  window.addEventListener(NOTIFICATION_PREFERENCES_REFRESH_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATION_PREFERENCES_REFRESH_EVENT, listener);
}
