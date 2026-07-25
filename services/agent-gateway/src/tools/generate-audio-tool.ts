import type { ToolDefinition } from '@openAwork/agent-core';
import { z } from 'zod';
import { createMediaArtifact } from '../media/media-artifact.js';
import { probeMediaBuffer } from '../media/ffprobe-bridge.js';

const generateAudioInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(5000)
    .describe('要转为语音的文本内容。支持中英文混合。最长 5000 字符'),
  voice: z
    .enum([
      'zh-CN-XiaoxiaoNeural',
      'zh-CN-YunxiNeural',
      'zh-CN-YunyangNeural',
      'zh-CN-XiaoyiNeural',
      'zh-CN-YunjianNeural',
      'en-US-AriaNeural',
      'en-US-GuyNeural',
      'en-US-JennyNeural',
    ])
    .optional()
    .describe('语音角色。默认 zh-CN-XiaoxiaoNeural（女声）。可选中文角色和英文角色'),
  rate: z.number().min(0.5).max(2).optional().describe('语速倍率，1.0=正常速度。默认 1.0'),
  volume: z.number().min(0).max(1).optional().describe('音量 0-1，默认 1.0'),
  pitch: z.string().optional().describe('音调调整，如 "+10Hz" 或 "-5Hz"。默认不调整'),
  outputFormat: z.enum(['mp3', 'wav']).optional().describe('输出格式：mp3（默认）或 wav'),
});

const generateAudioOutputSchema = z.string();

export type GenerateAudioToolInput = z.infer<typeof generateAudioInputSchema>;

export const generateAudioToolDefinition: ToolDefinition<
  typeof generateAudioInputSchema,
  typeof generateAudioOutputSchema
> = {
  name: 'generate_audio',
  description:
    '使用 Edge TTS（微软免费在线语音合成）将文本转为语音音频。' +
    '无需 API Key，完全免费。支持中英文多种语音角色、语速/音量/音调调节。' +
    '生成的音频会在对话中内联播放。' +
    '用户要你朗读、配音、生成语音、做 TTS 时使用此工具。',
  inputSchema: generateAudioInputSchema,
  outputSchema: generateAudioOutputSchema,
  execute: async () => {
    throw new Error('generate_audio must execute through the gateway-managed sandbox path');
  },
};

export async function executeGenerateAudioTool(input: {
  signal?: AbortSignal;
  sessionId: string;
  userId: string;
  toolCallId: string;
  toolInput: GenerateAudioToolInput;
}): Promise<{ output: string; isError: boolean }> {
  const { signal, sessionId, userId, toolCallId, toolInput } = input;

  try {
    const voice = toolInput.voice ?? 'zh-CN-XiaoxiaoNeural';
    const rate = toolInput.rate ?? 1.0;
    const volume = toolInput.volume ?? 1.0;
    const outputFormat = toolInput.outputFormat ?? 'mp3';

    // 使用 edge-tts 命令行工具或直接 WebSocket API
    // 这里我们使用 edge-tts 的 Node.js 实现
    const audioBuffer = await synthesizeWithEdgeTTS(
      toolInput.text,
      voice,
      rate,
      volume,
      toolInput.pitch,
      outputFormat,
      signal,
    );

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return { output: 'TTS 合成失败：生成的音频为空', isError: true };
    }

    const mimeType = outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg';

    // 尝试提取音频信息
    let duration: number | undefined;
    try {
      const info = await probeMediaBuffer(audioBuffer, mimeType, signal);
      duration = info.duration;
    } catch {
      // probe 失败不阻断
    }

    const artifactResult = createMediaArtifact({
      userId,
      sessionId,
      buffer: audioBuffer,
      mimeType,
      title: `语音合成: ${toolInput.text.slice(0, 40)}${toolInput.text.length > 40 ? '…' : ''}`,
      mediaInfo: { duration },
      sourceKind: 'tool_generate_audio',
      toolCallId,
      createdByNote: 'generate_audio tool (Edge TTS)',
    });

    const summary = {
      success: true,
      artifactId: artifactResult.artifactId,
      fileName: artifactResult.fileName,
      mimeType,
      voice,
      rate,
      volume,
      ...(duration ? { duration: Math.round(duration * 10) / 10 } : {}),
      sizeBytes: audioBuffer.byteLength,
      textPreview: toolInput.text.slice(0, 100),
      summary: `✅ 已生成语音（${voice} · ${outputFormat.toUpperCase()}${duration ? ` · ${Math.round(duration)}s` : ''}）`,
    };

    return { output: JSON.stringify(summary), isError: false };
  } catch (error) {
    return {
      output: `音频生成失败: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

/**
 * 使用 Edge TTS WebSocket API 合成语音。
 *
 * Edge TTS 是微软提供的免费在线 TTS 服务，通过 WebSocket
 * 协议传输 SSML 标记并接收 MP3/WAV 音频流。
 */
async function synthesizeWithEdgeTTS(
  text: string,
  voice: string,
  rate: number,
  volume: number,
  pitch: string | undefined,
  outputFormat: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const WebSocket = (await import('ws')).default;

  // Edge TTS WebSocket URL
  const wsUrl = new URL(
    'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
  );
  wsUrl.searchParams.set('TrustedClientToken', '6A5AA1D4EAFF4E9FB37E23D68491D6F4');

  // 构造 SSML
  const ratePercent = `${rate > 1 ? '+' : ''}${Math.round((rate - 1) * 100)}%`;
  const volumePercent = `${volume < 1 ? '-' : '+'}${Math.round(Math.abs(volume - 1) * 100)}%`;
  const pitchValue = pitch ?? '+0Hz';

  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${ratePercent}' volume='${volumePercent}' pitch='${pitchValue}'>` +
    escapeXml(text) +
    `</prosody></voice></speak>`;

  return new Promise<Buffer>((resolve, reject) => {
    const audioChunks: Buffer[] = [];
    let resolved = false;

    const ws = new WebSocket(wsUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      },
    });

    const onAbort = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('Aborted'));
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ws.on('open', () => {
      // 发送配置消息
      const configMessage = JSON.stringify({
        context: {
          synthesis: {
            metadata: {
              outputFormat:
                outputFormat === 'wav'
                  ? 'audio-24khz-48kbitrate-mono-mp3'
                  : 'audio-24khz-48kbitrate-mono-mp3',
              token: 'd4bea4e4a7e94e9fb37e23d68491d6f4',
            },
          },
        },
      });
      ws.send(configMessage);

      // 发送 SSML
      const ssmlMessage = JSON.stringify({
        'X-RequestId': 'edge-tts-' + Date.now(),
        'Content-Type': 'application/ssml+xml',
        'X-Timestamp': new Date().toISOString(),
        Path: 'ssml',
        body: ssml,
      });
      ws.send(ssmlMessage);
    });

    ws.on('message', (data: Buffer) => {
      const message = data.toString('utf-8');

      // 检查是否是音频数据（二进制消息以 "Path:audio\r\n" 开头）
      if (message.startsWith('Path:audio')) {
        const audioData = data.subarray(message.indexOf('\r\n\r\n') + 4);
        if (audioData.length > 0) {
          audioChunks.push(audioData);
        }
      } else if (message.includes('Path:turn.end')) {
        resolved = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        ws.close();
        resolve(Buffer.concat(audioChunks));
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error(`Edge TTS WebSocket 错误: ${err.message}`));
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('Edge TTS 连接关闭但未收到音频数据'));
        }
      }
    });

    // 超时保护
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        ws.close();
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('Edge TTS 超时'));
        }
      }
    }, 30000);
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
