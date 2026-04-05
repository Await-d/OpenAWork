import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompanionVoiceOutputMode, CompanionVoiceVariant } from '@openAwork/shared';
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
  voiceOutputMode: CompanionVoiceOutputMode;
  voiceRate: number;
  voiceVariant: CompanionVoiceVariant;
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

function resolveVoiceVariantTuning(voiceVariant: CompanionVoiceVariant): {
  pitch: number;
  rateOffset: number;
  volume: number;
} {
  switch (voiceVariant) {
    case 'bright':
      return { pitch: 1.12, rateOffset: 0.06, volume: 0.9 };
    case 'calm':
      return { pitch: 0.92, rateOffset: -0.08, volume: 0.82 };
    default:
      return { pitch: 1, rateOffset: 0, volume: 0.85 };
  }
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
  voiceOutputMode,
  voiceRate,
  voiceVariant,
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

    if (
      !featureReady ||
      !featureEnabled ||
      !enabled ||
      muted ||
      voiceInputVisible ||
      voiceOutputMode === 'off'
    ) {
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

    if (voiceOutputMode === 'important_only' && liveOutput.tone !== 'notice') {
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
    const tuning = resolveVoiceVariantTuning(voiceVariant);
    utterance.rate = Math.min(2, Math.max(0.5, voiceRate + tuning.rateOffset));
    utterance.pitch = tuning.pitch;
    utterance.volume = tuning.volume;
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
    voiceOutputMode,
    voiceRate,
    voiceVariant,
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

  if (voiceOutputMode === 'off') {
    return {
      isSpeaking: false,
      isVoiceOutputAvailable: true,
      speechStatusLabel: '当前绑定关闭了播报模式',
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
    speechStatusLabel:
      voiceOutputMode === 'important_only'
        ? isSpeaking
          ? 'Buddy 正在播报重点提醒'
          : 'Buddy 仅播报重点提醒'
        : isSpeaking
          ? 'Buddy 正在播报短句'
          : 'Buddy 播报待命中',
  };
}

export { buildSpokenText, buildUtteranceCooldownKey };
