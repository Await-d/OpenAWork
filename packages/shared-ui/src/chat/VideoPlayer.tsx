import { useCallback, useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';

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
  return (
    src.toLowerCase().endsWith('.m3u8') ||
    src.includes('.m3u8?') ||
    src.includes('m3u8#')
  );
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
  const hlsRef = useRef<Hls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | null>(null);

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

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video && duration === undefined && video.duration && isFinite(video.duration)) {
      // 可以在此触发回调
    }
  }, [duration]);

  const aspectRatio = width && height ? `${width} / ${height}` : '16 / 9';
  const maxWidth = width ? Math.min(width, 400) : 360;
  const maxHeight = 240;
  const isHls = isHlsSource(src);

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
        background: '#000',
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
        onLoadedMetadata={onLoadedMetadata}
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
            color: 'rgba(255,255,255,0.5)',
            fontSize: 12,
          }}
        >
          加载视频中…
        </div>
      )}

      {/* 悬浮控件栏 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'linear-gradient(transparent 0%, rgba(0,0,0,0.6) 100%)',
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
              color: 'rgba(255,255,255,0.85)',
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
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
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
            background: 'rgba(255,255,255,0.15)',
            color: 'white',
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
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
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
          background: 'rgba(0,0,0,0.5)',
          color: 'rgba(255,255,255,0.7)',
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
