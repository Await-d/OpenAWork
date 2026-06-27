import * as THREE from 'three';
import type {
  AgentTeamsFooterStat,
  AgentTeamsMetricCard,
  AgentTeamsOfficeAgent,
  AgentTeamsSidebarTeam,
} from '../../data/team-runtime-types.js';
import { formatSidebarTeamStatus } from '../../data/team-runtime-status.js';

export interface OfficeCanvasDisplayData {
  topSummary: {
    title: string;
    memberCount: string;
    onlineCount: string;
    status: string;
    runtimeStatus?: AgentTeamsSidebarTeam['status'] | null;
  };
  metricCards: AgentTeamsMetricCard[];
  footerStats: AgentTeamsFooterStat[];
  officeAgents: Pick<AgentTeamsOfficeAgent, 'id' | 'label' | 'status'>[];
  activityStats: Record<string, number>;
  elapsed: number;
}

export interface OfficeProjectionPage {
  title: string;
  subtitle: string;
  accent: keyof OfficeCanvasPalette;
  lines: string[];
  bars: Array<{ label: string; value: number; color: keyof OfficeCanvasPalette }>;
  footer: string;
}

interface OfficeCanvasPalette {
  accent: string;
  aux: string;
  warning: string;
  success: string;
  danger: string;
  fgStrong: string;
  fgDefault: string;
  fgMuted: string;
  bgBase: string;
  bgOverlay: string;
  border: string;
  surface: string;
}

type OfficeRuntimePalette = 'accent' | 'aux' | 'warning' | 'success' | 'danger';
export type OfficeStatusTone = 'accent' | 'warning' | 'success' | 'danger' | 'muted';

const TOKEN_FALLBACKS = {
  accent: '#6471f0',
  aux: '#3aa0ff',
  warning: '#f0b429',
  success: '#16a34a',
  danger: '#e0497a',
  fgStrong: '#f1f4f8',
  fgDefault: '#c8d1e0',
  fgMuted: '#7b8a9e',
  bgBase: '#1a1c2c',
  bgOverlay: '#0b1323',
  border: 'rgba(123, 138, 158, 0.28)',
  surface: '#142038',
} as const;

const OFFICE_STATUS_META: Record<
  AgentTeamsOfficeAgent['status'],
  { color: keyof OfficeCanvasPalette; glyph: string; label: string }
> = {
  working: { color: 'aux', glyph: 'WRK', label: '工作中' },
  discussing: { color: 'warning', glyph: 'DSC', label: '讨论中' },
  resting: { color: 'success', glyph: 'RST', label: '休息中' },
};

const ACTIVITY_LABELS: Record<string, string> = {
  assistant_message: '回复',
  command_execute: '执行',
  error: '异常',
  file_create: '建档',
  read: '读取',
  session_start: '启动',
  task_complete: '完成',
  thinking: '思考',
  tool_use: '工具',
  turn_complete: '回合',
  user_input: '输入',
  waiting_confirmation: '确认',
  write: '写入',
};

export const OFFICE_PROJECTION_PAGE_COUNT = 4;

export function resolveOfficeRuntimeStatus(input: {
  runtimeStatus?: AgentTeamsSidebarTeam['status'] | null;
  statusLabel?: string | null;
}): AgentTeamsSidebarTeam['status'] {
  if (input.runtimeStatus) {
    return input.runtimeStatus;
  }

  const normalized = input.statusLabel?.trim() ?? '';
  if (normalized.includes('暂停')) {
    return 'paused';
  }
  if (normalized.includes('失败')) {
    return 'failed';
  }
  if (normalized.includes('完成')) {
    return 'completed';
  }
  if (normalized.includes('空闲')) {
    return 'idle';
  }
  return 'running';
}

export function formatOfficeRuntimeStatus(status: AgentTeamsSidebarTeam['status']): string {
  return formatSidebarTeamStatus(status);
}

export function formatOfficeRuntimeMonitorStatus(status: AgentTeamsSidebarTeam['status']): string {
  if (status === 'paused') {
    return 'PAUSED';
  }
  if (status === 'failed') {
    return 'FAILED';
  }
  if (status === 'completed') {
    return 'DONE';
  }
  if (status === 'idle') {
    return 'IDLE';
  }
  return 'RUNNING';
}

