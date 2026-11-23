import type { MemoryScopeType } from '@openAwork/web-client';
import { BP, IS } from '../shared/settings-section-styles.js';

interface Props {
  busy: boolean;
  editing: boolean;
  canSubmit: boolean;
  scopeType: MemoryScopeType;
  scopeId: string;
  name: string;
  body: string;
  setScopeType: (value: MemoryScopeType) => void;
  setScopeId: (value: string) => void;
  setName: (value: string) => void;
  setBody: (value: string) => void;
  submit: () => void;
  cancel: () => void;
}

export function MemoryRuleForm(props: Props) {
  return (
    <fieldset disabled={props.busy} style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}>
      <label>
        作用域
        <select
          aria-label="规则作用域"
          style={IS}
          value={props.scopeType}
          disabled={props.editing}
          onChange={(event) => props.setScopeType(event.target.value as MemoryScopeType)}
        >
          <option value="user">个人</option>
          <option value="workspace">项目</option>
          <option value="team">团队</option>
          <option value="channel_chat">渠道对话</option>
        </select>
      </label>
      {props.scopeType !== 'user' && (
        <label>
          作用域标识
          <input
            style={IS}
            aria-label="规则作用域标识"
            value={props.scopeId}
            readOnly={props.editing}
            onChange={(event) => props.setScopeId(event.target.value)}
          />
        </label>
      )}
      <label>
        名称
        <input
          style={IS}
          aria-label="规则名称"
          maxLength={200}
          value={props.name}
          readOnly={props.editing}
          onChange={(event) => props.setName(event.target.value)}
        />
      </label>
      <label>
        完整正文
        <textarea
          style={{ ...IS, width: '100%' }}
          aria-label="规则正文"
          rows={5}
          maxLength={8000}
          value={props.body}
          onChange={(event) => props.setBody(event.target.value)}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={BP} disabled={!props.canSubmit} onClick={props.submit}>
          {props.editing ? '提交规则修改' : '提交规则提议'}
        </button>
        {props.editing && (
          <button type="button" onClick={props.cancel}>
            取消编辑
          </button>
        )}
      </div>
    </fieldset>
  );
}
