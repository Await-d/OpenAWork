import type { MessageContent } from '@openAwork/shared';
import { AudioContentBlock } from './audio-content-block.js';
import { VideoContentBlock } from './video-content-block.js';

/**
 * 媒体内容块渲染分发器。
 *
 * 遍历消息 content 数组，找到所有 input_audio / input_video 块并渲染。
 * 对非媒体类型返回 null，由上层消息渲染器处理其他类型。
 */
export function renderMediaContent(content: MessageContent[]): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block) continue;

    switch (block.type) {
      case 'input_audio':
        nodes.push(
          <AudioContentBlock
            key={`audio-${i}`}
            artifactId={block.artifactId}
            audioUrl={block.audioUrl}
            fileName={block.fileName}
            mimeType={block.mimeType}
            duration={block.duration}
            transcript={block.transcript}
          />,
        );
        break;
      case 'input_video':
        nodes.push(
          <VideoContentBlock
            key={`video-${i}`}
            artifactId={block.artifactId}
            videoUrl={block.videoUrl}
            fileName={block.fileName}
            mimeType={block.mimeType}
            duration={block.duration}
            thumbnailUrl={block.thumbnailUrl}
            width={block.width}
            height={block.height}
          />,
        );
        break;
      default:
        // 非媒体类型由上层处理
        break;
    }
  }

  return nodes;
}

/**
 * 从消息 content 中提取所有音频块。
 */
export function extractInputAudio(content: unknown[]): InputAudioItem[] {
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    if (obj['type'] !== 'input_audio') return [];
    return [{
      ...(typeof obj['artifactId'] === 'string' ? { artifactId: obj['artifactId'] } : {}),
      ...(typeof obj['audioUrl'] === 'string' ? { audioUrl: obj['audioUrl'] } : {}),
      ...(typeof obj['fileName'] === 'string' ? { fileName: obj['fileName'] } : {}),
      ...(typeof obj['mimeType'] === 'string' ? { mimeType: obj['mimeType'] } : {}),
      ...(typeof obj['duration'] === 'number' ? { duration: obj['duration'] } : {}),
      ...(typeof obj['transcript'] === 'string' ? { transcript: obj['transcript'] } : {}),
    }];
  });
}

/**
 * 从消息 content 中提取所有视频块。
 */
export function extractInputVideo(content: unknown[]): InputVideoItem[] {
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const obj = item as Record<string, unknown>;
    if (obj['type'] !== 'input_video') return [];
    return [{
      ...(typeof obj['artifactId'] === 'string' ? { artifactId: obj['artifactId'] } : {}),
      ...(typeof obj['videoUrl'] === 'string' ? { videoUrl: obj['videoUrl'] } : {}),
      ...(typeof obj['fileName'] === 'string' ? { fileName: obj['fileName'] } : {}),
      ...(typeof obj['mimeType'] === 'string' ? { mimeType: obj['mimeType'] } : {}),
      ...(typeof obj['duration'] === 'number' ? { duration: obj['duration'] } : {}),
      ...(typeof obj['thumbnailUrl'] === 'string' ? { thumbnailUrl: obj['thumbnailUrl'] } : {}),
      ...(typeof obj['width'] === 'number' ? { width: obj['width'] } : {}),
      ...(typeof obj['height'] === 'number' ? { height: obj['height'] } : {}),
    }];
  });
}

interface InputAudioItem {
  artifactId?: string;
  audioUrl?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  transcript?: string;
}

interface InputVideoItem {
  artifactId?: string;
  videoUrl?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}
