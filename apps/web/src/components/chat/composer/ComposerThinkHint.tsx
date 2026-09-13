export interface ComposerThinkHintProps {
  readonly visible: boolean;
}

/**
 * 输入中命中「深度思考」类关键词时的提示。
 * 仅作提示，不会覆盖用户当前的思考等级设置。
 */
export function ComposerThinkHint({ visible }: ComposerThinkHintProps) {
  if (!visible) return null;

  return (
    <div className="composer-think-hint" title="仅作提示，不会覆盖当前思考等级设置">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8Z" />
        <path d="M10 22h4" />
      </svg>
      检测到思考提示词
    </div>
  );
}
