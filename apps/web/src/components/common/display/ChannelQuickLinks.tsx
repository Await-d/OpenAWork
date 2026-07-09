import { CHANNEL_QUICK_LINKS_STYLES } from './channel-quick-links.styles.js';

export interface ChannelQuickLinkEntry {
  readonly label: string;
  readonly url: string;
  readonly description?: string;
}

interface ChannelQuickLinksProps {
  readonly links?: readonly ChannelQuickLinkEntry[];
}

export function ChannelQuickLinks({ links = [] }: ChannelQuickLinksProps) {
  if (links.length === 0) {
    return null;
  }

  return (
    <>
      <style>{CHANNEL_QUICK_LINKS_STYLES}</style>
      <div className="channel-quick-links" aria-label="平台快捷配置入口">
        {links.map((link) => (
          <a
            key={link.url}
            className="channel-quick-link"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={link.description ?? link.label}
          >
            <span className="channel-quick-link__label">{link.label}</span>
            {link.description ? (
              <span className="channel-quick-link__description">{link.description}</span>
            ) : null}
          </a>
        ))}
      </div>
    </>
  );
}
