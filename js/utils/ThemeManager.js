/**
 * ThemeManager - Light/Dark theme with system default + persistence.
 * Applies `data-theme` on <html>, remembers the choice in localStorage,
 * and emits Events.THEME_CHANGED so theme-dependent views (charts) can refresh.
 */

import { eventBus } from './EventBus.js';
import { Events } from './Constants.js';

const STORAGE_KEY = 'armtrack-theme';

export class ThemeManager {
  constructor() {
    this._media = window.matchMedia('(prefers-color-scheme: light)');
    this._theme = this._resolveInitial();
  }

  /** @returns {'light'|'dark'} */
  get theme() {
    return this._theme;
  }

  /** Resolve the initial theme: stored choice first, else follow the OS. */
  _resolveInitial() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return this._media.matches ? 'light' : 'dark';
  }

  /** Apply the current theme and start following the OS until the user picks. */
  init() {
    this._applyToDOM();

    // If the user hasn't explicitly chosen, keep following the OS setting.
    this._media.addEventListener('change', (e) => {
      if (localStorage.getItem(STORAGE_KEY)) return; // user override wins
      this._theme = e.matches ? 'light' : 'dark';
      this._applyToDOM();
      eventBus.emit(Events.THEME_CHANGED, this._theme);
    });
  }

  /** Explicitly set the theme (persists the choice). */
  set(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    this._theme = theme;
    localStorage.setItem(STORAGE_KEY, theme);
    this._applyToDOM();
    eventBus.emit(Events.THEME_CHANGED, theme);
  }

  /** Toggle between light and dark (persists). */
  toggle() {
    this.set(this._theme === 'dark' ? 'light' : 'dark');
  }

  _applyToDOM() {
    document.documentElement.setAttribute('data-theme', this._theme);
  }
}

export const themeManager = new ThemeManager();
