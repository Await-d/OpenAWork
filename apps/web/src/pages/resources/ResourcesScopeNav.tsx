import type { ResourceCenterScope } from './resource-center-utils.js';

interface ResourcesScopeNavProps {
  readonly activeScope: ResourceCenterScope;
  readonly onScopeChange: (scope: ResourceCenterScope) => void;
}

export function ResourcesScopeNav({ activeScope, onScopeChange }: ResourcesScopeNavProps) {
  return (
    <section className="resources-scope-nav" aria-label="资源用途切换">
      <button
        type="button"
        className={activeScope === 'catalog' ? 'active' : ''}
        onClick={() => onScopeChange('catalog')}
      >
        <strong>主资源目录</strong>
        <span>Agents、Skills、MCP、Extensions</span>
      </button>
      <button
        type="button"
        className={activeScope === 'feature' ? 'active' : ''}
        onClick={() => onScopeChange('feature')}
      >
        <strong>功能专用资源</strong>
        <span>Channels 人设、团队模板、命令与提示词</span>
      </button>
    </section>
  );
}
