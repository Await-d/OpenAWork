import { useEffect, useState } from 'react';
import { createSettingsClient } from '@openAwork/web-client';
import type { ModelPriceEntry } from './chat-page-utils.js';

export function useModelPrices(gatewayUrl: string, token: string | null): ModelPriceEntry[] {
  const [modelPrices, setModelPrices] = useState<ModelPriceEntry[]>([]);

  useEffect(() => {
    if (!token) {
      setModelPrices([]);
      return;
    }

    let cancelled = false;
    void createSettingsClient(gatewayUrl)
      .getModelPrices(token)
      .then((rawData) => {
        const data = rawData as { models?: ModelPriceEntry[] };
        if (!cancelled) {
          setModelPrices(data.models ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelPrices([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, token]);

  return modelPrices;
}
