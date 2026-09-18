import { describe, expect, it } from 'vitest';
import { shouldGrillIntent } from '../../handoff/capability/grill-intent.js';

describe('grill-intent — 高影响触发收窄为不可逆操作', () => {
  it('不可逆/破坏性输入仍触发 grill', () => {
    expect(shouldGrillIntent('删库')).toBe(true);
    expect(shouldGrillIntent('删除生产环境的所有数据')).toBe(true);
    expect(shouldGrillIntent('清空数据')).toBe(true);
    expect(shouldGrillIntent('不可逆')).toBe(true);
  });

  it('日常重构/重写/迁移/优化不再触发 grill', () => {
    expect(shouldGrillIntent('重构一下这个变量的命名')).toBe(false);
    expect(shouldGrillIntent('重构一下这个后端模块')).toBe(false);
    expect(shouldGrillIntent('重写一个函数')).toBe(false);
    expect(shouldGrillIntent('迁移到 Postgres')).toBe(false);
    expect(shouldGrillIntent('优化一下这段代码')).toBe(false);
  });

  it('中文架构级/高风险输入经 R3 分级探测触发 grill（evaluate 分支对中文生效）', () => {
    expect(shouldGrillIntent('重构整个系统架构')).toBe(true);
    expect(shouldGrillIntent('把数据迁移到 Postgres')).toBe(true);
  });

  it('中文只读提问保持 false（不误伤 light 路径）', () => {
    expect(shouldGrillIntent('了解一下这个模块的架构')).toBe(false);
    expect(shouldGrillIntent('解释一下这个函数')).toBe(false);
  });
});
