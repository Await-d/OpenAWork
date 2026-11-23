import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toast } from '../../../components/common/feedback/ToastNotification.js';
import type { ImageEditReferenceArtifact } from '../conversation/render/image-edit-reference-artifacts.js';

/**
 * 图片生成结果 strip 里的「继续编辑」入口所记录的结果快照。
 *
 * 只存条带需要渲染的三个字段（id / 标题 / 模型标签），不缓存整份生成响应。
 */
export interface LatestGeneratedImageResult {
  artifactId: string;
  artifactTitle: string;
  modelLabel: string;
}

interface UseChatImageResultSelectionDeps {
  /** 会话本身的图片参考图（来自产物列表），与「最新生成结果」合并成候选集。 */
  readonly sessionReferenceArtifacts: ImageEditReferenceArtifact[];
  /** 当前会话 id：真实切换会话时清空本域状态。 */
  readonly currentSessionId: string | null;
  /** 打开输入框的图片编辑模式（「继续编辑」的副作用之一）。 */
  readonly setImageGenerationMode: (enabled: boolean) => void;
}

/**
 * 「最新生成结果」与「参考图选中态」这一个自治域。
 *
 * 归一自 `ChatPage` 主组件内联的同名 state / 派生 / 回调，行为逐字保留：
 *
 * 1. 候选参考图 = 会话产物列表 ∪ 最新生成结果（已存在则不重复前置）；
 * 2. 选中项按 id 在候选集里解析，解析不到时为 null；
 * 3. 候选集变化导致选中项失效时自动清空选中（避免把已消失的产物当参考图提交）；
 * 4. 真实切换会话时清空结果与选中；首屏挂载（刷新后恢复）不清空，条带照常显示；
 * 5. 「继续编辑」= 选中最新结果 + 打开图片模式 + toast。
 *
 * 写入方（`runSendMessage` 的图片生成分支、composer 的参考图选择器）继续直接使用
 * 本 hook 暴露的 setter，接线与抽取前完全一致。
 */
export function useChatImageResultSelection(deps: UseChatImageResultSelectionDeps) {
  const { sessionReferenceArtifacts, currentSessionId, setImageGenerationMode } = deps;

  const [latestGeneratedImageResult, setLatestGeneratedImageResult] =
    useState<LatestGeneratedImageResult | null>(null);
  const [selectedImageEditReferenceArtifactId, setSelectedImageEditReferenceArtifactId] = useState<
    string | null
  >(null);
  /** 上一次提交里的会话 id：只在**真实切换**时回收（首屏挂载为 null 不回收）。 */
  const previousSessionIdRef = useRef<string | null>(null);

  const availableImageEditReferenceArtifacts = useMemo(() => {
    if (!latestGeneratedImageResult) {
      return sessionReferenceArtifacts;
    }

    if (
      sessionReferenceArtifacts.some(
        (artifact) => artifact.artifactId === latestGeneratedImageResult.artifactId,
      )
    ) {
      return sessionReferenceArtifacts;
    }

    return [
      {
        artifactId: latestGeneratedImageResult.artifactId,
        title: latestGeneratedImageResult.artifactTitle,
        updatedAt: new Date().toISOString(),
      },
      ...sessionReferenceArtifacts,
    ];
  }, [latestGeneratedImageResult, sessionReferenceArtifacts]);

  const selectedImageEditReferenceArtifact = useMemo(
    () =>
      availableImageEditReferenceArtifacts.find(
        (artifact) => artifact.artifactId === selectedImageEditReferenceArtifactId,
      ) ?? null,
    [availableImageEditReferenceArtifacts, selectedImageEditReferenceArtifactId],
  );

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = currentSessionId;
    if (previousSessionId !== null && previousSessionId !== currentSessionId) {
      setLatestGeneratedImageResult(null);
      setSelectedImageEditReferenceArtifactId(null);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (!selectedImageEditReferenceArtifactId) {
      return;
    }

    if (
      !availableImageEditReferenceArtifacts.some(
        (artifact) => artifact.artifactId === selectedImageEditReferenceArtifactId,
      )
    ) {
      setSelectedImageEditReferenceArtifactId(null);
    }
  }, [availableImageEditReferenceArtifacts, selectedImageEditReferenceArtifactId]);

  const continueEditingLatestGeneratedImage = useCallback(() => {
    if (!latestGeneratedImageResult) {
      return;
    }

    setSelectedImageEditReferenceArtifactId(latestGeneratedImageResult.artifactId);
    setImageGenerationMode(true);
    toast('已选择最新图片作为参考图，请继续输入编辑提示词。', 'success');
  }, [latestGeneratedImageResult, setImageGenerationMode]);

  return {
    latestGeneratedImageResult,
    setLatestGeneratedImageResult,
    selectedImageEditReferenceArtifactId,
    setSelectedImageEditReferenceArtifactId,
    availableImageEditReferenceArtifacts,
    selectedImageEditReferenceArtifact,
    continueEditingLatestGeneratedImage,
  };
}
