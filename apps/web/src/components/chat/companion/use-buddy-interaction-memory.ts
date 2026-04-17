import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY_PREFIX = 'openawork-buddy-interaction-memory';
const MAX_HISTORY_ENTRIES = 100;

export interface BuddyInteractionRecord {
  timestamp: number;
  type: 'chat' | 'trigger' | 'approval' | 'notification';
  summary: string;
}

export interface BuddyInteractionMemory {
  totalInteractions: number;
  recentTypes: BuddyInteractionRecord['type'][];
  lastInteractionAt: number | null;
  approvalCount: number;
  chatCount: number;
  triggerCount: number;
  notificationCount: number;
}

function buildStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}:${scope}`;
}

function readStoredHistory(scope: string): BuddyInteractionRecord[] {
  if (typeof globalThis.window === 'undefined') {
    return [];
  }

  try {
    const rawValue = globalThis.window.localStorage.getItem(buildStorageKey(scope));
    if (!rawValue) {
      return [];
    }

    return JSON.parse(rawValue) as BuddyInteractionRecord[];
  } catch {
    return [];
  }
}

function writeStoredHistory(scope: string, records: BuddyInteractionRecord[]): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  try {
    const trimmed = records.slice(0, MAX_HISTORY_ENTRIES);
    globalThis.window.localStorage.setItem(buildStorageKey(scope), JSON.stringify(trimmed));
  } catch {
    // localStorage may be unavailable
  }
}

function computeMemory(records: BuddyInteractionRecord[]): BuddyInteractionMemory {
  const recent = records.slice(0, 20);
  return {
    totalInteractions: records.length,
    recentTypes: recent.map((r) => r.type),
    lastInteractionAt: records[0]?.timestamp ?? null,
    approvalCount: records.filter((r) => r.type === 'approval').length,
    chatCount: records.filter((r) => r.type === 'chat').length,
    triggerCount: records.filter((r) => r.type === 'trigger').length,
    notificationCount: records.filter((r) => r.type === 'notification').length,
  };
}

export function useBuddyInteractionMemory(scope: string) {
  const normalizedScope = scope.trim().toLowerCase() || 'guest';
  const [records, setRecords] = useState<BuddyInteractionRecord[]>(() =>
    readStoredHistory(normalizedScope),
  );
  const scopeRef = useRef(normalizedScope);

  useEffect(() => {
    scopeRef.current = normalizedScope;
    setRecords(readStoredHistory(normalizedScope));
  }, [normalizedScope]);

  useEffect(() => {
    writeStoredHistory(normalizedScope, records);
  }, [normalizedScope, records]);

  const recordInteraction = useCallback((type: BuddyInteractionRecord['type'], summary: string) => {
    const entry: BuddyInteractionRecord = {
      timestamp: Date.now(),
      type,
      summary,
    };
    setRecords((prev) => [entry, ...prev].slice(0, MAX_HISTORY_ENTRIES));
  }, []);

  const memory = computeMemory(records);

  return {
    memory,
    recordInteraction,
    recentRecords: records.slice(0, 10),
  };
}
