import { describe, expect, it } from 'vitest';

import { naturalLanguageSummary } from './natural-language-summary.js';

/**
 * 渠道整族（`Plugin*` / `Weixin*` / `Feishu*`）的工具名是英文驼峰，一旦漏掉文案就会落到
 * 通用回退，把 `PluginSendMessage` 这样的英文名直接展示给用户。
 *
 * 这组断言逐条锁住中文文案。新增渠道工具时如果忘了补，这里会缺一条 ——
 * 那是刻意的：漏文案的代价（用户看到英文工具名）比多写一行测试大得多。
 */
const CHANNEL_CASES: ReadonlyArray<readonly [string, string]> = [
  ['PluginSendMessage', '已发送了消息'],
  ['PluginReplyMessage', '已回复了消息'],
  ['PluginSendImage', '已发送了图片'],
  ['PluginSendFile', '已发送了文件'],
  ['WeixinSendImage', '已发送了图片'],
  ['WeixinSendFile', '已发送了文件'],
  ['FeishuSendImage', '已发送了图片'],
  ['FeishuSendFile', '已发送了文件'],
  ['FeishuAtMember', '已提醒了群成员'],
  ['FeishuSendUrgent', '已发送了加急提醒'],
  ['PluginGetGroupMessages', '已读取了群消息'],
  ['PluginSummarizeGroup', '已读取了群消息'],
  ['PluginGetCurrentChatMessages', '已读取了群消息'],
  ['PluginListGroups', '已列举了群组'],
  ['FeishuListChatMembers', '已列举了群成员'],
  ['FeishuBitableListApps', '已列举了数据表'],
  ['FeishuBitableListTables', '已列举了数据表'],
  ['FeishuBitableListFields', '已列举了数据表字段'],
  ['FeishuBitableGetRecords', '已读取了数据表记录'],
  ['FeishuBitableCreateRecords', '已创建了数据表记录'],
  ['FeishuBitableUpdateRecords', '已更新了数据表记录'],
  ['FeishuBitableDeleteRecords', '已删除了数据表记录'],
];

describe('naturalLanguageSummary — 渠道工具', () => {
  for (const [toolName, expected] of CHANNEL_CASES) {
    it(`${toolName} → ${expected}`, () => {
      expect(naturalLanguageSummary(toolName, {})).toBe(expected);
    });
  }

  it('所有渠道文案都不残留英文（既没有工具名，也没有英文单词）', () => {
    for (const [toolName] of CHANNEL_CASES) {
      const summary = naturalLanguageSummary(toolName, {});
      expect(summary).not.toContain(toolName);
      expect(summary).not.toMatch(/[A-Za-z]/);
    }
  });

  it('未登记的渠道工具仍会落到通用回退（说明文案表是显式的）', () => {
    expect(naturalLanguageSummary('PluginSomethingElse', {})).toBe('已执行了 PluginSomethingElse');
  });
});
