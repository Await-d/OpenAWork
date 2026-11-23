// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageEditReferenceArtifact } from '../conversation/render/image-edit-reference-artifacts.js';
import { useChatImageResultSelection } from './use-chat-image-result-selection.js';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: mocks.toast,
}));

function artifact(artifactId: string, title = artifactId): ImageEditReferenceArtifact {
  return { artifactId, title, updatedAt: '2026-01-01T00:00:00.000Z' };
}

function renderDomain(initial?: {
  sessionReferenceArtifacts?: ImageEditReferenceArtifact[];
  currentSessionId?: string | null;
}) {
  const setImageGenerationMode = vi.fn();
  const view = renderHook(
    ({ sessionReferenceArtifacts, currentSessionId }) =>
      useChatImageResultSelection({
        sessionReferenceArtifacts,
        currentSessionId,
        setImageGenerationMode,
      }),
    {
      initialProps: {
        sessionReferenceArtifacts: initial?.sessionReferenceArtifacts ?? [],
        currentSessionId: initial?.currentSessionId ?? 's1',
      },
    },
  );
  return { ...view, setImageGenerationMode };
}

describe('useChatImageResultSelection', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it('无生成结果时候选集就是会话参考图，且沿用同一引用', () => {
    const sessionRefs = [artifact('a1')];
    const { result } = renderDomain({ sessionReferenceArtifacts: sessionRefs });

    expect(result.current.latestGeneratedImageResult).toBeNull();
    expect(result.current.availableImageEditReferenceArtifacts).toBe(sessionRefs);
    expect(result.current.selectedImageEditReferenceArtifact).toBeNull();
  });

  it('生成结果不在会话参考图里时前置到候选集首位', () => {
    const { result } = renderDomain({ sessionReferenceArtifacts: [artifact('a1')] });

    act(() => {
      result.current.setLatestGeneratedImageResult({
        artifactId: 'img-9',
        artifactTitle: '夕阳',
        modelLabel: 'gpt-image',
      });
    });

    const available = result.current.availableImageEditReferenceArtifacts;
    expect(available.map((item) => item.artifactId)).toEqual(['img-9', 'a1']);
    expect(available[0]?.title).toBe('夕阳');
  });

  it('生成结果已在会话参考图里时不重复前置，也不复制数组', () => {
    const sessionRefs = [artifact('img-9')];
    const { result } = renderDomain({ sessionReferenceArtifacts: sessionRefs });

    act(() => {
      result.current.setLatestGeneratedImageResult({
        artifactId: 'img-9',
        artifactTitle: '夕阳',
        modelLabel: 'gpt-image',
      });
    });

    expect(result.current.availableImageEditReferenceArtifacts).toBe(sessionRefs);
  });

  it('选中项按 id 在候选集里解析，命中即返回完整条目', () => {
    const { result } = renderDomain({ sessionReferenceArtifacts: [artifact('a1', '图一')] });

    expect(result.current.selectedImageEditReferenceArtifact).toBeNull();

    act(() => {
      result.current.setSelectedImageEditReferenceArtifactId('a1');
    });

    expect(result.current.selectedImageEditReferenceArtifact?.artifactId).toBe('a1');
    expect(result.current.selectedImageEditReferenceArtifact?.title).toBe('图一');
  });

  it('候选集里失去选中项时自动清空选中', () => {
    const { result, rerender } = renderDomain({
      sessionReferenceArtifacts: [artifact('a1')],
    });

    act(() => {
      result.current.setSelectedImageEditReferenceArtifactId('a1');
    });
    expect(result.current.selectedImageEditReferenceArtifactId).toBe('a1');

    rerender({ sessionReferenceArtifacts: [], currentSessionId: 's1' });

    expect(result.current.selectedImageEditReferenceArtifactId).toBeNull();
  });

  it('候选集仍包含选中项时不清空（流式补拉产物不应打断选择）', () => {
    const { result, rerender } = renderDomain({
      sessionReferenceArtifacts: [artifact('a1')],
    });

    act(() => {
      result.current.setSelectedImageEditReferenceArtifactId('a1');
    });

    rerender({
      sessionReferenceArtifacts: [artifact('a1'), artifact('a2')],
      currentSessionId: 's1',
    });

    expect(result.current.selectedImageEditReferenceArtifactId).toBe('a1');
  });

  it('真实切换会话时清空生成结果与选中；首屏挂载不清空', () => {
    const { result, rerender } = renderDomain({ currentSessionId: null });

    act(() => {
      result.current.setLatestGeneratedImageResult({
        artifactId: 'img-9',
        artifactTitle: '夕阳',
        modelLabel: 'gpt-image',
      });
      result.current.setSelectedImageEditReferenceArtifactId('img-9');
    });

    // 首屏：null -> 's1'，不应视为切换（刷新恢复场景）
    rerender({ sessionReferenceArtifacts: [], currentSessionId: 's1' });
    expect(result.current.latestGeneratedImageResult?.artifactId).toBe('img-9');
    expect(result.current.selectedImageEditReferenceArtifactId).toBe('img-9');

    // 真实切换：'s1' -> 's2'
    rerender({ sessionReferenceArtifacts: [], currentSessionId: 's2' });
    expect(result.current.latestGeneratedImageResult).toBeNull();
    expect(result.current.selectedImageEditReferenceArtifactId).toBeNull();
  });

  it('「继续编辑」选中最新结果、打开图片模式并提示；无结果时不动作', () => {
    const { result, setImageGenerationMode } = renderDomain();

    act(() => {
      result.current.continueEditingLatestGeneratedImage();
    });
    expect(result.current.selectedImageEditReferenceArtifactId).toBeNull();
    expect(setImageGenerationMode).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();

    act(() => {
      result.current.setLatestGeneratedImageResult({
        artifactId: 'img-9',
        artifactTitle: '夕阳',
        modelLabel: 'gpt-image',
      });
    });
    act(() => {
      result.current.continueEditingLatestGeneratedImage();
    });

    expect(result.current.selectedImageEditReferenceArtifactId).toBe('img-9');
    expect(result.current.selectedImageEditReferenceArtifact?.artifactId).toBe('img-9');
    expect(setImageGenerationMode).toHaveBeenCalledWith(true);
    expect(mocks.toast).toHaveBeenCalledWith(
      '已选择最新图片作为参考图，请继续输入编辑提示词。',
      'success',
    );
  });
});
