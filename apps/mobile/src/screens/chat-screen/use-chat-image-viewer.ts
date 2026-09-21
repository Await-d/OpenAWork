import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { MobileChatMessage, MobileInputImage } from '../../chat/chat-message-content';
import { useChatImageGallery } from '../../hooks/use-chat-image-gallery';
import type { ImageLightboxState, PendingImagePreview } from './types';

export interface ChatImageViewerState {
  /** 查看器当前状态；`null` 表示未打开。 */
  lightbox: ImageLightboxState | null;
  /** 是否处于「点击图片 → 解析整条消息图集」的进行中态（屏幕级 loading 反馈）。 */
  previewPending: boolean;
  closeLightbox: () => void;
  handleLightboxIndexChange: (index: number) => void;
  handlePressMessageImage: (message: MobileChatMessage, image: MobileInputImage) => void;
  /** 会话切换 / 重置时清空查看器状态。 */
  reset: () => void;
}

export function useChatImageViewer(): ChatImageViewerState {
  const [imagePreviewRequest, setImagePreviewRequest] = useState<PendingImagePreview | null>(null);
  const [imageLightbox, setImageLightbox] = useState<ImageLightboxState | null>(null);
  const imageGallery = useChatImageGallery(imagePreviewRequest?.message ?? null);

  const handlePressMessageImage = useCallback(
    (message: MobileChatMessage, image: MobileInputImage) => {
      setImagePreviewRequest({ message, image });
    },
    [],
  );

  const handleLightboxIndexChange = useCallback((index: number) => {
    setImageLightbox((current) => (current ? { ...current, index } : current));
  }, []);

  const closeLightbox = useCallback(() => {
    setImageLightbox(null);
  }, []);

  const reset = useCallback(() => {
    setImagePreviewRequest(null);
    setImageLightbox(null);
  }, []);

  // 「先解析整条消息图集、再打开查看器」：解析期间由屏幕级 loading 反馈兜住，
  // 终态后按图集下标打开；该图解析不出地址时给出可感知提示（不静默）。
  useEffect(() => {
    if (!imagePreviewRequest) {
      return;
    }
    if (imageGallery.status === 'idle' || imageGallery.status === 'loading') {
      return;
    }
    const request = imagePreviewRequest;
    setImagePreviewRequest(null);
    const index = imageGallery.indexOf(request.image);
    if (index < 0) {
      Alert.alert('无法预览图片', imageGallery.error ?? '这张图片暂时无法预览。');
      return;
    }
    setImageLightbox({ messageId: request.message.id, index, items: imageGallery.items });
    if (imageGallery.error) {
      Alert.alert('部分图片加载失败', imageGallery.error);
    }
  }, [imageGallery, imagePreviewRequest]);

  return {
    lightbox: imageLightbox,
    previewPending: imagePreviewRequest !== null,
    closeLightbox,
    handleLightboxIndexChange,
    handlePressMessageImage,
    reset,
  };
}
