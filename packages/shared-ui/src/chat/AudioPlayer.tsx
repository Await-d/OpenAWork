import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioPlayerProps {
  src: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  transcript?: string;
  /** compact 模式下隐藏文件名，适合嵌入消息流 */
  variant?: 'default' | 'compact';
}

/**
 * 内联音频播放器 —— 波形条 + 进度 + 播放/暂停 + 下载。
 *
 * 使用原生 `<audio>` 元素，上层自绘 UI 以匹配 E · Nebula 设计 token。
 */
export function AudioPlayer({
  src,
  fileName,
  mimeType,
  duration,
  transcript,
  variant = 'default',
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrent(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setTotal(audio.duration);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * total;
    setCurrent(audio.currentTime);
  }, [total]);

  const changeRate = useCallback(() => {
    const rates = [1, 1.5, 2, 0.75];
    const idx = rates.indexOf(playbackRate);
    const next = rates[(idx + 1) % rates.length]!;
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }, [playbackRate]);

  const download = useCallback(() => {
    const a = document.createElement('a');
    a.href = src;
    a.download = fileName ?? 'audio.mp3';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, fileName]);

  const progress = total > 0 ? (current / total) * 100 : 0;
  const isCompact = variant === 'compact';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 16px',
        background: 'var(--bg-overlay, rgba(0,0,0,0.03))',
        border: '1px solid var(--border-default, hsla(215,18%,50%,0.12))',
        borderRadius: 12,
        maxWidth: 420,
        minWidth: 280,
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 播放/暂停按钮 */}
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--accent, #5cd4c0)',
            color: 'var(--fg-on-accent, #052e22)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
            transition: 'transform 100ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>

        {/* 波形进度条 */}
        <div
          onClick={seek}
          style={{
            flex: 1,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          {/* 波形条 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            {Array.from({ length: 32 }).map((_, i) => {
              const barProgress = (i / 32) * 100;
              const active = barProgress < progress;
              const height = 4 + Math.abs(Math.sin(i * 1.5)) * 20;
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height,
                    borderRadius: 1,
                    background: active
                      ? 'var(--accent, #5cd4c0)'
                      : 'var(--border-emphasis, hsla(215,16%,55%,0.20))',
                    transition: 'background 100ms ease',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* 时长 */}
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-muted, #7b8a9e)',
            fontFamily: 'monospace',
            flexShrink: 0,
            minWidth: 72,
            textAlign: 'right',
          }}
        >
          {formatTime(current)} / {formatTime(total)}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* 语速 */}
        <button
          type="button"
          onClick={changeRate}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-default, hsla(215,18%,50%,0.12))',
            background: 'var(--bg-base, transparent)',
            color: 'var(--fg-default, #c8d1e0)',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          {playbackRate}x
        </button>

        {/* 下载 */}
        <button
          type="button"
          onClick={download}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border-default, hsla(215,18%,50%,0.12))',
            background: 'var(--bg-base, transparent)',
            color: 'var(--fg-muted, #7b8a9e)',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          ↓ 下载
        </button>

        {!isCompact && fileName && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-muted, #7b8a9e)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
          >
            {fileName}
          </span>
        )}

        {mimeType && (
          <span style={{ fontSize: 10, color: 'var(--fg-subtle, #4d5b6e)' }}>
            {mimeType.split('/')[1]?.toUpperCase()}
          </span>
        )}
      </div>

      {/* 文字记录 */}
      {transcript && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--bg-base, rgba(0,0,0,0.02))',
            borderRadius: 6,
            border: '1px solid var(--border-subtle, hsla(215,20%,50%,0.07))',
            fontSize: 12,
            color: 'var(--fg-default, #c8d1e0)',
            lineHeight: 1.5,
            maxHeight: 100,
            overflowY: 'auto',
          }}
        >
          {transcript}
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