export function resolveOfficeRuntimePalette(
  status: AgentTeamsSidebarTeam['status'],
): OfficeRuntimePalette {
  if (status === 'paused') {
    return 'warning';
  }
  if (status === 'failed') {
    return 'danger';
  }
  if (status === 'completed') {
    return 'success';
  }
  if (status === 'idle') {
    return 'aux';
  }
  return 'accent';
}

export function resolveOfficeRuntimeFooter(status: AgentTeamsSidebarTeam['status']): string {
  if (status === 'paused') {
    return '当前会话暂停中。';
  }
  if (status === 'failed') {
    return '当前会话出现失败，请检查运行链路。';
  }
  if (status === 'completed') {
    return '当前会话已完成本轮运行。';
  }
  if (status === 'idle') {
    return '当前会话待命中，等待新的团队运行事件。';
  }
  return '团队事件总线运行中。';
}

export function resolveOfficeAgentStatusLabel(input: {
  runtimeStatus: AgentTeamsSidebarTeam['status'];
  agentStatus?: AgentTeamsOfficeAgent['status'] | null;
}): string {
  if (input.runtimeStatus !== 'running') {
    return formatOfficeRuntimeStatus(input.runtimeStatus);
  }
  if (input.agentStatus === 'resting') {
    return '休息中';
  }
  if (input.agentStatus === 'discussing') {
    return '讨论中';
  }
  return '运行中';
}

export function resolveOfficeAgentStatusTone(input: {
  runtimeStatus: AgentTeamsSidebarTeam['status'];
  agentStatus?: AgentTeamsOfficeAgent['status'] | null;
}): OfficeStatusTone {
  if (input.runtimeStatus === 'paused') {
    return 'warning';
  }
  if (input.runtimeStatus === 'failed') {
    return 'danger';
  }
  if (input.runtimeStatus === 'completed') {
    return 'success';
  }
  if (input.runtimeStatus === 'idle') {
    return 'muted';
  }
  if (input.agentStatus === 'resting') {
    return 'warning';
  }
  if (input.agentStatus === 'discussing') {
    return 'accent';
  }
  return 'success';
}

export function makeCanvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('无法创建 2D canvas 上下文');
  }
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function resolveOfficeCanvasPalette(): OfficeCanvasPalette {
  if (typeof window === 'undefined') {
    return { ...TOKEN_FALLBACKS };
  }

  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };

  return {
    accent: read('--accent', TOKEN_FALLBACKS.accent),
    aux: read('--aux', TOKEN_FALLBACKS.aux),
    warning: read('--warning', TOKEN_FALLBACKS.warning),
    success: read('--success', TOKEN_FALLBACKS.success),
    danger: read('--danger', TOKEN_FALLBACKS.danger),
    fgStrong: read('--fg-strong', TOKEN_FALLBACKS.fgStrong),
    fgDefault: read('--fg-default', TOKEN_FALLBACKS.fgDefault),
    fgMuted: read('--fg-muted', TOKEN_FALLBACKS.fgMuted),
    bgBase: read('--bg-base', TOKEN_FALLBACKS.bgBase),
    bgOverlay: read('--bg-overlay', TOKEN_FALLBACKS.bgOverlay),
    border: read('--border-default', TOKEN_FALLBACKS.border),
    surface: TOKEN_FALLBACKS.surface,
  };
}

