import type { ToolParameters } from './tool-parameter-schema.js';
import {
  buildDesktopAutomationParameters,
  buildDesktopControlParameters,
} from '../desktop-tool-parameters.js';

export function buildMediaDesktopParameters(name: string): ToolParameters | undefined {
  switch (name) {
    case 'desktop_automation':
      return buildDesktopAutomationParameters();
    case 'desktop_control':
      return buildDesktopControlParameters();
    case 'computer_use':
      return {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: '用自然语言描述要让系统桌面完成的任务，例如「打开系统设置」。',
          },
          maxSteps: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: '最大循环步数（可选，1–100）；省略时由主循环使用默认上限。',
          },
        },
        required: ['instruction'],
        additionalProperties: false,
      };
    case 'look_at':
      return {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '要检视的本地文件的工作区绝对路径。file_path 与 image_data 只允许传其一。',
          },
          image_data: {
            type: 'string',
            description:
              'Base64 图片字节、data:URL，或 HTTP/HTTPS 远程图片 URL。file_path 与 image_data 只允许传其一。',
          },
          goal: {
            type: 'string',
            description: '简明指出希望从输入中提取什么。',
          },
          offset: {
            type: 'number',
            description:
              'PDF 文本的起始行号（从 1 开始，默认 1）。仅当上一次结果被截断并提示 Use offset=... 时用于续读。',
          },
        },
        required: [],
        additionalProperties: false,
      };
    case 'generate_image':
      return {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '描述要生成图片的文本 prompt。',
          },
          size: {
            type: 'string',
            description:
              '图片尺寸，WxH 格式。优先选预设：1K — "1024x1024"（1:1）、"1536x1024"（3:2）、"1024x1536"（2:3）；2K（自动提到 high quality）— "2048x2048"（1:1）、"2048x1152"（16:9）、"1152x2048"（9:16）；4K（实验性、慢、仅走 relay）— "3840x2160"（16:9）、"2160x3840"（9:16）。自定义尺寸须同时满足：最长边 ≤ 3840、宽高都是 16 的倍数、长宽比 ≤ 3:1、总像素 [655360, 8294400]。不传时用用户配置。',
          },
          quality: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              '图片质量："low"重速度、"medium"平衡、"high"重细节。2K / 4K 尺寸会被服务端自动提到 "high"。不传时用用户配置。',
          },
          outputFormat: {
            type: 'string',
            enum: ['png', 'jpeg', 'webp'],
            description:
              '输出文件格式："png"（默认、无损）、"jpeg"（较小、不支持透明）、"webp"（现代、较小）。不传时用用户配置。',
          },
          background: {
            type: 'string',
            enum: ['auto', 'opaque'],
            description:
              '背景处理："auto" 由模型决定（PNG/WebP 下可能产生透明）；"opaque" 强制不透明。不传时用用户配置。',
          },
        },
        required: ['prompt'],
        additionalProperties: false,
      };
    case 'convert_media':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '媒体来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
          targetFormat: {
            type: 'string',
            enum: [
              'mp3',
              'wav',
              'ogg',
              'aac',
              'flac',
              'm4a',
              'mp4',
              'webm',
              'mkv',
              'mov',
              'avi',
              'gif',
              'png',
              'jpg',
              'webp',
              'weba',
            ],
            description: '目标格式',
          },
          videoQuality: {
            type: 'integer',
            minimum: 0,
            maximum: 51,
            description: '视频编码质量 CRF 值（0-51，越低质量越高，默认 23）',
          },
          audioBitrate: { type: 'string', description: '音频比特率，如 "128k"' },
          videoScale: { type: 'string', description: '视频分辨率缩放，如 "1280:-1"' },
          videoFps: { type: 'integer', minimum: 1, maximum: 60, description: '视频帧率' },
          startTime: { type: 'number', minimum: 0, description: '截取起始时间（秒）' },
          duration: { type: 'number', minimum: 0, description: '截取持续时间（秒）' },
        },
        required: ['source', 'targetFormat'],
        additionalProperties: false,
      };
    case 'extract_media_info':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '媒体来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
        },
        required: ['source'],
        additionalProperties: false,
      };
    case 'extract_video_frame':
      return {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: '视频来源：artifactId、data:URL 或 HTTP/HTTPS 远程 URL',
          },
          timestamp: {
            type: 'number',
            minimum: 0,
            description: '提取帧的时间戳（秒），默认取第 1 秒',
          },
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
            description: '提取多帧的数量（1-10），均匀分布',
          },
          width: {
            type: 'integer',
            minimum: 16,
            maximum: 3840,
            description: '输出帧的宽度（像素），高度自动等比缩放',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpg'],
            description: '输出图片格式：png（默认）或 jpg',
          },
        },
        required: ['source'],
        additionalProperties: false,
      };
    case 'generate_audio':
      return {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '要转为语音的文本内容，支持中英文混合，最长 5000 字符',
          },
          voice: {
            type: 'string',
            enum: [
              'zh-CN-XiaoxiaoNeural',
              'zh-CN-YunxiNeural',
              'zh-CN-YunyangNeural',
              'zh-CN-XiaoyiNeural',
              'zh-CN-YunjianNeural',
              'en-US-AriaNeural',
              'en-US-GuyNeural',
              'en-US-JennyNeural',
            ],
            description: '语音角色，默认 zh-CN-XiaoxiaoNeural',
          },
          rate: { type: 'number', minimum: 0.5, maximum: 2, description: '语速倍率，1.0=正常速度' },
          volume: { type: 'number', minimum: 0, maximum: 1, description: '音量 0-1，默认 1.0' },
          pitch: { type: 'string', description: '音调调整，如 "+10Hz" 或 "-5Hz"' },
          outputFormat: {
            type: 'string',
            enum: ['mp3', 'wav'],
            description: '输出格式：mp3（默认）或 wav',
          },
        },
        required: ['text'],
        additionalProperties: false,
      };
    default:
      return undefined;
  }
}
