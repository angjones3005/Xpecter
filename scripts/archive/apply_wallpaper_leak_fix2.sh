#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

cat > "frontend/src/main.ts" << 'SPECTER_EOF_MAINTS'
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as monaco from 'monaco-editor';
import '@xterm/xterm/css/xterm.css';
// SPE-61: bundle real font files for the 3 open-source coding fonts so
// they render identically everywhere, rather than depending on the
// host OS having them installed. Consolas/Menlo/Courier New stay
// OS-dependent, they're proprietary (Microsoft/Apple), can't be
// bundled, Windows/Mac generally have them, stock Linux generally
// doesn't.
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/cascadia-code/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/700.css';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/victor-mono/400.css';
import '@fontsource/victor-mono/700.css';
import '@fontsource/ubuntu-mono/400.css';
import '@fontsource/ubuntu-mono/700.css';
import type { RemoteFile, ConnectRequest, SessionProfile, SessionGroup, SessionClosedEvent, Settings } from '../wailsjs.d.ts';

type ThemeName = 'dark' | 'light';

const XTERM_THEMES: Record<ThemeName, Record<string, string>> = {
  dark: {
    background: '#1e1e1e', foreground: '#dddddd', cursor: '#dddddd',
    black: '#1e1e1e', red: '#e5484d', green: '#2ea043', yellow: '#d29922',
    blue: '#3178c6', magenta: '#bc7cf0', cyan: '#39c5cf', white: '#dddddd',
    brightBlack: '#666666', brightRed: '#ff6b6b', brightGreen: '#3fb950',
    brightYellow: '#e3b341', brightBlue: '#58a6ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e',
    black: '#1e1e1e', red: '#cf3d3e', green: '#1f8a3d', yellow: '#a06800',
    blue: '#3178c6', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#e5484d', brightGreen: '#2ea043',
    brightYellow: '#d29922', brightBlue: '#4184e4', brightMagenta: '#a475f9',
    brightCyan: '#3192aa', brightWhite: '#1e1e1e',
  },
};

// SPE-61: curated terminal color-scheme presets, separate from the
// dark/light UI chrome toggle above. A full 16-color ANSI palette each,
// same shape as XTERM_THEMES. 'dark'/'light' here alias the existing UI
// themes so picking neither preserves old behavior exactly.
type ColorScheme = ThemeName | 'dracula' | 'nord' | 'solarized-dark' | 'solarized-light' | 'gruvbox-dark' | 'one-dark';

const TERMINAL_COLOR_SCHEMES: Record<ColorScheme, Record<string, string>> = {
  ...XTERM_THEMES,
  dracula: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  nord: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'solarized-dark': {
    background: '#002b36', foreground: '#839496', cursor: '#839496',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'gruvbox-dark': {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26',
    brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
    brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  },
  'one-dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#abb2bf',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
};

// SPE-61: curated font list, not free text, so a user can't select a
// font that doesn't exist. Most of these are real bundled font files
// (imported above via @fontsource, actual .woff2s in the build output),
// guaranteed to render identically everywhere regardless of host OS.
// Menlo, Consolas, and Courier New are the exception: proprietary
// (Apple/Microsoft), can't be legally bundled, fall back to the OS's
// copy if present (Windows/Mac generally have them, stock Linux
// generally doesn't, so those 3 may look unchanged on Linux).
const FONT_OPTIONS: { value: string; stack: string }[] = [
  { value: 'menlo', stack: 'Menlo, Consolas, monospace' },
  { value: 'consolas', stack: 'Consolas, Menlo, monospace' },
  { value: 'cascadia', stack: '"Cascadia Code", Consolas, monospace' },
  { value: 'fira', stack: '"Fira Code", Consolas, monospace' },
  { value: 'jetbrains', stack: '"JetBrains Mono", Consolas, monospace' },
  { value: 'courier', stack: '"Courier New", Courier, monospace' },
  { value: 'ibmplex', stack: '"IBM Plex Mono", Consolas, monospace' },
  { value: 'sourcecodepro', stack: '"Source Code Pro", Consolas, monospace' },
  { value: 'inconsolata', stack: 'Inconsolata, Consolas, monospace' },
  { value: 'victor', stack: '"Victor Mono", Consolas, monospace' },
  { value: 'ubuntumono', stack: '"Ubuntu Mono", Consolas, monospace' },
];

function fontStack(fontId: string): string {
  return FONT_OPTIONS.find((f) => f.value === fontId)?.stack ?? FONT_OPTIONS[0].stack;
}

const MONACO_THEMES: Record<ThemeName, string> = {
  dark: 'vs-dark',
  light: 'vs',
};

// In-memory copy of backend-persisted settings.json (SPE-61), loaded
// once at startup via App.GetSettings(). Deliberately not localStorage,
// matches the file-on-disk decision made for the wallpaper image itself.
let appSettings: Settings = {};

function currentColorScheme(): ColorScheme {
  const s = appSettings.colorScheme;
  if (s && s in TERMINAL_COLOR_SCHEMES) return s as ColorScheme;
  return currentTheme();
}

function wallpaperActive(): boolean {
  return !!appSettings.wallpaperPath;
}

// The palette actually applied to xterm: the chosen preset, with its
// background swapped for transparent whenever a wallpaper is active so
// the image (painted on #terminal-wallpaper, behind the tab containers)
// shows through. Text keeps the palette's normal foreground/ANSI colors.
function activeXtermTheme(): Record<string, string> {
  const base = TERMINAL_COLOR_SCHEMES[currentColorScheme()];
  if (!wallpaperActive()) return base;
  return { ...base, background: 'transparent' };
}

function refreshAllTerminalThemes() {
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.theme = activeXtermTheme();
  }
}

function applyColorScheme(name: ColorScheme) {
  appSettings.colorScheme = name;
  App.SaveSettings(appSettings);
  refreshAllTerminalThemes();
}

function applyFont(fontId: string) {
  appSettings.fontFamily = fontId;
  App.SaveSettings(appSettings);
  const stack = fontStack(fontId);
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  refitActiveTerminal();
}