function clampLabel(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function compactLine(value: string, max = 26): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function parseLeadingNumber(value: string): number {
  const matched = value.match(/\d+/);
  return matched ? Number.parseInt(matched[0], 10) : 0;
}

function getStatusCounts(
  agents: Pick<AgentTeamsOfficeAgent, 'status'>[],
): Record<AgentTeamsOfficeAgent['status'], number> {
  return agents.reduce(
    (counts, agent) => {
      counts[agent.status] += 1;
      return counts;
    },
    { working: 0, discussing: 0, resting: 0 } satisfies Record<
      AgentTeamsOfficeAgent['status'],
      number
    >,
  );
}

function getTopActivities(
  activityStats: Record<string, number>,
): Array<{ label: string; value: number }> {
  return Object.entries(activityStats)
    .filter(([, value]) => value > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([key, value]) => ({
      label: ACTIVITY_LABELS[key] ?? clampLabel(key, 6),
      value,
    }));
}

export function buildOfficeProjectionPages(data: OfficeCanvasDisplayData): OfficeProjectionPage[] {
  const runtimeStatus = resolveOfficeRuntimeStatus({
    runtimeStatus: data.topSummary.runtimeStatus,
    statusLabel: data.topSummary.status,
  });
  const runtimeStatusLabel = formatOfficeRuntimeStatus(runtimeStatus);
  const runtimePalette = resolveOfficeRuntimePalette(runtimeStatus);
  const statusCounts = getStatusCounts(data.officeAgents);
  const topActivities = getTopActivities(data.activityStats);
  const taskMetric = data.metricCards.find((card) => card.label === '任务');
  const reportMetric = data.metricCards.find((card) => card.label === '汇报');

  return [
    {
      title: '运行总览',
      subtitle: clampLabel(data.topSummary.title, 20),
      accent: runtimePalette,
      lines: [
        `状态：${runtimeStatusLabel}`,
        `成员：${data.topSummary.memberCount} / ${data.topSummary.onlineCount}`,
        ...data.footerStats.slice(0, 3).map((stat) => `${stat.label}：${stat.value}`),
      ],
      bars: data.footerStats.slice(0, 4).map((stat, index) => ({
        label: stat.label,
        value: parseLeadingNumber(stat.value),
        color: (index === 0
          ? 'accent'
          : index === 1
            ? 'success'
            : index === 2
              ? 'warning'
              : 'danger') satisfies keyof OfficeCanvasPalette,
      })),
      footer: '工作区总览',
    },
    {
      title: '角色状态',
      subtitle: `在线 ${data.officeAgents.length} 个角色槽位`,
      accent: 'success',
      lines:
        data.officeAgents.length > 0
          ? data.officeAgents.slice(0, 5).map((agent) => {
              const meta = OFFICE_STATUS_META[agent.status];
              return `${meta.glyph} ${clampLabel(agent.label)} · ${meta.label}`;
            })
          : ['暂无角色状态数据'],
      bars: [
        { label: '工作', value: statusCounts.working, color: 'aux' },
        { label: '讨论', value: statusCounts.discussing, color: 'warning' },
        { label: '休息', value: statusCounts.resting, color: 'success' },
      ],
      footer: '3D 办公室联动',
    },
    {
      title: '任务与汇报',
      subtitle: `任务 ${taskMetric?.value ?? '0'} · 汇报 ${reportMetric?.value ?? '0'}`,
      accent: 'aux',
      lines: data.metricCards.map((card) => `${card.label}：${card.value}`),
      bars: [
        {
          label: '成员',
          value: parseLeadingNumber(data.metricCards[0]?.value ?? '0'),
          color: 'accent',
        },
        {
          label: '任务',
          value: parseLeadingNumber(taskMetric?.value ?? '0'),
          color: 'warning',
        },
        {
          label: '汇报',
          value: parseLeadingNumber(reportMetric?.value ?? '0'),
          color: 'success',
        },
      ],
      footer: '协作产出脉冲',
    },
    {
      title: '事件热度',
      subtitle: topActivities.length > 0 ? '最近活动聚合' : '等待新的团队运行事件',
      accent: 'warning',
      lines:
        topActivities.length > 0
          ? topActivities.map((item) => `${item.label}：${item.value}`)
          : ['当前还没有新的活动事件进入时间线。'],
      bars:
        topActivities.length > 0
          ? topActivities.map((item, index) => ({
              label: item.label,
              value: item.value,
              color: (index === 0
                ? 'accent'
                : index === 1
                  ? 'aux'
                  : index === 2
                    ? 'success'
                    : 'warning') satisfies keyof OfficeCanvasPalette,
            }))
          : [{ label: '事件', value: 0, color: 'fgMuted' }],
      footer: compactLine(resolveOfficeRuntimeFooter(runtimeStatus)),
    },
  ];
}

export function createMonitorTexture(data: OfficeCanvasDisplayData): THREE.CanvasTexture {
  const { topSummary, metricCards, footerStats, officeAgents, activityStats, elapsed } = data;
  const palette = resolveOfficeCanvasPalette();
  const runtimeStatus = resolveOfficeRuntimeStatus({
    runtimeStatus: topSummary.runtimeStatus,
    statusLabel: topSummary.status,
  });
  const w = 384;
  const h = 192;

  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = palette.bgOverlay;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = palette.aux;
    ctx.fillRect(0, 0, w, 3);

    const statusColor = palette[resolveOfficeRuntimePalette(runtimeStatus)];
    const statusLabel = formatOfficeRuntimeMonitorStatus(runtimeStatus);

    ctx.font = 'bold 16px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = palette.aux;
    ctx.fillText(`■ ${clampLabel(topSummary.title, 18)}`, 10, 10);
    ctx.fillStyle = statusColor;
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText(`● ${statusLabel}`, 310, 12);

    ctx.fillStyle = palette.border;
    ctx.fillRect(0, 32, w, 1);

    ctx.fillStyle = palette.aux;
    ctx.fillRect(10, 40, 4, 14);
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = palette.accent;
    ctx.fillText('核心指标', 20, 41);

    ctx.font = '11px ui-monospace, Menlo, monospace';
    const metricY = 60;
    for (let i = 0; i < metricCards.length && i < 3; i += 1) {
      const metric = metricCards[i]!;
      ctx.fillStyle = palette.fgMuted;
      ctx.fillText(metric.label, 20, metricY + i * 16);
      ctx.fillStyle = palette.fgDefault;
      ctx.font = 'bold 11px ui-monospace, Menlo, monospace';
      ctx.fillText(metric.value, 70, metricY + i * 16);
      ctx.font = '11px ui-monospace, Menlo, monospace';
    }

    const barY = metricY + metricCards.length * 16 + 4;
    const barPalette: Array<keyof OfficeCanvasPalette> = ['accent', 'success', 'warning', 'danger'];
    for (let i = 0; i < footerStats.length && i < 4; i += 1) {
      const stat = footerStats[i]!;
      const value = parseLeadingNumber(stat.value);
      const barWidth = Math.min(value * 8, 100);
      ctx.fillStyle = palette.surface;
      ctx.fillRect(20, barY + i * 14, 100, 8);
      ctx.fillStyle = palette[barPalette[i]!] ?? palette.accent;
      ctx.fillRect(22, barY + i * 14 + 2, Math.max(2, barWidth), 4);
      ctx.fillStyle = palette.fgMuted;
      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.fillText(`${stat.label} ${stat.value}`, 128, barY + i * 14 - 2);
    }

    const rightX = 210;
    ctx.fillStyle = palette.success;
    ctx.fillRect(rightX, 40, 4, 14);
    ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
    ctx.fillStyle = palette.success;
    ctx.fillText('Agent 状态', rightX + 10, 41);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (let i = 0; i < officeAgents.length && i < 6; i += 1) {
      const agent = officeAgents[i]!;
      const y = 60 + i * 14;
      const meta = OFFICE_STATUS_META[agent.status];
      ctx.fillStyle = palette[meta.color];
      ctx.fillText(`${meta.glyph} ${clampLabel(agent.label, 10)}`, rightX + 10, y);
      ctx.fillStyle = palette.fgMuted;
      ctx.fillText(meta.label, rightX + 110, y);
    }

    ctx.fillStyle = palette.border;
    ctx.fillRect(0, 130, w, 1);

    ctx.font = '10px ui-monospace, Menlo, monospace';
    const activities = getTopActivities(activityStats);
    let x = 10;
    for (const activity of activities) {
      ctx.fillStyle = palette.aux;
      ctx.fillText(activity.label, x, 140);
      ctx.fillStyle = palette.fgDefault;
      ctx.fillText(String(activity.value), x + 36, 140);
      x += 62;
      if (x > 350) {
        break;
      }
    }

    ctx.strokeStyle = palette.aux;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 20; i += 1) {
      const xPoint = 20 + i * 8;
      const yPoint = 175 - Math.sin(i * 0.5 + elapsed * 0.3) * 8;
      if (i === 0) {
        ctx.moveTo(xPoint, yPoint);
      } else {
        ctx.lineTo(xPoint, yPoint);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = palette.success;
    ctx.beginPath();
    for (let i = 0; i < 20; i += 1) {
      const xPoint = 200 + i * 8;
      const yPoint = 175 - Math.cos(i * 0.4 + elapsed * 0.2) * 6;
      if (i === 0) {
        ctx.moveTo(xPoint, yPoint);
      } else {
        ctx.lineTo(xPoint, yPoint);
      }
    }
    ctx.stroke();
  });
}

