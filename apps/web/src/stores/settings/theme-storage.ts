/**
 * 主题持久化存储——完全独立于 Zustand persist。
 *
 * 直接使用 localStorage 读写主题风格和模式，
 * 不依赖任何框架中间件的水合时序。
 */

export type ThemeStyle =
  'nebula' | 'aurora' | 'linear' | 'forest' | 'sakura' | 'carbon' | 'sunset' | 'ocean';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STYLE_KEY = 'theme-style';
const THEME_MODE_KEY = 'theme-mode';
const LEGACY_THEME_KEY = 'theme';
const PERSIST_KEY = 'openAwork-display-preferences';

const VALID_STYLES: ThemeStyle[] = [
  'nebula',
  'aurora',
  'linear',
  'forest',
  'sakura',
  'carbon',
  'sunset',
  'ocean',
];

const VALID_MODES: ThemeMode[] = ['system', 'light', 'dark'];

function isValidStyle(v: unknown): v is ThemeStyle {
  return typeof v === 'string' && VALID_STYLES.includes(v as ThemeStyle);
}

function isValidMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && VALID_MODES.includes(v as ThemeMode);
}

/**
 * 读取主题风格。读取顺序：
 * 1. theme-style 独立 key
 * 2. openAwork-display-preferences persist key 中的 state.themeStyle
 * 3. 默认 carbon
 */
export function readThemeStyle(): ThemeStyle {
  try {
    // 1. 独立 key
    const direct = localStorage.getItem(THEME_STYLE_KEY);
    if (direct && isValidStyle(direct)) {
      return direct;
    }
    // 2. persist key
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const fromPersist = parsed?.state?.themeStyle;
      if (isValidStyle(fromPersist)) {
        return fromPersist;
      }
    }
  } catch {
    // ignore
  }
  return 'carbon';
}

/**
 * 读取主题模式。读取顺序：
 * 1. theme-mode 独立 key
 * 2. openAwork-display-preferences persist key 中的 state.themeMode
 * 3. legacy theme key
 * 4. 默认 system
 */
export function readThemeMode(): ThemeMode {
  try {
    // 1. 独立 key
    const direct = localStorage.getItem(THEME_MODE_KEY);
    if (direct && isValidMode(direct)) {
      return direct;
    }
    // 2. persist key
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const fromPersist = parsed?.state?.themeMode;
      if (isValidMode(fromPersist)) {
        return fromPersist;
      }
    }
    // 3. legacy key
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      return legacy;
    }
  } catch {
    // ignore
  }
  return 'system';
}

/**
 * 写入主题风格到所有存储位置。
 */
export function writeThemeStyle(style: ThemeStyle): void {
  try {
    localStorage.setItem(THEME_STYLE_KEY, style);
    console.log(
      '[theme-storage] writeThemeStyle:',
      style,
      '| verified:',
      localStorage.getItem(THEME_STYLE_KEY),
    );
  } catch (e) {
    console.error('[theme-storage] failed to write theme-style:', e);
  }
}

/**
 * 写入主题模式到所有存储位置。
 */
export function writeThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
    console.log(
      '[theme-storage] writeThemeMode:',
      mode,
      '| verified:',
      localStorage.getItem(THEME_MODE_KEY),
    );
  } catch (e) {
    console.error('[theme-storage] failed to write theme-mode:', e);
  }
}

/**
 * 诊断函数：打印当前 localStorage 中所有主题相关的 key。
 */
export function diagnoseThemeStorage(): void {
  try {
    const style = localStorage.getItem(THEME_STYLE_KEY);
    const mode = localStorage.getItem(THEME_MODE_KEY);
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    const persist = localStorage.getItem(PERSIST_KEY);
    console.log('[theme-diag] theme-style:', style);
    console.log('[theme-diag] theme-mode:', mode);
    console.log('[theme-diag] legacy theme:', legacy);
    console.log('[theme-diag] persist key:', persist ? persist.substring(0, 200) : 'null');
    console.log('[theme-diag] all keys:', Object.keys(localStorage).join(', '));
  } catch (e) {
    console.error('[theme-diag] error:', e);
  }
}
