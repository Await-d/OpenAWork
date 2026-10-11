/**
 * 会话概览「注入工具」分区:展示当前会话实际生效的 Skill / MCP / 工具,
 * 并对 MCP 提供「重试连接」这一手动恢复操作。
 *
 * 三类注入以二级 tab(Skill / MCP / 工具)切换查看,避免纵向堆叠成一条长列表;
 * 默认落到第一个非空分类,方向键可在分类间移动焦点。
 *
 * 数据来自网关 `GET /capabilities/session/:sessionId`(经 `@openAwork/web-client`
 * 的 `createCapabilitiesClient().sessionDetail`),MCP 部分已按会话
 * `requestedMcpServers` 白名单过滤并附带连接状态与工具目录。
 *
 * 该分区由 `ChatOverviewTabContent` 以 `OverviewSection` 包裹渲染,经典右栏与
 * Fusion 布局共用同一实现。
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { StatusPill } from '@openAwork/shared-ui';
import { Link } from 'react-router';
import {
  createCapabilitiesClient,
  createSettingsClient,
  type SessionCapabilitiesResult,
  type SessionMcpServerDetail,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';

const MCP_SETTINGS_HREF = '/settings/plugins?plugin=mcp';
const SKILL_SETTINGS_HREF = '/settings/plugins?plugin=skills';

type InjectedToolsTab = 'skill' | 'mcp' | 'tools';

const INJECTED_TOOLS_TAB_ORDER: readonly InjectedToolsTab[] = ['skill', 'mcp', 'tools'];

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type PillColor = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'muted';

function mcpStatusColor(status: SessionMcpServerDetail['status']): PillColor {
  if (status === 'connected') return 'success';
  if (status === 'error') return 'danger';
  return 'muted';
}

function mcpStatusLabel(status: SessionMcpServerDetail['status']): string {
  if (status === 'connected') return '已连接';
  if (status === 'error') return '连接失败';
  return '已停用';
}

function skillSourceLabel(source: string): string {
  switch (source) {
    case 'builtin':
      return '内置';
    case 'installed':
      return '已安装';
    case 'configured':
      return '已配置';
    case 'reference':
      return '参考目录';
    default:
      return '运行时';
  }
}

export interface SessionInjectedToolsSectionProps {
  readonly sessionId: string | null;
}

export function SessionInjectedToolsSection({ sessionId }: SessionInjectedToolsSectionProps) {
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const token = useAuthStore((state) => state.accessToken);

  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<SessionCapabilitiesResult | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // 请求序号守卫:快速切换会话 / 连续刷新时,只接受最新一次请求的结果,
  // 避免旧会话的响应后到并覆盖新会话的注入工具列表。
  const requestRef = useRef(0);

  // 二级分类切换(Skill / MCP / 工具):纯前端视图状态,不参与数据加载。
  const [activeTab, setActiveTab] = useState<InjectedToolsTab>('skill');
  const tabsInstanceId = useId();
  const tabRefs = useRef<Record<InjectedToolsTab, HTMLButtonElement | null>>({
    skill: null,
    mcp: null,
    tools: null,
  });
  // 首次拿到数据时默认落到第一个「非空」分类;之后不再自动改写,尊重用户选择。
  const defaultTabResolvedRef = useRef(false);
  const tabElementId = useCallback(
    (tab: InjectedToolsTab) => `${tabsInstanceId}-injected-tab-${tab}`,
    [tabsInstanceId],
  );
  const panelElementId = useCallback(
    (tab: InjectedToolsTab) => `${tabsInstanceId}-injected-panel-${tab}`,
    [tabsInstanceId],
  );

  const capabilitiesClient = useMemo(() => createCapabilitiesClient(gatewayUrl), [gatewayUrl]);

  const load = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!sessionId || !token) {
      setState('idle');
      setData(null);
      setLoadedFor(null);
      setLoadError(null);
      return;
    }
    setState('loading');
    setLoadError(null);
    try {
      const result = await capabilitiesClient.sessionDetail(token, sessionId);
      if (requestRef.current !== requestId) return;
      setData(result);
      setLoadedFor(sessionId);
      setState('ready');
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setData(null);
      setLoadedFor(null);
      setLoadError(error instanceof Error ? error.message : '加载注入工具失败。');
      setState('error');
    }
  }, [capabilitiesClient, sessionId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRetry = useCallback(
    async (serverId: string): Promise<void> => {
      if (!token) return;
      setRetryingId(serverId);
      setActionError(null);
      try {
        await createSettingsClient(gatewayUrl).retryMcpServer(token, serverId);
        await load();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : '重试连接失败。');
      } finally {
        setRetryingId(null);
      }
    },
    [gatewayUrl, load, token],
  );

  // 只展示与当前会话匹配的数据:会话切换后旧会话的数据不再复用,
  // 避免出现「展示上一个会话的注入工具」。
  const sessionData = loadedFor === sessionId ? data : null;

  useEffect(() => {
    if (defaultTabResolvedRef.current || state !== 'ready' || !sessionData) return;
    defaultTabResolvedRef.current = true;
    const counts: Record<InjectedToolsTab, number> = {
      skill: sessionData.skills.length,
      mcp: sessionData.mcpServers.length,
      tools: sessionData.tools.length,
    };
    const preferred = INJECTED_TOOLS_TAB_ORDER.find((tab) => counts[tab] > 0);
    if (preferred) setActiveTab(preferred);
  }, [sessionData, state]);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const currentIndex = INJECTED_TOOLS_TAB_ORDER.indexOf(activeTab);
      const nextIndex =
        (currentIndex + step + INJECTED_TOOLS_TAB_ORDER.length) % INJECTED_TOOLS_TAB_ORDER.length;
      const nextTab = INJECTED_TOOLS_TAB_ORDER[nextIndex] ?? activeTab;
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    },
    [activeTab],
  );

  if (state === 'idle') {
    return <p className="chat-overview__injected-note">当前会话未就绪,暂无注入工具信息。</p>;
  }
  if (state === 'loading' && !sessionData) {
    return <p className="chat-overview__injected-note">正在加载注入工具...</p>;
  }
  if (state === 'error') {
    return (
      <div className="chat-overview__diag-block">
        <p className="chat-overview__injected-note chat-overview__injected-note--error">
          {loadError ?? '加载注入工具失败。'}
        </p>
        <button type="button" className="chat-overview__action-button" onClick={() => void load()}>
          重新加载
        </button>
      </div>
    );
  }

  const skills = sessionData?.skills ?? [];
  const tools = sessionData?.tools ?? [];
  const mcpServers = sessionData?.mcpServers ?? [];
  const connectedCount = mcpServers.filter((server) => server.status === 'connected').length;

  const tabs: ReadonlyArray<{
    readonly id: InjectedToolsTab;
    readonly label: string;
    readonly meta: string;
  }> = [
    { id: 'skill', label: 'Skill', meta: `${skills.length} 个` },
    {
      id: 'mcp',
      label: 'MCP',
      meta: mcpServers.length > 0 ? `${connectedCount}/${mcpServers.length}` : '无',
    },
    { id: 'tools', label: '工具', meta: `${tools.length} 个` },
  ];

  return (
    <>
      {actionError ? (
        <p className="chat-overview__injected-note chat-overview__injected-note--error">
          {actionError}
        </p>
      ) : null}

      <div className="chat-overview__injected-tabs">
        <div
          role="tablist"
          aria-label="注入工具分类"
          aria-orientation="horizontal"
          className="chat-overview__injected-tablist"
          onKeyDown={handleTabKeyDown}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                type="button"
                role="tab"
                id={tabElementId(tab.id)}
                aria-selected={isActive}
                aria-controls={panelElementId(tab.id)}
                tabIndex={isActive ? 0 : -1}
                className="chat-overview__injected-tab"
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="chat-overview__injected-tab-label">{tab.label}</span>
                <span className="chat-overview__injected-tab-meta">{tab.meta}</span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={panelElementId('skill')}
          aria-labelledby={tabElementId('skill')}
          hidden={activeTab !== 'skill'}
          className="chat-overview__injected-panel"
        >
          {skills.length > 0 ? (
            <ul className="chat-overview__injected-list">
              {skills.map((skill) => (
                <li className="chat-overview__injected-row" key={skill.id}>
                  <span className="chat-overview__injected-name" title={skill.description}>
                    {skill.label}
                  </span>
                  <div className="chat-overview__injected-card-foot">
                    <StatusPill color="info" label={skillSourceLabel(skill.source)} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-overview__injected-note">当前会话没有生效的 Skill。</p>
          )}
        </div>

        <div
          role="tabpanel"
          id={panelElementId('mcp')}
          aria-labelledby={tabElementId('mcp')}
          hidden={activeTab !== 'mcp'}
          className="chat-overview__injected-panel"
        >
          {mcpServers.length > 0 ? (
            <ul className="chat-overview__injected-list">
              {mcpServers.map((server) => (
                <li className="chat-overview__injected-row" key={server.id} title={server.error}>
                  <span className="chat-overview__injected-name">{server.name}</span>
                  <div className="chat-overview__injected-card-foot">
                    <span className="chat-overview__injected-meta">{server.toolCount} 工具</span>
                    <StatusPill
                      color={mcpStatusColor(server.status)}
                      label={mcpStatusLabel(server.status)}
                    />
                    <button
                      type="button"
                      className="chat-overview__action-button"
                      disabled={retryingId === server.id || server.status === 'disabled' || !token}
                      onClick={() => void handleRetry(server.id)}
                    >
                      {retryingId === server.id ? '重试中...' : '重试连接'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-overview__injected-note">当前会话没有绑定 MCP 服务。</p>
          )}
        </div>

        <div
          role="tabpanel"
          id={panelElementId('tools')}
          aria-labelledby={tabElementId('tools')}
          hidden={activeTab !== 'tools'}
          className="chat-overview__injected-panel"
        >
          {tools.length > 0 ? (
            <ul className="chat-overview__injected-list">
              {tools.map((tool) => (
                <li className="chat-overview__injected-row" key={tool.id}>
                  <span className="chat-overview__injected-name" title={tool.description}>
                    {tool.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-overview__injected-note">当前会话没有可用工具。</p>
          )}
        </div>
      </div>

      <div className="chat-overview__injected-links">
        <Link className="chat-overview__action-button" to={MCP_SETTINGS_HREF}>
          在设置中管理 MCP
        </Link>
        <Link className="chat-overview__action-button" to={SKILL_SETTINGS_HREF}>
          在设置中管理技能
        </Link>
      </div>
    </>
  );
}
