import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseBuddyIdleDetectorOptions {
  readonly input: string;
}

const IDLE_TICK_MS = 1000;
const USER_ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'focus'] as const;

export function useBuddyIdleDetector(options: UseBuddyIdleDetectorOptions): number {
  const lastActivityAtRef = useRef(Date.now());
  const [idleSeconds, setIdleSeconds] = useState(0);

  const markActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    setIdleSeconds(0);
  }, []);

  useEffect(() => {
    markActivity();
  }, [markActivity, options.input]);

  useEffect(() => {
    if (typeof globalThis.window === 'undefined') {
      return undefined;
    }

    for (const eventName of USER_ACTIVITY_EVENTS) {
      globalThis.window.addEventListener(eventName, markActivity, { passive: true });
    }

    const timerId = globalThis.window.setInterval(() => {
      setIdleSeconds(Math.max(0, Math.floor((Date.now() - lastActivityAtRef.current) / 1000)));
    }, IDLE_TICK_MS);

    return () => {
      globalThis.window.clearInterval(timerId);
      for (const eventName of USER_ACTIVITY_EVENTS) {
        globalThis.window.removeEventListener(eventName, markActivity);
      }
    };
  }, [markActivity]);

  return idleSeconds;
}