function applyWallpaperVisual() {
  const el = document.getElementById('terminal-wallpaper')!;
  // Only actually show it if the active tab has real content behind it;
  // the wallpaper div lives inside #terminal, a sibling of the "No
  // session yet" landing screen, so it must stay hidden while that's
  // showing or it bleeds through the sliver #terminal still occupies.
  const activeTab = activeTabId ? tabs.get(activeTabId) : null;
  const shouldShow = !!appSettings.wallpaperDataUrl && activeTab?.mode !== 'pending';
  if (shouldShow) {
    el.style.backgroundImage = `url("${appSettings.wallpaperDataUrl}")`;
    el.style.opacity = String((appSettings.wallpaperOpacity ?? 0.15));
    el.style.display = 'block';
  } else {
    el.style.backgroundImage = '';
    el.style.display = 'none';
  }
  document.getElementById('wallpaper-opacity-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  document.getElementById('wallpaper-clear-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  refreshAllTerminalThemes();
}

async function setWallpaper(path: string) {
  appSettings.wallpaperPath = path;
  appSettings.wallpaperDataUrl = await App.ReadImageFile(path);
  if (!appSettings.wallpaperOpacity) appSettings.wallpaperOpacity = 0.15;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function clearWallpaper() {
  appSettings.wallpaperPath = '';
  appSettings.wallpaperDataUrl = undefined;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function loadSettingsAndApply() {
  appSettings = await App.GetSettings();
  if (appSettings.wallpaperPath) {
    try {
      appSettings.wallpaperDataUrl = await App.ReadImageFile(appSettings.wallpaperPath);
    } catch {
      // Wallpaper file moved/deleted since last launch, fall back to no
      // wallpaper rather than a broken image or a thrown error at startup.
      appSettings.wallpaperPath = '';
    }
  }
  const colorSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
  colorSelect.value = appSettings.colorScheme || currentTheme();
  const fontSelectEl = document.getElementById('font-select') as HTMLSelectElement;
  fontSelectEl.value = appSettings.fontFamily || FONT_OPTIONS[0].value;
  const opacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
  opacitySlider.value = String(Math.round((appSettings.wallpaperOpacity ?? 0.15) * 100));
  applyWallpaperVisual();

  // In case a tab was created before this async load resolved (race:
  // GetSettings is an IPC round-trip), reapply font to whatever's live.
  // refreshAllTerminalThemes (called by applyWallpaperVisual above)
  // already handles color.
  const stack = fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value);
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
}

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('specter-theme', name);

  // Only follow the UI theme toggle for terminal ANSI colors when the
  // user hasn't explicitly picked a color-scheme preset (SPE-61);
  // once they have, dark/light and terminal colors are independent.
  if (!appSettings.colorScheme || appSettings.colorScheme === 'dark' || appSettings.colorScheme === 'light') {
    appSettings.colorScheme = name;
  }
  refreshAllTerminalThemes();

  if (typeof monaco !== 'undefined' && editor) {
    monaco.editor.setTheme(MONACO_THEMES[name]);
  }
}

function refitActiveTerminal() {
  // CSS class toggles (sidebar/editor collapse) don't fire a browser
  // resize event, so xterm.js never re-measures its container on its
  // own. Force it after any layout change that affects terminal width.
  requestAnimationFrame(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab?.fitAddon || !tab.term) return;
    tab.fitAddon.fit();
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term.cols, tab.term.rows);
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term.cols, tab.term.rows);
  });
}

function currentTheme(): ThemeName {
  const saved = localStorage.getItem('specter-theme');
  return saved === 'light' ? 'light' : 'dark';
}


const App = window.go.main.App;
const runtime = window.runtime;

// --- Tab model ---
// Each tab owns its own xterm.js Terminal + backend session (SSH session ID
// or local terminal ID). 'pending' tabs show the connect form instead of a
// live terminal, until Connect/StartLocalTerminal resolves them.

type TabMode = 'pending' | 'local' | 'ssh' | 'serial';
type TabStatus = 'connecting' | 'connected' | 'disconnected';

interface Tab {
  id: string;
  mode: TabMode;
  backendId: string | null; // sessionId (ssh) or local terminal id
  label: string;
  status: TabStatus;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  container: HTMLDivElement | null;
  // SPE-59: true while showing the "session stopped" panel after an
  // unexpected disconnect. Gates keyboard input away from the dead PTY
  // and routes R/S/Enter to the panel's actions instead.
  stopped: boolean;
  overlay: HTMLDivElement | null;
  // Set once a session connects; re-runs the same connect call to
  // power the panel's "R to restart session" action. null for local
  // shell tabs (out of scope for SPE-59, see ticket).
  reconnect: (() => void | Promise<void>) | null;
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let tabCounter = 0;

function newTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function createPendingTab(): Tab {
  const tab: Tab = {
    id: newTabId(),
    mode: 'pending',
    backendId: null,
    label: 'New Tab',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
  };
  tabs.set(tab.id, tab);
  return tab;
}

function renderTabBar() {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  for (const tab of tabs.values()) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => switchToTab(tab.id);

    const dot = document.createElement('span');
    dot.className = 'status-dot ' + tab.status;
    el.appendChild(dot);

    const label = document.createElement('span');
    label.textContent = (tab.mode === 'local' ? '💻 ' : tab.mode === 'ssh' ? '🌐 ' : tab.mode === 'serial' ? '🔌 ' : '') + tab.label;
    el.appendChild(label);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
    el.appendChild(close);

    bar.appendChild(el);
  }

  const addBtn = document.createElement('div');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.onclick = () => {
    const tab = createPendingTab();
    switchToTab(tab.id);
  };
  bar.appendChild(addBtn);
}

function switchToTab(id: string) {
  activeTabId = id;
  const tab = tabs.get(id)!;

  // Hide all terminal containers, show only the active one (or the connect
  // form if this tab hasn't connected yet).
  document.querySelectorAll('.term-instance').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  document.getElementById('tab-landing')!.style.display = tab.mode === 'pending' ? 'flex' : 'none';
  // SPE-61 wallpaper lives inside #terminal, a sibling of #tab-landing;
  // without this, both compete for space in the flex layout and the
  // wallpaper peeks through the sliver #terminal still occupies while
  // the "No session yet" landing screen is showing. applyWallpaperVisual
  // itself checks the now-updated activeTabId/tab.mode.
  applyWallpaperVisual();

  if (tab.container) {
    tab.container.style.display = 'block';
    tab.fitAddon?.fit();
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term!.cols, tab.term!.rows);
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term!.cols, tab.term!.rows);
  }

  if (tab.mode === 'ssh' && tab.backendId) {
    refreshFileList('.', tab.backendId);
  }

  renderTabBar();
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;

  if (tab.mode === 'ssh' && tab.backendId) {
    await App.CloseSSH(tab.backendId);
    runtime.EventsOff('ssh:data:' + tab.backendId, 'ssh:closed:' + tab.backendId);
  }
  if (tab.mode === 'local' && tab.backendId) await App.CloseLocalTerminal(tab.backendId);
  if (tab.mode === 'serial' && tab.backendId) {
    await App.CloseSerial(tab.backendId);
    runtime.EventsOff('serial:data:' + tab.backendId, 'serial:closed:' + tab.backendId);
  }
  tab.overlay?.remove();
  tab.term?.dispose();
  tab.container?.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      const fresh = createPendingTab();
      switchToTab(fresh.id);
    }
  } else {
    renderTabBar();
  }
}

