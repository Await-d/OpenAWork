/**
 * 260517-team-phase-d · 派发包真实接入版
 *
 * 从当前选中的 team session 的 handoff 列表中：
 *   - 过滤出 to_role_layer ∈ {executor, tester, reviewer} 的派发记录
 *   - 把 payload.dispatch_package（PM2 写入）转换成 DispatchPackageView 展示形态
 *   - 对每个派发显示运行状态、accept / cancel 入口（状态由 useHandoffStore 实时同步）
 *
 * 没有 selectedTeam 时显示空态；正在加载时显示骨架；网络失败显示错误条带。
 *
 * 数据接口：
 *   - GET /team/sessions/:sessionId/handoffs（首次拉取）
 *   - useHandoffStore（实时 patch）
 *   - POST /team/handoffs/:handoffId/cancel（取消）
 */

import { type CSSProperties, useMemo } from 'react';
import type { HandoffRecord } from '@openAwork/web-client';
import { TabContainer } from '../TabContainer.js';
import { TabPlaceholder } from '../TabPlaceholder.js';
import { DispatchPackageView } from './DispatchPackageView.js';
import { useSessionHandoffs } from '../../hooks/use-session-handoffs.js';

interface DispatchTabProps {
  selectedTeamId: string;
  onCancelHandoff: (handoffId: string) => void;
}

interface DispatchPackagePayload {
  goal?: string;
  role?: string;
  toolsets?: string[];
  taskMarkers?: {
    taskId?: string;
    parallel?: boolean;
    story?: string;
    priority?: string;
  };
  dependsOn?: string[];
}

interface DispatchPayload {
  dispatch_package?: DispatchPackagePayload;
}

const STATE_LABEL: Record<HandoffRecord['state'], string> = {
  pending: '等待派发',
  claimed: '已认领',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATE_COLOR: Record<HandoffRecord['state'], string> = {
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const META_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 12,
  paddingBottom: 8,
  borderBottom: '1px dashed color-mix(in srgb, var(--border-default) 50%, transparent)',
};

const PACKAGE_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 84%, var(--bg-base)',
};

const ACTION_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--danger) 36%, transparent)',
  background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
  color: 'var(--danger)',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
};

function isDispatchPayload(value: unknown): value is DispatchPayload {
  return typeof value === 'object' && value !== null;
}

function parseDispatchPackage(record: HandoffRecord): DispatchPackagePayload | null {
  const payload = record.payload;
  if (!isDispatchPayload(payload)) return null;
  // 后端 pm2-runner 直接把 dispatch package 作为 payload 写入（不嵌套在 dispatch_package 下）
  // 兼容两种格式：payload.dispatch_package（旧）或 payload 本身就是 package（新）
  if (payload.dispatch_package) return payload.dispatch_package;
  // 检查 payload 本身是否有 dispatch package 的特征字段
  if (typeof (payload as Record<string, unknown>)['goal'] === 'string') {
    return payload as unknown as DispatchPackagePayload;
  }
  return null;
}

export function DispatchTab({ selectedTeamId, onCancelHandoff }: DispatchTabProps) {
  const { handoffs, loading, error, refresh } = useSessionHandoffs(selectedTeamId);

  const dispatchHandoffs = useMemo(
    () =>
      handoffs.filter(
        (record) =>
          record.toRoleLayer === 'executor' ||
          record.toRoleLayer === 'tester' ||
          record.toRoleLayer === 'reviewer',
      ),
    [handoffs],
  );

  const packages = useMemo(
    () =>
      dispatchHandoffs
        .map((record) => {
          const dispatch = parseDispatchPackage(record);
          if (!dispatch) return null;
          return {
            handoff: record,
            dispatch,
          };
        })
        .filter(
          (entry): entry is { handoff: HandoffRecord; dispatch: DispatchPackagePayload } =>
            entry !== null,
        ),
    [dispatchHandoffs],
  );

  if (!selectedTeamId) {
    return (
      <TabContainer title="派发包" subtitle="选择左侧会话查看 PM2 拆分出的 dispatch_packages。">
        <TabPlaceholder
          emoji="📦"
          title="未选择会话"
          subtitle="左侧选中一个团队会话后，这里会列出该会话由 PM2 派发到执行 / 测试 / 评审层的所有 dispatch_package。"
          status="data-pending"
          dataSource="GET /team/sessions/:sessionId/handoffs"
          bullets={[
            '过滤 to_role_layer ∈ {executor, tester, reviewer}',
            '展开 payload.dispatch_package',
          ]}
        />
      </TabContainer>
    );
  }

  return (
    <TabContainer
      title="派发包"
      subtitle="PM2 拆分 tasks.md 后向 e/f/g 派发的 dispatch_package 列表。"
      actions={
        <button
          type="button"
          onClick={refresh}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
            background: 'transparent',
            color: 'var(--fg-default)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {loading ? '加载中…' : '刷新'}
        </button>
      }
    >
      <div style={META_BAR_STYLE}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-default)' }}>
          派发记录 {dispatchHandoffs.length} 个
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
          {packages.length} 个携带 dispatch_package
        </span>
      </div>

      {error ? (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid color-mix(in srgb, var(--danger) 32%, transparent)',
            color: 'var(--danger)',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      {packages.length > 0 ? (
        <DispatchPackageView
          packages={packages.map(({ dispatch }) => ({
            goal: dispatch.goal ?? '(no goal)',
            role: dispatch.role ?? 'executor',
            toolsets: dispatch.toolsets ?? [],
            taskMarkers: {
              taskId: dispatch.taskMarkers?.taskId ?? '',
              parallel: dispatch.taskMarkers?.parallel ?? false,
              story: dispatch.taskMarkers?.story,
              priority: dispatch.taskMarkers?.priority ?? 'medium',
            },
            dependsOn: dispatch.dependsOn ?? [],
          }))}
        />
      ) : null}

      {dispatchHandoffs.length > 0 ? (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--fg-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 700,
            }}
          >
            实时状态
          </span>
          {dispatchHandoffs.map((record) => (
            <div key={record.id} style={PACKAGE_ROW_STYLE}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: `color-mix(in srgb, ${STATE_COLOR[record.state]} 14%, transparent)`,
                    color: STATE_COLOR[record.state],
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.02em',
                  }}
                >
                  {STATE_LABEL[record.state]}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-strong)' }}>
                  {record.fromRoleLayer} → {record.toRoleLayer}
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                  title={`Handoff ID: ${record.id}`}
                >
                  #{record.id.slice(0, 8)}
                </span>
              </div>
              {record.failureReason ? (
                <span style={{ fontSize: 11, color: 'var(--danger)' }}>
                  失败原因：{record.failureReason}
                </span>
              ) : null}
              {record.state === 'pending' ||
              record.state === 'claimed' ||
              record.state === 'running' ? (
                <div>
                  <button
                    type="button"
                    onClick={() => onCancelHandoff(record.id)}
                    style={ACTION_BTN_STYLE}
                  >
                    取消派发
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : !loading ? (
        <TabPlaceholder
          emoji="🛠️"
          title="本会话尚未派发任务"
          subtitle="只有当 PM2 完成 tasks.md 拆分并触发派发后，这里才会出现 e/f/g 层的执行记录。"
          status="data-pending"
          dataSource="handoff_records.to_role_layer ∈ {executor, tester, reviewer}"
        />
      ) : null}
    </TabContainer>
  );
}
