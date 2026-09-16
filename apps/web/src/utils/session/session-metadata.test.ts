import { describe, expect, it } from 'vitest';
import { getSessionModeLabels } from './session-metadata.js';

describe('getSessionModeLabels — 审批方式档位标签', () => {
  it('ask 档不追加任何审批标签', () => {
    expect(getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding' }))).toEqual(['编程']);
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding', permissionMode: 'ask' })),
    ).toEqual(['编程']);
  });

  it('auto-edit 档追加「编辑自动」标签', () => {
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding', permissionMode: 'auto-edit' })),
    ).toEqual(['编程', '编辑自动']);
  });

  it('yolo 档保留既有 YOLO 标签（规范字段与旧布尔都可识别）', () => {
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding', permissionMode: 'yolo' })),
    ).toEqual(['编程', 'YOLO']);
    // 旧数据只有 yoloMode 布尔：按档位回退推导为 yolo。
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding', yoloMode: true })),
    ).toEqual(['编程', 'YOLO']);
  });
});
