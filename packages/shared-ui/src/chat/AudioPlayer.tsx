import { useCallback, useEffect, useRef, useState } from 'react';

import './AudioPlayer.css';
import { capturePointer, releasePointer } from './pointer-capture.js';

export interface AudioPlayerProps {
  src: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  transcript?: string;
}

/**
 * 内联音频播放器 —— 可拖拽进度条 + 播放/暂停 + 语速 + 下载 + 转写。
 *
 * 使用原生 `<audio>` 元素，上层自绘 UI 以匹配 E · Nebula 设计 token。
 *
 * 进度条与 `VideoPlayer` 同构：`role="slider"` + 指针拖拽（`capturePointer` /
 * `releasePointer`）+ 键盘 ←→±5% / Home / End；比例换算统一走 `seekFromClientX`，
 * 不保留 `onClick`（pointer 事件是 mouse + touch 超集，双入口会重复 seek）。
 * 进度条样式在 `AudioPlayer.css`。
 */
export function AudioPlayer({ src, fileName, mimeType, duration, transcript }: AudioPlayerProps) {
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

  /** 点击 / 拖拽 / 键盘共用：按 clientX 在进度条上的比例设置播放位置。 */
  const seekFromClientX = useCallback(
    (target: HTMLDivElement, clientX: number) => {
      const audio = audioRef.current;
      if (!audio || !total) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = (clientX - rect.left) / rect.width;
      const next = Math.min(total, Math.max(0, ratio * total));
      audio.currentTime = next;
      setCurrent(next);
    },
    [total],
  );

  // 指针拖拽状态。用 ref 而非 state：拖拽不驱动渲染，只需在事件间传递。
  const draggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 阻止拖拽时选中文本 / 触发原生拖拽。
      // 注意：preventDefault 只抑制兼容性鼠标事件（mousedown 等），**不阻止 click**
      // —— click 是激活事件。故此处不使用 onClick，避免与 pointerdown 重复 seek。
      e.preventDefault();
      // 捕获排在置拖拽标志之前：即使抛错也不会进入半途的拖拽态。
      capturePointer(e.currentTarget, e.pointerId);
      draggingRef.current = true;
      seekFromClientX(e.currentTarget, e.clientX);
    },
    [seekFromClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      seekFromClientX(e.currentTarget, e.clientX);
    },
    [seekFromClientX],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 先无条件重置，且不依赖 hasPointerCapture 的返回值：pointercancel（触摸被系统
    // 手势接管）时捕获可能已自动失效，靠捕获状态决定是否清理会卡在拖拽态。
    draggingRef.current = false;
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

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

  const handleSeekKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || total <= 0) return;

      let next: number | null = null;
      if (e.key === 'ArrowRight') {
        next = Math.min(total, audio.currentTime + total * 0.05);
      } else if (e.key === 'ArrowLeft') {
        next = Math.max(0, audio.currentTime - total * 0.05);
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = total;
      }

      if (next === null) return;

      e.preventDefault();
      audio.currentTime = next;
      setCurrent(next);
    },
    [total],
  );

  const progress = total > 0 ? (current / total) * 100 : 0;

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
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>

        {/* 进度条 */}
        <div
          className="audio-player__progress"
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(total))}
          aria-valuenow={Math.max(0, Math.round(current))}
          onKeyDown={handleSeekKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="audio-player__progress-track">
            <div className="audio-player__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="audio-player__progress-thumb" style={{ left: `${progress}%` }} />
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

        {fileName && (
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
