import { color } from '../tokens.js';
import { useState } from 'react';
import {
  CheckboxField,
  FormAdvancedFields,
  TextField,
  TransportTabs,
} from './MCPServerConfigFormPrimitives.js';
import type { MCPServerEntry } from './mcp-server-config-model.js';
import {
  genMcpServerId,
  parseMcpOAuthJson,
  parseMcpRecordJson,
  splitMcpList,
} from './mcp-server-config-utils.js';

interface MCPServerConfigFormProps {
  onAdd: (entry: MCPServerEntry) => void;
  formError: string | null;
  setFormError: (message: string | null) => void;
}

export function MCPServerConfigForm({ onAdd, formError, setFormError }: MCPServerConfigFormProps) {
  const [transport, setTransport] = useState<'sse' | 'stdio'>('sse');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [envJson, setEnvJson] = useState('');
  const [required, setRequired] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [disabledTools, setDisabledTools] = useState('');
  const [headersJson, setHeadersJson] = useState('');
  const [oauthJson, setOauthJson] = useState('');

  const canAdd = name.trim() && (!enabled || (transport === 'sse' ? url.trim() : command.trim()));

  function resetForm() {
    setId('');
    setName('');
    setUrl('');
    setCommand('');
    setArgs('');
    setCwd('');
    setEnvJson('');
    setRequired(false);
    setEnabled(true);
    setDisabledTools('');
    setHeadersJson('');
    setOauthJson('');
  }

  function handleAdd() {
    const trimName = name.trim();
    const trimId = id.trim() || genMcpServerId();
    if (!trimName) return;
    if (enabled && transport === 'sse' && !url.trim()) return;
    if (enabled && transport === 'stdio' && !command.trim()) return;

    let headers: Record<string, string> | undefined;
    let env: Record<string, string> | undefined;
    let oauth: MCPServerEntry['oauth'] | undefined;
    try {
      headers = parseMcpRecordJson(headersJson);
      env = parseMcpRecordJson(envJson);
      oauth = parseMcpOAuthJson(oauthJson);
      setFormError(null);
    } catch {
      setFormError('Headers / Env / OAuth 必须是有效 JSON，OAuth 也可以填 false。');
      return;
    }

    onAdd({
      id: trimId,
      name: trimName,
      transport,
      enabled,
      ...(transport === 'sse'
        ? { url: url.trim() }
        : {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            ...(env ? { env } : {}),
          }),
      ...(required ? { required } : {}),
      ...(disabledTools.trim() ? { disabledTools: splitMcpList(disabledTools) } : {}),
      ...(headers ? { headers } : {}),
      ...(oauth !== undefined ? { oauth } : {}),
    });
    resetForm();
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-default, hsla(215, 18%, 50%, 0.12))',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-3, 12px)',
        padding: 'var(--spacing-4, 16px) var(--spacing-6, 24px)',
      }}
    >
      <TransportTabs transport={transport} setTransport={setTransport} />
      <TextField
        id="mcp-id"
        label="服务器 ID"
        value={id}
        onChange={setId}
        placeholder="websearch 或自定义 id"
      />
      <TextField
        id="mcp-name"
        label="服务器名称"
        value={name}
        onChange={setName}
        placeholder="我的 MCP 服务器"
      />
      {transport === 'sse' ? (
        <TextField
          id="mcp-url"
          label="服务器 URL"
          value={url}
          onChange={setUrl}
          placeholder="https://mcp.example.com/sse"
        />
      ) : (
        <>
          <TextField
            id="mcp-command"
            label="命令"
            value={command}
            onChange={setCommand}
            placeholder="npx mcp-server"
          />
          <TextField
            id="mcp-args"
            label="参数（空格分隔）"
            value={args}
            onChange={setArgs}
            placeholder="--port 3000 --verbose"
          />
          <TextField
            id="mcp-cwd"
            label="工作目录 cwd"
            value={cwd}
            onChange={setCwd}
            placeholder=". 或 /path/to/workspace"
          />
        </>
      )}
      <CheckboxField checked={enabled} label="启用此服务器" onChange={setEnabled} />
      <CheckboxField
        checked={required}
        label="required（启动时优先保持可用）"
        onChange={setRequired}
      />
      <TextField
        id="mcp-disabled-tools"
        label="禁用工具（逗号分隔）"
        value={disabledTools}
        onChange={setDisabledTools}
        placeholder="search, create_issue"
      />
      <FormAdvancedFields
        transport={transport}
        headersJson={headersJson}
        setHeadersJson={setHeadersJson}
        oauthJson={oauthJson}
        setOauthJson={setOauthJson}
        envJson={envJson}
        setEnvJson={setEnvJson}
      />
      {formError ? (
        <div style={{ color: color.danger, fontSize: 12, lineHeight: 1.5 }}>{formError}</div>
      ) : null}
      <button
        type="button"
        onClick={handleAdd}
        disabled={!canAdd}
        style={{
          alignSelf: 'flex-start',
          background: canAdd ? 'var(--accent)' : 'var(--border-default, hsla(215, 18%, 50%, 0.12))',
          border: 'none',
          borderRadius: 'var(--radius-sm, 6px)',
          color: color.fgOnAccent,
          cursor: canAdd ? 'pointer' : 'not-allowed',
          fontSize: 12,
          fontWeight: 600,
          padding: 'var(--spacing-2, 8px) var(--spacing-4, 16px)',
        }}
      >
        + 添加服务器
      </button>
    </div>
  );
}
