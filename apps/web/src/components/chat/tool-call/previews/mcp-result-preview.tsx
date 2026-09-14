import { ExpandableOutput } from '../shared/expandable-output.js';
import { JsonPreview } from './json-preview.js';

/**
 * MCP tool results arrive as `{ content: [...], structuredContent?, isError? }`
 * (the gateway's `skill_mcp` even returns that envelope JSON-stringified).
 * Rendering the envelope verbatim forces users to read a raw JSON blob, so we
 * unpack the content blocks into readable text / images and only fall back to
 * a JSON view for the structured payload.
 */
export interface McpContentBlock {
  data?: string;
  mimeType?: string;
  text?: string;
  type: string;
  uri?: string;
}

export interface McpResultView {
  blocks: McpContentBlock[];
  isError: boolean;
  structuredContent?: unknown;
  text: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Accept either an already-parsed object or a JSON string envelope. */
function coerceRecord(output: unknown): Record<string, unknown> | null {
  const direct = asRecord(output);
  if (direct) return direct;
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    return asRecord(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

function toContentBlock(value: unknown): McpContentBlock | null {
  const record = asRecord(value);
  if (!record) return null;
  const type = record['type'];
  if (typeof type !== 'string' || type.length === 0) return null;
  const block: McpContentBlock = { type };
  if (typeof record['text'] === 'string') block.text = record['text'];
  if (typeof record['data'] === 'string') block.data = record['data'];
  if (typeof record['mimeType'] === 'string') block.mimeType = record['mimeType'];
  if (typeof record['uri'] === 'string') block.uri = record['uri'];
  return block;
}

export function extractMcpResult(output: unknown): McpResultView | null {
  const record = coerceRecord(output);
  if (!record) return null;

  const rawContent = record['content'];
  const hasStructured = record['structuredContent'] !== undefined;
  if (!Array.isArray(rawContent) && !hasStructured) return null;

  const blocks: McpContentBlock[] = [];
  if (Array.isArray(rawContent)) {
    for (const item of rawContent) {
      const block = toContentBlock(item);
      if (block) blocks.push(block);
    }
  }

  if (blocks.length === 0 && !hasStructured) return null;

  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('\n\n');

  return {
    blocks,
    isError: record['isError'] === true,
    ...(hasStructured ? { structuredContent: record['structuredContent'] } : {}),
    text,
  };
}

function McpBlock({ block }: { block: McpContentBlock }) {
  if (block.type === 'text' && typeof block.text === 'string') {
    return <ExpandableOutput text={block.text} maxChars={800} maxLines={24} />;
  }
  if (block.type === 'image' && block.data && block.mimeType) {
    return (
      <img
        className="mcp-result-image"
        src={`data:${block.mimeType};base64,${block.data}`}
        alt={block.mimeType}
        loading="lazy"
      />
    );
  }
  if (block.type === 'resource' && block.uri) {
    return <div className="mcp-result-label">资源 · {block.uri}</div>;
  }
  return <div className="mcp-result-label">[{block.type}]</div>;
}

export function McpResultPreview({ result }: { result: McpResultView }) {
  return (
    <div className="mcp-result" data-error={result.isError ? 'true' : undefined}>
      {result.isError && <div className="mcp-result-error">MCP 调用返回错误</div>}
      {result.blocks.map((block, index) => (
        <McpBlock key={`${block.type}-${index}`} block={block} />
      ))}
      {result.structuredContent !== undefined && (
        <JsonPreview data={result.structuredContent} maxLines={16} />
      )}
    </div>
  );
}
