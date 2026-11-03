import { useState, type ReactNode } from 'react';
import type { MessageContent } from '@openAwork/shared';

import {
  parseAttachmentReferences,
  stripAttachmentReferences,
} from '../../conversation-runtime/attachments/attachment-reference.js';
import {
  extractInputImages,
  type ChatMessage,
} from '../../conversation-runtime/messages/support.js';
import { ImageLightbox, type ImageLightboxItem } from '../image/image-lightbox.js';
import { MediaReferenceCard } from '../media/media-reference-card.js';
import { renderMediaContent } from '../media/media-renderer.js';
import { resolveGalleryLayout } from './gallery-layout.js';

/**
 * 非 assistant 消息里的「附件与媒体」渲染。
 *
 * ## 为什么从 `ChatPageSections.tsx` 抽出来
 *
 * `AGENTS.md` 规定单文件上限 1500 行、1300–1500 为预警区间「应主动评估拆分」。主文件当时
 * 已 1462 行，而媒体类改动每一次都会往它里面加东西（图集、文件卡片、下载函数都属于这类）。
 * 把「消息附件与媒体的渲染」这一整个**职责域**移出后，主文件回落到预警线以下，且后续媒体
 * 改动不再挤占主文件的行数预算。
 *
 * ## 边界
 *
 * 本模块只做**装配**：判断有哪些可渲染内容 → 分派给对应的叶子组件。它不承载布局与样式
 * 规则（那些分别在 `gallery-layout.ts` 与 `ChatPageSections.css`），也不管 assistant 侧
 * 的富文本渲染（那条路走 markdown，与本模块无关）。
 */

