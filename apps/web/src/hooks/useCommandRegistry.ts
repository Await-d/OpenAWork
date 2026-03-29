import { useEffect, useState } from 'react';
import { createCommandsClient } from '@openAwork/web-client';
import type { CommandDescriptor, CommandSurface } from '@openAwork/shared';
import { useAuthStore } from '../stores/auth.js';

export function useCommandRegistry(surface: CommandSurface): CommandDescriptor[] {
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const [commands, setCommands] = useState<CommandDescriptor[]>([]);

  useEffect(() => {
    if (!token) {
      setCommands([]);
      return;
    }

    let cancelled = false;
    void createCommandsClient(gatewayUrl)
      .list(token)
      .then((items: CommandDescriptor[]) => {
        if (!cancelled) {
          setCommands(items.filter((item: CommandDescriptor) => item.contexts.includes(surface)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, surface, token]);

  return commands;
}
