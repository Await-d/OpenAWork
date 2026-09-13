/** 工具栏上的代理切换入口描述，由调用方计算出当前值后传入。 */
export interface ComposerAgentChipDescriptor {
  readonly label: string;
  readonly overridden: boolean;
  readonly onCycle: () => void;
}

export interface ComposerAgentChipProps {
  readonly label: string;
  /** 是否被显式指定了代理（而非使用会话默认代理）。 */
  readonly overridden: boolean;
  readonly onCycle: () => void;
}

/** 输入框右上角的代理指示胶囊，点击在可用代理间循环切换。 */
export function ComposerAgentChip({ label, overridden, onCycle }: ComposerAgentChipProps) {
  return (
    <button
      type="button"
      onClick={onCycle}
      className={`composer-agent-chip${overridden ? ' composer-agent-chip--overridden' : ''}`}
      title="点击切换代理"
      aria-label={`当前代理：${label}，点击切换代理`}
    >
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
      >
        <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.5V20h6v-2.5c2.9-1.2 5-4.1 5-7.5a8 8 0 0 0-8-8Z" />
        <path d="M9 22h6" />
      </svg>
      <span className="composer-agent-chip__label">{label}</span>
    </button>
  );
}
