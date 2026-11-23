import { describe, expect, it } from 'vitest';

import { buildChannelResultView, extractChannelAck } from './channel-result-view.js';

describe('buildChannelResultView · 消息', () => {
  it('裸数组消息 → 行卡（发送者 / 内容 / 时间）', () => {
    const view = buildChannelResultView([
      {
        id: 'msg_1',
        senderId: 'u_1',
        senderName: '张三',
        chatId: 'c_1',
        content: '你好，今天的版本什么时候发？',
        timestamp: 1735782645000,
      },
    ]);

    const row = view?.groups?.[0]?.rows[0];
    expect(row?.title).toBe('张三');
    expect(row?.description).toBe('你好，今天的版本什么时候发？');
    expect(row?.meta?.[0]).toMatch(/^\d\d-\d\d \d\d:\d\d$/);
  });

  it('JSON 字符串输出同样识别（渠道工具都是 JSON.stringify）', () => {
    const raw = JSON.stringify([{ senderName: '李四', content: '收到', timestamp: 1735782645000 }]);

    expect(buildChannelResultView(raw)?.groups?.[0]?.rows[0]?.title).toBe('李四');
  });
});

describe('buildChannelResultView · Bitable 记录', () => {
  it('`{ items: [{ fields }] }` → 动态列表格，列名来自实际出现的键', () => {
    const view = buildChannelResultView({
      items: [
        { record_id: 'rec_1', fields: { 名称: '发布 v2', 状态: '进行中' } },
        { record_id: 'rec_2', fields: { 名称: '接入飞书', 负责人: '张三' } },
      ],
      page_token: 'x',
      has_more: false,
    });

    expect(view?.table?.columns).toEqual(['名称', '状态', '负责人']);
    expect(view?.table?.rows[0]?.[0]?.text).toBe('发布 v2');
    // 第二条没有「状态」字段 → 空单元格，不能错位到别的列
    expect(view?.table?.rows[1]?.[1]?.text).toBe('');
    expect(view?.table?.rows[1]?.[2]?.text).toBe('张三');
  });

  it('字段值是数组时拍平成顿号连接', () => {
    const view = buildChannelResultView([{ record_id: 'r', fields: { 成员: ['张三', '李四'] } }]);

    expect(view?.table?.rows[0]?.[0]?.text).toBe('张三、李四');
  });

  it('列数超上限时补一列提示，避免把表格撑爆', () => {
    const fields: Record<string, string> = {};
    for (let index = 0; index < 12; index += 1) fields[`f${index}`] = String(index);

    const view = buildChannelResultView([{ record_id: 'r', fields }]);

    expect(view?.table?.columns).toHaveLength(9);
    expect(view?.table?.columns[8]).toBe('…');
  });
});

describe('buildChannelResultView · 群组与成员', () => {
  it('群组把人数放到右侧', () => {
    const view = buildChannelResultView([
      { id: 'c_1', name: '项目群', memberCount: 12 },
      { id: 'c_2', name: '产品群', memberCount: 8 },
    ]);

    expect(view?.groups?.[0]?.rows[0]?.title).toBe('项目群');
    expect(view?.groups?.[0]?.rows[0]?.trailing).toBe('12 人');
  });

  it('QQ / 微信的群列表没有 memberCount，也必须识别成群组', () => {
    // `listRecentChannelGroups` 只返回 `{ id, name }`——`memberCount` 在 `ChannelGroup`
    // 里是可选的。曾经用 `'memberCount' in item` 当判据，导致这两个渠道的群列表
    // 永远落不到群组卡上。
    const view = buildChannelResultView([
      { id: 'group_1', name: '项目群' },
      { id: 'group_2', name: '产品群' },
    ]);

    expect(view?.groups?.[0]?.rows[0]?.title).toBe('项目群');
    expect(view?.note).toBe('2 个群组');
    // 拿不到人数就不显示右对齐数字
    expect(view?.groups?.[0]?.rows[0]?.trailing).toBeUndefined();
  });

  it('飞书成员走 `{ items }` 信封', () => {
    const view = buildChannelResultView({
      items: [{ member_id: 'ou_1', name: '李四', tenant_key: 't' }],
      hasMore: false,
    });

    expect(view?.groups?.[0]?.rows[0]?.title).toBe('李四');
    expect(view?.groups?.[0]?.rows[0]?.meta?.[0]).toBe('ou_1');
  });
});

describe('buildChannelResultView · 拒绝误判', () => {
  it('数组里混了非对象就整组放弃', () => {
    expect(buildChannelResultView([{ senderName: 'a', content: 'x' }, 'oops'])).toBeNull();
  });

  it('形态不一致时不认', () => {
    expect(buildChannelResultView([{ name: '项目群', memberCount: 1 }, { foo: 'bar' }])).toBeNull();
  });

  it('普通 JSON 数组不会被当成渠道数据', () => {
    expect(
      buildChannelResultView([
        { id: 1, value: 'a' },
        { id: 2, value: 'b' },
      ]),
    ).toBeNull();
  });

  it('空数组 / 非数组返回 null', () => {
    expect(buildChannelResultView([])).toBeNull();
    expect(buildChannelResultView({ items: [] })).toBeNull();
    expect(buildChannelResultView({ foo: 'bar' })).toBeNull();
    expect(buildChannelResultView(null)).toBeNull();
  });
});

describe('buildChannelResultView · 条数说明', () => {
  it('行卡顶部给出条数（表格有表头，行卡没有，不给就只能自己数）', () => {
    expect(buildChannelResultView([{ senderName: '张三', content: '你好' }])?.note).toBe(
      '1 条消息',
    );
    expect(buildChannelResultView([{ id: 'c_1', name: '项目群', memberCount: 3 }])?.note).toBe(
      '1 个群组',
    );
    expect(buildChannelResultView({ items: [{ member_id: 'ou_1', name: '李四' }] })?.note).toBe(
      '1 位成员',
    );
  });
});

describe('extractChannelAck', () => {
  it('识别发送回执 `{ messageId }`（网关会再套一层 JSON.stringify）', () => {
    expect(extractChannelAck('{"messageId":"om_abc"}')).toEqual({ messageId: 'om_abc' });
  });

  it('已解析成对象的同样识别', () => {
    expect(extractChannelAck({ messageId: 'om_abc' })).toEqual({ messageId: 'om_abc' });
  });

  it('空 / 非字符串 messageId 不认（不把别的对象误当成发送回执）', () => {
    expect(extractChannelAck({ messageId: '   ' })).toBeNull();
    expect(extractChannelAck({ messageId: 123 })).toBeNull();
    expect(extractChannelAck({ ok: true })).toBeNull();
    expect(extractChannelAck('一段普通文本')).toBeNull();
    expect(extractChannelAck([{ messageId: 'om_abc' }])).toBeNull();
    expect(extractChannelAck(null)).toBeNull();
  });
});
