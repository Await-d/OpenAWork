import { useMemo, useState, type CSSProperties } from 'react';
import {
  agentTeamsActivityItems,
  agentTeamsCanvasSummary,
  agentTeamsConversationCards,
  agentTeamsFooterLead,
  agentTeamsFooterStats,
  agentTeamsMetricCards,
  agentTeamsMessageCards,
  agentTeamsOfficeAgents,
  agentTeamsOverviewCards,
  agentTeamsRoleChips,
  agentTeamsReviewCards,
  agentTeamsSidebarSections,
  agentTeamsTabPanels,
  agentTeamsTaskLanes,
  agentTeamsTabs,
  agentTeamsTeamCard,
  agentTeamsTopSummary,
  type AgentTeamsOfficeAgent,
  type AgentTeamsTabKey,
} from './team-runtime-reference-mock.js';

const SHELL_BACKGROUND = 'linear-gradient(180deg, #171823 0%, #161720 100%)';

const TITLE_BAR_STYLE: CSSProperties = {
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px 0 10px',
  borderBottom: '1px solid rgba(124, 102, 255, 0.18)',
  background: '#171723',
};

const SURFACE_STYLE: CSSProperties = {
  border: '1px solid rgba(104, 111, 152, 0.22)',
  background: '#1a1b28',
  boxShadow: '0 16px 50px rgba(0, 0, 0, 0.35)',
};

const PANEL_STYLE: CSSProperties = {
  ...SURFACE_STYLE,
  borderRadius: 18,
};

function MacDots() {
  return (
    <div aria-hidden="true" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
      {['#f87171', '#fbbf24', '#4ade80'].map((color) => (
        <span
          key={color}
          style={{ width: 10, height: 10, borderRadius: '50%', background: color }}
        />
      ))}
    </div>
  );
}

function ActivityRail() {
  return (
    <aside
      style={{
        width: 56,
        background: '#171821',
        borderRight: '1px solid rgba(104, 111, 152, 0.16)',
        display: 'grid',
        gridTemplateRows: '56px 1fr 56px',
      }}
    >
      <div style={{ display: 'grid', placeItems: 'center', color: '#8ba2ff', fontWeight: 800 }}>
        ▮
      </div>
      <div style={{ display: 'grid', gap: 10, alignContent: 'start', padding: '6px 0' }}>
        {agentTeamsActivityItems.map((item) => {
          const active = item.id === 'teams';
          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              style={{
                position: 'relative',
                width: 42,
                height: 42,
                margin: '0 auto',
                borderRadius: 14,
                display: 'grid',
                placeItems: 'center',
                color: active ? '#f5f7ff' : '#7d82af',
                border: active ? '1px solid rgba(158, 170, 255, 0.6)' : '1px solid transparent',
                background: active ? '#23253d' : 'transparent',
                boxShadow: active ? '0 0 0 1px rgba(138, 156, 255, 0.15)' : 'none',
              }}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: -7,
                    top: 8,
                    bottom: 8,
                    width: 3,
                    borderRadius: '0 999px 999px 0',
                    background: '#7d74ff',
                  }}
                />
              ) : null}
              <span style={{ fontSize: 17 }}>{item.icon}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'grid', placeItems: 'center', color: '#7d82af' }}>
        <span style={{ fontSize: 17 }}>⚙</span>
      </div>
    </aside>
  );
}

function SidebarTemplateCard({
  active,
  subtitle,
  title,
}: {
  active?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <button
      type="button"
      style={{
        position: 'relative',
        display: 'grid',
        gap: 8,
        width: '100%',
        padding: 12,
        borderRadius: 14,
        textAlign: 'left',
        color: '#eef1ff',
        background: active ? 'rgba(92, 98, 181, 0.28)' : 'transparent',
        border: active
          ? '1px solid rgba(138, 156, 255, 0.46)'
          : '1px solid rgba(104, 111, 152, 0.12)',
      }}
    >
      {active ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            borderRadius: '14px 0 0 14px',
            background: '#7d74ff',
          }}
        />
      ) : null}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        {active ? (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: '#3e3412',
              color: '#ffd458',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            已暂停
          </span>
        ) : null}
      </div>
      {active ? (
        <div
          style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#7e86b6', fontSize: 10 }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffd458' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6a6af7' }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef5a5a' }} />
          <span>4人 · 6天前</span>
        </div>
      ) : null}
      {subtitle ? <span style={{ fontSize: 11, color: '#8f95be' }}>{subtitle}</span> : null}
    </button>
  );
}

