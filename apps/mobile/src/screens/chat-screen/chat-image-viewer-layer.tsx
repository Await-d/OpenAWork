import { ActivityIndicator, Text, View } from 'react-native';
import type { MessageImageGalleryItem } from '../../chat/chat-image-gallery';
import { ImageLightboxModal } from '../../components/image-viewer/ImageLightboxModal';
import { colors } from '../../theme/colors';
import { styles } from './styles';
import type { ChatImageViewerState } from './use-chat-image-viewer';

/** 查看器未持有图集时的占位（稳定引用，避免每次渲染新建数组）。 */
const NO_LIGHTBOX_ITEMS: readonly MessageImageGalleryItem[] = [];

interface ChatImageViewerLayerProps {
  viewer: ChatImageViewerState;
}

/** 屏幕级图片查看器层：解析 loading 反馈 + lightbox 本体。 */
export function ChatImageViewerLayer({ viewer }: ChatImageViewerLayerProps) {
  const { lightbox } = viewer;

  return (
    <>
      {/* 点击图片后的解析反馈：不阻断滚动/操作，解析完成即被查看器取代。 */}
      {viewer.previewPending ? (
        <View style={styles.imagePreviewLoadingLayer} pointerEvents="none">
          <View style={styles.imagePreviewLoadingPill}>
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.imagePreviewLoadingText}>正在加载图片…</Text>
          </View>
        </View>
      ) : null}

      <ImageLightboxModal
        open={lightbox !== null}
        onClose={viewer.closeLightbox}
        items={lightbox?.items ?? NO_LIGHTBOX_ITEMS}
        index={lightbox?.index ?? 0}
        onIndexChange={viewer.handleLightboxIndexChange}
      />
    </>
  );
}