/** 附件图片下载：与灯箱里的下载按钮保持同一套行为（不泄露 referrer）。 */
function downloadImage(src: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = src;
  anchor.download = fileName;
  anchor.referrerPolicy = 'no-referrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * 用户消息附件图集。
 *
 * 布局由纯函数 `resolveGalleryLayout` 解算（数量 → 列数 / 裁切方式 / 折叠），
 * 组件只负责渲染，避免把多分支布局写死在 JSX 里。
 *
 * 无障碍：
 * - 可预览附件的文件名标签、缩略图按钮、下载按钮都由原生 `<button type="button">`
 *   承担，三者同级并列、**互不嵌套**；没有可预览图源时文件名退化为纯文本标签
 *   （`--static`），该 tile 不产生任何可聚焦控件。
 * - 缩略图按钮的可见名称沿用 `title="点击放大查看"`，**不再叠加 aria-label**：
 *   文件名按钮已占用「放大查看 X」，两个同名按钮会让按 name 查询命中多个。
 * - hover / focus-visible 交互态全部落在 CSS class 上，组件不内联颜色。
 */
function UserAttachedImagesGallery({ images }: { images: ReturnType<typeof extractInputImages> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const viewableImages = images.flatMap((image, imageIndex) =>
    image.imageUrl ? [{ image, imageIndex }] : [],
  );
  const lightboxItems: ImageLightboxItem[] = viewableImages.flatMap(({ image, imageIndex }) => {
    if (!image.imageUrl) return [];
    const label = image.fileName ?? `图片 ${imageIndex + 1}`;
    return [
      {
        src: image.imageUrl,
        alt: label,
        caption: label,
        ...(image.fileName ? { fileName: image.fileName } : {}),
      },
    ];
  });
  // openIndex 是 images 下标；图集索引用可预览图片的位置，两者互转。
  const openPosition = viewableImages.findIndex((entry) => entry.imageIndex === openIndex);

  const layout = resolveGalleryLayout(images.length);
  // 折叠入口占据最后一个可见格子：先渲染该位置的缩略图，再用 +N 遮罩盖住。
  const collapsedIndex = layout.overflowCount > 0 ? layout.visibleCount - 1 : -1;
  const visibleImages = images.slice(0, layout.visibleCount);

  return (
    <div
      className="chat-gallery"
      data-count={images.length}
      data-columns={layout.columns}
      data-lead-span={layout.leadSpansRows ? 'true' : 'false'}
    >
      {visibleImages.map((image, index) => {
        const label = image.fileName ?? `图片 ${index + 1}`;
        const src = image.imageUrl;
        const clickable = Boolean(src);
        const isCollapsedSlot = index === collapsedIndex;

        return (
          <div
            className="chat-gallery__tile"
            key={`${src ?? image.artifactId ?? image.fileId ?? 'image'}-${index}`}
          >
            {src ? (
              <button
                type="button"
                className="chat-gallery__thumb"
                title="点击放大查看"
                aria-label={isCollapsedSlot ? `查看全部 ${images.length} 张图片` : undefined}
                onClick={() => setOpenIndex(index)}
              >
                <img src={src} alt={label} />
                {isCollapsedSlot ? (
                  <span className="chat-gallery__more" aria-hidden="true">
                    +{layout.overflowCount}
                  </span>
                ) : (
                  <span className="chat-gallery__veil" aria-hidden="true">
                    <span className="chat-attachment-thumbnail__zoom-badge">⤢</span>
                  </span>
                )}
              </button>
            ) : (
              <div className="chat-gallery__placeholder">图片已附加</div>
            )}
            {src && !isCollapsedSlot ? (
              <button
                type="button"
                className="chat-gallery__download"
                title="下载图片"
                aria-label={`下载 ${label}`}
                onClick={() => downloadImage(src, label)}
              >
                ↓
              </button>
            ) : null}
            {clickable ? (
              <button
                type="button"
                className="chat-attachment-file-name"
                aria-label={`放大查看 ${label}`}
                title={label}
                onClick={() => setOpenIndex(index)}
              >
                {label}
              </button>
            ) : (
              <span
                className="chat-attachment-file-name chat-attachment-file-name--static"
                title={label}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}

      {openIndex !== null && openPosition >= 0 && (
        <ImageLightbox
          open
          items={lightboxItems}
          index={openPosition}
          onIndexChange={(next) => {
            // 可选链读值先落局部变量：直接写 `?.imageIndex ?? null` 会让编译器报
            // "Unexpected terminal in optional" 并放弃优化本组件。
            const nextImageIndex = viewableImages[next]?.imageIndex;
            setOpenIndex(nextImageIndex ?? null);
          }}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * 把一条非 assistant 消息渲染成「正文 + 附件图集 + 文件引用卡片 + 结构化媒体块」。
 *
 * 返回 `null` 表示这条消息没有任何需要在正文之外渲染的内容，调用方据此走「原样返回正文
 * 字符串」的快路径 —— 判定条件与抽取前逐字一致（三个来源皆空即无）。
 *
 * 刻意保持**函数**形态（而非组件）：调用方需要在「拿到节点」与「回退成纯文本」之间二选一，
 * 组件形态拿不到这个信息，而渲染两次会白跑一遍 `renderMediaContent` / 附件解析。
 */
export function renderMessageMediaAttachments(
  message: ChatMessage,
  sessionId: string | undefined,
): ReactNode {
  const inputImages = message.rawContent ? extractInputImages(message.rawContent) : [];
  const mediaNodes = message.rawContent
    ? renderMediaContent(message.rawContent as unknown as MessageContent[])
    : [];
  // 非图片附件在发送时被压平成 `[附件]` 段写进正文（见 attachment-upload.ts:130-187）。
  // 这里把它还原成文件卡片，并把该段从正文里剥离——否则同一份信息会显示两遍。
  // 解析失败时 stripAttachmentReferences 返回原文，正文不会丢内容。
  const fileReferences = parseAttachmentReferences(message.content);
  const bodyText =
    fileReferences.length > 0 ? stripAttachmentReferences(message.content) : message.content;

  if (inputImages.length === 0 && mediaNodes.length === 0 && fileReferences.length === 0) {
    return null;
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
      {bodyText ? <span>{bodyText}</span> : null}
      {inputImages.length > 0 && <UserAttachedImagesGallery images={inputImages} />}
      {fileReferences.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
          {fileReferences.map((reference, index) => (
            <MediaReferenceCard
              key={`${reference.artifactId}-${index}`}
              fileName={reference.fileName}
              artifactId={reference.artifactId}
              sessionId={sessionId}
            />
          ))}
        </div>
      )}
      {mediaNodes.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>{mediaNodes}</div>
      )}
    </div>
  );
}
