import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveCompanionOutputPolicy,
  type CompanionUtteranceSeed,
} from './companion-display-model.js';

const MAX_SPOKEN_CHARS = 72;
const NOTICE_COOLDOWN_MS = 12_000;
const ACTIVE_COOLDOWN_MS = 6_000;

interface BuddyVoiceOutputOptions {
  enabled: boolean;
  featureEnabled: boolean;
  featureReady: boolean;
  liveOutput: CompanionUtteranceSeed | null;
  liveOutputId: string | null;
  muted: boolean;
  profileName: string;
  quietMode: boolean;
  voiceInputVisible: boolean;
}

interface BuddyVoiceOutputState {
  isSpeaking: boolean;
  isVoiceOutputAvailable: boolean;
  speechStatusLabel: string;
}

function canUseSpeechSynthesis(): boolean {
  return (
    typeof globalThis.window !== 'undefined' &&
    'speechSynthesis' in globalThis.window &&
    typeof globalThis.SpeechSynthesisUtterance !== 'undefined'
  );
}

function buildSpokenText(profileName: string, output: CompanionUtteranceSeed): string {
  const body = output.text.replace(/\s+/g, ' ').trim();
  const clippedBody =
    body.length > MAX_SPOKEN_CHARS ? `${body.slice(0, MAX_SPOKEN_CHARS).trimEnd()}。` : body;
  const prefix = output.tone === 'notice' ? `${profileName}提醒：` : `${profileName}：`;
  return `${prefix}${clippedBody}`;
}

function buildUtteranceCooldownKey(output: CompanionUtteranceSeed): string {
  return `${output.tone}:${output.badge}`;
}

export function useBuddyVoiceOutput({
  enabled,
  featureEnabled,
  featureReady,
  liveOutput,
  liveOutputId,
  muted,
  profileName,
  quietMode,
  voiceInputVisible,
}: BuddyVoiceOutputOptions): BuddyVoiceOutputState {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isVoiceOutputAvailable = useMemo(() => canUseSpeechSynthesis(), []);
  const lastSpokenIdRef = useRef<string | null>(null);
  const lastSpokenAtByKeyRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!enabled) {
      lastSpokenIdRef.current = null;
      lastSpokenAtByKeyRef.current.clear();
    }
  }, [enabled]);

  useEffect(() => {
    if (!isVoiceOutputAvailable) {
      return;
    }

    if (!featureReady || !featureEnabled || !enabled || muted || voiceInputVisible) {
      globalThis.window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    if (!liveOutput || !liveOutputId) {
      return;
    }

    if (lastSpokenIdRef.current === liveOutputId) {
      return;
    }

    const policy = deriveCompanionOutputPolicy(liveOutput, { muted, quietMode });
    if (!policy.shouldSpeak) {
      return;
    }

    const nextCooldownKey = buildUtteranceCooldownKey(liveOutput);
    const previousSpokenAt = lastSpokenAtByKeyRef.current.get(nextCooldownKey);
    const cooldownWindow = liveOutput.tone === 'notice' ? NOTICE_COOLDOWN_MS : ACTIVE_COOLDOWN_MS;
    const now = Date.now();
    if (typeof previousSpokenAt === 'number' && now - previousSpokenAt < cooldownWindow) {
      return;
    }

    const utterance = new globalThis.SpeechSynthesisUtterance(
      buildSpokenText(profileName, liveOutput),
    );
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.volume = 0.85;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    try {
      globalThis.window.speechSynthesis.cancel();
      globalThis.window.speechSynthesis.speak(utterance);
      lastSpokenIdRef.current = liveOutputId;
      lastSpokenAtByKeyRef.current.set(nextCooldownKey, now);
    } catch {
      setIsSpeaking(false);
    }
  }, [
    enabled,
    featureEnabled,
    featureReady,
    isVoiceOutputAvailable,
    liveOutput,
    liveOutputId,
    muted,
    profileName,
    quietMode,
    voiceInputVisible,
  ]);

  useEffect(() => {
    if (!isVoiceOutputAvailable) {
      return;
    }

    return () => {
      globalThis.window.speechSynthesis.cancel();
    };
  }, [isVoiceOutputAvailable]);

  if (!isVoiceOutputAvailable) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: false,
      speechStatusLabel: '当前环境无本地播报',
    };
  }

  if (!featureReady) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: '远端设置读取中',
    };
  }

  if (!featureEnabled) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: '远端功能开关已关闭',
    };
  }

  if (!enabled) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: 'Buddy 播报已关闭',
    };
  }

  if (muted) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: '总静音已拦截播报',
    };
  }

  if (voiceInputVisible) {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: '语音输入打开时暂停播报',
    };
  }

  return {
    isSpeaking,
    isVoiceOutputAvailable: true,
    speechStatusLabel: isSpeaking ? 'Buddy 正在播报短句' : 'Buddy 播报待命中',
  };
}

export { buildSpokenText, buildUtteranceCooldownKey };