function LeftSidebar() {
  return (
    <aside
      style={{
        width: 248,
        background: '#171821',
        borderRight: '1px solid rgba(104, 111, 152, 0.16)',
        display: 'grid',
        gridTemplateRows: '46px minmax(0, 1fr) 74px',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid rgba(104, 111, 152, 0.16)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 800, color: '#e6e9ff', letterSpacing: '0.04em' }}>
          AGENT TEAMS
        </span>
        <button type="button" style={{ fontSize: 20, color: '#9aa2d9' }}>
          +
        </button>
      </div>

      <div style={{ overflow: 'auto', padding: '12px 14px 16px', display: 'grid', gap: 16 }}>
        <section style={{ display: 'grid', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              color: '#9ea5d7',
              fontSize: 12,
            }}
          >
            <span>▾</span>
            <span>运行中</span>
          </div>
        </section>

        <section style={{ display: 'grid', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
              color: '#9ea5d7',
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>▾</span>
              <span>历史记录</span>
            </div>
            <span
              style={{
                minWidth: 18,
                height: 18,
                borderRadius: 6,
                display: 'grid',
                placeItems: 'center',
                background: '#31345a',
                color: '#d5daff',
                fontSize: 10,
              }}
            >
              1
            </span>
          </div>

          <SidebarTemplateCard
            active
            subtitle={agentTeamsTeamCard.subtitle}
            title={agentTeamsTeamCard.title}
          />
        </section>

        <section style={{ display: 'grid', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: '#9ea5d7',
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 12, color: '#8ba2ff' }}>
              ▦
            </span>
            <span style={{ flex: 1, height: 1, background: 'rgba(104, 111, 152, 0.28)' }} />
            <span>模板 (5)</span>
            <span style={{ flex: 1, height: 1, background: 'rgba(104, 111, 152, 0.28)' }} />
          </div>

          {agentTeamsSidebarSections.map((section) => (
            <div key={section.id} style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#d7dbff' }}>
                {section.title}
              </span>
              {section.items.map((item) => (
                <div key={item.id} style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {item.roleTags.map((tag) => (
                      <span
                        key={tag.label}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          minHeight: 17,
                          padding: '0 7px',
                          borderRadius: 999,
                          background: `${tag.color}22`,
                          color: tag.color,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <span style={{ fontSize: 10.5, color: '#7e86b6', lineHeight: 1.45 }}>
                    {item.description}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>

      <div style={{ padding: 14, borderTop: '1px solid rgba(104, 111, 152, 0.16)' }}>
        <button
          type="button"
          style={{
            width: '100%',
            minHeight: 34,
            borderRadius: 12,
            border: '1px dashed rgba(120, 126, 196, 0.5)',
            color: '#bfc7ff',
            background: '#1b1d30',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ＋ 新建团队模板
        </button>
      </div>
    </aside>
  );
}

function RoleChip({ item }: { item: (typeof agentTeamsRoleChips)[number] }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 24 }}>
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: item.accent,
          color: '#fff',
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        {item.badge}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: '#e6e9ff' }}>{item.role}</span>
      {item.leader ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 18,
            padding: '0 7px',
            borderRadius: 999,
            background: '#3b2d16',
            color: '#ffd458',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          Leader
        </span>
      ) : null}
      <span style={{ color: '#67e38f', fontSize: 11 }}>✓ {item.status}</span>
      <span style={{ color: '#7e86b6', fontSize: 11 }}>{item.provider}</span>
    </div>
  );
}

function TopTeamHeader() {
  return (
    <header style={{ display: 'grid', gap: 10, padding: '12px 18px 9px' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}
      >
        <div
          style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}
        >
          <span style={{ color: '#8ba2ff', fontSize: 13 }}>◌</span>
          <span style={{ color: '#cfd5ff', fontSize: 12 }}>
            Agent Teams · {agentTeamsTopSummary.title}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ color: '#7e86b6', fontSize: 12 }}>← 返回普通模式</span>
          <button
            type="button"
            style={{
              minHeight: 30,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid rgba(145, 200, 84, 0.48)',
              background: '#1d2617',
              color: '#b4e65d',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ▶ 恢复
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span
            style={{ fontSize: 28, fontWeight: 800, color: '#f3f5ff', letterSpacing: '-0.03em' }}
          >
            {agentTeamsTopSummary.title}
          </span>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: 10,
              background: '#3e3412',
              color: '#ffd458',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {agentTeamsTopSummary.status}
          </span>
          <span style={{ color: '#8f95be', fontSize: 13 }}>{agentTeamsTopSummary.memberCount}</span>
          <span style={{ color: '#67e38f', fontSize: 13 }}>{agentTeamsTopSummary.onlineCount}</span>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {agentTeamsRoleChips.map((item) => (
            <RoleChip key={item.role} item={item} />
          ))}
        </div>
      </div>
    </header>
  );
}

function TabRow({
  activeTab,
  onSelect,
}: {
  activeTab: AgentTeamsTabKey;
  onSelect: (tab: AgentTeamsTabKey) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 20,
        alignItems: 'center',
        minHeight: 42,
        padding: '0 18px',
        borderTop: '1px solid rgba(104, 111, 152, 0.12)',
        borderBottom: '1px solid rgba(104, 111, 152, 0.18)',
      }}
    >
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        {agentTeamsTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              style={{
                position: 'relative',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 42,
                color: active ? '#dfe3ff' : '#7e86b6',
                fontSize: 13,
                fontWeight: active ? 700 : 500,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 12, opacity: active ? 1 : 0.75 }}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
              {tab.badge ? (
                <span
                  style={{
                    minWidth: 16,
                    height: 16,
                    padding: '0 5px',
                    borderRadius: 999,
                    background: active ? '#40447c' : '#2a2d48',
                    color: '#dfe3ff',
                    fontSize: 10,
                    fontWeight: 800,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {tab.badge}
                </span>
              ) : null}
              {active ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: -1,
                    height: 3,
                    borderRadius: '999px 999px 0 0',
                    background: '#7d74ff',
                  }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: '#7e86b6',
          fontSize: 12,
        }}
      >
        <span aria-hidden="true">⇱</span>
        <span>弹出窗口</span>
      </button>
    </div>
  );
}

function MetricCard({ item }: { item: (typeof agentTeamsMetricCards)[number] }) {
  return (
    <div
      style={{
        ...PANEL_STYLE,
        display: 'grid',
        gap: 7,
        padding: '12px 16px',
        minHeight: 66,
      }}
    >
      <div
        style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#8f95be', fontSize: 12 }}
      >
        <span aria-hidden="true" style={{ color: '#a9b2ff', fontSize: 12 }}>
          {item.icon}
        </span>
        <span>{item.label}</span>
      </div>
      <span style={{ fontSize: 34, lineHeight: 1, fontWeight: 800, color: '#e6e9ff' }}>
        {item.value}
      </span>
    </div>
  );
}

function PixelCharacter({ item }: { item: AgentTeamsOfficeAgent }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${item.x}%`,
        top: `${item.y}%`,
        transform: 'translate(-50%, -50%)',
        display: 'grid',
        justifyItems: 'center',
        gap: 4,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 44,
          height: 90,
          display: 'grid',
          justifyItems: 'center',
          padding: item.selected ? 4 : 0,
          borderRadius: 10,
          boxShadow: item.selected ? '0 0 0 2px rgba(103, 164, 255, 0.75)' : 'none',
        }}
      >
        {item.crown ? (
          <div
            style={{ width: 6, height: 6, background: '#facc15', marginBottom: -2, zIndex: 1 }}
          />
        ) : (
          <div style={{ width: 6, height: 6, marginBottom: -2, zIndex: 1 }} />
        )}
        <div
          style={{ width: 28, height: 26, background: '#ffd29f', border: '3px solid #2b1f1f' }}
        />
        <div
          style={{
            width: 30,
            height: 28,
            background: item.accent,
            border: '3px solid #2b1f1f',
            marginTop: -3,
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: -3 }}>
          <div style={{ width: 8, height: 22, background: '#2b1f1f' }} />
          <div style={{ width: 8, height: 22, background: '#2b1f1f' }} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: -4,
            top: 42,
            width: 8,
            height: 18,
            background: '#ffd29f',
            border: '2px solid #2b1f1f',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: 42,
            width: 8,
            height: 18,
            background: '#ffd29f',
            border: '2px solid #2b1f1f',
          }}
        />
      </div>
      <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 8,
            background: item.selected ? '#111111' : '#161616',
            color: '#f5f7ff',
            fontSize: 11,
            fontWeight: 700,
            boxShadow: item.selected ? '0 0 0 2px rgba(111, 164, 255, 0.55)' : 'none',
          }}
        >
          {item.label}
        </span>
        <span
          style={{
            padding: '4px 8px',
            borderRadius: 8,
            background: '#0e0e0e',
            color: '#e3e6ff',
            fontSize: 10,
          }}
        >
          {item.note}
        </span>
        {item.extraNote ? (
          <span
            style={{
              padding: '4px 8px',
              borderRadius: 8,
              background: '#0a0a0a',
              color: '#d2d7ff',
              fontSize: 10,
            }}
          >
            {item.extraNote}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OfficeScene() {
  return (
    <div style={{ ...PANEL_STYLE, padding: 10, borderRadius: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <span style={{ color: '#cfd5ff', fontSize: 13 }}>{agentTeamsCanvasSummary}</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {['⌕', '↻', '⊕'].map((action) => (
            <button
              key={action}
              type="button"
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: '1px solid rgba(104, 111, 152, 0.24)',
                background: '#1d1f2d',
                color: '#cfd5ff',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          minHeight: 610,
          overflow: 'hidden',
          borderRadius: 24,
          border: '1px solid rgba(104, 111, 152, 0.18)',
          background: '#171723',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '0 0 64% 0',
            background:
              'repeating-linear-gradient(90deg, #6c4e42 0 1px, #7a584b 1px 96px), linear-gradient(180deg, #795b4d 0%, #6f5245 100%)',
            borderBottom: '4px solid #1c140f',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: '36% 0 0 0',
            background:
              'linear-gradient(180deg, rgba(232, 222, 206, 0.98) 0%, rgba(223, 214, 199, 0.98) 100%), repeating-linear-gradient(90deg, rgba(148, 140, 127, 0.16) 0 1px, transparent 1px 48px), repeating-linear-gradient(0deg, rgba(148, 140, 127, 0.16) 0 1px, transparent 1px 48px)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 14,
            padding: '8px 10px',
            background: '#111111',
            border: '2px solid #433226',
            color: '#dbeafe',
            fontSize: 10,
            lineHeight: 1.45,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.24)',
          }}
        >
          ▶ 研究团队 / 4名成员，状态联动
          <br />← 小地图与提醒，会实时刷新画布。
        </div>

        <div
          style={{
            position: 'absolute',
            left: '69.5%',
            top: '63.2%',
            fontSize: 8,
            color: '#2b1f1f',
            letterSpacing: '0.08em',
          }}
        >
          POWER_BAR
        </div>

        <div
          style={{
            position: 'absolute',
            left: '39.5%',
            top: 84,
            width: 78,
            height: 18,
            border: '2px solid #a5afb5',
            background: '#eff4f6',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: '18%',
            top: 94,
            width: 110,
            height: 16,
            background: '#e8ecef',
            border: '2px solid #9fa9af',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: '18%',
            top: 164,
            width: 140,
            height: 42,
            background: '#b98976',
            border: '4px solid #8a6254',
          }}
        />
        <div style={{ position: 'absolute', left: '18%', top: 152, display: 'flex', gap: 12 }}>
          {[1, 2, 3].map((item) => (
            <span
              key={`chair-top-${item}`}
              style={{ width: 12, height: 12, background: '#5b7280', border: '2px solid #18242c' }}
            />
          ))}
        </div>
        <div style={{ position: 'absolute', left: '18%', top: 208, display: 'flex', gap: 12 }}>
          {[1, 2, 3].map((item) => (
            <span
              key={`chair-bottom-${item}`}
              style={{ width: 12, height: 12, background: '#5b7280', border: '2px solid #18242c' }}
            />
          ))}
        </div>

        <div
          style={{
            position: 'absolute',
            left: '41%',
            top: 110,
            width: 230,
            height: 130,
            background: '#0d0d0f',
            border: '6px solid #291c18',
            boxShadow: '0 10px 24px rgba(0, 0, 0, 0.35)',
            color: '#7de5ff',
            padding: 12,
            display: 'grid',
            alignContent: 'start',
            gap: 8,
            fontSize: 11,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#69d8ff' }}>
            <span>■ 研究团队-2026-03-31 进度</span>
            <span>STATE: ACTIVE</span>
          </div>
          <div style={{ display: 'grid', gap: 6, color: '#efeef8' }}>
            <span>任务总数　　　　　　　　　　　 0%</span>
            <span>研究任务　　　　　　　　　　　 0%</span>
            <span>已完成　　　　　　　　　　　　 0%</span>
          </div>
          <div
            style={{
              height: 18,
              background: 'linear-gradient(90deg, #0b1323 0%, #0f1f36 100%)',
              border: '1px solid #214a6a',
            }}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            right: 198,
            top: 126,
            width: 44,
            height: 72,
            border: '3px solid #496070',
            background: 'linear-gradient(180deg, #c7eefc 0%, #a7d2ea 100%)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 3,
              background: '#6f8796',
              transform: 'translateX(-50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 6,
              top: '48%',
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: '#6f8796',
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 6,
              top: '48%',
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: '#6f8796',
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            right: 140,
            top: 116,
            width: 50,
            height: 32,
            border: '3px solid #8d4c17',
            background: '#fff4df',
            color: '#ff7a00',
            fontSize: 9,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            lineHeight: 1.2,
          }}
        >
          办公室
          <br />
          安全提示
        </div>
        <div
          style={{
            position: 'absolute',
            right: 60,
            top: 112,
            width: 56,
            height: 54,
            border: '3px solid #252836',
            background: 'linear-gradient(180deg, #d8f3ff 0%, #bdddec 100%)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: 3,
              background: '#252836',
              transform: 'translateX(-50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: '50%',
              height: 3,
              background: '#252836',
              transform: 'translateY(-50%)',
            }}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            left: '12%',
            top: '40%',
            width: '52%',
            height: '50%',
            borderRadius: 10,
            background: 'rgba(180, 184, 206, 0.22)',
            boxShadow: 'inset 0 0 0 1px rgba(149, 155, 191, 0.18)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: '18%',
              bottom: 24,
              padding: '6px 18px',
              borderRadius: 999,
              border: '1px dashed rgba(90, 97, 124, 0.55)',
              color: '#9096b7',
              fontSize: 10,
            }}
          >
            export zone
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 44,
            top: '63%',
            width: 18,
            height: 50,
            background: '#6a8391',
            border: '3px solid #4d6774',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 2,
              right: 2,
              top: 12,
              height: 3,
              background: '#d9e6ef',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 2,
              right: 2,
              top: 24,
              height: 3,
              background: '#d9e6ef',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 2,
              right: 2,
              top: 36,
              height: 3,
              background: '#d9e6ef',
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            left: 50,
            top: '61%',
            width: 10,
            height: 4,
            background: '#d9e6ef',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 50,
            top: '65%',
            width: 10,
            height: 4,
            background: '#d9e6ef',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: 42,
            top: '44%',
            display: 'grid',
            gap: 2,
            justifyItems: 'center',
          }}
        >
          <div
            style={{
              width: 14,
              height: 12,
              background: '#3fad4f',
              borderRadius: '50% 50% 20% 20%',
            }}
          />
          <div style={{ width: 16, height: 8, background: '#8b5a3c' }} />
        </div>
        <div
          style={{
            position: 'absolute',
            right: 80,
            top: '42%',
            display: 'grid',
            gap: 2,
            justifyItems: 'center',
          }}
        >
          <div style={{ width: 10, height: 22, background: '#3fad4f', borderRadius: 8 }} />
          <div style={{ width: 14, height: 8, background: '#8b5a3c' }} />
        </div>
        <div
          style={{
            position: 'absolute',
            right: 110,
            bottom: 90,
            width: 16,
            height: 36,
            background: '#c9d8e5',
            border: '3px solid #7da1b7',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 8,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#f87171',
              transform: 'translateX(-50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 18,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#60a5fa',
              transform: 'translateX(-50%)',
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            right: 114,
            bottom: 104,
            width: 8,
            height: 5,
            background: '#f87171',
          }}
        />

        <div
          style={{
            position: 'absolute',
            left: '77%',
            top: '67%',
            width: 16,
            height: 14,
            border: '2px solid #2b1f1f',
            background: '#8d7760',
          }}
        />

        {agentTeamsOfficeAgents.map((item) => (
          <PixelCharacter key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function PlaceholderPanel({ activeTab }: { activeTab: Exclude<AgentTeamsTabKey, 'office'> }) {
  if (activeTab === 'conversation') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          {agentTeamsConversationCards.map((card) => (
            <div
              key={card.id}
              style={{ ...PANEL_STYLE, padding: 18, borderRadius: 18, display: 'grid', gap: 8 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#edf1ff' }}>
                  {card.title}
                </span>
                <span style={{ fontSize: 11, color: '#7e86b6' }}>{card.meta}</span>
              </div>
              <span style={{ fontSize: 13, color: '#8f95be', lineHeight: 1.7 }}>{card.body}</span>
            </div>
          ))}
        </div>

        <div style={{ ...PANEL_STYLE, padding: 18, borderRadius: 18, display: 'grid', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#edf1ff' }}>最近提问</span>
          {agentTeamsTabPanels.conversation.map((card) => (
            <div
              key={card.id}
              style={{
                display: 'grid',
                gap: 6,
                padding: 12,
                borderRadius: 14,
                background: '#181a29',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</span>
              <span style={{ fontSize: 12, color: '#8f95be', lineHeight: 1.6 }}>
                {card.description}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeTab === 'tasks') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        {agentTeamsTaskLanes.map((lane) => (
          <section
            key={lane.id}
            style={{ ...PANEL_STYLE, padding: 16, borderRadius: 18, display: 'grid', gap: 12 }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 800, color: '#edf1ff' }}>{lane.title}</span>
              <span style={{ fontSize: 11, color: '#7e86b6' }}>{lane.cards.length}</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {lane.cards.map((card) => (
                <div
                  key={card.id}
                  style={{
                    display: 'grid',
                    gap: 6,
                    padding: 12,
                    borderRadius: 14,
                    background: '#181a29',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</span>
                  <span style={{ fontSize: 11, color: '#8f95be' }}>{card.owner}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (activeTab === 'messages') {
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        {agentTeamsMessageCards.map((card) => (
          <div
            key={card.id}
            style={{ ...PANEL_STYLE, padding: 18, borderRadius: 18, display: 'grid', gap: 8 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#edf1ff' }}>
                {card.from} → {card.to}
              </span>
              <span style={{ fontSize: 11, color: '#7e86b6' }}>TeamBus</span>
            </div>
            <span style={{ fontSize: 13, color: '#8f95be', lineHeight: 1.7 }}>{card.summary}</span>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === 'overview') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        {agentTeamsOverviewCards.map((card) => (
          <div
            key={card.id}
            style={{ ...PANEL_STYLE, padding: 18, borderRadius: 18, display: 'grid', gap: 8 }}
          >
            <span style={{ fontSize: 12, color: '#7e86b6' }}>{card.label}</span>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#edf1ff' }}>{card.value}</span>
            <span style={{ fontSize: 12, color: '#8f95be', lineHeight: 1.6 }}>{card.note}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {agentTeamsReviewCards.map((card) => (
        <div
          key={card.id}
          style={{ ...PANEL_STYLE, padding: 18, borderRadius: 18, display: 'grid', gap: 8 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#edf1ff' }}>{card.title}</span>
            <span style={{ fontSize: 11, color: '#ffd458' }}>{card.priority}</span>
          </div>
          <span style={{ fontSize: 13, color: '#8f95be', lineHeight: 1.7 }}>{card.summary}</span>
        </div>
      ))}
    </div>
  );
}

function MainWorkspace({ activeTab }: { activeTab: AgentTeamsTabKey }) {
  return (
    <section style={{ display: 'grid', gap: 18, padding: '18px 18px 0' }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: '#f3f5ff' }}>团队工作空间</span>
        <span style={{ fontSize: 13, color: '#7e86b6' }}>{agentTeamsTopSummary.description}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        {agentTeamsMetricCards.map((item) => (
          <MetricCard key={item.label} item={item} />
        ))}
      </div>

      {activeTab === 'office' ? <OfficeScene /> : <PlaceholderPanel activeTab={activeTab} />}
    </section>
  );
}

function FooterBar() {
  return (
    <footer
      style={{
        height: 34,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0 16px 0 6px',
        borderTop: '1px solid rgba(104, 111, 152, 0.18)',
        background: '#171821',
        color: '#8f95be',
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#7ad45a' }} />
        <span>{agentTeamsFooterLead}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          padding: '2px 6px',
          borderRadius: 8,
          background: '#1f2030',
        }}
      >
        {['▥', '◫', '◔', '▤'].map((icon, index) => {
          const active = index === 1;
          return (
            <button
              key={icon}
              type="button"
              style={{
                width: 24,
                height: 20,
                borderRadius: 6,
                display: 'grid',
                placeItems: 'center',
                color: active ? '#f5f7ff' : '#8f95be',
                background: active ? '#2e3150' : 'transparent',
              }}
            >
              {icon}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {agentTeamsFooterStats.map((item) => (
          <span key={item.label}>
            {item.label} <strong style={{ color: '#dfe3ff' }}>{item.value}</strong>
          </span>
        ))}
        <span>运行 16m 41s</span>
      </div>
    </footer>
  );
}

export function TeamRuntimeReferencePage() {
  const [activeTab, setActiveTab] = useState<AgentTeamsTabKey>('office');

  const mainContent = useMemo(() => <MainWorkspace activeTab={activeTab} />, [activeTab]);

  return (
    <div className="page-root" style={{ background: SHELL_BACKGROUND, minHeight: '100dvh' }}>
      <div
        style={{
          minHeight: '100dvh',
          fontFamily:
            'Inter, "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <div
          style={{
            minWidth: 1600,
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateRows: '36px minmax(0, 1fr) 34px',
            overflow: 'auto',
          }}
        >
          <header style={TITLE_BAR_STYLE}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <MacDots />
              <span style={{ color: '#7c8cff', fontSize: 18 }}>⚡</span>
              <span style={{ color: '#e6e9ff', fontWeight: 700, fontSize: 14 }}>SpectrAI</span>
            </div>
            <div style={{ display: 'flex', gap: 18, color: '#cfd5ff' }}>
              <span>─</span>
              <span>□</span>
              <span>✕</span>
            </div>
          </header>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '56px 248px minmax(0, 1fr)',
              minHeight: 0,
            }}
          >
            <ActivityRail />
            <LeftSidebar />

            <main
              style={{
                minHeight: 0,
                display: 'grid',
                gridTemplateRows: 'auto auto 1fr',
                background: '#181926',
              }}
            >
              <TopTeamHeader />
              <TabRow activeTab={activeTab} onSelect={setActiveTab} />
              <div style={{ minHeight: 0, overflow: 'auto' }}>{mainContent}</div>
            </main>
          </div>

          <FooterBar />
        </div>
      </div>
    </div>
  );
}
