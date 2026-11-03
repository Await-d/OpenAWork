import { useCallback, useEffect, useRef, useState } from 'react';

import './VideoPlayer.css';
import { capturePointer, releasePointer } from './pointer-capture.js';
import { color } from '../tokens.js';

type HlsHandle = {
  destroy(): void;
};

export interface VideoPlayerProps {
  src: string;
  fileName?: string;
  mimeType?: string;
  poster?: string;
  duration?: number;
  width?: number;
  height?: number;
  autoPlay?: boolean;
}

function isHlsSource(src: string): boolean {
  // .m3u8 或 application/vnd.apple.mpegurl
  return src.toLowerCase().endsWith('.m3u8') || src.includes('.m3u8?') || src.includes('m3u8#');
}

/**
 * 内联视频播放器 —— 支持普通视频文件和 HLS (.m3u8) 流。
 *
 * - 普通格式（MP4/WebM/Ogg）：直接用原生 `<video>` src 播放
 * - HLS 流（.m3u8）：Safari 原生支持；其他浏览器通过 hls.js 播放
 *
 * 遵循 E · Nebula 设计 token，圆角卡片 + 悬浮操作栏。
 */
export function VideoPlayer({
  src,
  fileName,
  mimeType,
  poster,
  duration,
  width,
  height,
  autoPlay = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  /** 播放器已知的总时长：优先取真实媒体 duration，回退到 duration prop。 */
  const [total, setTotal] = useState(0);

  // HLS 初始化
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const shouldUseHls = isHlsSource(src);

    if (shouldUseHls) {
      // Safari 原生支持 HLS
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        setCurrentSrc(src);
        return;
      }

      // 其他浏览器使用 hls.js
      let cancelled = false;

      void (async () => {
        try {
          const mod = await import('hls.js');
          if (cancelled || !video) return;

          const HlsClass = mod.default;
          if (HlsClass.isSupported()) {
            // 清理旧的 hls 实例
            hlsRef.current?.destroy();

            const hls = new HlsClass({
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 30,
            });
            hlsRef.current = hls;

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(HlsClass.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                switch (data.type) {
                  case HlsClass.ErrorTypes.NETWORK_ERROR:
                    hls.startLoad();
                    break;
                  case HlsClass.ErrorTypes.MEDIA_ERROR:
                    hls.recoverMediaError();
                    break;
                  default:
                    hls.destroy();
                    break;
                }
              }
            });

            setCurrentSrc(src);
          }
        } catch {
          // hls.js 加载失败，回退到直接设置 src
          video.src = src;
          setCurrentSrc(src);
        }
      })();

      return () => {
        cancelled = true;
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }

    // 普通视频格式
    video.src = src;
    setCurrentSrc(src);

    return () => {
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  // 进度追踪：timeupdate 维护 current，loadedmetadata 修正 total。
  // 清理与设置同处，卸载时一并移除监听。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrent(video.currentTime);
    const onLoadedMetadata = () => {
      if (video.duration && isFinite(video.duration)) {
        setTotal(video.duration);
      }
    };
    const onEnded = () => setCurrent(0);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
    };
  }, []);

  // duration prop 作为 total 的兜底初值；真实媒体元数据到达后会被 loadedmetadata 覆盖。
  useEffect(() => {
    if (typeof duration === 'number' && duration > 0) {
      setTotal((prev) => (prev > 0 ? prev : duration));
    }
  }, [duration]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      await container.requestFullscreen?.();
      setFullscreen(true);
    } else {
      await document.exitFullscreen?.();
      setFullscreen(false);
    }
  }, []);

  const download = useCallback(() => {
    const a = document.createElement('a');
    a.href = src;
    a.download = fileName ?? 'video.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, fileName]);

  /**
   * 统一的「按横向坐标算比例 → 设 currentTime」换算。
   * 点击 / 拖拽 / 键盘三处共用，避免第二份换算逻辑漂移。
   */
  const seekFromClientX = useCallback(
    (target: HTMLElement, clientX: number) => {
      const video = videoRef.current;
      if (!video || total <= 0) return;
      const rect = target.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const next = Math.min(total, Math.max(0, ratio * total));
      video.currentTime = next;
      setCurrent(next);
    },
    [total],
  );

  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (total <= 0) return;
      e.preventDefault();
      // 捕获排在置拖拽标志之前：即使抛错也不会进入半途的拖拽态。
      capturePointer(e.currentTarget, e.pointerId);
      draggingRef.current = true;
      seekFromClientX(e.currentTarget, e.clientX);
    },
    [total, seekFromClientX],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      seekFromClientX(e.currentTarget, e.clientX);
    },
    [seekFromClientX],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 与音频侧同构：先无条件重置，且不依赖 hasPointerCapture 的返回值 ——
    // pointercancel（触摸被系统手势接管）时捕获可能已自动失效，靠捕获状态决定是否
    // 清理会卡在拖拽态。
    draggingRef.current = false;
    releasePointer(e.currentTarget, e.pointerId);
  }, []);

  const handleSeekKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const video = videoRef.current;
      if (!video || total <= 0) return;

      let next: number | null = null;
      if (e.key === 'ArrowRight') {
        next = Math.min(total, video.currentTime + total * 0.05);
      } else if (e.key === 'ArrowLeft') {
        next = Math.max(0, video.currentTime - total * 0.05);
      } else if (e.key === 'Home') {
        next = 0;
      } else if (e.key === 'End') {
        next = total;
      }

      if (next === null) return;

      e.preventDefault();
      video.currentTime = next;
      setCurrent(next);
    },
    [total],
  );

  const aspectRatio = width && height ? `${width} / ${height}` : '16 / 9';
  const maxWidth = width ? Math.min(width, 400) : 360;
  const maxHeight = 240;
  const isHls = isHlsSource(src);
  const progress = total > 0 ? (current / total) * 100 : 0;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        maxWidth: fullscreen ? '100%' : maxWidth,
        width: '100%',
        maxHeight: fullscreen ? '100vh' : maxHeight,
        borderRadius: fullscreen ? 0 : 12,
        overflow: 'hidden',
        border: '1px solid var(--border-subtle, hsla(215,20%,50%,0.07))',
        boxShadow: '0 2px 8px color-mix(in oklch, var(--fg-strong) 6%, transparent)',
        background: color.mediaScrim,
        aspectRatio,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <video
        ref={videoRef}
        poster={poster}
        autoPlay={autoPlay}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={togglePlay}
        playsInline
        controls={false}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: 'pointer',
        }}
      />

      {/* 加载中占位（HLS 初始化前 currentSrc 为 null） */}
      {!currentSrc && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color.mediaTextFaint,
            fontSize: 12,
          }}
        >
          加载视频中…
        </div>
      )}

      {/* 播放进度条（常显，不随悬浮控件栏淡出） */}
      <div
        className="video-player__progress"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(total))}
        aria-valuenow={Math.max(0, Math.round(current))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleSeekKeyDown}
      >
        <div className="video-player__progress-track">
          <div className="video-player__progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="video-player__progress-thumb" style={{ left: `${progress}%` }} />
      </div>

      {/* 悬浮控件栏（上移 18px 让出进度条点击区） */}
      <div
        style={{
          position: 'absolute',
          bottom: 18,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: `linear-gradient(transparent 0%, ${color.mediaGradient} 100%)`,
          opacity: hover || !playing ? 1 : 0,
          transition: 'opacity 200ms ease',
          pointerEvents: hover || !playing ? 'auto' : 'none',
        }}
      >
        {/* 播放/暂停 */}
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--accent, #5cd4c0)',
            color: 'var(--fg-on-accent, #052e22)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            flexShrink: 0,
          }}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>

        {/* 文件名 */}
        {fileName && (
          <span
            style={{
              flex: 1,
              fontSize: 12,
              color: color.mediaTextStrong,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </span>
        )}

        {/* 时长标签 */}
        {duration !== undefined && duration > 0 && (
          <span style={{ fontSize: 11, color: color.mediaTextSubtle, fontFamily: 'monospace' }}>
            {formatDuration(duration)}
          </span>
        )}

        {/* 全屏 */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title="全屏"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: 'none',
            background: color.mediaControlBg,
            color: color.mediaTextContrast,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {fullscreen ? '\u2922' : '\u26F6'}
        </button>

        {/* 下载（HLS 流不提供下载） */}
        {!isHls && (
          <button
            type="button"
            onClick={download}
            title="下载"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: 'none',
              background: color.mediaControlBg,
              color: color.mediaTextContrast,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            ↓
          </button>
        )}
      </div>

      {/* 格式标签 */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '2px 6px',
          borderRadius: 4,
          background: color.mediaBadgeBg,
          color: color.mediaTextMuted,
          fontSize: 10,
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        {isHls ? 'HLS' : (mimeType?.split('/')[1]?.toUpperCase() ?? 'VIDEO')}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
