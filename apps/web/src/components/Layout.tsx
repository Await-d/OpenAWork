import { CommandPalette, PermissionConfirmDialog } from '@openAwork/shared-ui';
import QuestionPromptCard from './common/display/QuestionPromptCard.js';
import { FloatingPermissionPrompt } from './layout/shared/FloatingPermissionPrompt.js';
import { LayoutTransitionOverlay } from './layout/shared/LayoutTransitionOverlay.js';
import { useLayoutShared } from './layout/shared/useLayoutShared.js';
import { LayoutFusion } from './layout/fusion/LayoutFusion.js';
import { LayoutClassic } from './layout/LayoutClassic.js';

export interface LayoutProps {
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  onOpenFile?: (path: string, options?: { line?: number; endLine?: number }) => void;
}

export default function Layout({ theme = 'dark', onToggleTheme }: LayoutProps = {}) {
  const shared = useLayoutShared(theme, onToggleTheme);

  return (
    <>
      <style>{`@keyframes toast-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
@keyframes permissionSlideIn { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:translateY(0); } }
@keyframes permissionPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.6; transform:scale(1.35); } }`}</style>
      <CommandPalette
        commands={shared.paletteCommands}
        emptyLabel={
          shared.paletteQuery.trim().length >= 2
            ? '没有匹配的命令或会话'
            : '输入至少 2 个字符开始搜索'
        }
        isOpen={shared.isPaletteOpen}
        onClose={() => shared.setIsPaletteOpen(false)}
        onQueryChange={shared.setPaletteQuery}
        placeholder="搜索命令、会话内容…"
        query={shared.paletteQuery}
      />
      <FloatingPermissionPrompt onPendingChange={shared.setPendingPermissionIndicator} />
      {shared.pendingQuestion && !shared.isChatRoute && (
        <QuestionPromptCard
          answers={shared.pendingQuestionAnswers}
          errorMessage={shared.pendingQuestionReplyError ?? undefined}
          pendingAction={shared.pendingQuestionReplyStatus}
          request={shared.pendingQuestion}
          onDismiss={() => {
            void shared.replyPendingQuestion('dismissed');
          }}
          onSubmit={() => {
            void shared.replyPendingQuestion('answered');
          }}
          onToggleOption={shared.togglePendingQuestionAnswer}
        />
      )}
      <PermissionConfirmDialog
        open={shared.pendingConfirmDialog !== null}
        skillName={shared.pendingConfirmDialog?.skillName ?? ''}
        permissions={shared.pendingConfirmDialog?.permissions ?? []}
        trustLevel={shared.pendingConfirmDialog?.trustLevel ?? 'standard'}
        onConfirm={() => {
          shared.setPendingConfirmDialog(null);
        }}
        onCancel={() => {
          shared.setPendingConfirmDialog(null);
        }}
      />
      <style>{`@keyframes layout-titlebar-slide-down { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }
.layout-switch-wrapper > *:nth-child(1) { animation:layout-titlebar-slide-down 320ms cubic-bezier(0.22,0.61,0.36,1) both; animation-delay:0ms; }
.layout-switch-wrapper > *:nth-child(2) { animation-delay:50ms; }
.layout-switch-wrapper > *:nth-child(3) { animation-delay:100ms; }
.layout-switch-wrapper > *:nth-child(4) { animation-delay:150ms; }
.layout-titlebar-fusion { animation: layout-titlebar-slide-down 320ms cubic-bezier(0.22, 0.61, 0.36, 1) both; }`}</style>
      <LayoutTransitionOverlay />
      {shared.layoutMode === 'fusion' ? (
        <LayoutFusion shared={shared} theme={theme} onToggleTheme={onToggleTheme} />
      ) : (
        <LayoutClassic shared={shared} theme={theme} onToggleTheme={onToggleTheme} />
      )}
    </>
  );
}