function createTerminalForTab(tab: Tab) {
  const container = document.createElement('div');
  container.className = 'term-instance';
  container.style.cssText = 'height:100%;padding:4px;box-sizing:border-box;position:relative;';
  document.getElementById('terminal')!.appendChild(container);

  const term = new Terminal({
    fontFamily: fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value),
    fontSize: appSettings.fontSize || 13,
    theme: activeXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  // OSC 52: let remote programs (xclip, pbcopy, tmux, vim, etc.) sync
  // their copy into the local OS clipboard, gated by osc52Enabled since
  // this lets a remote process silently write to the local clipboard.
  term.parser.registerOscHandler(52, (data: string) => {
    if (!osc52Enabled) return true;
    const parts = data.split(';');
    if (parts.length < 2) return true;
    try {
      const text = atob(parts[1]);
      navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // ignore malformed OSC 52 payloads
    }
    return true;
  });

  // Auto-copy on selection (classic X11/xterm/PuTTY-style behavior),
  // gated by copyOnSelectEnabled toggle since not everyone wants this.
  term.onSelectionChange(() => {
    if (!copyOnSelectEnabled) return;
    const sel = term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  });

  // Explicit paste keybind (Ctrl+Shift+V / Cmd+Shift+V), separate from
  // native browser paste, as a reliable fallback across platforms/webviews.
  // Ctrl+Shift+X disconnects the active session (see disconnectTab):
  // deliberately NOT plain Ctrl+C, since that's the real SIGINT keystroke
  // needed constantly on a live switch session, and NOT plain Ctrl+X
  // either, since bash/readline and Emacs both use that as a prefix key.
  // Also handles the SPE-59 disconnected-session panel: while a session is
  // stopped, R/S/Enter drive the panel's actions and everything else is
  // swallowed rather than typed into a dead PTY.
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (tab.stopped) {
      if (e.type === 'keydown') {
        const key = e.key.toLowerCase();
        if (key === 'enter') closeTab(tab.id);
        else if (key === 'r') reconnectTab(tab);
        else if (key === 's') saveTabOutput(tab);
      }
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      disconnectTab(tab);
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then((text) => {
        if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, text);
        if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, text);
        if (tab.mode === 'serial' && tab.backendId) App.WriteSerial(tab.backendId, text);
      }).catch(() => {});
      return false;
    }
    return true;
  });

  // Right-click to paste (toggleable), matching PuTTY/most Linux terminal convention.
  container.addEventListener('contextmenu', (e) => {
    if (!rightClickPasteEnabled) return;
    e.preventDefault();
    App.GetClipboardText().then((text) => {
      if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, text);
      if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, text);
      if (tab.mode === 'serial' && tab.backendId) App.WriteSerial(tab.backendId, text);
    }).catch(() => {});
  });

  term.onData((data) => {
    if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, data);
    if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, data);
    if (tab.mode === 'serial' && tab.backendId) App.WriteSerial(tab.backendId, data);
  });

  tab.term = term;
  tab.fitAddon = fitAddon;
  tab.container = container;
}

let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab || !tab.fitAddon || !tab.term) return;
    tab.fitAddon.fit();
    if (tab.mode === 'local' && tab.backendId) App.ResizeLocalTerminal(tab.backendId, tab.term.cols, tab.term.rows);
    if (tab.mode === 'ssh' && tab.backendId) App.ResizeSSH(tab.backendId, tab.term.cols, tab.term.rows);
  }, 100);
});

// --- Editor setup (shared across all tabs, VS Code-style) ---

const editor = monaco.editor.create(document.getElementById('editor')!, {
  value: '',
  language: 'plaintext',
  theme: MONACO_THEMES[currentTheme()],
  automaticLayout: true,
});

document.getElementById('editor-close')!.addEventListener('click', () => {
  document.getElementById('app')!.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  document.getElementById('app')!.classList.toggle('editor-collapsed');
  refitActiveTerminal();
});

document.getElementById('menu-toggle-editor')!.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('app')!.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  document.getElementById('app')!.classList.toggle('editor-collapsed');
  refitActiveTerminal();
});


let openFilePath: string | null = null;
let openFileSessionId: string | null = null;

async function openRemoteFile(sessionId: string, path: string) {
  const content = await App.ReadRemoteFile(sessionId, path);
  openFilePath = path;
  openFileSessionId = sessionId;
  document.getElementById('editor-path')!.textContent = path;
  document.getElementById('editor-close')!.style.display = 'inline';
  const ext = path.split('.').pop() ?? '';
  const langMap: Record<string, string> = {
    go: 'go', hs: 'haskell', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown',
  };
  monaco.editor.setModelLanguage(editor.getModel()!, langMap[ext] ?? 'plaintext');
  editor.setValue(content);
}

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
  if (!openFileSessionId || !openFilePath) return;
  await App.WriteRemoteFile(openFileSessionId, openFilePath, editor.getValue());
});

// --- File browser (scoped to whichever SSH tab is active) ---

let currentRemotePath = '.';
let currentRemoteSessionId: string | null = null;

async function refreshFileList(path = '.', sessionId?: string) {
  const id = sessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!id) return;
  currentRemotePath = path;
  currentRemoteSessionId = id;
  const entries: RemoteFile[] = await App.ListRemoteDir(id, path);
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = (e.isDir ? '\ud83d\udcc1 ' : '\ud83d\udcc4 ') + e.name;
    div.onclick = () => (e.isDir ? refreshFileList(e.path, id) : openRemoteFile(id, e.path));
    list.appendChild(div);
  }
}

