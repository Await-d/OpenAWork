export const CHANNEL_QUICK_LINKS_STYLES = `
.channel-quick-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2, 8px);
  margin-top: var(--spacing-2, 8px);
}

.channel-quick-link {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1, 4px);
  max-width: 260px;
  padding: var(--spacing-1, 4px) var(--spacing-3, 12px);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--aux-border);
  background: var(--aux-subtle);
  color: var(--aux);
  text-decoration: none;
  font-size: 11px;
  font-weight: 700;
  transition:
    border-color var(--motion-micro, 100ms) ease,
    background var(--motion-micro, 100ms) ease,
    transform var(--motion-micro, 100ms) ease;
}

.channel-quick-link:hover {
  border-color: var(--border-emphasis);
  background: var(--aux-muted);
  transform: translateY(-1px);
}

.channel-quick-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--accent-subtle);
}

.channel-quick-link__label {
  white-space: nowrap;
}

.channel-quick-link__description {
  min-width: 0;
  color: var(--fg-muted);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
