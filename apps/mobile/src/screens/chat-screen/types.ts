import type { InputImageContent } from '@openAwork/shared';
import type { MessageImageGalleryItem } from '../../chat/chat-image-gallery';
import type { MobileChatMessage, MobileInputImage } from '../../chat/chat-message-content';
import type { MobileAttachmentItem } from '../../components/MobileAttachmentBar';

export interface Message extends MobileChatMessage {
  streaming?: boolean;
}

/** 待打开查看器的图片请求：先解析整条消息图集，再按图集下标打开。 */
export interface PendingImagePreview {
  message: MobileChatMessage;
  image: MobileInputImage;
}

/** 屏幕级唯一的查看器状态（切图时同步 index；关闭置 null）。 */
export interface ImageLightboxState {
  messageId: string;
  index: number;
  items: readonly MessageImageGalleryItem[];
}

export interface ChatScreenProps {
  sessionId: string;
}

export interface ArtifactRecord {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  preview?: string;
  createdAt?: number;
}

export interface UploadedMobileAttachment {
  artifactId: string;
  fileName: string;
  localUri?: string;
  mimeType?: string;
  preview?: string;
  type: MobileAttachmentItem['type'];
}

export interface RetryableTextRequest {
  displayMessage: string;
  inputParts?: InputImageContent[];
  requestMessage: string;
  userContent: string;
  userInputImages?: Message['inputImages'];
}