async function uploadFilesToCurrentDir(files: FileList) {
  if (!currentRemoteSessionId) return;
  const list = document.getElementById('file-list')!;
  const status = document.createElement('div');
  status.className = 'entry';
  status.style.opacity = '0.7';
  status.style.fontStyle = 'italic';
  list.appendChild(status);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Uploading ${file.name}...`;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
    const base64 = btoa(binary);
    const remotePath = currentRemotePath === '.' ? file.name : `${currentRemotePath}/${file.name}`;
    try {
      await App.UploadRemoteFile(currentRemoteSessionId, remotePath, base64);
    } catch (err) {
      console.error('Upload failed for', file.name, err);
    }
  }

  refreshFileList(currentRemotePath, currentRemoteSessionId);
}

(() => {
  const fileList = document.getElementById('file-list')!;
  fileList.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    fileList.style.background = 'var(--hover)';
  });
  fileList.addEventListener('dragleave', () => {
    fileList.style.background = '';
  });
  fileList.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    fileList.style.background = '';
    uploadFilesToCurrentDir(e.dataTransfer.files);
  });
})();

// --- Saved sessions ---

function setAuthMode(mode: 'password' | 'key') {
  const radio = document.querySelector(`input[name="authmode"][value="${mode}"]`) as HTMLInputElement;
  radio.checked = true;
  const isKey = mode === 'key';
  document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
  document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
}

function setDeviceKind(kind: 'host' | 'switch' | 'firewall') {
  const radio = document.querySelector(`input[name="devicekind"][value="${kind}"]`) as HTMLInputElement;
  radio.checked = true;
}

function currentDeviceKind(): 'host' | 'switch' | 'firewall' {
  const checked = document.querySelector('input[name="devicekind"]:checked') as HTMLInputElement | null;
  if (checked?.value === 'switch') return 'switch';
  if (checked?.value === 'firewall') return 'firewall';
  return 'host';
}

let skipSavePrompt = false;
let skipSerialSavePrompt = false;
let pendingSessionName: string | null = null;

// In-memory only, never persisted to disk, cleared on app restart.

// Distinct from the deliberate "never save passwords to disk" design

// principle in backend/config/sessions.go, this just avoids re-prompting

// within a single running session.

const passwordCache = new Map<string, string>();

function passwordCacheKey(host: string, port: number, user: string): string {

  return `${user}@${host}:${port}`;

}

async function useSession(s: SessionProfile) {
  if (s.type === 'serial') {
    await useSerialSession(s);
    return;
  }
  await useSSHSession(s);
}

async function useSSHSession(s: SessionProfile) {

  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });

  ensurePendingTab();

  (document.getElementById('host') as HTMLInputElement).value = s.host ?? '';

  (document.getElementById('user') as HTMLInputElement).value = s.user ?? '';

  setDeviceKind(s.deviceKind === 'switch' ? 'switch' : s.deviceKind === 'firewall' ? 'firewall' : 'host');



  skipSavePrompt = true;



  if (s.keyPath) {

    setAuthMode('key');

    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath;

    (document.getElementById('passphrase') as HTMLInputElement).value = '';

    await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', keyPath: s.keyPath });

    const tab = tabs.get(activeTabId!);

    if (tab) {

      tab.label = s.name;

      renderTabBar();

    }

  } else {

    setAuthMode('password');

    const cacheKey = passwordCacheKey(s.host ?? '', s.port ?? 22, s.user ?? '');

    const cachedPassword = passwordCache.get(cacheKey);

    if (cachedPassword) {

      await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', password: cachedPassword });

      const tab = tabs.get(activeTabId!);

      if (tab) {

        tab.label = s.name;

        renderTabBar();

      }

    } else {

      pendingSessionName = s.name;

      openSessionPicker();

      document.getElementById('picker-grid')!.style.display = 'none';

      document.getElementById('picker-ssh-fields')!.style.display = 'flex';

      const pwField = document.getElementById('password') as HTMLInputElement;

      pwField.value = '';

      pwField.focus();

    }

  }

}

async function useSerialSession(s: SessionProfile) {
  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });
  ensurePendingTab();
  skipSerialSavePrompt = true;
  await connectSerialInActiveTab(s.serialPort ?? '', s.baud ?? 9600);
}

function renderSessionRow(s: SessionProfile): HTMLElement {
  const row = document.createElement('div');
  row.className = 'session-entry';
  row.style.paddingLeft = '18px';
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/specter-session-id', s.id);
  });

  const label = document.createElement('span');
  const icon = s.type === 'serial' ? '\ud83d\udd0c '
    : s.deviceKind === 'switch' ? '\ud83d\udd00 '
    : s.deviceKind === 'firewall' ? '\ud83d\udee1\ufe0f '
    : '\ud83d\udda5\ufe0f ';
  label.textContent = icon + s.name;
  label.onclick = () => useSession(s);
  label.style.flex = '1';

  const del = document.createElement('span');
  del.textContent = '\u2715';
  del.className = 'delete-btn';
  del.onclick = async (e) => {
    e.stopPropagation();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  row.appendChild(label);
  row.appendChild(del);

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showSessionContextMenu(e.clientX, e.clientY, s);
  });

  return row;
}

function attachMenuAutoClose(menu: HTMLElement) {
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

const DEVICE_KINDS: { value: 'host' | 'switch' | 'firewall'; label: string }[] = [
  { value: 'host', label: 'VM / Host' },
  { value: 'switch', label: 'Network switch' },
  { value: 'firewall', label: 'Firewall' },
];

// Flyout submenu for device type, kept separate from the main session
// context menu so that menu doesn't grow a new row every time a device
// kind is added (router, load balancer, AP, ...). Opens anchored to the
// "Device type ▸" item that triggered it.
function showDeviceKindMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:140px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const current = s.deviceKind === 'switch' || s.deviceKind === 'firewall' ? s.deviceKind : 'host';
  for (const k of DEVICE_KINDS) {
    const kindItem = document.createElement('div');
    kindItem.textContent = (k.value === current ? '\u2713 ' : '\u2003') + k.label;
    kindItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
    kindItem.onmouseenter = () => { kindItem.style.background = 'var(--hover)'; };
    kindItem.onmouseleave = () => { kindItem.style.background = ''; };
    kindItem.onclick = async () => {
      menu.remove();
      if (k.value === current) return;
      await App.SaveSession({ ...s, deviceKind: k.value });
      renderSessionList();
    };
    menu.appendChild(kindItem);
  }

  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

function showSessionContextMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:120px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const renameItem = document.createElement('div');
  renameItem.textContent = 'Rename';
  renameItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  renameItem.onmouseenter = () => { renameItem.style.background = 'var(--hover)'; };
  renameItem.onmouseleave = () => { renameItem.style.background = ''; };
  renameItem.onclick = async () => {
    menu.remove();
    const newName = prompt('Rename session:', s.name);
    if (!newName || newName === s.name) return;
    await App.SaveSession({ ...s, name: newName });
    renderSessionList();
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  menu.appendChild(renameItem);

  // Single flyout entry instead of one row per device kind, only
  // meaningful for SSH sessions, serial always shows its own icon.
  if (s.type !== 'serial') {
    const kindItem = document.createElement('div');
    kindItem.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:12px;';
    const kindLabel = document.createElement('span');
    kindLabel.textContent = 'Device type';
    const arrow = document.createElement('span');
    arrow.textContent = '\u25b8';
    arrow.style.opacity = '0.6';
    kindItem.appendChild(kindLabel);
    kindItem.appendChild(arrow);
    kindItem.onmouseenter = () => { kindItem.style.background = 'var(--hover)'; };
    kindItem.onmouseleave = () => { kindItem.style.background = ''; };
    kindItem.onclick = (e) => {
      e.stopPropagation();
      const rect = kindItem.getBoundingClientRect();
      menu.remove();
      showDeviceKindMenu(rect.right, rect.top, s);
    };
    menu.appendChild(kindItem);
  }

  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

function renderGroupNode(
  group: SessionGroup,
  groups: SessionGroup[],
  sessions: SessionProfile[],
  container: HTMLElement,
) {
  const isCollapsed = collapsedGroups.has(group.id);
  const header = document.createElement('div');
  header.className = 'entry';
  header.style.fontWeight = 'bold';
  header.style.userSelect = 'none';
  header.textContent = (isCollapsed ? '\u25b8 ' : '\u25be ') + '\ud83d\udcc1 ' + group.name;
  header.addEventListener('click', () => {
    if (collapsedGroups.has(group.id)) {
      collapsedGroups.delete(group.id);
    } else {
      collapsedGroups.add(group.id);
    }
    renderSessionList();
  });
  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    header.style.background = 'var(--hover)';
  });
  header.addEventListener('dragleave', () => {
    header.style.background = '';
  });
  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    header.style.background = '';
    const sessionId = e.dataTransfer?.getData('text/specter-session-id');
    if (!sessionId) return;
    const sessions = await App.ListSessions();
    const s = sessions.find((x) => x.id === sessionId);
    if (!s) return;
    await App.SaveSession({ ...s, groupId: group.id });
    collapsedGroups.add(group.id);
    renderSessionList();
  });
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupContextMenu(e.clientX, e.clientY, group);
  });
  container.appendChild(header);
  if (isCollapsed) return;
  const childGroups = groups.filter((g) => g.parentId === group.id);
  const childSessions = sessions.filter((s) => s.groupId === group.id);
  for (const cg of childGroups) {
    renderGroupNode(cg, groups, sessions, container);
  }
  for (const s of childSessions) {
    container.appendChild(renderSessionRow(s));
  }
}

function showGroupContextMenu(x: number, y: number, group: SessionGroup) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:140px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const renameItem = document.createElement('div');
  renameItem.textContent = 'Rename folder';
  renameItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  renameItem.onmouseenter = () => { renameItem.style.background = 'var(--hover)'; };
  renameItem.onmouseleave = () => { renameItem.style.background = ''; };
  renameItem.onclick = async () => {
    menu.remove();
    const newName = prompt('Rename folder:', group.name);
    if (!newName || newName === group.name) return;
    await App.SaveGroup({ ...group, name: newName });
    renderSessionList();
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete folder';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    if (!confirm(`Delete folder "${group.name}"? Sessions inside will be moved out, not deleted.`)) return;
    await App.DeleteGroup(group.id);
    renderSessionList();
  };

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

let sessionSearchQuery = '';
const collapsedGroups = new Set<string>();
let foldersInitialized = false;
let recentCollapsed = true;
let osc52Enabled = localStorage.getItem('specter-osc52') !== 'off';
let copyOnSelectEnabled = localStorage.getItem('specter-copy-on-select') === 'on';
let rightClickPasteEnabled = localStorage.getItem('specter-rclick-paste') !== 'off';
let highlightEnabled = localStorage.getItem('specter-highlight') !== 'off';

const HIGHLIGHT_RULES: [RegExp, string][] = [
  [/\b(connected|up|ok|success)\b/gi, '38;2;51;204;51'],   // bright green, MobaXterm-style
  [/\b(disabled|down|error|fail|failed)\b/gi, '38;2;229;72;77'], // red
  [/\b(warning)\b/gi, '38;2;210;153;34'],                   // yellow
  [/\b(?:Gi|Te|Fa|Fo|Hu|Po|Eth|Vlan)\d+(?:\/\d+)*\b/g, '38;2;198;120;221'], // magenta, interface/port identifiers
];

// Matches existing ANSI/OSC escape sequences so they can be preserved
// untouched. Covers CSI (colors, cursor movement: \x1b[...m etc.), OSC
// (window title: \x1b]...BEL or \x1b]...ST), and simple single-char
// escapes. Highlighting must never modify bytes inside these, doing so
// previously corrupted real prompts that use ANSI color codes (SPE-45).
// eslint-disable-next-line no-control-regex -- intentional: matching real ANSI/OSC escape sequences requires literal control chars
const ANSI_SEQUENCE_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-9;?]*[a-zA-Z]|[a-zA-Z0-9])/g;

function highlightPlainText(text: string): string {
  let result = text;
  for (const [pattern, code] of HIGHLIGHT_RULES) {
    result = result.replace(pattern, (match) => `\x1b[${code}m${match}\x1b[0m`);
  }
  return result;
}

function applyOutputHighlighting(text: string): string {
  if (!highlightEnabled) return text;
  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(ANSI_SEQUENCE_RE)) {
    const idx = match.index!;
    result += highlightPlainText(text.slice(lastIndex, idx));
    result += match[0]; // pass existing escape sequences through untouched
    lastIndex = idx + match[0].length;
  }
  result += highlightPlainText(text.slice(lastIndex));
  return result;
}

function writeToTerminal(tab: Tab, data: string) {
  tab.term!.write(applyOutputHighlighting(data));
}

// --- Disconnected-session panel (SPE-59) ---
// Mirrors MobaXterm's disconnect UI (see design-reference comment on the
// Linear ticket): the failure message and a divider are written into the
// terminal's own scrollback, real content that scrolls, copies, and saves
// like everything else, and a small non-modal panel with Reconnect /
// Save Output / Close Tab is anchored to the bottom of the pane. R / S /
// Enter work as shortcuts while the panel is open, matching MobaXterm's
// keyboard-driven flow.

function terminalTextContent(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

async function saveTabOutput(tab: Tab) {
  if (!tab.term) return;
  const content = terminalTextContent(tab.term);
  const defaultName = `${tab.label.replace(/[^a-zA-Z0-9._@-]+/g, '_')}.log`;
  try {
    await App.SaveTextFile(defaultName, content);
  } catch (err) {
    console.error('Failed to save terminal output', err);
  }
}

function clearDisconnectPanel(tab: Tab) {
  tab.stopped = false;
  tab.overlay?.remove();
  tab.overlay = null;
}

async function reconnectTab(tab: Tab) {
  if (!tab.reconnect) return;
  clearDisconnectPanel(tab);
  await tab.reconnect();
}

// Manual "Disconnect" (Terminal menu): closes the underlying session but
// keeps the tab open, showing the same SPE-59 panel a real drop would.
// Useful both as a real feature (deliberately kill a session without
// losing the tab/scrollback) and for testing the panel without having
// to pull a cable every time. Reuses CloseSSH/CloseSerial, which mark
// the close as deliberate on the backend (no ssh:closed/serial:closed
// event fires), so the panel is shown here on the frontend side instead.
async function disconnectTab(tab: Tab) {
  if (tab.stopped) return;
  if (tab.mode === 'ssh' && tab.backendId) {
    await App.CloseSSH(tab.backendId);
  } else if (tab.mode === 'serial' && tab.backendId) {
    await App.CloseSerial(tab.backendId);
  } else {
    return; // nothing live to disconnect (pending or local shell tabs)
  }
  showDisconnectPanel(tab, 'Disconnected.');
}

function showDisconnectPanel(tab: Tab, message: string) {
  if (!tab.term || !tab.container) return;
  tab.stopped = true;
  tab.status = 'disconnected';
  renderTabBar();

  const term = tab.term;
  const cols = term.cols || 80;
  const divider = '-'.repeat(cols);
  // Red inline message + divider, written as real terminal content so it
  // scrolls, copies, and saves like everything else in the session.
  term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
  term.write(`\x1b[36m${divider}\x1b[0m\r\n`);

  tab.overlay?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'disconnect-panel';

  const title = document.createElement('div');
  title.className = 'disconnect-title';
  title.textContent = 'Session stopped';
  overlay.appendChild(title);

  const actions: { key: string; label: string; run: () => void; enabled: boolean }[] = [
    { key: 'Enter', label: 'exit tab', run: () => closeTab(tab.id), enabled: true },
    { key: 'R', label: 'restart session', run: () => { reconnectTab(tab); }, enabled: !!tab.reconnect },
    { key: 'S', label: 'save terminal output to file', run: () => { saveTabOutput(tab); }, enabled: true },
  ];

  for (const action of actions) {
    if (!action.enabled) continue;
    const row = document.createElement('div');
    row.className = 'disconnect-action';
    const key = document.createElement('span');
    key.className = 'disconnect-key';
    key.textContent = action.key;
    row.appendChild(key);
    const label = document.createElement('span');
    label.textContent = `to ${action.label}`;
    row.appendChild(label);
    row.onclick = action.run;
    overlay.appendChild(row);
  }

  tab.container.appendChild(overlay);
  tab.overlay = overlay;
}

function sessionMatchesQuery(s: SessionProfile, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.host && s.host.toLowerCase().includes(q)) return true;
  if (s.serialPort && s.serialPort.toLowerCase().includes(q)) return true;
  if (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

async function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  await App.SaveGroup({ id: '', name, parentId: '' });
  renderSessionList();
}

async function renderSessionList() {
  const [sessions, groups] = await Promise.all([App.ListSessions(), App.ListGroups()]);
  if (!foldersInitialized) {
    for (const g of groups) collapsedGroups.add(g.id);
    foldersInitialized = true;
  }
  const list = document.getElementById('session-list')!;
  list.innerHTML = '';

  const query = sessionSearchQuery;
  const visibleSessions = sessions.filter((s) => sessionMatchesQuery(s, query));

  if (!query) {
    const recent = sessions
      .filter((s) => s.lastUsed)
      .sort((a, b) => (b.lastUsed! > a.lastUsed! ? 1 : -1))
      .slice(0, 5);
    if (recent.length > 0) {
      const header = document.createElement('div');
      header.className = 'entry';
      header.style.fontWeight = 'bold';
      header.style.userSelect = 'none';
      header.textContent = (recentCollapsed ? '\u25b8 ' : '\u25be ') + '\u23f1\ufe0f Recent';
      header.addEventListener('click', () => {
        recentCollapsed = !recentCollapsed;
        renderSessionList();
      });
      list.appendChild(header);
      if (!recentCollapsed) {
        for (const s of recent) {
          list.appendChild(renderSessionRow(s));
        }
      }
    }
  }

  const topGroups = groups.filter((g) => !g.parentId);
  for (const g of topGroups) {
    renderGroupNode(g, groups, visibleSessions, list);
  }

  const ungrouped = visibleSessions.filter((s) => !s.groupId);
  for (const s of ungrouped) {
    list.appendChild(renderSessionRow(s));
  }

  if (!query) {
    const addFolder = document.createElement('div');
    addFolder.className = 'entry';
    addFolder.style.cssText = 'opacity:0.6;cursor:pointer;font-size:12px;';
    addFolder.textContent = '+ New folder';
    addFolder.onclick = createNewFolder;
    list.appendChild(addFolder);
  }
}

// --- Host key trust modal ---

// SPE-63: masked passphrase entry, replacing window.prompt() which has
// no password mode and showed the passphrase in cleartext on-screen
// while typing. Mirrors showTrustPrompt's modal pattern below.
function showPassphrasePrompt(opts: { onSubmit: (passphrase: string) => void; onCancel: () => void }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border:2px solid #3a3a3a;border-radius:8px;padding:24px;max-width:380px;width:100%;color:#ddd;font-family:sans-serif;';

  const title = document.createElement('h3');
  title.style.cssText = 'margin-top:0;color:#ddd;';
  title.textContent = 'Encrypted key';
  box.appendChild(title);

  const label = document.createElement('p');
  label.textContent = 'This private key is encrypted. Enter its passphrase to continue.';
  box.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.autofocus = true;
  input.style.cssText = 'width:100%;box-sizing:border-box;background:#151515;border:1px solid #3a3a3a;color:#ddd;padding:6px 8px;font-size:13px;';
  box.appendChild(input);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { document.body.removeChild(overlay); opts.onCancel(); };
  const submitBtn = document.createElement('button');
  submitBtn.textContent = 'Continue';
  submitBtn.style.cssText = 'background:#3178c6;color:white;';
  const submit = () => { document.body.removeChild(overlay); opts.onSubmit(input.value); };
  submitBtn.onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') { document.body.removeChild(overlay); opts.onCancel(); }
  });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(submitBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  input.focus();
}

function showTrustPrompt(opts: {
  host: string; fingerprint: string; keyType: string; changed: boolean;
  onAccept: () => void; onReject: () => void;
}) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = `background:#1e1e1e;border:2px solid ${opts.changed ? '#e5484d' : '#3a3a3a'};border-radius:8px;padding:24px;max-width:480px;color:#ddd;font-family:sans-serif;`;
  const title = opts.changed ? '⚠️ Host key has CHANGED — possible security risk' : 'Unknown host — verify before connecting';
  box.innerHTML = `
    <h3 style="margin-top:0;color:${opts.changed ? '#e5484d' : '#ddd'}">${title}</h3>
    <p><strong>Host:</strong> ${opts.host}</p>
    <p><strong>Key type:</strong> ${opts.keyType}</p>
    <p><strong>Fingerprint:</strong> <code style="word-break:break-all;">${opts.fingerprint}</code></p>
    ${opts.changed
      ? '<p style="color:#e5484d;">This host previously presented a different key. This could mean the server was reinstalled — or that your connection is being intercepted. Only proceed if you\'re certain.</p>'
      : '<p>Verify this fingerprint matches what the server administrator provided before trusting it.</p>'}
  `;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const rejectBtn = document.createElement('button');
  rejectBtn.textContent = 'Cancel';
  rejectBtn.onclick = () => { document.body.removeChild(overlay); opts.onReject(); };
  const acceptBtn = document.createElement('button');
  acceptBtn.textContent = opts.changed ? 'I understand the risk — trust anyway' : 'Trust and connect';
  acceptBtn.style.cssText = opts.changed ? 'background:#e5484d;color:white;' : 'background:#3178c6;color:white;';
  acceptBtn.onclick = () => { document.body.removeChild(overlay); opts.onAccept(); };
  btnRow.appendChild(rejectBtn);
  btnRow.appendChild(acceptBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function showConnectError(message: string) {

  let el = document.getElementById('connect-error');

  if (!el) {

    el = document.createElement('div');

    el.id = 'connect-error';

    el.style.cssText = 'width:100%;color:#e5484d;font-size:12px;padding:2px 0;';

    document.getElementById('picker-ssh-fields')!.appendChild(el);

  }

  el.textContent = message;

}

function clearConnectError() {
  document.getElementById('connect-error')?.remove();
}

// --- Connect flow (targets the currently active pending tab) ---

// wireSSHEvents attaches the data/close listeners for a live SSH session
// and (re)installs the tab's reconnect closure, used both on first
// connect and after SPE-59's "R to restart session" action.
function wireSSHEvents(tab: Tab, sessionId: string, req: ConnectRequest) {
  runtime.EventsOn('ssh:data:' + sessionId, (data: unknown) => writeToTerminal(tab, data as string));
  runtime.EventsOn('ssh:closed:' + sessionId, (payload: unknown) => {
    showDisconnectPanel(tab, (payload as SessionClosedEvent).message);
  });
  tab.reconnect = () => reconnectSSH(tab, req);
}

// reconnectSSH re-runs Connect() on an already-live tab (as opposed to
// connectActiveTab, which targets a fresh pending tab and creates a new
// terminal). Reuses the existing terminal/container so scrollback from
// the dead session, including the disconnect message, stays visible.
async function reconnectSSH(tab: Tab, req: ConnectRequest): Promise<void> {
  tab.status = 'connecting';
  renderTabBar();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { reconnectSSH(tab, { ...req, passphrase }); },
      onCancel: () => showDisconnectPanel(tab, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await reconnectSSH(tab, req);
      },
      onReject: () => showDisconnectPanel(tab, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.sessionId) {
    tab.backendId = result.sessionId;
    tab.status = 'connected';
    renderTabBar();
    tab.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
    wireSSHEvents(tab, result.sessionId, req);
  }
}

async function connectActiveTab(req: ConnectRequest) {
  const tab = tabs.get(activeTabId!)!;
  tab.status = 'connecting';
  tab.label = `${req.user}@${req.host}`;
  renderTabBar();
  clearConnectError();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    tab.status = 'disconnected';
    renderTabBar();
    showConnectError(String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { connectActiveTab({ ...req, passphrase }); },
      onCancel: () => { tab.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await connectActiveTab(req);
      },
      onReject: () => { tab.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.sessionId) {
    tab.mode = 'ssh';
    tab.backendId = result.sessionId;
    tab.status = 'connected';
    createTerminalForTab(tab);
    wireSSHEvents(tab, result.sessionId, req);
    switchToTab(tab.id);
    refreshFileList('.', result.sessionId);

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({ id: '', name, host: req.host, port: req.port, user: req.user, keyPath: req.keyPath, deviceKind: currentDeviceKind() });
        renderSessionList();
      }
    }
    skipSavePrompt = false;
  }
}

document.getElementById('connect')!.addEventListener('click', async () => {
  const host = (document.getElementById('host') as HTMLInputElement).value;
  const user = (document.getElementById('user') as HTMLInputElement).value;
  const authMode = (document.querySelector('input[name="authmode"]:checked') as HTMLInputElement).value;

  let req: ConnectRequest;
  if (authMode === 'key') {
    const keyPath = (document.getElementById('keyPath') as HTMLInputElement).value;
    const passphrase = (document.getElementById('passphrase') as HTMLInputElement).value;
    req = { host, port: 22, user, keyPath, passphrase };
  } else {
    const password = (document.getElementById('password') as HTMLInputElement).value;
    req = { host, port: 22, user, password };
  }

  await connectActiveTab(req);

  if (authMode !== 'key') {

    const tab = tabs.get(activeTabId!);

    if (tab && tab.status === 'connected') {

      const password = (document.getElementById('password') as HTMLInputElement).value;

      passwordCache.set(passwordCacheKey(host, 22, user), password);

    }

  }
  if (pendingSessionName) {

    const tab = tabs.get(activeTabId!);

    if (tab) {

      tab.label = pendingSessionName;

      renderTabBar();

    }

    pendingSessionName = null;

  }

  closeSessionPicker();
});

// SPE-31: pre-1809 Windows (and any other local-shell startup failure)
// must show a clear error, not fail silently. Previously this had no
// error handling at all, a rejected StartLocalTerminal() call (e.g.
// ConPty's ErrConPtyUnsupported on old Windows) left the tab stuck in
// 'pending' forever with zero feedback, not a crash, but just as
// confusing for a first impression. Creates the terminal container up
// front so there's always somewhere to show the message, reuses the
// same disconnect panel SPE-59 built rather than a separate error UI.
async function startLocalShellInActiveTab(shell: string, label: string) {
  const tab = tabs.get(activeTabId!)!;
  tab.label = label;
  tab.mode = 'local';
  createTerminalForTab(tab);
  switchToTab(tab.id);

  let id: string;
  try {
    id = await App.StartLocalTerminal(shell);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }

  tab.backendId = id;
  tab.status = 'connected';
  renderTabBar();
  runtime.EventsOn('local:data:' + id, (data: unknown) => writeToTerminal(tab, data as string));
}

async function newLocalShellTab(shell: string, label: string) {
  const tab = createPendingTab();
  switchToTab(tab.id);
  await startLocalShellInActiveTab(shell, label);
}

// wireSerialEvents mirrors wireSSHEvents for serial console sessions,
// the direct-hardware-console analogue of a dropped SSH session (SPE-59).
function wireSerialEvents(tab: Tab, id: string, portName: string, baud: number) {
  runtime.EventsOn('serial:data:' + id, (data: unknown) => writeToTerminal(tab, data as string));
  runtime.EventsOn('serial:closed:' + id, (payload: unknown) => {
    showDisconnectPanel(tab, (payload as SessionClosedEvent).message);
  });
  tab.reconnect = () => reconnectSerial(tab, portName, baud);
}

async function reconnectSerial(tab: Tab, portName: string, baud: number): Promise<void> {
  tab.status = 'connecting';
  renderTabBar();
  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showDisconnectPanel(tab, String(err));
    return;
  }
  tab.backendId = id;
  tab.status = 'connected';
  renderTabBar();
  tab.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
  wireSerialEvents(tab, id, portName, baud);
}

async function connectSerialInActiveTab(portName: string, baud: number) {
  const tab = tabs.get(activeTabId!)!;
  tab.label = portName;
  const id = await App.ConnectSerial(portName, baud);
  tab.mode = 'serial';
  tab.backendId = id;
  tab.status = 'connected';
  createTerminalForTab(tab);
  wireSerialEvents(tab, id, portName, baud);
  switchToTab(tab.id);

  if (!skipSerialSavePrompt) {
    if (confirm(`Save this serial session as "${portName}"?`)) {
      await App.SaveSession({ id: '', name: portName, type: 'serial', serialPort: portName, baud });
      renderSessionList();
    }
  }
  skipSerialSavePrompt = false;
}



function checkCapsLock(e: KeyboardEvent) {

  const isCapsOn = e.getModifierState && e.getModifierState('CapsLock');

  document.getElementById('caps-lock-warning')!.style.display = isCapsOn ? 'block' : 'none';

}

document.addEventListener('keydown', checkCapsLock);

document.addEventListener('keyup', checkCapsLock);

document.getElementById('password')!.addEventListener('focus', () => {

  // Chrome/WebKit don't expose getModifierState on a plain focus event,

  // so send a synthetic check on the next keydown; also immediately hide

  // any stale warning left over from before this field was focused.

  document.getElementById('caps-lock-warning')!.style.display = 'none';

});



document.getElementById('picker-ssh-fields')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('connect')!.click();
  }
});

document.getElementById('browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) (document.getElementById('keyPath') as HTMLInputElement).value = path;
});

