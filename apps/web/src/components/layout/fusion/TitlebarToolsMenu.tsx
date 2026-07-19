import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { LayoutModeMenuItems } from '../shared/TitlebarLayoutModeControl.js';
import { SettingsIcon, ThemeIcon } from '../shared/TitlebarIcons.js';
import './TitlebarToolsMenu.css';

export interface TitlebarToolsMenuProps {
  readonly theme?: 'dark' | 'light';
  readonly onToggleTheme?: () => void;
}

export function TitlebarToolsMenu({ theme, onToggleTheme }: TitlebarToolsMenuProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target instanceof Node ? event.target : null)) {
        return;
      }
      setOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleToggleTheme = useCallback(() => {
    onToggleTheme?.();
    setOpen(false);
  }, [onToggleTheme]);

  const handleOpenSettings = useCallback(() => {
    void navigate('/settings');
    setOpen(false);
  }, [navigate]);

  return (
    <div ref={containerRef} className="titlebar-tools-menu">
      <button
        type="button"
        title="工具菜单"
        aria-label="工具菜单"
        aria-expanded={open}
        aria-haspopup="menu"
        className="titlebar-tools-menu__trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <SettingsIcon />
      </button>

      {open ? (
        <div role="menu" aria-label="工具菜单" className="titlebar-tools-menu__panel">
          <LayoutModeMenuItems onSelect={() => setOpen(false)} />
          <hr className="titlebar-tools-menu__separator" />

          {onToggleTheme ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="titlebar-tools-menu__item"
                onClick={handleToggleTheme}
              >
                <ThemeIcon theme={theme} />
                <span className="titlebar-tools-menu__item-label">
                  {theme === 'dark' ? '日间模式' : '夜间模式'}
                </span>
              </button>
              <hr className="titlebar-tools-menu__separator" />
            </>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className="titlebar-tools-menu__item"
            onClick={handleOpenSettings}
          >
            <SettingsIcon />
            <span className="titlebar-tools-menu__item-label">设置</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
