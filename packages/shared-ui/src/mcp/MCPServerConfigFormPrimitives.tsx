import { color } from '../tokens.js';
import type { ChangeEvent } from 'react';
import { inputBase, labelStyle, secondaryButtonStyle } from './mcp-server-config-styles.js';

interface TransportTabsProps {
  transport: 'sse' | 'stdio';
  setTransport: (transport: 'sse' | 'stdio') => void;
}

export function TransportTabs({ transport, setTransport }: TransportTabsProps) {
  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-2, 8px)' }}>
      {(['sse', 'stdio'] as const).map((nextTransport) => (
        <button
          key={nextTransport}
          type="button"
          onClick={() => setTransport(nextTransport)}
          style={{
            ...secondaryButtonStyle,
            background: transport === nextTransport ? 'var(--accent)' : 'transparent',
            color: transport === nextTransport ? color.fgOnAccent : 'var(--fg-muted)',
          }}
        >
          {nextTransport.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export function TextField({ id, label, value, onChange, placeholder }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        style={inputBase}
      />
    </div>
  );
}

interface CheckboxFieldProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function CheckboxField({ checked, label, onChange }: CheckboxFieldProps) {
  return (
    <label style={{ ...labelStyle, marginBottom: 0 }}>
      <input
        checked={checked}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
        type="checkbox"
      />{' '}
      {label}
    </label>
  );
}

interface FormAdvancedFieldsProps {
  transport: 'sse' | 'stdio';
  headersJson: string;
  setHeadersJson: (value: string) => void;
  oauthJson: string;
  setOauthJson: (value: string) => void;
  envJson: string;
  setEnvJson: (value: string) => void;
}

export function FormAdvancedFields(props: FormAdvancedFieldsProps) {
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
        <textarea
          aria-label="新增 MCP headers JSON"
          placeholder={'headers JSON，例如 {"x-api-key":"..."}'}
          rows={3}
          value={props.headersJson}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            props.setHeadersJson(event.target.value)
          }
          style={inputBase}
        />
        <textarea
          aria-label="新增 MCP OAuth JSON"
          placeholder="oauth JSON 或 false"
          rows={3}
          value={props.oauthJson}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            props.setOauthJson(event.target.value)
          }
          style={inputBase}
        />
        {props.transport === 'stdio' ? (
          <textarea
            aria-label="新增 MCP env JSON"
            placeholder={'env JSON，例如 {"NODE_ENV":"production"}'}
            rows={3}
            value={props.envJson}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              props.setEnvJson(event.target.value)
            }
            style={inputBase}
          />
        ) : null}
      </div>
    </details>
  );
}
