export const CHANNEL_SUBSCRIPTION_SETTINGS_STYLES = `
.channel-studio {
  display: grid;
  grid-template-columns: minmax(208px, 232px) minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.channel-card {
  border: 1px solid color-mix(in srgb, var(--border, #334155) 72%, transparent);
  border-radius: 12px;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface, #0f172a) 97%, white 3%);
  box-shadow: none;
}

.channel-sidebar {
  display: flex;
  flex-direction: column;
  min-height: auto;
}

.channel-sidebar__hero,
.channel-panel__hero,
.channel-panel__footer {
  padding: 10px 12px;
}

.channel-sidebar__hero,
.channel-panel__hero {
  border-bottom: 1px solid color-mix(in srgb, var(--border, #334155) 78%, transparent);
  background: transparent;
}

.channel-sidebar__eyebrow,
.channel-panel__eyebrow {
  display: none;
}

.channel-sidebar__title,
.channel-panel__title {
  margin: 0;
  font-size: 15px;
  line-height: 1.15;
  color: var(--text, #e2e8f0);
}

.channel-sidebar__description,
.channel-panel__description,
.channel-muted {
  color: var(--text-3, #94a3b8);
  font-size: 11px;
  line-height: 1.4;
}

.channel-sidebar__description,
.channel-panel__description {
  margin: 4px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(148, 163, 184, 0.1);
  color: var(--text, #e2e8f0);
  font-size: 10px;
  font-weight: 600;
}

.channel-search {
  padding: 8px 12px 0;
}

.channel-search input,
.channel-field input,
.channel-field select,
.channel-path-entry input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--border, #334155) 80%, transparent);
  background: color-mix(in srgb, var(--bg, #0f172a) 92%, white 8%);
  color: var(--text, #e2e8f0);
  padding: 7px 9px;
  font-size: 11px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.channel-search input:focus,
.channel-field input:focus,
.channel-field select:focus,
.channel-path-entry input:focus {
  border-color: color-mix(in srgb, var(--accent, #6366f1) 68%, white 32%);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
}

.channel-sidebar__body,
.channel-panel__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 10px;
}

.channel-group {
  display: grid;
  gap: 6px;
}

.channel-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.channel-group__title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text, #e2e8f0);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.channel-descriptor,
.channel-instance {
  width: 100%;
  text-align: left;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;
}

.channel-descriptor:hover,
.channel-instance:hover,
.channel-button:hover:not(:disabled) {
  border-color: rgba(99, 102, 241, 0.32);
}

.channel-descriptor.is-active,
.channel-instance.is-active {
  border-color: rgba(99, 102, 241, 0.52);
  background: rgba(99, 102, 241, 0.08);
}

.channel-descriptor__body,
.channel-instance__body {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 8px;
  padding: 7px 6px;
  align-items: center;
}

.channel-icon {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(148, 163, 184, 0.06);
  color: var(--text, #e2e8f0);
  font-size: 11px;
  font-weight: 700;
}

.channel-descriptor__name,
.channel-instance__name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text, #e2e8f0);
}

.channel-descriptor__desc,
.channel-instance__desc {
  margin-top: 2px;
  font-size: 10px;
  line-height: 1.3;
  color: var(--text-3, #94a3b8);
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
  padding: 3px 6px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}

.channel-count,
.channel-mini-badge {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: transparent;
  color: var(--text-3, #94a3b8);
}

.channel-panel__hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
}

.channel-panel__identity {
  display: flex;
  gap: 8px;
  min-width: 0;
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

.channel-status-badge {
  border: 1px solid color-mix(in srgb, var(--tone-color) 34%, transparent);
  color: var(--tone-color);
  background: transparent;
}

.channel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text, #e2e8f0);
  font-size: 10px;
  font-weight: 600;
}

.channel-toggle input {
  accent-color: var(--accent, #6366f1);
}

.channel-button {
  appearance: none;
  border: none;
  border-radius: 8px;
  padding: 6px 9px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 150ms ease, filter 150ms ease, border-color 150ms ease;
}

.channel-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  filter: none;
}

.channel-button--primary {
  background: var(--accent, #6366f1);
  color: var(--accent-text, #fff);
}

.channel-button--ghost {
  background: transparent;
  color: var(--text, #e2e8f0);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.channel-button--danger {
  background: transparent;
  color: #fecaca;
  border: 1px solid rgba(248, 113, 113, 0.24);
}

.channel-grid-two,
.channel-grid-fields,
.channel-grid-provider {
  display: grid;
  gap: 8px;
}

.channel-grid-two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.channel-grid-fields {
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
}

.channel-grid-provider {
  grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
}

.channel-section {
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0;
  background: transparent;
}

.channel-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0 6px;
  border-bottom: none;
}

.channel-section__title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--text, #e2e8f0);
}

.channel-section__body {
  padding: 0 0 10px;
}

.channel-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.channel-field__label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text, #e2e8f0);
  font-size: 10px;
  font-weight: 700;
}

.channel-field__hint {
  color: var(--text-3, #94a3b8);
  font-size: 10px;
  line-height: 1.3;
}

.channel-field__input-wrap {
  position: relative;
}

.channel-field__secret-toggle {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--text-3, #94a3b8);
  font-size: 9px;
  cursor: pointer;
  padding: 0;
}

.channel-check-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  background: transparent;
}

.channel-check-card input {
  margin-top: 2px;
  accent-color: var(--accent, #6366f1);
}

.channel-check-card__title {
  color: var(--text, #e2e8f0);
  font-size: 11px;
  font-weight: 700;
}

.channel-check-card__desc {
  margin-top: 2px;
  color: var(--text-3, #94a3b8);
  font-size: 10px;
  line-height: 1.3;
}

.channel-tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
  gap: 0 12px;
}

.channel-path-entry {
  align-items: stretch;
}

.channel-path-entry .channel-button {
  flex-shrink: 0;
}

.channel-path-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 4px 8px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.18);
  color: var(--text, #e2e8f0);
  font-size: 10px;
}

.channel-path-pill button {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}

.channel-targets {
  display: grid;
  gap: 6px;
}

.channel-target-row {
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: transparent;
}

.channel-target-row.is-selected {
  border-color: rgba(99, 102, 241, 0.28);
  background: transparent;
}

.channel-target-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text, #e2e8f0);
}

.channel-target-id {
  margin-top: 2px;
  color: var(--text-3, #94a3b8);
  font-size: 10px;
}

.channel-notice {
  border-radius: 8px;
  padding: 7px 9px;
  font-size: 11px;
  line-height: 1.35;
  border: 1px solid rgba(248, 113, 113, 0.24);
  background: rgba(248, 113, 113, 0.08);
  color: #fecaca;
}

.channel-notice--neutral {
  border-color: rgba(148, 163, 184, 0.14);
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-3, #94a3b8);
}

.channel-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
  background: transparent;
}

.channel-footer__meta {
  font-size: 10px;
  color: var(--text-3, #94a3b8);
}

.channel-empty {
  padding: 10px 0 4px;
  border-radius: 0;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  background: transparent;
  color: var(--text-3, #94a3b8);
  font-size: 11px;
  line-height: 1.4;
  border-left: none;
  border-right: none;
  border-top: none;
}

@media (max-width: 980px) {
  .channel-studio {
    grid-template-columns: minmax(0, 1fr);
  }

  .channel-sidebar {
    min-height: auto;
  }

  .channel-grid-two,
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
  .channel-search,
  .channel-section__head,
  .channel-section__body {
    padding-left: 10px;
    padding-right: 10px;
  }

  .channel-descriptor__body,
  .channel-instance__body {
    grid-template-columns: 26px minmax(0, 1fr);
  }

  .channel-count {
    grid-column: 2;
    justify-self: start;
  }
}
`;