const authRadios = document.querySelectorAll('input[name="authmode"]') as NodeListOf<HTMLInputElement>;
authRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    const isKey = radio.value === 'key' && radio.checked;
    document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
    document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
  });
});

// --- Init: start with one pending tab ---
document.getElementById('app')!.classList.add('editor-collapsed');
let remoteFilesCollapsed = false;
document.getElementById('remote-files-header')!.addEventListener('click', () => {
  remoteFilesCollapsed = !remoteFilesCollapsed;
  document.getElementById('file-list')!.style.display = remoteFilesCollapsed ? 'none' : 'block';
  document.getElementById('remote-files-label')!.textContent = (remoteFilesCollapsed ? '\u25b8 ' : '\u25be ') + 'Remote files';
});
document.getElementById('remote-files-label')!.textContent = '\u25be Remote files';

const initialTab = createPendingTab();
switchToTab(initialTab.id);
document.getElementById('session-search')!.addEventListener('input', (e) => {
  sessionSearchQuery = (e.target as HTMLInputElement).value;
  renderSessionList();
});


const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
themeSelect.value = currentTheme();
applyTheme(currentTheme());
themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value as ThemeName);
});

// SPE-61: terminal color scheme, font, and wallpaper. Loaded from the
// backend-persisted settings.json (loadSettingsAndApply), independent
// of the dark/light UI toggle above once the user explicitly picks one.
const colorSchemeSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
colorSchemeSelect.addEventListener('change', () => {
  applyColorScheme(colorSchemeSelect.value as ColorScheme);
});

