/**
 * 极简 SSE 帧解析器（只覆盖网关实际用到的 `event:` / `data:` 两个字段）。
 *
 * 为什么不用 `EventSource`：生图流是 **POST + JSON body**，而 `EventSource`
 * 只能发 GET，参数只能塞进 query（token 与 prompt 都会进 URL/日志）。
 *
 * 为什么不用 `fetch` 一次性读完整流：生图的价值就在中间稿能实时看到，
 * 攒完再解析等于退化成非流式。
 *
 * 解析规则按 SSE 规范：**空行分帧**，帧内 `field: value` 逐行；
 * `data:` 多行按 `\n` 连接。未知字段与注释行（`:` 开头）直接忽略——
 * 部分中转会插入心跳，把未知帧当错误会让整条流误判失败。
 */

export interface ParsedSseFrame {
  data: string;
  event: string | null;
}

export interface SseFrameParser {
  /** 取出缓冲区里剩余的最后一帧（流结束前调用，处理没有空行收尾的实现）。 */
  flush: () => ParsedSseFrame[];
  /** 喂入一段新文本，返回其中**已完整**的帧。 */
  push: (chunk: string) => ParsedSseFrame[];
}

function parseFrameText(frameText: string): ParsedSseFrame | null {
  const dataLines: string[] = [];
  let event: string | null = null;

  for (const rawLine of frameText.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }

    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'data') {
      dataLines.push(value);
      continue;
    }
    if (field === 'event') {
      event = value;
    }
  }

  // 没有 `data:` 的帧（纯 `event:`、纯注释）对调用方没有意义——消费侧只按
  // `data` 载荷派发，保留空帧只会让上层多做一次无用的类型判断。
  if (dataLines.length === 0) {
    return null;
  }

  return { event, data: dataLines.join('\n') };
}

export function createSseFrameParser(): SseFrameParser {
  let buffer = '';

  const drain = (): ParsedSseFrame[] => {
    const frames: ParsedSseFrame[] = [];
    for (;;) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary === -1) {
        return frames;
      }

      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const frameText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + (match?.[0].length ?? 2));

      const frame = parseFrameText(frameText);
      if (frame) {
        frames.push(frame);
      }
    }
  };

  return {
    push: (chunk) => {
      buffer += chunk;
      return drain();
    },
    flush: () => {
      const frames = drain();
      const remainder = buffer;
      buffer = '';
      if (remainder.trim().length > 0) {
        const frame = parseFrameText(remainder);
        if (frame) {
          frames.push(frame);
        }
      }
      return frames;
    },
  };
}
