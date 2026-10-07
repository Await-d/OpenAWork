import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export interface VoiceRecorderProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
  onTranscript?: (text: string) => void;
  isTranscribing?: boolean;
  autoConfirm?: boolean;
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

/** `MediaRecorder` 未给出mime 时的兜底容器，与 Chromium 主路径一致。 */
const DEFAULT_RECORDING_MIME = 'audio/webm';

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
  autoConfirm = false,
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
  /**
   * 录音与转写是两条独立链路：Firefox 等浏览器不提供 `SpeechRecognition`，
   * 但 `MediaRecorder` 可用。只要调用方接了 `onRecordingComplete`，就仍应允许
   * 录音（音频作为附件落库），代价是没有实时字幕。
   */
  const captureRequested = onRecordingComplete !== undefined;
  const canCaptureAudio =
    captureRequested &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';
  /** 入口可用条件：能转写或能录音，任一成立即可。 */
  const recordingAvailable = recognitionSupported || canCaptureAudio;
  const unsupportedMessage = recordingAvailable
    ? null
    : captureRequested
      ? '当前浏览器不支持录音，请改用键盘输入。'
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

  /** 进入录音态并启动计时。转写与纯录音两条链路共用。 */
  const beginRecordingUi = useCallback(() => {
    setStarting(false);
    setRecording(true);
    clearTimer();
    timerRef.current = setInterval(() => {
      setSeconds((currentSeconds) => currentSeconds + 1);
    }, 1000);
  }, [clearTimer]);

  /** 退出录音态并清理计时。两条链路共用，重复调用无害。 */
  const endRecordingUi = useCallback(() => {
    setStarting(false);
    setRecording(false);
    clearTimer();
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (!recordingAvailable || starting || recording) {
      return;
    }

    setMicError(null);
    setTranscript('');
    transcriptRef.current = '';
    finalTranscriptRef.current = '';
    recognitionErroredRef.current = false;
    setSeconds(0);
    setStarting(true);

    // ─── 1. 录音链路（可选）：产出音频 blob，交给调用方落库 ───
    if (canCaptureAudio && onRecordingComplete) {
      let recorderStream: MediaStream;
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
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || DEFAULT_RECORDING_MIME,
        });
        mediaStreamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
        mediaStreamRef.current = null;
        // 纯录音模式没有 recognition.onend 兜底，录音态收尾必须落在这里。
        endRecordingUi();
        // 误触（秒内起停）会产生空音频，此时不投递附件。
        if (blob.size > 0) {
          onRecordingComplete(blob);
        }
      };
      recorder.start();
      mediaRef.current = recorder;
    }

    // ─── 2. 转写链路（可选）：实时字幕 ───
    if (!recognitionConstructor) {
      // 无 STT：录音已在上面启动，直接进入录音态。
      if (mediaRef.current) {
        beginRecordingUi();
      } else {
        setStarting(false);
      }
      return;
    }

    const recognition = new recognitionConstructor();
    recognition.lang = resolveSpeechLocale();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      beginRecordingUi();
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
      endRecordingUi();
      stopMediaCapture();

      const message = resolveSpeechRecognitionErrorMessage(event.error);
      if (message) {
        setMicError(message);
      }
    };

    recognition.onend = () => {
      endRecordingUi();
      stopMediaCapture();
      disposeRecognition('none');

      const text = (finalTranscriptRef.current.trim() || transcriptRef.current.trim()).trim();
      if (!recognitionErroredRef.current && !text) {
        setMicError('没有识别到有效语音，请重试');
      } else if (!recognitionErroredRef.current && text && autoConfirm && onTranscript) {
        onTranscript(text);
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
    autoConfirm,
    beginRecordingUi,
    canCaptureAudio,
    clearTimer,
    disposeRecognition,
    endRecordingUi,
    onRecordingComplete,
    onTranscript,
    recognitionConstructor,
    recording,
    recordingAvailable,
    starting,
    stopMediaCapture,
  ]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    // 纯录音模式没有 recognition 兜底，直接停 MediaRecorder，收尾走 recorder.onstop。
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
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
  /**
   * 字幕面板只在有 STT 时才有意义：纯录音模式下 `transcript` 恒为空，展示
   * 「识别结果会实时显示在这里」是误导，改由 hintText 说明录音去向。
   */
  const showTranscriptPanel =
    recognitionSupported && (busy || Boolean(isTranscribing) || hasTranscript);
  const hintText = unsupportedMessage
    ? unsupportedMessage
    : starting
      ? recognitionSupported
        ? '正在启动语音识别…'
        : '正在启动录音…'
      : recording
        ? recognitionSupported
          ? '正在识别语音…'
          : '正在录音，停止后音频将作为附件加入输入框'
        : hasTranscript
          ? '识别完成，确认后将文本填入输入框'
          : '点击开始语音输入';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!recordingAvailable || starting}
          aria-label={busy ? '停止语音输入' : '开始语音输入'}
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            cursor: !recordingAvailable || starting ? 'not-allowed' : 'pointer',
            background: busy
              ? 'color-mix(in oklch, var(--danger) 12%, transparent)'
              : 'var(--bg-overlay)',
            color: busy ? 'color-mix(in oklch, var(--danger) 82%, white 18%)' : 'var(--fg-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: !recordingAvailable ? 0.45 : 1,
            transition: 'opacity 150ms ease, background 150ms ease, color 150ms ease',
          }}
        >
          {busy ? (
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          )}
        </button>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--fg-default)',
            fontVariantNumeric: 'tabular-nums',
            minWidth: 36,
          }}
        >
          {fmt(seconds)}
        </span>
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 2,
            height: 18,
          }}
        >
          {BAR_HEIGHTS.map((height, index) => (
            <div
              key={`bar-${index}-${height}`}
              style={{
                width: 3,
                height: busy ? height * 1.8 : 3,
                background: busy
                  ? 'color-mix(in oklch, var(--accent) 70%, white 30%)'
                  : 'var(--border-subtle)',
                borderRadius: 2,
                transition: 'height 0.15s ease, background 0.15s ease',
                animation: busy ? `wave-${index % 3} 0.6s ease-in-out infinite alternate` : 'none',
              }}
            />
          ))}
        </div>

        {busy && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: 'color-mix(in oklch, var(--danger) 70%, white 30%)',
              whiteSpace: 'nowrap',
            }}
          >
            REC
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          color: unsupportedMessage ? 'var(--fg-muted)' : 'var(--fg-muted)',
          lineHeight: 1.4,
        }}
      >
        {hintText}
      </div>

      {unsupportedMessage && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--fg-muted)',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '4px 8px',
            lineHeight: 1.5,
          }}
        >
          浏览器未提供 Speech Recognition / MediaRecorder API，当前仅支持键盘输入。
        </div>
      )}

      {micError && (
        <div
          style={{
            fontSize: 10,
            color: 'color-mix(in oklch, var(--danger) 80%, white 20%)',
            background: 'color-mix(in oklch, var(--danger) 8%, transparent)',
            border: '1px solid color-mix(in oklch, var(--danger) 20%, var(--border-subtle))',
            borderRadius: 6,
            padding: '4px 8px',
            lineHeight: 1.5,
          }}
        >
          {micError}
        </div>
      )}

      {showTranscriptPanel && (
        <div
          style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: isTranscribing ? 'var(--fg-muted)' : 'var(--fg-strong)',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '6px 8px',
            minHeight: 36,
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
            fontSize: 10,
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: 6,
            border: '1px solid color-mix(in oklch, var(--accent) 24%, var(--border-subtle))',
            background: 'color-mix(in oklch, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            transition: 'border-color 150ms ease, color 150ms ease, background 150ms ease',
          }}
        >
          使用转录结果
        </button>
      )}
    </div>
  );
}
