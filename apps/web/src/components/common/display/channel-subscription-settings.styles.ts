export const CHANNEL_SUBSCRIPTION_SETTINGS_STYLES = `
.channel-studio {
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.channel-card {
  border: 1px solid var(--border-default);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg-overlay);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

.channel-sidebar {
  display: flex;
  flex-direction: column;
  min-height: auto;
}

.channel-sidebar__hero,
.channel-panel__hero,
.channel-panel__footer {
  padding: 16px 18px;
}

.channel-sidebar__hero,
.channel-panel__hero {
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(
    135deg,
    var(--accent-subtle) 0%,
    transparent 60%
  );
}

.channel-sidebar__eyebrow,
.channel-panel__eyebrow {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 6px;
}

.channel-sidebar__title,
.channel-panel__title {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  color: var(--fg-strong);
  font-weight: 700;
  letter-spacing: -0.01em;
}

.channel-sidebar__description,
.channel-panel__description,
.channel-muted {
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.channel-sidebar__description,
.channel-panel__description {
  margin: 8px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-subtle);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.channel-search {
  padding: 12px 18px 0;
}

.channel-search input,
.channel-field input,
.channel-field select,
.channel-path-entry input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: var(--bg-base);
  color: var(--fg-strong);
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.channel-search input::placeholder,
.channel-field input::placeholder,
.channel-path-entry input::placeholder {
  color: var(--fg-subtle);
}

.channel-search input:focus,
.channel-field input:focus,
.channel-field select:focus,
.channel-path-entry input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.channel-sidebar__body,
.channel-panel__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 18px 16px;
}

.channel-group {
  display: grid;
  gap: 8px;
}

.channel-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
}

.channel-group__title {
  font-size: 11px;
  font-weight: 700;
  color: var(--fg-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.channel-descriptor,
.channel-instance {
  width: 100%;
  text-align: left;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.channel-descriptor:hover,
.channel-instance:hover {
  border-color: var(--border-emphasis);
  background: var(--bg-base);
  transform: translateX(2px);
}

.channel-descriptor.is-active,
.channel-instance.is-active {
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.channel-descriptor__body,
.channel-instance__body {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 10px 10px;
  align-items: center;
}

.channel-icon {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-base);
  color: var(--fg-strong);
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
}

.channel-descriptor__name,
.channel-instance__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-descriptor__desc,
.channel-instance__desc {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--fg-muted);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.channel-count,
.channel-status-badge,
.channel-mini-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.channel-count,
.channel-mini-badge {
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--fg-muted);
}

.channel-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}

.channel-panel__identity {
  display: flex;
  gap: 14px;
  min-width: 0;
}

.channel-panel__identity .channel-icon {
  width: 42px;
  height: 42px;
  font-size: 16px;
  border-radius: 10px;
  background: var(--accent-subtle);
  border-color: var(--accent-border);
}

.channel-panel__title-row,
.channel-panel__meta,
.channel-toolbar,
.channel-footer__actions,
.channel-path-entry,
.channel-path-list,
.channel-target-row,
.channel-target-actions,
.channel-toggle-grid,
.channel-tool-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.channel-panel__title-row {
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.channel-panel__meta {
  margin-top: 10px;
  gap: 8px;
}

.channel-status-badge {
  border: 1px solid color-mix(in srgb, var(--tone-color, var(--fg-muted)) 34%, transparent);
  color: var(--tone-color, var(--fg-muted));
  background: color-mix(in srgb, var(--tone-color, var(--fg-muted)) 8%, transparent);
}

.channel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--bg-base);
  color: var(--fg-strong);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;
}

.channel-toggle:hover {
  border-color: var(--border-emphasis);
}

.channel-toggle input {
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}

.channel-button {
  appearance: none;
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 150ms ease, filter 150ms ease, border-color 150ms ease, background 150ms ease;
}

.channel-button:active:not(:disabled) {
  transform: scale(0.97);
}

.channel-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  filter: none;
}

.channel-button--primary {
  background: var(--accent);
  color: var(--fg-on-accent);
}

.channel-button--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.channel-button--ghost {
  background: transparent;
  color: var(--fg-strong);
  border: 1px solid var(--border-default);
}

.channel-button--ghost:hover:not(:disabled) {
  border-color: var(--border-emphasis);
  background: var(--bg-base);
}

.channel-button--danger {
  background: transparent;
  color: var(--complement);
  border: 1px solid var(--complement-border);
}

.channel-button--danger:hover:not(:disabled) {
  background: var(--complement-subtle);
}

.channel-grid-two,
.channel-grid-fields,
.channel-grid-provider {
  display: grid;
  gap: 12px;
}

.channel-grid-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.channel-grid-fields {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.channel-grid-provider {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.channel-persona-layout {
  display: grid;
  grid-template-columns: minmax(220px, 0.78fr) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}

.channel-persona-preview {
  display: grid;
  gap: 8px;
  align-content: start;
  min-height: 82px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-base);
}

.channel-persona-preview__title {
  color: var(--fg-strong);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}

.channel-persona-preview__desc {
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.channel-section {
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  background: transparent;
}

.channel-section:last-child {
  border-bottom: none;
}

.channel-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 0 10px;
  border-bottom: none;
}

.channel-section__title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--fg-strong);
  letter-spacing: -0.01em;
}

.channel-section__body {
  padding: 0 0 16px;
}

.channel-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.channel-field__label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-strong);
  font-size: 12px;
  font-weight: 600;
}

.channel-field__hint {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.4;
}

.channel-field__input-wrap {
  position: relative;
}

.channel-field__secret-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 150ms ease;
}

.channel-field__secret-toggle:hover {
  color: var(--fg-strong);
}

.channel-weixin-bind {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-base);
}

.channel-weixin-bind__title {
  color: var(--fg-strong);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}

.channel-weixin-bind__qr {
  width: 132px;
  height: 132px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: var(--bg-raised);
  padding: 6px;
}

.channel-check-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  cursor: pointer;
  transition: background 150ms ease;
}

.channel-check-card:last-child {
  border-bottom: none;
}

.channel-check-card:hover {
  background: var(--bg-base);
  padding-left: 8px;
  padding-right: 8px;
  border-radius: 6px;
}

.channel-check-card input {
  margin-top: 2px;
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}

.channel-tool-gate {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  margin-bottom: 6px;
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  background: var(--accent-subtle);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;
}

.channel-tool-gate:hover {
  border-color: var(--border-emphasis);
  background: var(--bg-base);
}

.channel-tool-gate input {
  margin-top: 2px;
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
}

.channel-check-card__title {
  color: var(--fg-strong);
  font-size: 12px;
  font-weight: 600;
}

.channel-check-card__desc {
  margin-top: 3px;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1.4;
}

.channel-tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0 16px;
}

.channel-path-entry {
  align-items: stretch;
  gap: 8px;
}

.channel-path-entry .channel-button {
  flex-shrink: 0;
}

.channel-path-list {
  gap: 6px;
  margin-top: 8px;
}

.channel-path-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 5px 12px;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  color: var(--fg-strong);
  font-size: 11px;
  font-weight: 500;
}

.channel-path-pill button {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
  transition: color 150ms ease;
}

.channel-path-pill button:hover {
  color: var(--complement);
}

.channel-targets {
  display: grid;
  gap: 4px;
}

.channel-target-row {
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  cursor: pointer;
  transition: background 150ms ease;
}

.channel-target-row:last-child {
  border-bottom: none;
}

.channel-target-row.is-selected {
  background: var(--accent-subtle);
  border-radius: 6px;
  padding-left: 10px;
  padding-right: 10px;
}

.channel-target-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
}

.channel-target-id {
  margin-top: 3px;
  color: var(--fg-muted);
  font-size: 11px;
}

.channel-notice {
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--complement-border);
  background: var(--complement-subtle);
  color: var(--complement);
}

.channel-notice--neutral {
  border-color: var(--border-default);
  background: var(--bg-base);
  color: var(--fg-muted);
}

.channel-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-base);
}

.channel-footer__meta {
  font-size: 11px;
  color: var(--fg-muted);
  line-height: 1.4;
}

.channel-footer__actions {
  gap: 8px;
  flex-shrink: 0;
}

.channel-empty {
  padding: 16px 0 8px;
  border-radius: 0;
  border: 1px dashed var(--border-default);
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
  border-left: none;
  border-right: none;
  border-top: none;
  text-align: center;
}

@media (max-width: 980px) {
  .channel-studio {
    grid-template-columns: minmax(0, 1fr);
  }

  .channel-sidebar {
    min-height: auto;
  }

  .channel-grid-two,
  .channel-persona-layout,
  .channel-panel__hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .channel-panel__footer {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 720px) {
  .channel-sidebar__hero,
  .channel-panel__hero,
  .channel-panel__footer,
  .channel-sidebar__body,
  .channel-panel__body,
  .channel-search {
    padding-left: 14px;
    padding-right: 14px;
  }

  .channel-descriptor__body,
  .channel-instance__body {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .channel-count {
    grid-column: 2;
    justify-self: start;
  }
}
`;
