import type { MCPServerEntry } from './mcp-server-config-model.js';
import {
  parseMcpOAuthJson,
  parseMcpRecordJson,
  stringifyMcpJson,
} from './mcp-server-config-utils.js';
import { inputBase, labelStyle } from './mcp-server-config-styles.js';

interface TransportEditorProps {
  server: MCPServerEntry;
  transport: 'sse' | 'stdio';
  onUpdate: (patch: Partial<MCPServerEntry>) => void;
}

export function TransportEditor({ server, transport, onUpdate }: TransportEditorProps) {
  return (
    <>
      <select
        aria-label="MCP transport"
        value={transport}
        onChange={(event) => onUpdate({ transport: event.target.value as 'sse' | 'stdio' })}
        style={inputBase}
      >
        <option value="sse">SSE</option>
        <option value="stdio">stdio</option>
      </select>
      {transport === 'sse' ? (
        <input
          aria-label="MCP URL"
          placeholder="https://mcp.example.com/sse"
          value={server.url ?? ''}
          onChange={(event) => onUpdate({ url: event.target.value })}
          style={inputBase}
        />
      ) : (
        <input
          aria-label="MCP command"
          placeholder="npx"
          value={server.command ?? ''}
          onChange={(event) => onUpdate({ command: event.target.value })}
          style={inputBase}
        />
      )}
    </>
  );
}

interface ServerAdvancedFieldsProps {
  server: MCPServerEntry;
  transport: 'sse' | 'stdio';
  onUpdate: (patch: Partial<MCPServerEntry>) => void;
  setFormError: (message: string | null) => void;
}

export function ServerAdvancedFields({
  server,
  transport,
  onUpdate,
  setFormError,
}: ServerAdvancedFieldsProps) {
  return (
    <details>
      <summary style={{ color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 12 }}>
        高级字段
      </summary>
      <div
        style={{
          display: 'grid',
          gap: 'var(--spacing-2, 8px)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          marginTop: 'var(--spacing-2, 8px)',
        }}
      >
        {transport === 'stdio' ? (
          <StdioAdvancedFields server={server} onUpdate={onUpdate} setFormError={setFormError} />
        ) : null}
        <textarea
          aria-label="MCP headers JSON"
          placeholder={'headers JSON，例如 {"x-api-key":"..."}'}
          rows={3}
          value={stringifyMcpJson(server.headers)}
          onChange={(event) => {
            try {
              onUpdate({ headers: parseMcpRecordJson(event.target.value) });
              setFormError(null);
            } catch {
              setFormError('Headers 必须是有效 JSON 对象。');
            }
          }}
          style={inputBase}
        />
        <textarea
          aria-label="MCP OAuth JSON"
          placeholder="oauth JSON 或 false"
          rows={3}
          value={stringifyMcpJson(server.oauth)}
          onChange={(event) => {
            try {
              onUpdate({ oauth: parseMcpOAuthJson(event.target.value) });
              setFormError(null);
            } catch {
              setFormError('OAuth 必须是有效 JSON，或 false。');
            }
          }}
          style={inputBase}
        />
      </div>
    </details>
  );
}

interface StdioAdvancedFieldsProps {
  server: MCPServerEntry;
  onUpdate: (patch: Partial<MCPServerEntry>) => void;
  setFormError: (message: string | null) => void;
}

function StdioAdvancedFields({ server, onUpdate, setFormError }: StdioAdvancedFieldsProps) {
  return (
    <>
      <input
        aria-label="MCP args"
        placeholder="args，空格分隔"
        value={(server.args ?? []).join(' ')}
        onChange={(event) =>
          onUpdate({
            args: event.target.value.trim() ? event.target.value.trim().split(/\s+/) : [],
          })
        }
        style={inputBase}
      />
      <input
        aria-label="MCP cwd"
        placeholder="cwd，例如 . 或 /path/to/workspace"
        value={server.cwd ?? ''}
        onChange={(event) => onUpdate({ cwd: event.target.value.trim() || undefined })}
        style={inputBase}
      />
      <textarea
        aria-label="MCP env JSON"
        placeholder={'env JSON，例如 {"NODE_ENV":"production"}'}
        rows={3}
        value={stringifyMcpJson(server.env)}
        onChange={(event) => {
          try {
            onUpdate({ env: parseMcpRecordJson(event.target.value) });
            setFormError(null);
          } catch {
            setFormError('Env 必须是有效 JSON 对象。');
          }
        }}
        style={inputBase}
      />
      <label style={{ ...labelStyle, alignSelf: 'center', marginBottom: 0 }}>
        <input
          checked={server.required === true}
          onChange={(event) => onUpdate({ required: event.target.checked })}
          type="checkbox"
        />{' '}
        required
      </label>
    </>
  );
}
