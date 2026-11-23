// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolOutputPreview } from './tool-output-preview.js';

afterEach(cleanup);

describe('ToolOutputPreview · 结果视图分发', () => {
  it('管理类信封 → 行卡列表 + 状态摘要', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="skill_manage"
        output={{
          ok: true,
          action: 'list',
          count: 1,
          skills: [
            {
              skillId: 'pdf-tools',
              displayName: 'PDF 工具箱',
              enabled: false,
              description: '拆分合并与 OCR',
            },
          ],
        }}
      />,
    );

    expect(container.querySelector('.result-view')).not.toBeNull();
    expect(container.querySelector('.result-row-title')?.textContent).toBe('PDF 工具箱');
    expect(container.querySelector('.result-row-desc')?.textContent).toBe('拆分合并与 OCR');
    expect(container.querySelector('.result-view-note')?.textContent).toBe('1 个已停用');
  });

  it('定时任务走表格', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="schedule_manage"
        output={{
          ok: true,
          action: 'list',
          count: 1,
          jobs: [
            {
              id: 'j1',
              name: '每日站会',
              scheduleKind: 'cron',
              scheduleExpr: '0 9 * * 1-5',
              enabled: true,
              fireCount: 3,
            },
          ],
        }}
      />,
    );

    expect(container.querySelector('.result-table')).not.toBeNull();
    expect(container.querySelector('.result-table tbody td')?.textContent).toBe('每日站会');
  });

  it('models → 行卡，并提供表格切换', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="models"
        output={{
          providers: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              models: [
                {
                  id: 'anthropic/claude-sonnet-4-5',
                  name: 'Claude Sonnet 4.5',
                  cost: [{ input: 3, output: 15 }],
                  status: 'active',
                },
              ],
            },
          ],
          total: 1,
          next: null,
        }}
      />,
    );

    expect(container.querySelector('.result-group-title')?.textContent).toContain('Anthropic');
    expect(container.querySelector('.result-row-trailing')?.textContent).toBe('$3 / $15');
    expect(container.querySelector('.result-view-toggle')?.textContent).toBe('表格视图');
  });

  it('models 切到表格视图后渲染定价表，按钮文案反过来', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="models"
        output={{
          providers: [
            {
              id: 'anthropic',
              name: 'Anthropic',
              models: [
                {
                  id: 'anthropic/x',
                  name: 'X',
                  cost: [{ input: 3, output: 15 }],
                  status: 'active',
                },
              ],
            },
          ],
          total: 1,
          next: null,
        }}
      />,
    );

    expect(container.querySelector('.result-table')).toBeNull();

    fireEvent.click(container.querySelector('.result-view-toggle') as HTMLElement);

    expect(container.querySelector('.result-table')).not.toBeNull();
    expect(container.querySelector('.result-table th')?.textContent).toBe('模型');
    expect(container.querySelector('.result-view-toggle')?.textContent).toBe('行卡视图');
    // 表格里定价列对齐
    expect(container.querySelectorAll('.result-table td')[2]?.textContent).toBe('$3');
  });

  it('session_read → 紧凑日志', () => {
    const text = [
      'Session: sess_1',
      '',
      '[Message 1/2] user (2025-01-02T03:04:05.000Z)',
      '帮我查一下天气',
      '',
      '[Message 2/2] assistant (2025-01-02T03:04:10.000Z)',
      '[tool_call] get_weather {"city":"北京"}',
    ].join('\n');

    const { container } = render(<ToolOutputPreview toolName="session_read" output={text} />);

    expect(container.querySelector('.session-read-log')).not.toBeNull();
    expect(container.querySelector('.session-read-role')?.textContent).toBe('用户');
    expect(container.querySelector('.session-read-tool')?.textContent).toContain('get_weather');
  });

  it('session_read 的角色标签覆盖 MessageRole 全部取值，且不漏英文哨兵', () => {
    // `MessageRole` 是闭集合（packages/shared/src/message-schema.ts）：
    // user / assistant / tool / system / synthetic。最后一行角色缺失，
    // 解析器会写哨兵 `unknown`——它也必须译，否则界面上冒出英文。
    const roles = ['user', 'assistant', 'tool', 'system', 'synthetic'];
    const text = [
      'Session: sess_1',
      '',
      ...roles.flatMap((role, index) => [
        `[Message ${index + 1}/6] ${role} (2025-01-02T03:0${index}:00.000Z)`,
        `第 ${index + 1} 条内容`,
        '',
      ]),
      '[Message 6/6]',
      '缺角色的一行',
    ].join('\n');

    const { container } = render(<ToolOutputPreview toolName="session_read" output={text} />);
    const cells = Array.from(container.querySelectorAll('.session-read-role'));
    const labels = cells.map((cell) => cell.textContent ?? '');
    const roleAttrs = cells.map((cell) => cell.getAttribute('data-role') ?? '');

    for (const expected of ['用户', '助手', '工具', '系统', '通知', '未知']) {
      expect(labels).toContain(expected);
    }
    for (const label of labels) {
      expect(label).not.toMatch(/[A-Za-z]/);
    }
    // `data-role` 是配色选择器的挂点：5 个真实角色都得有值，否则对应配色静默失效。
    for (const role of [...roles, 'unknown']) {
      expect(roleAttrs).toContain(role);
    }
  });

  it('session_read 的会话来源与通知标签渲染成中文', () => {
    const text = [
      'Session: sess_9f2c',
      'Source: channel · wechat · wxid_abc123',
      'Messages: 2',
      '',
      '[Message 1/2] user (2026-01-02T03:04:05.000Z)',
      '在吗',
      '',
      '[Message 2/2] synthetic (2026-01-02T03:04:10.000Z · subagent · scout · failed)',
      '子代理已完成',
    ].join('\n');

    const { container } = render(<ToolOutputPreview toolName="session_read" output={text} />);

    // 会话级来源：通道 · 微信 · wxid_abc123（判别词与通道类型译中文，会话 id 是数据）
    expect(container.querySelector('.session-read-source-tag')?.textContent).toBe('来源');
    const source = container.querySelector('.session-read-source')?.textContent ?? '';
    expect(source).toContain('通道');
    expect(source).toContain('微信');
    expect(source).toContain('wxid_abc123');

    // 通知标签：子代理 · scout · 失败（来源名原样，状态译中文）
    expect(container.querySelector('.session-read-origin')?.textContent).toBe(
      '子代理 · scout · 失败',
    );

    // 限定词不该污染时间列（本地时区，所以只校验格式而非具体值）
    const times = Array.from(container.querySelectorAll('.session-read-time')).map(
      (cell) => cell.textContent ?? '',
    );
    expect(times.some((value) => /^\d{2}:\d{2}:\d{2}$/.test(value))).toBe(true);
  });

  it('渠道消息数组 → 行卡', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="PluginGetGroupMessages"
        output={JSON.stringify([{ senderName: '张三', content: '你好', timestamp: 1735782645000 }])}
      />,
    );

    expect(container.querySelector('.result-row-title')?.textContent).toBe('张三');
    expect(container.querySelector('.result-row-desc')?.textContent).toBe('你好');
  });

  it('Bitable 记录 → 动态列表格', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="FeishuBitableGetRecords"
        output={JSON.stringify({
          items: [{ record_id: 'r1', fields: { 名称: '发布 v2', 状态: '进行中' } }],
          has_more: false,
        })}
      />,
    );

    const headers = container.querySelectorAll('.result-table th');
    expect(Array.from(headers).map((cell) => cell.textContent)).toEqual(['名称', '状态']);
  });

  it('不会误吃有专用预览的工具输出', () => {
    const { container } = render(
      <ToolOutputPreview toolName="read" output={{ content: 'file body' }} />,
    );

    expect(container.querySelector('.result-view')).toBeNull();
    expect(container.textContent).toContain('file body');
  });

  it('渠道发送回执 → 确认行，而不是 messageId 字段表', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="PluginSendMessage"
        output={JSON.stringify({ messageId: 'om_abc123' })}
      />,
    );

    const confirm = container.querySelector('.tool-call-confirm');
    expect(confirm).not.toBeNull();
    // 中文动作 + 可核对的回执 id
    expect(confirm?.textContent).toContain('已发送了消息');
    expect(confirm?.textContent).toContain('om_abc123');
    // 不再走字段表
    expect(container.textContent).not.toContain('messageId');
  });

  it('lsp_status → 服务状态视图，未安装项带出安装命令', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="lsp_status"
        output={{
          servers: [
            { id: 'typescript', root: '/w', running: true, fileCount: 3, diagnosticCount: 0 },
          ],
          missing: [
            {
              id: 'gopls',
              extensions: ['.go'],
              binary: 'gopls',
              installCommand: 'go install golang.org/x/tools/gopls@latest',
              installed: false,
            },
          ],
        }}
      />,
    );

    expect(container.querySelectorAll('.result-group-title')).toHaveLength(2);
    expect(container.querySelector('.result-view-note')?.textContent).toBe('1 个尚未安装');
    expect(container.textContent).toContain('go install golang.org/x/tools/gopls@latest');
  });

  it('mcp__lsp__status 归一化后走同一条路径', () => {
    const { container } = render(
      <ToolOutputPreview
        toolName="mcp__lsp__status"
        output={{
          content: [
            {
              type: 'text',
              text: JSON.stringify({ servers: [], missing: [{ id: 'gopls', installed: false }] }),
            },
          ],
        }}
      />,
    );

    expect(container.querySelector('.result-row-title')?.textContent).toBe('gopls');
    expect(container.querySelector('.mcp-result')).toBeNull();
  });
});
