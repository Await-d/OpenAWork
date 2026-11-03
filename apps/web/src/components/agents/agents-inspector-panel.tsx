/**
 * Agent 管理页右列：只读检视（元信息 / 覆盖情况 / 别名 / 外观）。
 *
 * 这些字段原先和编辑表单挤在同一列（`InfoRow` 贴在表单上方），改配置时要来回滚动；
 * 拆到独立只读列后，编辑与「我在改什么」可以同屏对照。
 */

import { AgentsBadge } from './agents-primitives.js';
import { ORIGIN_LABELS, SOURCE_LABELS, formatCanonicalRoleZh } from './agents-editor-state.js';
import type { ManagedAgentRecord } from '@openAwork/shared';

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="console-meta__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CheckRow({ label, value, on }: { label: string; value: string; on: boolean }) {
  return (
    <div className="console-check-row">
      <span aria-hidden="true" className={`console-dot${on ? '' : ' is-off'}`} />
      <b>{label}</b>
      {value}
    </div>
  );
}

export interface AgentPromptSummary {
  /** 是否存在用户级提示词覆盖。 */
  overridden: boolean;
  /** 「提示词来源」行的取值文案。 */
  sourceLabel: string;
  /** 当前生效的提示词文本（用户覆盖值，或系统默认值）。 */
  effectiveText: string;
  /** 当前版本的默认提示词；仅内置 Agent 会返回（自定义 Agent 无回落目标）。 */
  defaultText: string;
  /** 覆盖态且存在默认提示词：此时「恢复默认提示词」会回落到 `defaultText`。 */
  showsRestoreHint: boolean;
}

/**
 * 归纳提示词状态，供检视栏渲染。
 *
 * 关键点：内置 Agent 的 `systemPrompt` 是**当前生效值**——既有可能是用户覆盖，也有可能
 * 就是系统默认（编辑器用它预填表单）。因此判定「是否覆盖」必须读
 * `promptMetadata.hasPromptOverride`，不能按「非空即已自定义」推断；自定义 Agent 没有
 * 该字段，此时「非空即自定义」才成立。
 */
export function summarizeAgentPrompt(agent: ManagedAgentRecord | null): AgentPromptSummary {
  if (!agent) {
    return {
      overridden: false,
      sourceLabel: '未选择 Agent',
      effectiveText: '',
      defaultText: '',
      showsRestoreHint: false,
    };
  }

  const defaultText = agent.promptMetadata?.defaultText ?? '';
  const effectiveText = agent.systemPrompt ?? defaultText;
  const overridden = agent.promptMetadata
    ? agent.promptMetadata.hasPromptOverride
    : effectiveText.length > 0;

  if (overridden) {
    return {
      overridden: true,
      sourceLabel: `用户覆盖（${effectiveText.length} 字符）`,
      effectiveText,
      defaultText,
      showsRestoreHint: defaultText.length > 0,
    };
  }

  return {
    overridden: false,
    sourceLabel: effectiveText.length > 0 ? `系统默认（${effectiveText.length} 字符）` : '未设置',
    effectiveText,
    defaultText,
    showsRestoreHint: false,
  };
}

export function AgentsInspectorPanel({ agent }: { agent: ManagedAgentRecord | null }) {
  const prompt = summarizeAgentPrompt(agent);

  return (
    <aside className="console-col console-col--aside" aria-label="Agent 元信息">
      <div className="console-col__head">
        <h2 className="console-col__title">元信息</h2>
        <span className="console-spacer" />
        <span className="console-statline">只读</span>
      </div>

      <div className="console-col__scroll">
        {!agent ? (
          <div className="console-empty">从左侧选择 Agent 查看其元信息与覆盖情况。</div>
        ) : (
          <div className="agents-inspector">
            <dl className="console-meta">
              <MetaRow label="ID" value={agent.id} />
              <MetaRow label="类型" value={`${ORIGIN_LABELS[agent.origin]} · ${agent.origin}`} />
              <MetaRow label="来源" value={SOURCE_LABELS[agent.source]} />
              <MetaRow label="状态" value={agent.enabled ? '已启用' : '已禁用'} />
              <MetaRow
                label="角色"
                value={formatCanonicalRoleZh(agent) ?? agent.canonicalRole?.coreRole ?? '未设置'}
              />
              <MetaRow label="可移除" value={agent.removable ? '是' : '否'} />
              <MetaRow label="可恢复默认" value={agent.resettable ? '是' : '否'} />
              <MetaRow label="创建时间" value={agent.createdAt} />
              <MetaRow label="最近更新" value={agent.updatedAt} />
            </dl>

            <div className="console-group">
              <span className="console-group__label">覆盖情况</span>
              <CheckRow
                label="模型"
                value={agent.model ?? '继承参考默认值'}
                on={Boolean(agent.model)}
              />
              <CheckRow
                label="Variant"
                value={agent.variant ?? '未设置'}
                on={Boolean(agent.variant)}
              />
              <CheckRow
                label="回退链"
                value={
                  agent.fallbackModels?.length ? agent.fallbackModels.join(' → ') : '继承参考默认值'
                }
                on={Boolean(agent.fallbackModels?.length)}
              />
              <CheckRow label="提示词来源" value={prompt.sourceLabel} on={prompt.overridden} />
              <CheckRow
                label="本地覆盖"
                value={agent.hasOverrides ? '存在覆盖' : '与默认一致'}
                on={agent.hasOverrides}
              />
            </div>

            {prompt.effectiveText ? (
              <div className="console-group">
                <span className="console-group__label">
                  {prompt.overridden ? '当前提示词（用户覆盖）' : '当前提示词（系统默认）'}
                </span>
                <pre className="agents-prompt-preview">{prompt.effectiveText}</pre>
                {prompt.showsRestoreHint ? (
                  <span className="console-label__hint">
                    {`覆盖后不再随版本升级更新；在编辑器里点「恢复默认提示词」会回落到系统默认（${prompt.defaultText.length} 字符）。`}
                  </span>
                ) : null}
              </div>
            ) : null}

            {prompt.overridden && prompt.defaultText ? (
              <div className="console-group">
                <span className="console-group__label">系统默认提示词</span>
                <pre className="agents-prompt-preview agents-prompt-preview--muted">
                  {prompt.defaultText}
                </pre>
              </div>
            ) : null}

            <div className="console-group">
              <span className="console-group__label">别名</span>
              {agent.aliases.length === 0 ? (
                <span className="console-check-row">未设置别名</span>
              ) : (
                <div className="console-tag-row">
                  {agent.aliases.map((alias) => (
                    <AgentsBadge key={alias} mono>
                      {alias}
                    </AgentsBadge>
                  ))}
                </div>
              )}
            </div>

            {agent.color ? (
              <div className="console-group">
                <span className="console-group__label">外观</span>
                <div className="console-check-row">
                  <span className="console-swatch" style={{ background: agent.color }} />
                  <b>{agent.color}</b>
                  Agent 标识色
                </div>
              </div>
            ) : null}

            {agent.note ? (
              <div className="console-group">
                <span className="console-group__label">备注</span>
                <div className="console-check-row">{agent.note}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