export function createProjectionScreenTexture(
  data: OfficeCanvasDisplayData,
  slideIndex: number,
): THREE.CanvasTexture {
  const palette = resolveOfficeCanvasPalette();
  const pages = buildOfficeProjectionPages(data);
  const page = pages[slideIndex % pages.length]!;
  const width = 320;
  const height = 200;
  const maxBarValue = Math.max(1, ...page.bars.map((bar) => bar.value));

  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = palette.bgBase;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = palette[page.accent];
    ctx.fillRect(0, 0, width, 36);
    ctx.fillStyle = palette.fgStrong;
    ctx.font = 'bold 16px ui-monospace, sans-serif';
    ctx.fillText(page.title, 16, 24);

    ctx.fillStyle = palette.fgMuted;
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(page.subtitle, 16, 48);

    ctx.fillStyle = palette.border;
    ctx.fillRect(16, 56, 288, 1);

    ctx.font = '10px ui-monospace, monospace';
    page.lines.slice(0, 6).forEach((line, index) => {
      ctx.fillStyle = index === 0 ? palette.fgStrong : palette.fgDefault;
      ctx.fillText(compactLine(line, 28), 16, 74 + index * 16);
    });

    ctx.fillStyle = palette.surface;
    ctx.fillRect(198, 66, 106, 92);
    page.bars.slice(0, 4).forEach((bar, index) => {
      const y = 76 + index * 20;
      ctx.fillStyle = palette.fgMuted;
      ctx.fillText(bar.label, 208, y);
      ctx.fillStyle = palette.surface;
      ctx.fillRect(208, y + 4, 76, 6);
      const filledWidth = Math.round((Math.max(0, bar.value) / maxBarValue) * 76);
      ctx.fillStyle = palette[bar.color];
      ctx.fillRect(208, y + 4, Math.max(2, filledWidth), 6);
      ctx.fillStyle = palette.fgStrong;
      ctx.fillText(String(bar.value), 288, y);
    });

    ctx.fillStyle = palette.border;
    ctx.fillRect(16, 172, 288, 1);
    ctx.fillStyle = palette.fgMuted;
    ctx.fillText(page.footer, 16, 186);
    ctx.fillText(`${(slideIndex % pages.length) + 1} / ${pages.length}`, 270, 186);
  });
}

