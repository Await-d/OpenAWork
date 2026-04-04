import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { tokens } from './tokens.js';

export interface VoiceRecorderProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
  onTranscript?: (text: string) => void;
  isTranscribing?: boolean;
  style?: CSSProperties;
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  0: BrowserSpeechRecognitionAlternative | undefined;
  isFinal: boolean;
  length: number;
}

interface BrowserSpeechRecognitionResultList {
  [index: number]: BrowserSpeechRecognitionResult | undefined;
  length: number;
}

interface BrowserSpeechRecognitionEvent extends Event {
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: ((event: Event) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: ((event: Event) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionHost {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
}

export interface VoiceRecognitionResultLike {
  isFinal: boolean;
  transcript: string;
}

const BAR_HEIGHTS = [3, 6, 10, 7, 4, 8, 5, 9, 6, 4] as const;
const RECORD_BUTTON_SIZE = tokens.spacing.xl + tokens.spacing.lg + tokens.spacing.xs;

export function resolveSpeechRecognitionConstructor(
  host: SpeechRecognitionHost | null | undefined,
): (new () => BrowserSpeechRecognition) | null {
  return host?.SpeechRecognition ?? host?.webkitSpeechRecognition ?? null;
}

export function resolveSpeechRecognitionErrorMessage(error?: string): string | null {
  switch (error) {
    case 'aborted':
      return null;
    case 'audio-capture':
      return '未找到可用的麦克风设备';
    case 'network':
      return '语音识别服务暂时不可用，请稍后重试';
    case 'no-speech':
      return '没有识别到有效语音，请重试';
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风或语音识别权限被拒绝';
    default:
      return '语音识别失败，请重试';
  }
}

export function collectSpeechRecognitionText(results: ReadonlyArray<VoiceRecognitionResultLike>): {
  finalTranscript: string;
  previewTranscript: string;
} {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (const result of results) {
    const text = result.transcript.trim();
    if (!text) {
      continue;
    }
    if (result.isFinal) {
      finalParts.push(text);
    } else {
      interimParts.push(text);
    }
  }

  const finalTranscript = finalParts.join(' ').trim();
  const previewTranscript = [finalTranscript, interimParts.join(' ').trim()]
    .filter((value) => value.length > 0)
    .join(' ')
    .trim();

  return { finalTranscript, previewTranscript };
}

function resolveMediaAccessErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '未找到可用的麦克风设备';
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '麦克风权限被拒绝';
  }

  return '无法访问麦克风';
}

function resolveSpeechLocale(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale?.replace('_', '-') || 'zh-CN';
}

function toVoiceRecognitionResults(
  results: BrowserSpeechRecognitionResultList,
): VoiceRecognitionResultLike[] {
  const normalized: VoiceRecognitionResultLike[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const transcript = result?.[0]?.transcript?.trim() ?? '';

    if (!transcript) {
      continue;
    }

    normalized.push({
      isFinal: result?.isFinal === true,
      transcript,
    });
  }

  return normalized;
}

export function VoiceRecorder({
  onRecordingComplete,
  onTranscript,
  isTranscribing,
  style,
}: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef('');
  const finalTranscriptRef = useRef('');
  const recognitionErroredRef = useRef(false);

  const recognitionConstructor = useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return resolveSpeechRecognitionConstructor(window as SpeechRecognitionHost);
  }, []);

  const recognitionSupported = recognitionConstructor !== null;
  const unsupportedMessage = recognitionSupported
    ? null
    : '当前浏览器不支持语音转写，请改用键盘输入。';

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopMediaCapture = useCallback(() => {
    const recorder = mediaRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      mediaRef.current = null;
      return;
    }

    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
  }, []);

  const disposeRecognition = useCallback((mode: 'abort' | 'none') => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }

    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognitionRef.current = null;

    if (mode === 'abort') {
      recognition.abort();
    }
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    return () => {
      clearTimer();
      stopMediaCapture();
      disposeRecognition('abort');
    };
  }, [clearTimer, disposeRecognition, stopMediaCapture]);

  const start = useCallback(async () => {
    if (!recognitionConstructor || starting || recording) {
      return;
    }

    setMicError(null);
    setTranscript('');
    transcriptRef.current = '';
    finalTranscriptRef.current = '';
    recognitionErroredRef.current = false;
    setSeconds(0);
    setStarting(true);

    let recorderStream: MediaStream | null = null;

    if (
      onRecordingComplete &&
      typeof navigator !== 'undefined' &&
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    ) {
      try {
        recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        setMicError(resolveMediaAccessErrorMessage(error));
        setStarting(false);
        return;
      }

      const recorder = new MediaRecorder(recorderStream);
      chunksRef.current = [];
      mediaStreamRef.current = recorderStream;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        onRecordingComplete(blob);
        mediaStreamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
        mediaStreamRef.current = null;
      };
      recorder.start();
      mediaRef.current = recorder;
    }

    const recognition = new recognitionConstructor();
    recognition.lang = resolveSpeechLocale();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setStarting(false);
      setRecording(true);
      clearTimer();
      timerRef.current = setInterval(() => {
        setSeconds((currentSeconds) => currentSeconds + 1);
      }, 1000);
    };

    recognition.onresult = (event) => {
      const { finalTranscript, previewTranscript } = collectSpeechRecognitionText(
        toVoiceRecognitionResults(event.results),
      );
      finalTranscriptRef.current = finalTranscript;
      transcriptRef.current = previewTranscript;
      setTranscript(previewTranscript);
    };

    recognition.onerror = (event) => {
      recognitionErroredRef.current = true;
      setStarting(false);
      setRecording(false);
      clearTimer();
      stopMediaCapture();

      const message = resolveSpeechRecognitionErrorMessage(event.error);
      if (message) {
        setMicError(message);
      }
    };

    recognition.onend = () => {
      setStarting(false);
      setRecording(false);
      clearTimer();
      stopMediaCapture();
      disposeRecognition('none');

      const text = (finalTranscriptRef.current.trim() || transcriptRef.current.trim()).trim();
      if (!recognitionErroredRef.current && !text) {
        setMicError('没有识别到有效语音，请重试');
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      clearTimer();
      stopMediaCapture();
      disposeRecognition('none');
      setStarting(false);
      setRecording(false);
      setMicError(resolveMediaAccessErrorMessage(error));
    }
  }, [
    clearTimer,
    disposeRecognition,
    onRecordingComplete,
    recognitionConstructor,
    recording,
    starting,
    stopMediaCapture,
  ]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (recording) {
      stop();
      return;
    }

    void start();
  }, [recording, start, stop]);

  const fmt = useCallback(
    (value: number) =>
      `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
    [],
  );

  const busy = starting || recording;
  const hasTranscript = transcript.trim().length > 0;
  const showTranscriptPanel = busy || Boolean(isTranscribing) || hasTranscript;
  const hintText = unsupportedMessage
    ? unsupportedMessage
    : starting
      ? '正在启动语音识别…'
      : recording
        ? '正在识别语音…'
        : hasTranscript
          ? '识别完成，确认后将文本填入输入框'
          : '点击开始语音输入';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacing.sm,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: tokens.spacing.md,
        }}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!recognitionSupported || starting}
          aria-label={busy ? '停止语音输入' : '开始语音输入'}
          style={{
            width: RECORD_BUTTON_SIZE,
            height: RECORD_BUTTON_SIZE,
            borderRadius: '50%',
            border: `1px solid ${busy ? tokens.color.danger : tokens.color.border}`,
            cursor: !recognitionSupported || starting ? 'not-allowed' : 'pointer',
            background: busy ? tokens.color.danger : tokens.color.accent,
            color: tokens.color.text,
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: !recognitionSupported ? 0.55 : 1,
            transition: 'opacity 0.15s ease, transform 0.15s ease, background 0.15s ease',
          }}
        >
          {busy ? '■' : '●'}
        </button>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: tokens.color.text,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 42,
          }}
        >
          {fmt(seconds)}
        </span>
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: tokens.spacing.xxs,
            height: tokens.spacing.xl,
          }}
        >
          {BAR_HEIGHTS.map((height, index) => (
            <div
              key={`bar-${index}-${height}`}
              style={{
                width: tokens.spacing.xs,
                height: busy ? height * 2 : tokens.spacing.xs,
                background: busy ? tokens.color.accent : tokens.color.border,
                borderRadius: tokens.radius.sm,
                transition: 'height 0.15s ease, background 0.15s ease',
                animation: busy ? `wave-${index % 3} 0.6s ease-in-out infinite alternate` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          fontSize: 12,
          color: unsupportedMessage ? tokens.color.muted : tokens.color.text,
        }}
      >
        {hintText}
      </div>

      {unsupportedMessage && (
        <div
          style={{
            fontSize: 12,
            color: tokens.color.muted,
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
          }}
        >
          浏览器未提供 Speech Recognition API，当前仅支持键盘输入。
        </div>
      )}

      {micError && (
        <div
          style={{
            fontSize: 12,
            color: tokens.color.danger,
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.danger}`,
            borderRadius: tokens.radius.sm,
            padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
          }}
        >
          {micError}
        </div>
      )}

      {showTranscriptPanel && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: isTranscribing ? tokens.color.muted : tokens.color.text,
            background: tokens.color.surface,
            border: `1px solid ${tokens.color.border}`,
            borderRadius: tokens.radius.sm,
            padding: `${tokens.spacing.sm}px ${tokens.spacing.md}px`,
            minHeight: tokens.spacing.xl * 3,
          }}
        >
          {isTranscribing
            ? '转录中…'
            : transcript || (busy ? '识别结果会实时显示在这里' : '暂无可用识别文本')}
        </div>
      )}

      {onTranscript && hasTranscript && !busy && !isTranscribing && (
        <button
          type="button"
          onClick={() => {
            onTranscript(transcript.trim());
            setTranscript('');
            transcriptRef.current = '';
            finalTranscriptRef.current = '';
            setMicError(null);
          }}
          style={{
            fontSize: 11,
            padding: `${tokens.spacing.xs - 1}px ${tokens.spacing.md - 2}px`,
            borderRadius: tokens.radius.sm,
            border: `1px solid ${tokens.color.border}`,
            background: tokens.color.bg,
            color: tokens.color.text,
            cursor: 'pointer',
            alignSelf: 'flex-start',
            transition: 'border-color 0.15s ease, color 0.15s ease',
          }}
        >
          使用转录结果
        </button>
      )}
    </div>
  );
}
