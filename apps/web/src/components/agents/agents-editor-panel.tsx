/**
 * Agent 管理页中列：分区编辑器。
 *
 * 相对旧版的变化：
 *   - 只读元信息（ID / 来源 / 时间 / fallback）移到右列检视面板，表单只留可编辑字段；
 *   - 表单按「基础 / 角色 / 模型 / 提示词与备注 / 危险操作」分组，组内用细分隔线而非嵌套卡片；
 *   - 启用开关收进头部（创建时改草稿，编辑自定义 Agent 时即时落库），底部只留保存动作。
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ManagedAgentPromptMetadata, ManagedAgentRecord } from '@openAwork/shared';
import { AgentAvatar, AgentsBadge, AgentsSwitch } from './agents-primitives.js';
import {
  CORE_ROLE_LABELS,
  CORE_ROLE_OPTIONS,
  ORIGIN_LABELS,
  PRESET_LABELS,
  PRESET_OPTIONS,
  SOURCE_LABELS,
  formatCanonicalRoleZh,
  parseAliases,
} from './agents-editor-state.js';
import type { AgentEditorState, EditorMode } from './agents-editor-state.js';

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="console-group">
      <div className="console-group__head">
        <span className="console-group__label">{label}</span>
      </div>
      {children}
    </div>
  );
}

function AgentForm({
  isBuiltin,
  promptMeta,
  state,
  setState,
}: {
  isBuiltin: boolean;
  /** 内置 Agent 的提示词覆盖状态（自定义 Agent 无此字段）。 */
  promptMeta?: ManagedAgentPromptMetadata;
  state: AgentEditorState;
  setState: Dispatch<SetStateAction<AgentEditorState>>;
}) {
  const patch = (partial: Partial<AgentEditorState>) =>
    setState((current) => ({ ...current, ...partial }));
  const fallbacks = parseAliases(state.fallbackModelsText);
  const hasPromptOverride = promptMeta?.hasPromptOverride === true;
  /** 当前版本的系统默认提示词；「恢复默认提示词」把编辑器内容填回它。 */
  const defaultPrompt = promptMeta?.defaultText ?? '';
  /** 编辑器内容已等于默认值——此时无需再「恢复」，按钮保持禁用。 */
  const isAtDefaultPrompt = state.systemPrompt === defaultPrompt;

  return (
    <>
      <Group label="基础">
        <div className="console-grid-2">
          <label className="console-label">
            名称
            <input
              className="console-field"
              value={state.label}
              placeholder="例如：架构顾问"
              disabled={isBuiltin}
              onChange={(event) => patch({ label: event.target.value })}
            />
          </label>
          <label className="console-label">
            别名（逗号分隔）
            <input
              className="console-field"
              value={state.aliasesText}
              placeholder="architect, reviewer, debugger"
              disabled={isBuiltin}
              onChange={(event) => patch({ aliasesText: event.target.value })}
            />
          </label>
        </div>
        <label className="console-label">
          说明
          <textarea
            className="console-textarea console-textarea--md"
            value={state.description}
            placeholder="描述这个 Agent 的用途与职责…"
            disabled={isBuiltin}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </label>
      </Group>

      <Group label="角色">
        <div className="console-grid-2">
          <label className="console-label">
            核心角色
            <select
              className="console-select"
              value={state.coreRole}
              disabled={isBuiltin}
              onChange={(event) =>
                patch({ coreRole: event.target.value as AgentEditorState['coreRole'] })
              }
            >
              <option value="">未设置</option>
              {CORE_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {CORE_ROLE_LABELS[role] ?? role}
                </option>
              ))}
            </select>
          </label>
          <label className="console-label">
            预设模式
            <select
              className="console-select"
              value={state.preset}
              disabled={isBuiltin}
              onChange={(event) =>
                patch({ preset: event.target.value as AgentEditorState['preset'] })
              }
            >
              <option value="">未设置</option>
              {PRESET_OPTIONS.map((preset) => (
                <option key={preset} value={preset}>
                  {PRESET_LABELS[preset] ?? preset}
                </option>
              ))}
            </select>
            <span className="console-label__hint">预设决定角色提示词的默认取向。</span>
          </label>
        </div>
      </Group>

      <Group label="模型">
        <div className="console-grid-2">
          <label className="console-label">
            默认模型
            <input
              className="console-field"
              value={state.model}
              placeholder="例如：openai/gpt-5.4 或 gpt-5.4"
              onChange={(event) => patch({ model: event.target.value })}
            />
          </label>
          <label className="console-label">
            Variant
            <input
              className="console-field"
              value={state.variant}
              placeholder="例如：high / medium / max"
              onChange={(event) => patch({ variant: event.target.value })}
            />
          </label>
        </div>
        <label className="console-label">
          回退模型链（逗号分隔，按序尝试）
          <textarea
            className="console-textarea console-textarea--md"
            value={state.fallbackModelsText}
            placeholder="例如：claude-opus-4-6, gpt-5.4, kimi-k2.5"
            onChange={(event) => patch({ fallbackModelsText: event.target.value })}
          />
          <span className="console-label__hint">留空时回退到参考默认值。</span>
        </label>
        {state.model || state.variant || fallbacks.length > 0 ? (
          <div className="console-tag-row">
            {state.model ? <AgentsBadge tone="accent">默认 {state.model}</AgentsBadge> : null}
            {state.variant ? <AgentsBadge>variant {state.variant}</AgentsBadge> : null}
            {fallbacks.map((fallback) => (
              <AgentsBadge key={fallback}>fallback {fallback}</AgentsBadge>
            ))}
          </div>
        ) : null}
      </Group>

      <Group label="提示词与备注">
        <label className="console-label">
          系统提示词
          {isBuiltin ? (
            <span className="console-label__hint">
              可覆盖内置提示词；覆盖后不再随版本升级更新，可点「恢复默认提示词」回到当前默认。
            </span>
          ) : (
            <span className="console-label__hint">留空时沿用该 Agent 的参考默认提示词。</span>
          )}
          <textarea
            className="console-textarea console-textarea--lg"
            value={state.systemPrompt}
            placeholder="可选：记录该 Agent 的系统提示词或执行说明…"
            onChange={(event) => patch({ systemPrompt: event.target.value })}
          />
        </label>
        {isBuiltin ? (
          <div className="console-check-row">
            <span className="console-label__hint">
              {hasPromptOverride ? '当前使用自定义提示词' : '当前使用系统默认提示词'}
            </span>
            <button
              type="button"
              className="console-btn"
              // 「恢复默认提示词」= 把编辑器内容**填回当前默认值**（而不是清空）。
              // 清空会让「本来没有覆盖」的用户也产生一次差异提交，服务端据此落一条
              // 空 override 对象（`sameAsDefault` 比较的右侧是默认文本，不等于 undefined）。
              // 填回默认值则会被服务端归一为「无覆盖」，语义与界面文案一致（复查 V-09）。
              disabled={isAtDefaultPrompt}
              title={isAtDefaultPrompt ? '编辑器内容已是系统默认提示词' : '填回系统默认提示词'}
              onClick={() => patch({ systemPrompt: defaultPrompt })}
            >
              恢复默认提示词
            </button>
          </div>
        ) : null}
        <label className="console-label">
          备注
          <textarea
            className="console-textarea console-textarea--sm"
            value={state.note}
            placeholder="记录这个 Agent 的使用注意事项…"
            disabled={isBuiltin}
            onChange={(event) => patch({ note: event.target.value })}
          />
        </label>
      </Group>
    </>
  );
}

