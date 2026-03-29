import type { Attachment } from './index.js';

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
  onProgress?: (pct: number) => void;
}

export interface FileChunk {
  fileId: string;
  index: number;
  total: number;
  content: string;
  startByte: number;
  endByte: number;
}

export interface FileChunker {
  chunkText(fileId: string, content: string, opts?: ChunkOptions): FileChunk[];
  chunkAttachment(attachment: Attachment, opts?: ChunkOptions): Promise<FileChunk[]>;
}

const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP = 200;

function getByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export class FileChunkerImpl implements FileChunker {
  chunkText(fileId: string, content: string, opts?: ChunkOptions): FileChunk[] {
    const chunkSize = Math.max(1, opts?.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const overlap = Math.max(0, Math.min(opts?.overlap ?? DEFAULT_OVERLAP, chunkSize - 1));

    if (content.length === 0) {
      opts?.onProgress?.(100);
      return [];
    }

    const step = Math.max(1, chunkSize - overlap);
    const ranges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < content.length; start += step) {
      const end = Math.min(content.length, start + chunkSize);
      ranges.push({ start, end });
      if (end >= content.length) {
        break;
      }
    }

    const total = ranges.length;
    const chunks: FileChunk[] = ranges.map((range, index) => {
      const prefix = content.slice(0, range.start);
      const segment = content.slice(range.start, range.end);
      const startByte = getByteLength(prefix);
      const endByte = startByte + getByteLength(segment);
      opts?.onProgress?.(Math.round(((index + 1) / total) * 100));
      return {
        fileId,
        index,
        total,
        content: segment,
        startByte,
        endByte,
      };
    });

    return chunks;
  }

  async chunkAttachment(attachment: Attachment, opts?: ChunkOptions): Promise<FileChunk[]> {
    const text =
      typeof attachment.data === 'string'
        ? attachment.data
        : new TextDecoder().decode(attachment.data);
    return this.chunkText(attachment.id, text, opts);
  }
}
