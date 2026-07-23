import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationRecord, PendingPermissionRequest } from '@openAwork/web-client';
import {
  matchPendingPermissionForNotification,
  NotificationItem,
  parsePermissionNotificationBody,
} from './NotificationItem.js';

function makeNotification(overrides?: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: 'notif-1',
    title: '等待权限 · mcp_call',
    body: '需要调用 MCP 工具\n调用 open_websearch/fetch_web {"url":"https://example.com"}\nopen_websearch:fetch_web:fp-open_websearch\nhigh',
    eventType: 'permission_asked',
    sessionId: 'session-1',
    createdAt: '2026-07-16T10:00:00.000Z',
    readAt: null,
    status: 'unread',
    ...(overrides ?? {}),
  };
}

function makePermissionRequest(
  requestId: string,
  overrides?: Partial<PendingPermissionRequest>,
): PendingPermissionRequest {
  return {
    requestId,
    sessionId: 'session-1',
    toolName: 'mcp_call',
    scope: 'open_websearch:fetch_web:fp-open_websearch',
    reason: '需要调用 MCP 工具',
    riskLevel: 'high',
    previewAction: '调用 open_websearch/fetch_web {"url":"https://example.com"}',
    always: ['open_websearch:fetch_web:*', 'open_websearch:*'],
    status: 'pending',
    createdAt: '2026-07-16T10:00:00.000Z',
    ...(overrides ?? {}),
  };
}

describe('parsePermissionNotificationBody', () => {
  it('兼容带 requestId 前缀的新通知格式', () => {
    const parsed = parsePermissionNotificationBody(
      'requestId=perm-123\n需要调用 MCP 工具\n调用 context7/query_docs\ncontext7:query_docs\nhigh',
    );

    expect(parsed).toEqual({
      requestId: 'perm-123',
      reason: '需要调用 MCP 工具',
      previewAction: '调用 context7/query_docs',
      scope: 'context7:query_docs',
      riskLevel: 'high',
    });
  });
});

describe('matchPendingPermissionForNotification', () => {
  it('同一会话存在多个权限请求时，会按通知正文匹配到对应请求', () => {
    const notification = makeNotification();
    const pendingRequests = [
      makePermissionRequest('perm-bash', {
        toolName: 'bash',
        scope: 'npm run build -- --watch',
        reason: '需要执行工作区命令',
        riskLevel: 'medium',
        previewAction: '执行命令: npm run build -- --watch',
        always: ['npm run *', 'npm *'],
      }),
      makePermissionRequest('perm-mcp'),
    ];

    expect(matchPendingPermissionForNotification(notification, pendingRequests)?.requestId).toBe(
      'perm-mcp',
    );
  });
});

describe('NotificationItem', () => {
  it('权限通知拿到详情后会渲染三档授权范围按钮', () => {
    const notification = makeNotification();
    const permission = makePermissionRequest('perm-mcp');

    const html = renderToStaticMarkup(
      <NotificationItem
        notification={notification}
        permDetail={permission}
        sessionTitle="测试会话"
        replying={false}
        selectedScope="base"
        index={0}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onReply={vi.fn()}
        onScopeChange={vi.fn()}
      />,
    );

    expect(html).toContain('授权范围');
    expect(html).toContain('第一档');
    expect(html).toContain('第二档');
    expect(html).toContain('第三档');
    expect(html).toContain('仅本次指令');
    expect(html).toContain('同子命令');
    expect(html).toContain('同类指令');
    expect(html).toContain('open_websearch/fetch_web');
    expect(html.indexOf('open_websearch:fetch_web:fp-open_websearch')).toBeLessThan(
      html.indexOf('open_websearch:fetch_web:*'),
    );
    expect(html.indexOf('open_websearch:fetch_web:*')).toBeLessThan(
      html.indexOf('open_websearch:*'),
    );
  });

  it('没有 pending 详情时不展示审批操作按钮', () => {
    const notification = makeNotification();
    const html = renderToStaticMarkup(
      <NotificationItem
        notification={notification}
        permDetail={undefined}
        sessionTitle="测试会话"
        replying={false}
        selectedScope={undefined}
        index={0}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onReply={vi.fn()}
        onScopeChange={vi.fn()}
      />,
    );

    expect(html).not.toContain('允许一次');
    expect(html).not.toContain('本会话');
    expect(html).not.toContain('永久允许');
    expect(html).not.toContain('拒绝');
    expect(html).not.toContain('授权范围');
  });

  it('bash 权限通知也会按第一档、第二档、第三档固定展示指令范围', () => {
    const notification = makeNotification({
      title: '等待权限 · bash',
      body: '需要执行工作区命令\n执行命令: git status -sb\ngit status -sb\nmedium',
    });
    const permission = makePermissionRequest('perm-bash', {
      toolName: 'bash',
      scope: 'git status -sb',
      reason: '需要执行工作区命令',
      riskLevel: 'medium',
      previewAction: '执行命令: git status -sb',
      always: ['git *', 'git status *'],
    });

    const html = renderToStaticMarkup(
      <NotificationItem
        notification={notification}
        permDetail={permission}
        sessionTitle="测试会话"
        replying={false}
        selectedScope="base"
        index={0}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onReply={vi.fn()}
        onScopeChange={vi.fn()}
      />,
    );

    expect(html).toContain('第一档');
    expect(html).toContain('第二档');
    expect(html).toContain('第三档');
    expect(html).toContain('git status -sb');
    expect(html.indexOf('git status -sb')).toBeLessThan(html.indexOf('git status *'));
    expect(html.indexOf('git status *')).toBeLessThan(html.indexOf('git *'));
  });
});