const fontSelect = document.getElementById('font-select') as HTMLSelectElement;
fontSelect.addEventListener('change', () => {
  applyFont(fontSelect.value);
});

document.getElementById('wallpaper-browse')!.addEventListener('click', async () => {
  const path = await App.SelectImageFile();
  if (!path) return;
  await setWallpaper(path);
});

const wallpaperOpacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
wallpaperOpacitySlider.addEventListener('input', () => {
  appSettings.wallpaperOpacity = Number(wallpaperOpacitySlider.value) / 100;
  applyWallpaperVisual();
});
wallpaperOpacitySlider.addEventListener('change', () => {
  App.SaveSettings(appSettings);
});

document.getElementById('wallpaper-clear')!.addEventListener('click', () => {
  clearWallpaper();
});

loadSettingsAndApply();

const osc52Toggle = document.getElementById('osc52-toggle') as HTMLInputElement;
osc52Toggle.checked = osc52Enabled;
osc52Toggle.addEventListener('change', () => {
  osc52Enabled = osc52Toggle.checked;
  localStorage.setItem('specter-osc52', osc52Enabled ? 'on' : 'off');
});

const copyOnSelectToggle = document.getElementById('copy-on-select-toggle') as HTMLInputElement;
copyOnSelectToggle.checked = copyOnSelectEnabled;
copyOnSelectToggle.addEventListener('change', () => {
  copyOnSelectEnabled = copyOnSelectToggle.checked;
  localStorage.setItem('specter-copy-on-select', copyOnSelectEnabled ? 'on' : 'off');
});

