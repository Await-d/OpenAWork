import { describe, expect, it } from 'vitest';
import { extractSshConnectionId, getSessionModeLabels } from './session-metadata.js';

describe('extractSshConnectionId — SSH 工作区绑定', () => {
  it('解析出会话绑定的 SSH 连接 id', () => {
    expect(
      extractSshConnectionId(JSON.stringify({ sshConnectionId: 'ssh-1', workingDirectory: '/r' })),
    ).toBe('ssh-1');
  });

  it('本地会话 / 非法值回落 null', () => {
    expect(extractSshConnectionId(JSON.stringify({ workingDirectory: '/repo' }))).toBeNull();
    expect(extractSshConnectionId(JSON.stringify({ sshConnectionId: '   ' }))).toBeNull();
    expect(extractSshConnectionId(undefined)).toBeNull();
  });
});

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

describe('getSessionModeLabels — 标签范围选项', () => {
  it('关闭对话模式标签后不再输出模式文案', () => {
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding' }), {
        includeDialogueMode: false,
      }),
    ).toEqual([]);
  });

  it('会话列表过滤模式下仅保留审批档位标签', () => {
    const metadataJson = JSON.stringify({
      dialogueMode: 'programmer',
      permissionMode: 'yolo',
      modelId: 'deepseek-chat',
    });

    expect(
      getSessionModeLabels(metadataJson, {
        includeDialogueMode: false,
        includeModel: false,
      }),
    ).toEqual(['YOLO']);
  });

  it('模型名标签可独立关闭', () => {
    expect(
      getSessionModeLabels(JSON.stringify({ dialogueMode: 'coding', modelId: 'gpt-4o' }), {
        includeModel: false,
      }),
    ).toEqual(['编程']);
  });
});
