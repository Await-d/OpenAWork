import { useEffect, useState } from 'react';
import type { ModelPriceEntry } from './chat-page-utils.js';

export function useModelPrices(gatewayUrl: string, token: string | null): ModelPriceEntry[] {
  const [modelPrices, setModelPrices] = useState<ModelPriceEntry[]>([]);

  useEffect(() => {
    if (!token) {
      setModelPrices([]);
      return;
    }

    let cancelled = false;
    void fetch(`${gatewayUrl}/settings/model-prices`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('fail'))))
      .then((data: { models?: ModelPriceEntry[] }) => {
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
