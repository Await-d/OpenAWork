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
  /** 工作区是否已索引出文件；用于区分「无文件」与「无匹配」两种空状态。 */
  hasWorkspaceFiles: boolean;
}

export function ChatComposerMenu({
  composerMenu,
  currentItems,
  slashIncludesWorkspaceCatalog,
  composerListRef,
  composerItemRefs,
  onComposerHover,
  onApplyComposerSelection,
  hasWorkspaceFiles,
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
                  : '按 Enter 或 Tab 插入文件引用'}
              </div>
            </div>
          </div>
          <ComposerHintChip
            label={`${composerMenu.type === 'slash' ? '/' : '@'}${composerMenu.query}`}
            tone="accent"
          />
        </div>
        <div
          ref={composerListRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '6px 5px',
            gap: 2,
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
              {hasWorkspaceFiles ? (
                <>
                  <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>
                    未找到匹配「{composerMenu.query}」的文件
                  </span>
                  <span>试试更短的关键词，或用更靠前的目录名。</span>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>
                    暂无可引用的文件
                  </span>
                  <span>先打开工作区，索引完成后文件会出现在这里。</span>
                </>
              )}
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
                  padding: '5px 8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {!slashItem && <FileIcon />}
                  <span
                    style={{
                      ...composerListPrimaryTextStyle,
                      flexShrink: 0,
                      maxWidth: item.description ? '45%' : '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  {item.description && (
                    <>
                      <span
                        aria-hidden="true"
                        style={{
                          color: 'var(--fg-subtle)',
                          fontSize: 10,
                          flexShrink: 0,
                        }}
                      >
                        ·
                      </span>
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          fontSize: 10,
                          lineHeight: 1.45,
                          color: 'var(--fg-muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          overflow: 'hidden',
                        }}
                        title={item.description}
                      >
                        <FolderIcon />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.description}
                        </span>
                      </span>
                    </>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--fg-muted)',
                    flexShrink: 0,
                    marginLeft: 8,
                    alignSelf: 'center',
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

function FileIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--fg-subtle)' }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, color: 'var(--fg-subtle)' }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
