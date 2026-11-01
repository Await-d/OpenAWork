/**
 * 渠道「会话级扩展管理」开关（方案 §1 / 规格 :34）。
 *
 * 开启后本渠道的会话按 `explicit` 策略运行：**不再继承**会话所有者的用户级技能与
 * MCP（网关侧默认口径见 `resolveDefaultSessionExtensionInheritance`）。所以这里不做
 * 「勾了就生效」——勾选只进入**待确认**态：
 *
 *   1. 先把「将不再继承」的能力列出来（`loadImpact` 注入，便于测试与复用）；
 *   2. 只有点「确认开启」才写进草稿；点「取消」什么都不改。
 *
 * 规格原文：「启用界面展示哪些旧能力将不再继承，确认前不切换。」读不到影响清单时
 * 不阻断确认，但要把「读不到」如实说出来，而不是假装没有影响。
 */

import { useState } from 'react';

/** 开启后将不再被继承的用户级配置。 */
export interface ChannelExtensionImpact {
  readonly mcpServers: readonly string[];
  readonly skills: readonly string[];
}

function ImpactList({ impact }: { impact: ChannelExtensionImpact }): React.ReactElement {
  const total = impact.mcpServers.length + impact.skills.length;
  if (total === 0) {
    return <div className="channel-muted">你当前没有用户级技能或 MCP，开启不会减少已有能力。</div>;
  }

  return (
    <div>
      <div className="channel-muted">将不再继承以下 {total} 项：</div>
      {impact.mcpServers.length > 0 ? (
        <div className="channel-muted">
          MCP（{impact.mcpServers.length}）：{impact.mcpServers.join('、')}
        </div>
      ) : null}
      {impact.skills.length > 0 ? (
        <div className="channel-muted">
          技能（{impact.skills.length}）：{impact.skills.join('、')}
        </div>
      ) : null}
    </div>
  );
}

export function ChannelExtensionManagementSection({
  value,
  disabled,
  loadImpact,
  onChange,
}: {
  /** 草稿里当前的值；`true` 表示该渠道已开启。 */
  value: boolean;
  disabled?: boolean;
  /** 读取「将不再继承」的能力清单；未注入时只显示通用提示。 */
  loadImpact?: () => Promise<ChannelExtensionImpact>;
  /** 仅在用户确认后调用；取消不触发。 */
  onChange: (next: boolean) => void;
}): React.ReactElement {
  const [armed, setArmed] = useState(false);
  const [impact, setImpact] = useState<ChannelExtensionImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  const arm = (): void => {
    setArmed(true);
    setImpact(null);
    setImpactError(null);
    if (!loadImpact) return;
    setLoadingImpact(true);
    void loadImpact()
      .then((next) => setImpact(next))
      .catch((error: unknown) =>
        setImpactError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setLoadingImpact(false));
  };

  if (value) {
    return (
      <section className="channel-section">
        <div className="channel-section__head">
          <div>
            <h4 className="channel-section__title">会话级扩展管理</h4>
            <div className="channel-muted">
              已开启：本渠道的会话按「只用会话自己的条目」运行，不继承你的用户级技能与
              MCP。会话内新增或启用条目需要会话所有者或其授权管理员在确认页批准。
            </div>
          </div>
        </div>
        <div className="channel-section__body">
          <button type="button" disabled={disabled} onClick={() => onChange(false)}>
            关闭会话级扩展管理
          </button>
          {/*
            这里不承诺「关闭即恢复继承」：关闭只停掉本能力，已经按 explicit 建过策略行的
            会话仍按「只用会话自己的条目」运行（行值优先，见 resolveSessionExtensionInheritance）。
            承诺恢复继承还会**扩大**能力面——关闭一个功能顺带把用户级技能 / MCP 放给渠道，
            方向是反的。要改单个会话的策略，走那个会话的扩展面板。
          */}
          <div className="channel-muted">
            关闭后本渠道不再受理新的会话内安装。渠道会话不允许改回继承（那会把会话所有者的
            用户级技能与 MCP 放给群成员），因此已经切换为「只用会话条目」的会话会一直保持该策略。
          </div>
        </div>
      </section>
    );
  }

  if (armed) {
    return (
      <section className="channel-section">
        <div className="channel-section__head">
          <div>
            <h4 className="channel-section__title">确认开启会话级扩展管理</h4>
            <div className="channel-muted">
              开启后本渠道的会话不再继承你已有的用户级技能与 MCP；会话内需要重新提案确认 才会生效。
            </div>
          </div>
        </div>
        <div className="channel-section__body">
          {loadingImpact ? (
            <div className="channel-muted">正在读取将不再继承的用户级配置…</div>
          ) : null}
          {impactError ? (
            <div className="channel-muted">
              无法读取影响清单（{impactError}）。开启后本渠道会话将不再继承你的全部用户级 技能与
              MCP，请自行确认影响。
            </div>
          ) : null}
          {impact ? <ImpactList impact={impact} /> : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onChange(true);
                setArmed(false);
              }}
            >
              确认开启
            </button>
            {/* 取消 = 什么都不改：规格要求「确认前不切换」。 */}
            <button type="button" onClick={() => setArmed(false)}>
              取消
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="channel-section">
      <div className="channel-section__head">
        <div>
          <h4 className="channel-section__title">会话级扩展管理</h4>
          <div className="channel-muted">
            允许在这个渠道的会话里安装技能 / MCP（仅作用于当前会话，且需要会话所有者确认）。
            渠道默认关闭。
          </div>
        </div>
      </div>
      <div className="channel-section__body">
        <button type="button" disabled={disabled} onClick={arm}>
          开启会话级扩展管理
        </button>
        <div className="channel-muted">开启前会先列出将不再继承的用户级配置，确认前不会切换。</div>
      </div>
    </section>
  );
}