export function AgentsEditorPanel({
  editorMode,
  selectedAgent,
  editorState,
  setEditorState,
  canSave,
  saving,
  saveMessage,
  onCreate,
  onCancelCreate,
  onResetDraft,
  onSave,
  onToggleEnabled,
  onResetOne,
  onRemove,
}: {
  editorMode: EditorMode;
  selectedAgent: ManagedAgentRecord | null;
  editorState: AgentEditorState;
  setEditorState: Dispatch<SetStateAction<AgentEditorState>>;
  canSave: boolean;
  saving: boolean;
  saveMessage: string | null;
  onCreate: () => void;
  onCancelCreate: () => void;
  onResetDraft: () => void;
  onSave: () => void;
  onToggleEnabled: () => void;
  onResetOne: () => void;
  onRemove: () => void;
}) {
  const isCreate = editorMode === 'create';
  const isBuiltin = selectedAgent?.origin === 'builtin';
  const role = selectedAgent ? formatCanonicalRoleZh(selectedAgent) : undefined;

  return (
    <section className="console-col" aria-label="Agent 编辑器">
      <div className="agents-editor__head">
        {isCreate ? (
          <div className="console-title-group">
            <div className="agents-editor__name">新增自定义 Agent</div>
            <div className="console-subline">创建后会进入智能体目录，并可被能力目录消费。</div>
          </div>
        ) : !selectedAgent ? (
          <div className="console-title-group">
            <div className="agents-editor__name">未选择 Agent</div>
            <div className="console-subline">从左侧目录选择，或新增一个自定义 Agent。</div>
          </div>
        ) : (
          <>
            <AgentAvatar label={selectedAgent.label} origin={selectedAgent.origin} />
            <div className="console-title-group">
              <div className="agents-editor__name">{selectedAgent.label}</div>
              <div className="console-subline">
                {selectedAgent.id} · {ORIGIN_LABELS[selectedAgent.origin]} ·{' '}
                {SOURCE_LABELS[selectedAgent.source]}
              </div>
            </div>
            {role ? <AgentsBadge tone="accent">{role}</AgentsBadge> : null}
            {selectedAgent.hasOverrides ? <AgentsBadge tone="contrast">已修改</AgentsBadge> : null}
          </>
        )}

        <span className="console-spacer" />

        {isCreate ? (
          <label className="console-check-row">
            启用
            <AgentsSwitch
              checked={editorState.enabled}
              label="创建后立即启用"
              onChange={() =>
                setEditorState((current) => ({ ...current, enabled: !current.enabled }))
              }
            />
          </label>
        ) : selectedAgent ? (
          isBuiltin ? (
            <span className="console-statline">启用状态由系统管理</span>
          ) : (
            <label className="console-check-row">
              {selectedAgent.enabled ? '已启用' : '已禁用'}
              <AgentsSwitch
                checked={selectedAgent.enabled}
                label={selectedAgent.enabled ? '禁用该 Agent' : '启用该 Agent'}
                disabled={saving}
                onChange={onToggleEnabled}
              />
            </label>
          )
        ) : null}
      </div>

      <div className="console-col__scroll">
        {isCreate || selectedAgent ? (
          <div className="agents-editor__body">
            {isBuiltin ? (
              <div className="console-notice">
                内置 Agent 的名称、角色与启用状态由系统固定管理；这里可调整模型配置与系统提示词。
              </div>
            ) : null}

            <AgentForm
              isBuiltin={isBuiltin === true}
              promptMeta={selectedAgent?.promptMetadata}
              state={editorState}
              setState={setEditorState}
            />

            {!isCreate && selectedAgent ? (
              <Group label="危险操作">
                <div className="console-danger-zone">
                  <p>恢复默认会丢弃该 Agent 的全部本地覆盖；移除后别名与提示词一并失效。</p>
                  <button
                    type="button"
                    className="console-btn"
                    disabled={saving}
                    onClick={onResetOne}
                  >
                    恢复默认
                  </button>
                  {selectedAgent.removable ? (
                    <button
                      type="button"
                      className="console-btn console-btn--danger"
                      disabled={saving}
                      onClick={onRemove}
                    >
                      移除 Agent
                    </button>
                  ) : null}
                </div>
              </Group>
            ) : null}
          </div>
        ) : (
          <div className="console-empty">从左侧选择 Agent，或新增一个自定义 Agent。</div>
        )}
      </div>

      <div className="agents-editor__foot">
        {isCreate ? (
          <>
            <button
              type="button"
              className="console-btn console-btn--primary"
              disabled={!canSave || saving}
              onClick={onCreate}
            >
              {saving ? '创建中…' : '创建 Agent'}
            </button>
            <button
              type="button"
              className="console-btn"
              disabled={saving}
              onClick={onCancelCreate}
            >
              取消
            </button>
          </>
        ) : selectedAgent ? (
          <>
            <button
              type="button"
              className="console-btn console-btn--primary"
              disabled={!canSave || saving}
              onClick={onSave}
            >
              {saving ? '保存中…' : '保存变更'}
            </button>
            <button type="button" className="console-btn" disabled={saving} onClick={onResetDraft}>
              放弃修改
            </button>
            {saveMessage ? <span className="console-save-state">{saveMessage}</span> : null}
            <span className="console-spacer" />
            <span className="console-statline">
              最近更新 <b>{selectedAgent.updatedAt}</b>
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}
