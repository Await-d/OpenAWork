/**
 * ChatComposerMenu — 命令/提及菜单
 *
 * 从 ChatComposer.tsx 拆分出来的斜杠命令和 @ 文件提及菜单。
 */

import type { RefObject } from 'react';
import type {
  ComposerMenuState,
  MentionItem,
  SlashCommandItem,
} from '../../conversation-runtime/messages/support.js';
import {
  ComposerHintChip,
  composerHeaderTitleStyle,
  composerListPrimaryTextStyle,
  getSlashBadgeStyle,
} from './chat-composer-primitives.js';

export interface ChatComposerMenuProps {
  composerMenu: NonNullable<ComposerMenuState>;
  currentItems: Array<SlashCommandItem | MentionItem>;
  slashIncludesWorkspaceCatalog: boolean;
  composerListRef: RefObject<HTMLDivElement | null>;
  composerItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  onComposerHover: (index: number) => void;
  onApplyComposerSelection: (item: SlashCommandItem | MentionItem) => void | Promise<void>;
}

export function ChatComposerMenu({
  composerMenu,
  currentItems,
  slashIncludesWorkspaceCatalog,
  composerListRef,
  composerItemRefs,
  onComposerHover,
  onApplyComposerSelection,
}: ChatComposerMenuProps) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'calc(100% + 14px)',
        zIndex: 12,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 'min(100%, 600px)',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-overlay)',
          borderRadius: 14,
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 10px 7px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                width: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                background: 'var(--accent-muted)',
                color: 'var(--accent)',
                flexShrink: 0,
              }}
            >
              {composerMenu.type === 'slash' ? '/' : '@'}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={composerHeaderTitleStyle}>
                {composerMenu.type === 'slash'
                  ? slashIncludesWorkspaceCatalog
                    ? '快捷命令与工作区能力'
                    : '快捷命令'
                  : '工作区文件'}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {composerMenu.type === 'slash'
                  ? slashIncludesWorkspaceCatalog
                    ? '按 Enter 或 Tab 插入；仅 / 命令会在发送时直接执行'
                    : '按 Enter 或 Tab 插入 / 执行'
                  : '输入 @ 引用文件到当前消息'}
              </div>
            </div>
          </div>
          <ComposerHintChip
            label={`${composerMenu.type === 'slash' ? '/' : '@'}${composerMenu.query || '...'}`}
            tone="accent"
          />
        </div>
        <div
          ref={composerListRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '8px 6px',
            gap: 4,
            maxHeight: 'min(320px, 45vh)',
            overflowY: 'auto',
          }}
        >
          {currentItems.length === 0 && composerMenu.type === 'mention' && (
            <div
              style={{
                padding: '14px 12px',
                color: 'var(--fg-muted)',
                fontSize: 12,
                lineHeight: 1.55,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>
                暂无可引用的工作区文件
              </span>
              <span>请先在左上角「打开工作目录」选择一个目录，索引完成后再用 @ 引用文件。</span>
            </div>
          )}
          {currentItems.map((item, index) => {
            const selected = index === composerMenu.selectedIndex;
            const slashItem = composerMenu.type === 'slash' && item.kind === 'slash' ? item : null;
            return (
              <button
                ref={(node) => {
                  composerItemRefs.current[index] = node;
                }}
                key={item.id}
                type="button"
                onMouseEnter={() => {
                  onComposerHover(index);
                }}
                onClick={() => {
                  void onApplyComposerSelection(item);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 10,
                  background: selected ? 'var(--accent-muted)' : 'transparent',
                  color: 'var(--fg-strong)',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <span style={composerListPrimaryTextStyle} title={item.label}>
                    {item.label}
                  </span>
                  {item.description && (
                    <span
                      style={{
                        marginTop: 2,
                        fontSize: 10,
                        lineHeight: 1.45,
                        color: 'var(--fg-muted)',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        maxWidth: '100%',
                      }}
                      title={item.description}
                    >
                      {item.description}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    flexShrink: 0,
                    marginLeft: 8,
                    alignSelf: 'flex-start',
                  }}
                >
                  {slashItem ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 18,
                        padding: '0 6px',
                        borderRadius: 999,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.01em',
                        ...getSlashBadgeStyle(slashItem.source),
                      }}
                    >
                      {slashItem.badgeLabel ?? '命令'}
                    </span>
                  ) : (
                    '@'
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
