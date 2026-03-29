import { useState, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';

export interface VoiceRecorderProps {
  onRecordingComplete?: (audioBlob: Blob) => void;
  onTranscript?: (text: string) => void;
  isTranscribing?: boolean;
  style?: CSSProperties;
}

export function VoiceRecorder({
  onRecordingComplete,
  onTranscript,
  isTranscribing,
  style,
}: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const start = async () => {
    setMicError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setMicError('未找到麦克风设备');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setMicError('麦克风权限被拒绝');
      } else {
        setMicError('无法访问麦克风');
      }
      return;
    }
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];
    mr.ondataavailable = (e) => chunksRef.current.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      onRecordingComplete?.(blob);
      for (const t of stream.getTracks()) t.stop();
    };
    mr.start();
    mediaRef.current = mr;
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const toggle = () => {
    setMicError(null);
    if (recording) stop();
    else void start();
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={toggle}
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            background: recording ? '#f87171' : '#6366f1',
            color: '#fff',
            fontSize: 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {recording ? '■' : '●'}
        </button>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text, #f1f5f9)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(seconds)}
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 24 }}>
          {([3, 6, 10, 7, 4, 8, 5, 9, 6, 4] as const).map((h, i) => (
            <div
              key={`bar-${i}-${h}`}
              style={{
                width: 3,
                height: recording ? h * 2 : 4,
                background: recording ? '#6366f1' : 'var(--color-border, #334155)',
                borderRadius: 2,
                transition: 'height 0.15s ease',
                animation: recording ? `wave-${i % 3} 0.6s ease-in-out infinite alternate` : 'none',
              }}
            />
          ))}
        </div>
      </div>
      {micError && (
        <div
          style={{
            fontSize: 12,
            color: '#f87171',
            background: 'var(--color-surface, #1e293b)',
            border: '1px solid #f87171',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
          }}
        >
          {micError}
        </div>
      )}
      {(isTranscribing || transcript) && (
        <div
          style={{
            fontSize: 12,
            color: isTranscribing ? 'var(--color-muted, #94a3b8)' : 'var(--color-text, #f1f5f9)',
            background: 'var(--color-surface, #1e293b)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
          }}
        >
          {isTranscribing ? '转录中…' : transcript}
        </div>
      )}
      {onTranscript && transcript && !isTranscribing && (
        <button
          type="button"
          onClick={() => {
            onTranscript(transcript);
            setTranscript('');
          }}
          style={{
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 4,
            border: '1px solid var(--color-border, #334155)',
            background: 'var(--color-bg, #0f172a)',
            color: 'var(--color-text, #f1f5f9)',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          使用转录结果
        </button>
      )}
    </div>
  );
}
