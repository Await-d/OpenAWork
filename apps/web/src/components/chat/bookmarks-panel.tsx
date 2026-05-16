import { useCallback, useState } from 'react';
import { useBookmarkStore, type MessageBookmark } from '../../stores/bookmarks.js';

interface BookmarksPanelProps {
  sessionId: string;
  onNavigateToMessage?: (messageId: string) => void;
}

export function BookmarksPanel({ sessionId, onNavigateToMessage }: BookmarksPanelProps) {
  const { bookmarks, removeBookmark, updateBookmarkNote } = useBookmarkStore();
  const sessionBookmarks = bookmarks.filter((b) => b.sessionId === sessionId);
  const allBookmarks = bookmarks;
  const [showAll, setShowAll] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const displayBookmarks = showAll ? allBookmarks : sessionBookmarks;

  if (displayBookmarks.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--text-3)',
          fontSize: 12,
        }}
      >
        <div style={{ fontSize: 24, marginBottom: 8 }}>⭐</div>
        <div>还没有收藏的消息</div>
        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-4)' }}>
          在消息操作菜单中点击"收藏"来添加
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Toggle: current session vs all */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '8px 12px 4px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setShowAll(false)}
          style={{
            height: 22,
            padding: '0 8px',
            borderRadius: 11,
            border: !showAll ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
            background: !showAll
              ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
              : 'transparent',
            color: !showAll ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          当前会话 ({sessionBookmarks.length})
        </button>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            height: 22,
            padding: '0 8px',
            borderRadius: 11,
            border: showAll ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
            background: showAll
              ? 'color-mix(in oklch, var(--accent) 10%, transparent)'
              : 'transparent',
            color: showAll ? 'var(--accent)' : 'var(--text-3)',
            fontSize: 10,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          全部 ({allBookmarks.length})
        </button>
      </div>

      {/* Bookmark list */}
      <div style={{ overflowY: 'auto', padding: '4px 0' }}>
        {displayBookmarks.map((bookmark) => (
          <BookmarkItem
            key={bookmark.messageId}
            bookmark={bookmark}
            isEditing={editingNoteId === bookmark.messageId}
            onNavigate={() => onNavigateToMessage?.(bookmark.messageId)}
            onRemove={() => removeBookmark(bookmark.messageId)}
            onEditNote={() => setEditingNoteId(bookmark.messageId)}
            onSaveNote={(note) => {
              updateBookmarkNote(bookmark.messageId, note);
              setEditingNoteId(null);
            }}
            onCancelEdit={() => setEditingNoteId(null)}
          />
        ))}
      </div>
    </div>
  );
}

function BookmarkItem({
  bookmark,
  isEditing,
  onNavigate,
  onRemove,
  onEditNote,
  onSaveNote,
  onCancelEdit,
}: {
  bookmark: MessageBookmark;
  isEditing: boolean;
  onNavigate: () => void;
  onRemove: () => void;
  onEditNote: () => void;
  onSaveNote: (note: string) => void;
  onCancelEdit: () => void;
}) {
  const [noteValue, setNoteValue] = useState(bookmark.note ?? '');

  const roleIcon = bookmark.role === 'user' ? '👤' : '🤖';
  const timeLabel = new Date(bookmark.createdAt).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
      }}
      onClick={onNavigate}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background =
          'color-mix(in oklch, var(--accent) 4%, transparent)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11 }}>{roleIcon}</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', flex: 1 }}>{timeLabel}</span>
        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onEditNote}
            title="添加备注"
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✎
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="取消收藏"
            style={{
              width: 18,
              height: 18,
              borderRadius: 3,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--text-2)',
          lineHeight: 1.4,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {bookmark.content}
      </div>

      {bookmark.note && !isEditing && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            color: 'var(--accent)',
            fontStyle: 'italic',
          }}
        >
          📝 {bookmark.note}
        </div>
      )}

      {isEditing && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            placeholder="添加备注…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSaveNote(noteValue);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            style={{
              flex: 1,
              padding: '3px 6px',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              fontSize: 10,
            }}
          />
          <button
            type="button"
            onClick={() => onSaveNote(noteValue)}
            style={{
              height: 22,
              padding: '0 6px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent)',
              color: 'white',
              fontSize: 9,
              cursor: 'pointer',
            }}
          >
            保存
          </button>
        </div>
      )}
    </div>
  );
}