const rclickPasteToggle = document.getElementById('rclick-paste-toggle') as HTMLInputElement;
rclickPasteToggle.checked = rightClickPasteEnabled;
rclickPasteToggle.addEventListener('change', () => {
  rightClickPasteEnabled = rclickPasteToggle.checked;
  localStorage.setItem('specter-rclick-paste', rightClickPasteEnabled ? 'on' : 'off');
});

const highlightToggle = document.getElementById('highlight-toggle') as HTMLInputElement;
highlightToggle.checked = highlightEnabled;
highlightToggle.addEventListener('change', () => {
  highlightEnabled = highlightToggle.checked;
  localStorage.setItem('specter-highlight', highlightEnabled ? 'on' : 'off');
});

// --- Menu bar ---

function closeAllMenus() {
  document.querySelectorAll('#menubar .menu-dropdown').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('#menubar .menu-item').forEach((el) => el.classList.remove('open'));
}

document.querySelectorAll('#menubar .menu-item').forEach((item) => {
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = item.querySelector('.menu-dropdown')!;
    const wasOpen = dropdown.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) {
      dropdown.classList.add('open');
      item.classList.add('open');
    }
  });
});

// Frameless window (no OS title bar): #menubar doubles as the title bar
// via --wails-draggable:drag in CSS, these are the real window controls.
document.getElementById('win-minimize')!.addEventListener('click', () => {
  runtime.WindowMinimise();
});
document.getElementById('win-maximize')!.addEventListener('click', () => {
  runtime.WindowToggleMaximise();
});
document.getElementById('win-close')!.addEventListener('click', () => {
  runtime.Quit();
});
document.getElementById('titlebar-spacer')!.addEventListener('dblclick', () => {
  runtime.WindowToggleMaximise();
});

