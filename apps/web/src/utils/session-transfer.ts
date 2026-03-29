import { useAuthStore } from '../stores/auth.js';
import { createSessionsClient } from '@openAwork/web-client';
import { logger } from './logger.js';

export interface ExportedSession {
  id: string;
  messages: unknown[];
  exportedAt: string;
}

export function exportSession(sessionId: string, messages: unknown[]): void {
  const data: ExportedSession = {
    id: sessionId,
    messages,
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${sessionId.slice(0, 8)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importSession(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as ExportedSession;
        const { accessToken, gatewayUrl } = useAuthStore.getState();
        void createSessionsClient(gatewayUrl)
          .importSession(accessToken ?? '', parsed)
          .catch(() => null);
      } catch {
        logger.error('Invalid session file');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