export function createWallTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 64;
  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = '#5d3a1a';
    ctx.fillRect(0, 0, width, height);
    for (let row = 0; row < height; row += 8) {
      const offset = (row / 8) % 2 === 0 ? 0 : 16;
      for (let col = offset; col < width; col += 32) {
        ctx.fillStyle = '#4a2e14';
        ctx.fillRect(col, row, 1, 8);
      }
      ctx.fillStyle = '#3e2510';
      ctx.fillRect(0, row, width, 1);
    }
  });
}

export function createFloorTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 256;
  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = '#c2a06e';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#a88850';
    for (let x = 0; x < width; x += 16) {
      ctx.fillRect(x, 0, 1, height);
    }
    for (let y = 0; y < height; y += 16) {
      ctx.fillRect(0, y, width, 1);
    }
  });
}

export function createCarpetTexture(): THREE.CanvasTexture {
  const width = 128;
  const height = 128;
  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = '#8b4562';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#6b3050';
    for (let x = 0; x < width; x += 8) {
      ctx.fillRect(x, 0, 1, height);
    }
    for (let y = 0; y < height; y += 8) {
      ctx.fillRect(0, y, width, 1);
    }
    ctx.fillStyle = '#a05070';
    ctx.fillRect(0, 0, width, 4);
    ctx.fillRect(0, height - 4, width, 4);
    ctx.fillRect(0, 0, 4, height);
    ctx.fillRect(width - 4, 0, 4, height);
  });
}

export function createLabelTexture(
  label: string,
  isSelected: boolean,
  isHovered: boolean,
): THREE.CanvasTexture {
  const palette = resolveOfficeCanvasPalette();
  const charWidth = 10;
  const charHeight = 12;
  const width = label.length * charWidth + 16;
  const height = charHeight + 10;

  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = palette.bgBase;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = isHovered ? '#252540' : palette.bgBase;
    ctx.fillRect(2, 2, width - 4, height - 4);
    if (isSelected) {
      ctx.fillStyle = palette.aux;
      ctx.fillRect(0, 0, width, 2);
      ctx.fillRect(0, height - 2, width, 2);
      ctx.fillRect(0, 0, 2, height);
      ctx.fillRect(width - 2, 0, 2, height);
    } else if (isHovered) {
      ctx.fillStyle = palette.accent;
      ctx.fillRect(0, 0, width, 1);
      ctx.fillRect(0, height - 1, width, 1);
    }
    ctx.font = `${charHeight}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = isHovered ? palette.aux : palette.fgStrong;
    ctx.fillText(label, 8, 5);
  });
}