document.addEventListener('click', () => closeAllMenus());

// Terminal menu
document.getElementById('menu-new-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = createPendingTab();
  switchToTab(tab.id);
});
document.getElementById('menu-new-local-shell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Local shell');
});
document.getElementById('menu-close-tab')!.addEventListener('click', () => {
  closeAllMenus();
  if (activeTabId) closeTab(activeTabId);
});
document.getElementById('menu-disconnect-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) disconnectTab(tab);
});
document.getElementById('menu-clear-screen')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  tab?.term?.clear();
});

// Sessions menu
function resetPickerView() {
  document.getElementById('picker-grid')!.style.display = 'grid';
  document.getElementById('picker-ssh-fields')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'none';
}
function openSessionPicker() {
  resetPickerView();
  document.getElementById('session-picker-overlay')!.classList.add('open');
}
function closeSessionPicker() {
  document.getElementById('session-picker-overlay')!.classList.remove('open');
  resetPickerView();
}
function ensurePendingTab() {
  // The picker always operates on the current tab if it's already
  // pending (opened from a tab's own landing view); otherwise it
  // creates a fresh pending tab first (opened from the Sessions menu).
  const current = activeTabId ? tabs.get(activeTabId) : null;
  if (current && current.mode === 'pending') return current;
  const tab = createPendingTab();
  switchToTab(tab.id);
  return tab;
}

document.getElementById('menu-new-session')!.addEventListener('click', () => {
  closeAllMenus();
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('new-session-btn')!.addEventListener('click', () => {
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('session-picker-close')!.addEventListener('click', closeSessionPicker);
document.getElementById('session-picker-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('session-picker-overlay')) closeSessionPicker();
});
document.getElementById('picker-ssh')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-ssh-fields')!.style.display = 'flex';
});
document.getElementById('picker-serial')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'flex';
});
document.getElementById('serial-connect')!.addEventListener('click', async () => {
  const portName = (document.getElementById('serial-port') as HTMLInputElement).value;
  const baud = parseInt((document.getElementById('serial-baud') as HTMLSelectElement).value, 10);
  if (!portName) return;
  closeSessionPicker();
  await connectSerialInActiveTab(portName, baud);
});
document.getElementById('picker-shell')!.addEventListener('click', () => {
  ensurePendingTab();
  closeSessionPicker();
  startLocalShellInActiveTab('', 'Local shell');
});
document.getElementById('menu-new-folder')!.addEventListener('click', () => {
  closeAllMenus();
  createNewFolder();
});

// View menu
document.getElementById('menu-toggle-sidebar')!.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('app')!.style.gridTemplateColumns = '';
  currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];
  document.getElementById('app')!.classList.toggle('sidebar-collapsed');
  refitActiveTerminal();
});

// Tools menu: platform-aware, hide Command Prompt/PowerShell on non-Windows
App.GetPlatform().then((platform) => {
  if (platform !== 'windows') {
    document.getElementById('menu-tool-cmd')!.classList.add('disabled');
    document.getElementById('menu-tool-powershell')!.classList.add('disabled');
  }
});
document.getElementById('menu-tool-terminal')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Terminal');
});
document.getElementById('menu-tool-cmd')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('cmd.exe', 'Command Prompt');
});
document.getElementById('menu-tool-powershell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('powershell.exe', 'PowerShell');
});
document.getElementById('menu-tool-text-editor')!.addEventListener('click', () => {
  closeAllMenus();
  document.getElementById('app')!.classList.remove('editor-collapsed');
  openFilePath = null;
  openFileSessionId = null;
  document.getElementById('editor-path')!.textContent = 'Untitled';
  editor.setValue('');
  monaco.editor.setModelLanguage(editor.getModel()!, 'plaintext');
});

renderSessionList();let currentColumnTemplate = ['220px', '5px', '1fr', '5px', '1fr'];

function setupPaneResize(handleId: string, columnIndex: number, minWidth: number) {
  const handle = document.getElementById(handleId)!;
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const app = document.getElementById('app')!;
    const startX = e.clientX;
    // Only read the starting width of the column actually being dragged.
    // Reading/pinning ALL columns here would destroy the editor column's
    // 1fr flexibility on the very first drag, causing it to stop
    // absorbing remaining space and instead shift/shrink unexpectedly
    // whenever the OTHER handle was dragged afterward.
    const startWidth = parseFloat(getComputedStyle(app).gridTemplateColumns.split(' ')[columnIndex]);
    handle.classList.add('dragging');

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(minWidth, startWidth + delta);
      currentColumnTemplate[columnIndex] = `${newWidth}px`;
      app.style.gridTemplateColumns = currentColumnTemplate.join(' ');
      refitActiveTerminal();
    };
    const onMouseUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

setupPaneResize('resize-sidebar', 0, 150);
setupPaneResize('resize-editor', 2, 200);

renderSessionList();renderSessionList();
SPECTER_EOF_MAINTS

