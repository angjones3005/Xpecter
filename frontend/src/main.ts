import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
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
import type { RemoteFile, ConnectRequest, SessionProfile, SessionGroup, SessionClosedEvent, Settings, UpdateInfo, LocalShellProfile } from '../wailsjs.d.ts';

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
type ColorScheme = ThemeName | 'dracula' | 'nord' | 'solarized-dark' | 'solarized-light' | 'gruvbox-dark' | 'one-dark' | 'tokyo-night';

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
  'tokyo-night': {
    background: '#16161e', foreground: '#c0caf5', cursor: '#c0caf5',
    black: '#15161e', red: '#f7768e', green: '#41a6b5', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#73daca',
    brightYellow: '#ff9e64', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff',
    brightCyan: '#a4daff', brightWhite: '#c0caf5',
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

// Wallpaper mode uses xterm's canvas renderer, whose transparent theme can
// reveal the CSS image. WebGL owns an opaque canvas clear on WebView2, so it
// remains reserved for sessions without wallpaper rather than fighting the
// browser compositor.
function activeXtermTheme(): Record<string, string> {
  const base = TERMINAL_COLOR_SCHEMES[currentColorScheme()];
  if (!wallpaperActive()) return base;
  return { ...base, background: 'rgba(0, 0, 0, 0)' };
}

function refreshAllTerminalThemes() {
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      if (s.term) s.term.options.theme = activeXtermTheme();
    }
  }
}

function createWebglAddon(term: Terminal, onContextLoss?: () => void): WebglAddon | null {
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      onContextLoss?.();
    });
    term.loadAddon(webglAddon);
    return webglAddon;
  } catch (error) {
    console.warn('WebGL terminal renderer unavailable; using the default renderer.', error);
    return null;
  }
}

// SPE-77: zoom drives the same persisted appSettings.fontSize shown in
// Settings, not a separate temporary zoom layer, confirmed choice.
// Applies to every live tab (font size is global, not per-tab, same
// reasoning as refreshAllTerminalThemes above), refitting and notifying
// the backend of the new terminal size for each, mirroring what
// refitActiveTerminal does for a single tab.
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 13;

function applyFontSize(size: number) {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
  appSettings.fontSize = clamped;
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      if (!s.term || !s.fitAddon) continue;
      s.term.options.fontSize = clamped;
      s.fitAddon.fit();
      if (s.mode === 'local' && s.backendId) App.ResizeLocalTerminal(s.backendId, s.term.cols, s.term.rows);
      if (s.mode === 'ssh' && s.backendId) App.ResizeSSH(s.backendId, s.term.cols, s.term.rows);
    }
  }
  // SPE-78: editor shares the same font size setting as the terminal,
  // confirmed choice, not an independent editor-specific size.
  editor.updateOptions({ fontSize: clamped });
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;
  fontSizeSelect.value = String(clamped);
  App.SaveSettings(appSettings);
}

function zoomBy(delta: number) {
  applyFontSize((appSettings.fontSize || FONT_SIZE_DEFAULT) + delta);
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
  // SPE-61 originally only touched the terminal itself; the picker
  // should also cover the rest of the app chrome (sidebar, menus, tab
  // bar), otherwise the terminal font visibly doesn't match everything
  // around it.
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  refitActiveTerminal();
}

// Renders the wallpaper on each terminal's fixed host rather than the
// scrollable .xterm-viewport. The viewport's scroll height changes when
// the font size changes, which makes background-size: cover recompute its
// scale and center position. The host stays fixed while terminal content
// resizes, so the image remains visually anchored.
function wallpaperBackgroundImage(): string {
  if (!appSettings.wallpaperDataUrl) return '';
  const opacity = appSettings.wallpaperOpacity ?? 0.15;
  const dim = 1 - opacity;
  return `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${appSettings.wallpaperDataUrl}")`;
}

function applyWallpaperToSession(session: Session) {
  if (!session.term?.element) return;
  const termHost = session.term.element.parentElement as HTMLElement | null;
  const viewport = session.term.element.querySelector('.xterm-viewport') as HTMLElement | null;
  const screen = session.term.element.querySelector('.xterm-screen') as HTMLElement | null;
  if (!termHost || !viewport) return;
  const bg = wallpaperBackgroundImage();
  if (bg) {
    termHost.style.backgroundImage = bg;
    termHost.style.backgroundSize = '100% 100%';
    termHost.style.backgroundPosition = '0 0';
    viewport.style.backgroundImage = '';
  } else {
    termHost.style.backgroundImage = '';
    viewport.style.backgroundImage = '';
  }
  viewport.style.backgroundColor = 'transparent';
  if (screen) screen.style.backgroundColor = 'transparent';
  session.term.element.style.backgroundColor = 'transparent';
}

function applyRendererMode(session: Session) {
  if (!session.term) return;
  const shouldUseWebgl = !wallpaperActive();
  if (shouldUseWebgl && !session.webglAddon) {
    session.webglAddon = createSessionWebglAddon(session);
  } else if (!shouldUseWebgl && session.webglAddon) {
    session.webglAddon.dispose();
    session.webglAddon = null;
  }
}

function createSessionWebglAddon(session: Session): WebglAddon | null {
  if (!session.term) return null;
  return createWebglAddon(session.term, () => {
    session.webglAddon = null;
    if (!wallpaperActive()) {
      window.setTimeout(() => {
        if (!wallpaperActive() && session.term && !session.webglAddon) {
          session.webglAddon = createSessionWebglAddon(session);
        }
      }, 250);
    }
  });
}

function applyWallpaperVisual() {
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      applyRendererMode(s);
      applyWallpaperToSession(s);
    }
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

  const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
  keepaliveToggle.checked = !appSettings.sshKeepaliveDisabled;
  document.getElementById('session-log-clear-row')!.style.display = appSettings.sessionLogDirectory ? 'block' : 'none';

  const keepOpenToggle = document.getElementById('keep-open-last-tab-toggle') as HTMLInputElement;
  keepOpenToggle.checked = !!appSettings.keepOpenOnLastTab;

  const initialSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;
  fontSizeSelect.value = String(initialSize);

  // In case a tab was created before this async load resolved (race:
  // GetSettings is an IPC round-trip), reapply font to whatever's live.
  // refreshAllTerminalThemes (called by applyWallpaperVisual above)
  // already handles color.
  const stack = fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value);
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  // Same race-condition reasoning for font SIZE: the editor was created
  // synchronously at module load, before this async settings load
  // resolved, and terminal tabs may exist too if one connected fast.
  const savedFontSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  editor.updateOptions({ fontSize: savedFontSize });
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontSize = savedFontSize;
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
    if (!tab) return;
    for (const s of allSessions(tab)) {
      if (!s.fitAddon || !s.term) continue;
      s.fitAddon.fit();
      s.term.refresh(0, s.term.rows - 1);
      if (s.mode === 'local' && s.backendId) App.ResizeLocalTerminal(s.backendId, s.term.cols, s.term.rows);
      if (s.mode === 'ssh' && s.backendId) App.ResizeSSH(s.backendId, s.term.cols, s.term.rows);
    }
  });
}

function currentTheme(): ThemeName {
  const saved = localStorage.getItem('specter-theme');
  return saved === 'light' ? 'light' : 'dark';
}


const App = window.go.main.App;
const runtime = window.runtime;

// Fetched once and reused everywhere a platform check is needed
// (Tools menu, Clear Screen), rather than a fresh IPC round trip per
// use. Declared this early (right after the App binding) specifically
// so it's safe to reference from handlers defined earlier in this file
// too, a `let`/`const` referenced before its own declaration line has
// run throws a temporal-dead-zone error that silently halts all script
// execution after it, confirmed the hard way with a past bug in this
// same file (see the SPE-96 sidebar-position removal history).
const platformPromise = App.GetPlatform();

// --- Tab model ---
// Each tab owns its own xterm.js Terminal + backend session (SSH session ID
// or local terminal ID). 'pending' tabs show the connect form instead of a
// live terminal, until Connect/StartLocalTerminal resolves them.

type TabMode = 'pending' | 'local' | 'ssh' | 'serial';
type TabStatus = 'connecting' | 'connected' | 'disconnected';

// SPE-92: Session describes everything a single live terminal needs.
// Both Tab (a tab's own primary session) and Pane (an additional split
// pane) satisfy this shape structurally, so functions that only need
// to read/write one live terminal's own state (writeToTerminal,
// showDisconnectPanel, setupCustomScrollbar, the paste guard, keyboard
// handling, reconnect, etc.) take a Session and work identically
// whether called for a whole tab or one split pane inside it. No
// existing single-pane logic is rewritten, only its parameter type is
// widened.
interface Session {
  id: string;
  mode: TabMode;
  backendId: string | null; // sessionId (ssh) or local terminal id
  label: string;
  status: TabStatus;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  webglAddon: WebglAddon | null;
  disposeScrollbar: (() => void) | null;
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
  // The Tab (in the `tabs` map) this session lives inside, itself for
  // a Tab's own primary session. Looked up fresh every time rather
  // than storing a pane index directly, since closing a sibling pane
  // shifts indices, a stored index would go stale.
  ownerTabId: string;
}

// A split pane alongside a tab's primary session. Same shape as
// Session, kept as its own name for clarity at call sites.
type Pane = Session;

type Layout = 'single' | '2v' | '2h' | '4';

interface Tab extends Session {
  // 'single' (default): behaves exactly as before this feature
  // existed, just this tab's own Session fields above, no extraPanes.
  // '2v'/'2h'/'4' show extraPanes alongside it in a fixed CSS grid.
  layout: Layout;
  extraPanes: Pane[];
  // 0 = the tab's own primary session; 1..extraPanes.length index into
  // extraPanes. Drives which session receives keyboard input/paste and
  // which pane shows a focus outline.
  focusedPaneIndex: number;
  // Wrapping grid element for every session's pane-wrapper, created
  // once a tab's first session starts connecting. A 1-cell grid looks
  // identical to a plain block container, so this exists even for
  // 'single' tabs, one uniform code path rather than two.
  paneGrid: HTMLDivElement | null;
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let tabCounter = 0;

function newTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function createPendingTab(): Tab {
  const id = newTabId();
  const tab: Tab = {
    id,
    mode: 'pending',
    backendId: null,
    label: 'New Tab',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    webglAddon: null,
    disposeScrollbar: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
    ownerTabId: id,
    layout: 'single',
    extraPanes: [],
    focusedPaneIndex: 0,
    paneGrid: null,
  };
  tabs.set(tab.id, tab);
  return tab;
}

// --- Pane helpers (SPE-92) ---

function allSessions(tab: Tab): Session[] {
  return [tab, ...tab.extraPanes];
}

function focusedSession(tab: Tab): Session {
  return tab.focusedPaneIndex === 0 ? tab : tab.extraPanes[tab.focusedPaneIndex - 1];
}

// 0 for the tab's own primary session, 1-based into extraPanes
// otherwise. Computed fresh every call rather than cached, see the
// ownerTabId comment on Session above.
function paneIndexOf(tab: Tab, session: Session): number {
  if (session === tab) return 0;
  return 1 + tab.extraPanes.indexOf(session as Pane);
}

// SPE-97: opt-in (defaults off), a numbered badge is a minor visual
// addition, not a safety/correctness feature, so it follows the
// opt-in convention rather than the default-on one.
let showTabNumbersEnabled = localStorage.getItem('specter-show-tab-numbers') === 'on';

function renderTabBar() {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  let tabIndex = 0;
  for (const tab of tabs.values()) {
    tabIndex++;
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.onclick = () => switchToTab(tab.id);

    if (showTabNumbersEnabled) {
      const num = document.createElement('span');
      num.textContent = String(tabIndex);
      num.style.cssText = 'opacity:0.5;font-size:10px;margin-right:5px;';
      el.appendChild(num);
    }

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

  // SPE-92: reactive re-render of the active tab's pane headers
  // (label/status/focus), same "just re-render on every call" pattern
  // as the tab-row loop above.
  const active = activeTabId ? tabs.get(activeTabId) : null;
  if (active) {
    allSessions(active).forEach((s, i) => {
      const wrapper = s.container;
      if (!wrapper) return;
      const labelEl = wrapper.querySelector('.pane-header-label');
      if (labelEl) {
        labelEl.textContent = (s.mode === 'local' ? '💻 ' : s.mode === 'ssh' ? '🌐 ' : s.mode === 'serial' ? '🔌 ' : '') + s.label;
      }
      wrapper.classList.toggle('focused', active.layout !== 'single' && i === active.focusedPaneIndex);
    });
  }
}

function switchToTab(id: string) {
  activeTabId = id;
  const tab = tabs.get(id)!;

  // Hide every tab's pane grid, show only the active one (or the
  // connect form if this tab hasn't connected yet).
  document.querySelectorAll('.tab-pane-grid').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  document.getElementById('tab-landing')!.style.display = tab.mode === 'pending' ? 'flex' : 'none';

  if (tab.paneGrid) {
    tab.paneGrid.style.display = 'grid';
    for (const s of allSessions(tab)) {
      s.fitAddon?.fit();
      if (s.mode === 'ssh' && s.backendId && s.term) App.ResizeSSH(s.backendId, s.term.cols, s.term.rows);
      if (s.mode === 'local' && s.backendId && s.term) App.ResizeLocalTerminal(s.backendId, s.term.cols, s.term.rows);
    }
  }

  const focused = focusedSession(tab);
  if (focused.mode === 'ssh' && focused.backendId) {
    refreshFileList('.', focused.backendId);
  }

  renderTabBar();
}

// Shared backend-close + local cleanup for one Session, used by both
// closeTab (loops over every session in the tab) and closePane
// (closes just one split pane, leaving the tab and its other panes
// open).
async function closeSessionBackend(s: Session) {
  if (s.mode === 'ssh' && s.backendId) {
    await App.CloseSSH(s.backendId);
    runtime.EventsOff('ssh:data:' + s.backendId, 'ssh:closed:' + s.backendId);
  }
  if (s.mode === 'local' && s.backendId) await App.CloseLocalTerminal(s.backendId);
  if (s.mode === 'serial' && s.backendId) {
    await App.CloseSerial(s.backendId);
    runtime.EventsOff('serial:data:' + s.backendId, 'serial:closed:' + s.backendId);
  }
  s.disposeScrollbar?.();
  s.disposeScrollbar = null;
  s.webglAddon?.dispose();
  s.webglAddon = null;
  s.overlay?.remove();
  s.term?.dispose();
  s.container?.remove();
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;

  // SPE-81: only prompt if something in this tab is genuinely live, not
  // the disconnect panel's own "exit tab" action, and not a
  // pending/never-connected tab, matching the ticket's own scope note.
  const anyConnected = allSessions(tab).some((s) => s.status === 'connected' && !s.stopped);
  if (anyConnected) {
    const what = tab.extraPanes.length > 0 ? 'One or more panes are' : 'The session is';
    const proceed = confirm(`Close this tab? ${what} still connected (${tab.label}).`);
    if (!proceed) return;
  }

  for (const s of allSessions(tab)) await closeSessionBackend(s);
  tab.paneGrid?.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      if (appSettings.keepOpenOnLastTab) {
        const fresh = createPendingTab();
        switchToTab(fresh.id);
      } else {
        runtime.Quit();
      }
    }
  } else {
    renderTabBar();
  }
}

// SPE-92: closes one split pane, keeping the tab (and its other panes)
// open. paneIndex 0 always means the tab's own primary session, closing
// that closes the whole tab, same as closing any single-pane tab always
// has.
async function closePane(tab: Tab, paneIndex: number) {
  if (paneIndex === 0) {
    await closeTab(tab.id);
    return;
  }
  const pane = tab.extraPanes[paneIndex - 1];
  if (!pane) return;
  if (pane.status === 'connected' && !pane.stopped) {
    const proceed = confirm(`Close this pane? The session is still connected (${pane.label}).`);
    if (!proceed) return;
  }
  await closeSessionBackend(pane);
  tab.extraPanes.splice(paneIndex - 1, 1);
  if (tab.extraPanes.length === 0) tab.layout = 'single';
  if (tab.focusedPaneIndex >= tab.extraPanes.length + 1) {
    tab.focusedPaneIndex = tab.extraPanes.length;
  }
  applyPaneGridLayout(tab);
  if (activeTabId === tab.id) switchToTab(tab.id);
  else renderTabBar();
}

// SPE-92: when set, the next New Session picker flow (SSH connect,
// local shell, or serial connect) targets this pane instead of the
// active tab's own primary session. Set by openSplitPanePicker, reset
// to null by openSessionPicker (the ordinary New-Session-from-menu
// flow), so a stale target can never leak into an unrelated later
// connect.
let pendingPaneTarget: Pane | null = null;

function createEmptyPane(tab: Tab): Pane {
  return {
    id: newTabId(),
    mode: 'pending',
    backendId: null,
    label: 'New Pane',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    webglAddon: null,
    disposeScrollbar: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
    ownerTabId: tab.id,
  };
}

function ensurePaneGrid(tab: Tab) {
  if (tab.paneGrid) return;
  const grid = document.createElement('div');
  grid.className = 'tab-pane-grid';
  grid.style.display = 'none'; // switchToTab shows it once this tab is active
  document.getElementById('terminal')!.appendChild(grid);
  tab.paneGrid = grid;
}

function buildPaneHeader(session: Session, tab: Tab): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'pane-header';
  header.style.display = tab.layout === 'single' ? 'none' : 'flex';
  const labelEl = document.createElement('span');
  labelEl.className = 'pane-header-label';
  labelEl.textContent = session.label;
  header.appendChild(labelEl);
  const closeEl = document.createElement('span');
  closeEl.className = 'pane-header-close';
  closeEl.textContent = '\u2715';
  closeEl.title = 'Close pane';
  closeEl.onclick = (e) => {
    e.stopPropagation();
    closePane(tab, paneIndexOf(tab, session));
  };
  header.appendChild(closeEl);
  return header;
}

// Empty placeholder for a freshly split pane: header + a "+ New
// Session" button, no live Terminal yet. createTerminalForSession
// reuses this same wrapper once a session is actually chosen, rather
// than creating a second one, so nothing needs tearing down.
function createPaneShell(pane: Pane, tab: Tab) {
  ensurePaneGrid(tab);
  const wrapper = document.createElement('div');
  wrapper.className = 'pane-wrapper';
  wrapper.appendChild(buildPaneHeader(pane, tab));

  const landing = document.createElement('div');
  landing.className = 'pane-landing';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pane-landing-btn';
  btn.textContent = '+ New Session';
  btn.onclick = () => openSplitPanePicker(pane);
  landing.appendChild(btn);
  wrapper.appendChild(landing);

  // No term-host here: this pane has no live session yet, and a
  // term-host with flex:1 would otherwise compete with the landing
  // placeholder above (both flex:1, both visible at once) for the same
  // space. createTerminalForSession creates the real term-host once a
  // session is actually chosen, removing this landing div then.
  wrapper.addEventListener('mousedown', () => focusPane(tab, paneIndexOf(tab, pane)));
  tab.paneGrid!.appendChild(wrapper);
  pane.container = wrapper;
}

function focusPane(tab: Tab, paneIndex: number) {
  if (tab.focusedPaneIndex === paneIndex) return;
  tab.focusedPaneIndex = paneIndex;
  renderTabBar();
}

// Pure layout-geometry update for a tab's paneGrid CSS grid-template.
// Never touches any session's term/container/backend, safe to call any
// time the layout or pane count changes.
function applyPaneGridLayout(tab: Tab) {
  if (!tab.paneGrid) return;
  const cols = tab.layout === '2v' || tab.layout === '4' ? '1fr 1fr' : '1fr';
  const rows = tab.layout === '2h' || tab.layout === '4' ? '1fr 1fr' : '1fr';
  tab.paneGrid.style.gridTemplateColumns = cols;
  tab.paneGrid.style.gridTemplateRows = rows;
  for (const s of allSessions(tab)) {
    const header = s.container?.querySelector('.pane-header') as HTMLElement | null;
    if (header) header.style.display = tab.layout === 'single' ? 'none' : 'flex';
    const landing = s.container?.querySelector('.pane-landing') as HTMLElement | null;
    if (landing) landing.style.display = tab.layout === 'single' ? 'none' : 'flex';
  }
  if (activeTabId === tab.id) refitActiveTerminal();
}

// Switches a tab to a fixed target layout (SPE-92: single / 2 vertical
// / 2 horizontal / 4-pane grid), creating empty panes as needed or
// closing extra ones from the end if shrinking. New panes start empty
// (mode 'pending', showing a small "+ New Session" placeholder) rather
// than auto-opening the New Session picker for each one, so switching
// straight to a 4-pane grid doesn't stack three modals on top of each
// other.
async function setTabLayout(tab: Tab, layout: Layout) {
  // A still-pending tab (never connected its own primary session) has
  // no paneGrid yet and shows the big #tab-landing view instead. That
  // view and a newly split pane's own landing would otherwise both be
  // visible at once, stacked, pushing the new pane down the page.
  // Simplest correct fix: require the tab's own session first, split
  // afterward.
  if (layout !== 'single' && tab.mode === 'pending') {
    alert('Connect a session in this tab first, then split it into panes.');
    return;
  }

  const targetCount = layout === 'single' ? 1 : layout === '4' ? 4 : 2;
  const currentCount = 1 + tab.extraPanes.length;

  if (targetCount < currentCount) {
    const removing = tab.extraPanes.slice(targetCount - 1);
    const anyConnected = removing.some((p) => p.status === 'connected' && !p.stopped);
    if (anyConnected) {
      const proceed = confirm(`Switch layout? ${removing.length} connected pane(s) will be closed.`);
      if (!proceed) return;
    }
    for (const p of removing) await closeSessionBackend(p);
    tab.extraPanes = tab.extraPanes.slice(0, targetCount - 1);
  }

  tab.layout = layout;
  if (tab.focusedPaneIndex >= targetCount) tab.focusedPaneIndex = 0;

  ensurePaneGrid(tab);

  while (1 + tab.extraPanes.length < targetCount) {
    const pane = createEmptyPane(tab);
    tab.extraPanes.push(pane);
    createPaneShell(pane, tab);
  }

  applyPaneGridLayout(tab);
  if (activeTabId === tab.id) switchToTab(tab.id);
  else renderTabBar();
}

// Custom-drawn scrollbar (see the CSS comment above the .xterm-viewport
// rules for why this exists): the native scrollbar is hidden entirely,
// this is pure page content instead, so it looks and behaves
// identically across Linux/Windows/macOS regardless of what each
// platform's webview engine does or doesn't expose for native scrollbar
// styling.
function setupCustomScrollbar(session: Session) {
  if (!session.term || !session.container) return;
  const term = session.term;
  // Anchored to the term host (position:relative), not the outer pane
  // wrapper, since SPE-92 the wrapper also contains the pane header,
  // an absolutely-positioned track on the wrapper would overlay the
  // header too.
  const termHost = term.element?.parentElement;
  if (!termHost) return;

  const track = document.createElement('div');
  track.className = 'custom-scrollbar-track';
  const thumb = document.createElement('div');
  thumb.className = 'custom-scrollbar-thumb';
  track.appendChild(thumb);
  termHost.appendChild(track);

  function update() {
    const buffer = term.buffer.active;
    const totalLines = buffer.length;
    const rows = term.rows;
    if (totalLines <= rows) {
      track.style.display = 'none';
      return;
    }
    track.style.display = 'block';
    const trackHeight = track.clientHeight;
    const thumbHeightPct = Math.max(rows / totalLines, 0.03);
    const scrollableRange = buffer.baseY;
    const scrollPct = scrollableRange > 0 ? buffer.viewportY / scrollableRange : 0;
    thumb.style.height = `${Math.max(thumbHeightPct * trackHeight, 20)}px`;
    const thumbHeightPx = thumb.getBoundingClientRect().height || thumbHeightPct * trackHeight;
    thumb.style.top = `${scrollPct * (trackHeight - thumbHeightPx)}px`;
  }

  term.onScroll(update);
  term.onResize(update);
  // New output can extend the scrollable range without necessarily
  // firing onScroll (e.g. output arriving while already at the
  // bottom), refresh after every write too.
  term.onWriteParsed(update);
  // Redundant safety net: xterm.js's own onScroll event apparently
  // doesn't fire reliably for touchpad-driven scroll on Windows/WebView2
  // (confirmed by testing, content scrolled correctly but the thumb
  // never moved), even though mouse wheel and thumb-drag both worked.
  // Listening directly to .xterm-viewport's real DOM scroll event should
  // catch it regardless of what triggered the scroll, wheel, touchpad,
  // keyboard, programmatic, since it's the browser's own native event,
  // not xterm's internal one.
  const viewport = term.element?.querySelector('.xterm-viewport');
  viewport?.addEventListener('scroll', update);

  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollLine = 0;

  thumb.addEventListener('mousedown', (e) => {
    dragging = true;
    thumb.classList.add('dragging');
    dragStartY = e.clientY;
    dragStartScrollLine = term.buffer.active.viewportY;
    e.preventDefault();
  });
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const trackHeight = track.clientHeight;
    const thumbHeightPx = thumb.getBoundingClientRect().height;
    const usableTrack = Math.max(trackHeight - thumbHeightPx, 1);
    const deltaY = e.clientY - dragStartY;
    const deltaLines = (deltaY / usableTrack) * scrollableRange;
    const newLine = Math.round(dragStartScrollLine + deltaLines);
    term.scrollToLine(Math.min(scrollableRange, Math.max(0, newLine)));
  };
  const onMouseUp = () => {
    dragging = false;
    thumb.classList.remove('dragging');
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Click on the track itself (not the thumb) jumps to that position,
  // standard scrollbar behavior.
  track.addEventListener('mousedown', (e) => {
    if (e.target !== track) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const rect = track.getBoundingClientRect();
    const clickPct = (e.clientY - rect.top) / rect.height;
    term.scrollToLine(Math.round(clickPct * scrollableRange));
  });

  update();
  session.disposeScrollbar = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    viewport?.removeEventListener('scroll', update);
    track.remove();
  };
}

// SPE-80: warn before sending clipboard content containing multiple
// lines, since each line can execute as a separate command once it
// reaches a remote shell, a real safety net especially on network
// hardware where a pasted multi-line block could silently apply
// several config commands in sequence. Toggleable, matching the
// checkbox precedent this was modeled on; not everyone wants a prompt
// on every multi-line paste.
let warnMultilinePasteEnabled = localStorage.getItem('specter-warn-multiline-paste') !== 'off';

function writeToSessionWithPasteGuard(session: Session, text: string) {
  if (warnMultilinePasteEnabled) {
    const lines = text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
    if (lines.length > 1) {
      const proceed = confirm(`You're about to paste ${lines.length} lines. Each line may run as a separate command on the remote end. Continue?`);
      if (!proceed) return;
    }
  }
  if (session.mode === 'local' && session.backendId) App.WriteLocalTerminal(session.backendId, text);
  if (session.mode === 'ssh' && session.backendId) App.WriteSSH(session.backendId, text);
  if (session.mode === 'serial' && session.backendId) App.WriteSerial(session.backendId, text);
}

// SPE-92: creates (or fills in) the live xterm.js Terminal for one
// Session, whether that's a tab's own primary session (the original,
// unchanged behavior) or a split pane. If `session.container` already
// exists (a pane created via createPaneShell, still showing its "+ New
// Session" placeholder), that same wrapper/header is reused, its
// landing placeholder removed, rather than creating a second wrapper.
function createTerminalForSession(session: Session, tab: Tab) {
  ensurePaneGrid(tab);

  let wrapper = session.container;
  if (wrapper) {
    // Reused from createPaneShell's empty-landing placeholder: keep the
    // header, drop the landing button, the real term-host below is
    // always created fresh either way.
    wrapper.querySelector('.pane-landing')?.remove();
  } else {
    wrapper = document.createElement('div');
    wrapper.className = 'pane-wrapper';
    wrapper.appendChild(buildPaneHeader(session, tab));
    wrapper.addEventListener('mousedown', () => focusPane(tab, paneIndexOf(tab, session)));
    tab.paneGrid!.appendChild(wrapper);
  }

  const termHost = document.createElement('div');
  termHost.className = 'pane-term-host term-instance';
  termHost.style.cssText = 'padding:4px;box-sizing:border-box;position:relative;';
  wrapper.appendChild(termHost);
  const container = termHost;

  const term = new Terminal({
    allowTransparency: true,
    fontFamily: fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value),
    fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
    theme: activeXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  const webglAddon = wallpaperActive() ? null : createSessionWebglAddon(session);
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
  // SPE-92: split/close/focus-pane shortcuts, checked against every
  // existing binding (Ctrl+Shift+X/B/V, Ctrl+/-/0, F11), no collisions.
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (session.stopped) {
      if (e.type === 'keydown') {
        const key = e.key.toLowerCase();
        if (key === 'enter') closePane(tab, paneIndexOf(tab, session));
        else if (key === 'r') reconnectSession(session);
        else if (key === 's') saveSessionOutput(session);
      }
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      disconnectSession(session);
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      // Not plain Ctrl+B: that's tmux's default prefix key, binding it
      // globally would break every tmux user's workflow the moment
      // they're inside a session.
      toggleSidebar();
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      navigator.clipboard.readText().then((text) => writeToSessionWithPasteGuard(session, text)).catch(() => {});
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      // SPE-77. Accepts both '=' and '+' since Plus is Shift+Equals on
      // most layouts, matching how browsers handle Ctrl+= zoom too.
      zoomBy(1);
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === '-') {
      zoomBy(-1);
      return false;
    }
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey) && e.key === '0') {
      applyFontSize(FONT_SIZE_DEFAULT);
      return false;
    }
    if (e.type === 'keydown' && e.key === 'F11') {
      toggleFullscreen();
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      setTabLayout(tab, tab.layout === '2h' ? '4' : '2v');
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      setTabLayout(tab, tab.layout === '2v' ? '4' : '2h');
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
      closePane(tab, paneIndexOf(tab, session));
      return false;
    }
    if (e.type === 'keydown' && e.altKey && tab.layout !== 'single' && e.key.startsWith('Arrow')) {
      focusAdjacentPane(tab, e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown');
      return false;
    }
    return true;
  });

  // Right-click to paste (toggleable), matching PuTTY/most Linux terminal convention.
  container.addEventListener('contextmenu', (e) => {
    if (!rightClickPasteEnabled) return;
    e.preventDefault();
    App.GetClipboardText().then((text) => writeToSessionWithPasteGuard(session, text)).catch(() => {});
  });

  // Native browser paste (Ctrl+V, middle-click on Linux, right-click ->
  // Paste in some contexts, etc.), xterm.js listens for this itself and
  // would otherwise feed it straight through to onData below with no
  // multi-line awareness at all. Intercepted here instead, at capture
  // phase so it runs before xterm's own listener, so it goes through
  // the same guard as the other two paste paths above.
  container.addEventListener('paste', (e) => {
    if (!e.clipboardData) return; // let default handling proceed if unavailable
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text');
    if (text) writeToSessionWithPasteGuard(session, text);
  }, true);

  term.onData((data) => {
    if (session.mode === 'local' && session.backendId) App.WriteLocalTerminal(session.backendId, data);
    if (session.mode === 'ssh' && session.backendId) App.WriteSSH(session.backendId, data);
    if (session.mode === 'serial' && session.backendId) App.WriteSerial(session.backendId, data);
  });

  session.term = term;
  session.fitAddon = fitAddon;
  session.webglAddon = webglAddon;
  session.disposeScrollbar = null;
  session.container = wrapper;
  applyWallpaperToSession(session);
  setupCustomScrollbar(session);
}

// SPE-92: Alt+Arrow moves focus between panes by rough screen
// direction. With at most 4 panes in a fixed 2x2 grid, a simple
// left/right/up/down split on the current index covers every case,
// no real geometry needed.
function focusAdjacentPane(tab: Tab, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') {
  const count = 1 + tab.extraPanes.length;
  const i = tab.focusedPaneIndex;
  let next = i;
  if (tab.layout === '2v') {
    if (key === 'ArrowLeft' || key === 'ArrowRight') next = i === 0 ? 1 : 0;
  } else if (tab.layout === '2h') {
    if (key === 'ArrowUp' || key === 'ArrowDown') next = i === 0 ? 1 : 0;
  } else if (tab.layout === '4') {
    // Grid order: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    if (key === 'ArrowLeft') next = i % 2 === 1 ? i - 1 : i;
    if (key === 'ArrowRight') next = i % 2 === 0 ? i + 1 : i;
    if (key === 'ArrowUp') next = i >= 2 ? i - 2 : i;
    if (key === 'ArrowDown') next = i < 2 ? i + 2 : i;
  }
  if (next >= 0 && next < count) focusPane(tab, next);
}

let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;
    for (const s of allSessions(tab)) {
      if (!s.fitAddon || !s.term) continue;
      s.fitAddon.fit();
      if (s.mode === 'local' && s.backendId) App.ResizeLocalTerminal(s.backendId, s.term.cols, s.term.rows);
      if (s.mode === 'ssh' && s.backendId) App.ResizeSSH(s.backendId, s.term.cols, s.term.rows);
    }
  }, 100);
});

// --- Editor setup (shared across all tabs, VS Code-style) ---

const editor = monaco.editor.create(document.getElementById('editor')!, {
  value: '',
  language: 'plaintext',
  theme: MONACO_THEMES[currentTheme()],
  automaticLayout: true,
  // SPE-78: shares appSettings.fontSize with the terminal (confirmed
  // choice), appSettings isn't populated yet at this point in module
  // load order (loadSettingsAndApply is async), loadSettingsAndApply
  // re-applies the real value once it resolves, same race-condition
  // pattern already used for the terminal's own font-family sync.
  fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
});

function toggleEditorPane() {
  const app = document.getElementById('app')!;
  app.style.gridTemplateColumns = '';
  const collapsed = app.classList.toggle('editor-collapsed');
  app.style.setProperty('--ew', collapsed ? '0px' : (editorWidth ? `${editorWidth}px` : '1fr'));
  app.style.setProperty('--rew', collapsed ? '0px' : '5px');
  document.getElementById('editor-expand-btn')!.style.display = collapsed ? 'flex' : 'none';
  refitActiveTerminal();
}

document.getElementById('editor-close')!.addEventListener('click', toggleEditorPane);
document.getElementById('editor-expand-btn')!.addEventListener('click', toggleEditorPane);

document.getElementById('menu-toggle-editor')!.addEventListener('click', () => {
  closeAllMenus();
  toggleEditorPane();
});


let openFilePath: string | null = null;
let openFileSessionId: string | null = null;
// SPE-78: local file support alongside the existing remote (SSH) editing.
// openFileSessionId stays null for both "nothing open" and "a local file
// is open", this flag is what actually distinguishes the two.
let openFileIsLocal = false;

let editorStatusTimer: ReturnType<typeof setTimeout> | null = null;
function flashEditorStatus(msg: string, isError = false) {
  const el = document.getElementById('editor-status')!;
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  el.style.opacity = '1';
  if (editorStatusTimer) clearTimeout(editorStatusTimer);
  editorStatusTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// Shared tail end of opening a file, whether local or remote:
// language detection, showing/expanding the pane, loading content.
function finishOpeningFile(path: string, content: string) {
  document.getElementById('editor-path')!.textContent = path;
  document.getElementById('editor-close')!.style.display = 'inline';
  // The editor pane defaults to collapsed (nothing to show until a
  // file's actually open), opening one needs to explicitly restore it,
  // otherwise the content loads into Monaco invisibly behind a hidden
  // pane.
  const app = document.getElementById('app')!;
  app.classList.remove('editor-collapsed');
  app.style.setProperty('--ew', editorWidth ? `${editorWidth}px` : '1fr');
  app.style.setProperty('--rew', '5px');
  document.getElementById('editor-expand-btn')!.style.display = 'none';
  refitActiveTerminal();
  const ext = path.split('.').pop() ?? '';
  const langMap: Record<string, string> = {
    go: 'go', hs: 'haskell', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown',
  };
  monaco.editor.setModelLanguage(editor.getModel()!, langMap[ext] ?? 'plaintext');
  editor.setValue(content);
}

async function openRemoteFile(sessionId: string, path: string) {
  const content = await App.ReadRemoteFile(sessionId, path);
  openFilePath = path;
  openFileSessionId = sessionId;
  openFileIsLocal = false;
  finishOpeningFile(path, content);
}

async function openLocalFile() {
  const path = await App.SelectAnyFile();
  if (!path) return; // cancelled
  const content = await App.ReadLocalFile(path);
  openFilePath = path;
  openFileSessionId = null;
  openFileIsLocal = true;
  finishOpeningFile(path, content);
}

async function saveCurrentFile() {
  if (!openFilePath) {
    // Nothing open yet (Untitled), Save behaves like Save As rather
    // than silently doing nothing, matching most editors' convention.
    return saveAsLocal();
  }
  try {
    if (openFileIsLocal) {
      await App.WriteLocalFile(openFilePath, editor.getValue());
    } else if (openFileSessionId) {
      await App.WriteRemoteFile(openFileSessionId, openFilePath, editor.getValue());
    }
    flashEditorStatus('Saved');
  } catch (err) {
    flashEditorStatus(`Save failed: ${err}`, true);
  }
}

async function saveAsLocal() {
  const defaultName = openFilePath ? openFilePath.split(/[\\/]/).pop()! : 'Untitled.txt';
  const path = await App.SaveTextFile(defaultName, editor.getValue());
  if (!path) return; // cancelled
  openFilePath = path;
  openFileSessionId = null;
  openFileIsLocal = true;
  document.getElementById('editor-path')!.textContent = path;
  document.getElementById('editor-close')!.style.display = 'inline';
  flashEditorStatus('Saved');
}

async function saveAsRemote() {
  const activeTab = activeTabId ? tabs.get(activeTabId) : null;
  const sessionId = openFileSessionId ?? (activeTab ? focusedSession(activeTab).backendId : null);
  if (!sessionId) {
    alert('No active SSH session to save to. Open or switch to an SSH tab first.');
    return;
  }
  const defaultPath = openFilePath && !openFileIsLocal
    ? openFilePath
    : (currentRemotePath === '.' ? 'untitled.txt' : `${currentRemotePath}/untitled.txt`);
  const newPath = prompt('Save to remote path:', defaultPath);
  if (!newPath) return; // cancelled
  try {
    await App.WriteRemoteFile(sessionId, newPath, editor.getValue());
    openFilePath = newPath;
    openFileSessionId = sessionId;
    openFileIsLocal = false;
    document.getElementById('editor-path')!.textContent = newPath;
    document.getElementById('editor-close')!.style.display = 'inline';
    flashEditorStatus('Saved');
  } catch (err) {
    flashEditorStatus(`Save failed: ${err}`, true);
  }
}

document.getElementById('editor-open-btn')!.addEventListener('click', () => { openLocalFile(); });
document.getElementById('editor-save-btn')!.addEventListener('click', () => { saveCurrentFile(); });

const saveAsMenu = document.getElementById('editor-saveas-menu')!;
document.getElementById('editor-saveas-btn')!.addEventListener('click', (e) => {
  e.stopPropagation();
  saveAsMenu.style.display = saveAsMenu.style.display === 'block' ? 'none' : 'block';
});
document.getElementById('editor-saveas-local')!.addEventListener('click', () => {
  saveAsMenu.style.display = 'none';
  saveAsLocal();
});
document.getElementById('editor-saveas-remote')!.addEventListener('click', () => {
  saveAsMenu.style.display = 'none';
  saveAsRemote();
});
document.addEventListener('click', () => { saveAsMenu.style.display = 'none'; });

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveCurrentFile(); });

// --- File browser (scoped to whichever SSH tab is active) ---

let currentRemotePath = '.';
let currentRemoteSessionId: string | null = null;

// Computes the parent of a path built by ListDir's path.Join convention
// (plain relative strings, e.g. "logs", then "logs/subfolder", no
// leading "/" or "./"). Confirmed against the actual Go backend rather
// than assumed, this is exactly the kind of thing that's cheap to get
// wrong by guessing (see tonight's NSIS filename mismatch).
function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

async function refreshFileList(path = '.', sessionId?: string) {
  const id = sessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!id) return;
  currentRemotePath = path;
  currentRemoteSessionId = id;
  const entries: RemoteFile[] = await App.ListRemoteDir(id, path);
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  if (path !== '.') {
    const up = document.createElement('div');
    up.className = 'entry';
    up.textContent = '\ud83d\udcc1 ..';
    up.style.opacity = '0.8';
    up.onclick = () => refreshFileList(parentPath(path), id);
    list.appendChild(up);
  }
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = (e.isDir ? '\ud83d\udcc1 ' : '\ud83d\udcc4 ') + e.name;
    if (e.isDir) {
      div.onclick = () => refreshFileList(e.path, id);
    } else {
      div.title = 'Open in Specter; Shift-click to open with the system app';
      div.onauxclick = (event) => {
        if (event.button === 1) {
          void App.OpenRemoteFile(id, e.path).catch((err) => {
            flashEditorStatus(`External open failed: ${err}`, true);
          });
        }
      };
      div.onclick = (event) => {
        if (event instanceof MouseEvent && event.shiftKey) {
          void App.OpenRemoteFile(id, e.path).catch((err) => {
            flashEditorStatus(`External open failed: ${err}`, true);
          });
          return;
        }
        void openRemoteFile(id, e.path).catch((err) => {
          flashEditorStatus(`Open failed: ${err}`, true);
        });
      };
    }
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
      await App.UploadRemoteFile(currentRemoteSessionId, remotePath, base64, file.lastModified);
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
  (document.getElementById('device-kind-select') as HTMLSelectElement).value = kind;
}

function currentDeviceKind(): 'host' | 'switch' | 'firewall' {
  const value = (document.getElementById('device-kind-select') as HTMLSelectElement).value;
  if (value === 'switch') return 'switch';
  if (value === 'firewall') return 'firewall';
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

// SPE-92: clicking a saved session in the sidebar targets the
// currently focused pane if the active tab is split AND that pane is
// genuinely empty (nothing live to silently replace); otherwise
// behaves exactly as before, connecting into a plain new/pending tab.
function targetEmptyFocusedPane(): Pane | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.layout === 'single') return null;
  const focused = focusedSession(tab);
  if (focused === tab) return null; // pane 0 is the tab itself, not a split pane
  if (focused.mode !== 'pending') return null; // already live, don't silently replace it
  return focused as Pane;
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

  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
  } else {
    pendingPaneTarget = null;
    ensurePendingTab();
  }

  (document.getElementById('host') as HTMLInputElement).value = s.host ?? '';

  (document.getElementById('user') as HTMLInputElement).value = s.user ?? '';

  setDeviceKind(s.deviceKind === 'switch' ? 'switch' : s.deviceKind === 'firewall' ? 'firewall' : 'host');



  skipSavePrompt = true;



  if (s.keyPath || s.useAgent || s.internalAgent) {

    setAuthMode('key');

    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath ?? '';
    (document.getElementById('use-ssh-agent') as HTMLInputElement).checked = !!s.useAgent;
    (document.getElementById('use-internal-agent') as HTMLInputElement).checked = !!s.internalAgent;

    (document.getElementById('passphrase') as HTMLInputElement).value = '';

    await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', keyPath: s.keyPath, useAgent: s.useAgent, internalAgent: s.internalAgent });

    const connected = paneTarget ?? tabs.get(activeTabId!);

    if (connected) {

      connected.label = s.name;

      renderTabBar();

    }

  } else {

    setAuthMode('password');

    (document.getElementById('use-ssh-agent') as HTMLInputElement).checked = false;
    (document.getElementById('use-internal-agent') as HTMLInputElement).checked = false;

    const cacheKey = passwordCacheKey(s.host ?? '', s.port ?? 22, s.user ?? '');

    const cachedPassword = passwordCache.get(cacheKey);

    if (cachedPassword) {

      await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', password: cachedPassword });

      const connected = paneTarget ?? tabs.get(activeTabId!);

      if (connected) {

        connected.label = s.name;

        renderTabBar();

      }

    } else {

      pendingSessionName = s.name;

      openSessionPicker();

      // openSessionPicker() above always resets pendingPaneTarget to
      // null (it's the entry point for the ordinary New Session flow),
      // reassert the pane target here since this call is really the
      // "connect a saved session" flow reusing the picker's password
      // field, not a fresh New Session.
      pendingPaneTarget = paneTarget;

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
  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
  } else {
    pendingPaneTarget = null;
    ensurePendingTab();
  }
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

// SPE-62: single "Edit session" entry replaces the old Rename prompt()
// and Device-type flyout, both folded into the real edit dialog now.
function showSessionContextMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:120px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const editItem = document.createElement('div');
  editItem.textContent = 'Edit session';
  editItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  editItem.onmouseenter = () => { editItem.style.background = 'var(--hover)'; };
  editItem.onmouseleave = () => { editItem.style.background = ''; };
  editItem.onclick = () => {
    menu.remove();
    openSessionEditor(s);
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

  menu.appendChild(editItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

// --- Edit session dialog (SPE-62) ---

let sessionEditorTarget: SessionProfile | null = null;

function switchSessionEditorTab(tab: 'basic' | 'advanced') {
  document.querySelectorAll('#session-editor .editor-tab').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
  });
  document.getElementById('session-editor-tab-basic')!.style.display = tab === 'basic' ? 'flex' : 'none';
  document.getElementById('session-editor-tab-advanced')!.style.display = tab === 'advanced' ? 'flex' : 'none';
}

document.querySelectorAll('#session-editor .editor-tab').forEach((el) => {
  el.addEventListener('click', () => switchSessionEditorTab((el as HTMLElement).dataset.tab as 'basic' | 'advanced'));
});

async function openSessionEditor(s: SessionProfile) {
  sessionEditorTarget = s;
  const isSerial = s.type === 'serial';

  switchSessionEditorTab('basic');

  (document.getElementById('se-name') as HTMLInputElement).value = s.name;

  document.getElementById('se-ssh-basic-fields')!.style.display = isSerial ? 'none' : 'flex';
  document.getElementById('se-serial-basic-fields')!.style.display = isSerial ? 'flex' : 'none';
  // Device kind / key path only apply to SSH sessions, serial always
  // shows its own icon (matches the pre-SPE-62 context menu behavior).
  document.getElementById('se-ssh-advanced-fields')!.style.display = isSerial ? 'none' : 'flex';

  if (isSerial) {
    (document.getElementById('se-serial-port') as HTMLInputElement).value = s.serialPort ?? '';
    (document.getElementById('se-baud') as HTMLSelectElement).value = String(s.baud ?? 9600);
  } else {
    (document.getElementById('se-host') as HTMLInputElement).value = s.host ?? '';
    (document.getElementById('se-port') as HTMLInputElement).value = String(s.port ?? 22);
    (document.getElementById('se-user') as HTMLInputElement).value = s.user ?? '';
    (document.getElementById('se-keypath') as HTMLInputElement).value = s.keyPath ?? '';
    (document.getElementById('se-use-ssh-agent') as HTMLInputElement).checked = !!s.useAgent;
    (document.getElementById('se-use-internal-agent') as HTMLInputElement).checked = !!s.internalAgent;

    const deviceKindSelect = document.getElementById('se-devicekind-select') as HTMLSelectElement;
    const current = s.deviceKind === 'switch' || s.deviceKind === 'firewall' ? s.deviceKind : 'host';
    deviceKindSelect.value = current;
  }

  const groupSelect = document.getElementById('se-group') as HTMLSelectElement;
  groupSelect.innerHTML = '<option value="">No folder</option>';
  const groups = await App.ListGroups();
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    groupSelect.appendChild(opt);
  }
  groupSelect.value = s.groupId ?? '';

  document.getElementById('session-editor-overlay')!.classList.add('open');
}

function closeSessionEditor() {
  document.getElementById('session-editor-overlay')!.classList.remove('open');
  sessionEditorTarget = null;
}

document.getElementById('session-editor-close')!.addEventListener('click', closeSessionEditor);
document.getElementById('se-cancel')!.addEventListener('click', closeSessionEditor);
document.getElementById('session-editor-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('session-editor-overlay')) closeSessionEditor();
});

document.getElementById('se-browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) (document.getElementById('se-keypath') as HTMLInputElement).value = path;
});
document.getElementById('se-clear-key')!.addEventListener('click', () => {
  (document.getElementById('se-keypath') as HTMLInputElement).value = '';
});

document.getElementById('se-save')!.addEventListener('click', async () => {
  const s = sessionEditorTarget;
  if (!s) return;
  const name = (document.getElementById('se-name') as HTMLInputElement).value.trim();
  if (!name) return;

  const groupId = (document.getElementById('se-group') as HTMLSelectElement).value;
  const updated: SessionProfile = { ...s, name, groupId: groupId || undefined };

  if (s.type === 'serial') {
    updated.serialPort = (document.getElementById('se-serial-port') as HTMLInputElement).value.trim();
    updated.baud = parseInt((document.getElementById('se-baud') as HTMLSelectElement).value, 10);
  } else {
    updated.host = (document.getElementById('se-host') as HTMLInputElement).value.trim();
    updated.port = parseInt((document.getElementById('se-port') as HTMLInputElement).value, 10) || 22;
    updated.user = (document.getElementById('se-user') as HTMLInputElement).value.trim();
    const keyPath = (document.getElementById('se-keypath') as HTMLInputElement).value.trim();
    updated.keyPath = keyPath || undefined;
    updated.useAgent = (document.getElementById('se-use-ssh-agent') as HTMLInputElement).checked;
    updated.internalAgent = (document.getElementById('se-use-internal-agent') as HTMLInputElement).checked;
    updated.deviceKind = (document.getElementById('se-devicekind-select') as HTMLSelectElement).value as 'host' | 'switch' | 'firewall';
  }

  await App.SaveSession(updated);
  closeSessionEditor();
  renderSessionList();
});

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
// SPE-64: defaults OFF. OSC 52 lets whatever's running on the remote
// end write directly to the local OS clipboard with zero confirmation,
// including from a host you haven't decided to trust yet, the exact
// TOFU moment Specter's own host-key verification exists to gate.
// Opt-in via Settings for anyone who wants the convenience.
let osc52Enabled = localStorage.getItem('specter-osc52') === 'on';
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

function writeToTerminal(session: Session, data: string) {
  session.term!.write(applyOutputHighlighting(data));
  if (appSettings.sessionLogDirectory && session.backendId) {
    App.AppendSessionLog(appSettings.sessionLogDirectory, session.backendId, session.label, data).catch((err) => {
      console.error('Session log append failed', err);
    });
  }
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

async function saveSessionOutput(session: Session) {
  if (!session.term) return;
  const content = terminalTextContent(session.term);
  const defaultName = `${session.label.replace(/[^a-zA-Z0-9._@-]+/g, '_')}.log`;
  try {
    await App.SaveTextFile(defaultName, content);
  } catch (err) {
    console.error('Failed to save terminal output', err);
  }
}

function clearDisconnectPanel(session: Session) {
  session.stopped = false;
  session.overlay?.remove();
  session.overlay = null;
}

async function reconnectSession(session: Session) {
  if (!session.reconnect) return;
  clearDisconnectPanel(session);
  await session.reconnect();
}

// Manual "Disconnect" (Terminal menu): closes the underlying session but
// keeps the tab open, showing the same SPE-59 panel a real drop would.
// Useful both as a real feature (deliberately kill a session without
// losing the tab/scrollback) and for testing the panel without having
// to pull a cable every time. Reuses CloseSSH/CloseSerial, which mark
// the close as deliberate on the backend (no ssh:closed/serial:closed
// event fires), so the panel is shown here on the frontend side instead.
async function disconnectSession(session: Session) {
  if (session.stopped) return;
  if (session.mode === 'ssh' && session.backendId) {
    await App.CloseSSH(session.backendId);
  } else if (session.mode === 'serial' && session.backendId) {
    await App.CloseSerial(session.backendId);
  } else {
    return; // nothing live to disconnect (pending or local shell sessions)
  }
  showDisconnectPanel(session, 'Disconnected.');
}

function showDisconnectPanel(session: Session, message: string) {
  if (!session.term || !session.container) return;
  session.stopped = true;
  session.status = 'disconnected';
  renderTabBar();

  const term = session.term;
  const cols = term.cols || 80;
  const divider = '-'.repeat(cols);
  // Red inline message + divider, written as real terminal content so it
  // scrolls, copies, and saves like everything else in the session.
  term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
  term.write(`\x1b[36m${divider}\x1b[0m\r\n`);

  session.overlay?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'disconnect-panel';

  const title = document.createElement('div');
  title.className = 'disconnect-title';
  title.textContent = 'Session stopped';
  overlay.appendChild(title);

  const ownerTab = tabs.get(session.ownerTabId)!;
  const actions: { key: string; label: string; run: () => void; enabled: boolean }[] = [
    { key: 'Enter', label: 'exit pane', run: () => closePane(ownerTab, paneIndexOf(ownerTab, session)), enabled: true },
    { key: 'R', label: 'restart session', run: () => { reconnectSession(session); }, enabled: !!session.reconnect },
    { key: 'S', label: 'save terminal output to file', run: () => { saveSessionOutput(session); }, enabled: true },
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

  // Anchored to the term host (position:relative), same reasoning as
  // the custom scrollbar track above, the outer pane wrapper also
  // contains the header now.
  const termHost = term.element?.parentElement ?? session.container;
  termHost.appendChild(overlay);
  session.overlay = overlay;
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
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '4px';
      const arrow = document.createElement('span');
      arrow.textContent = recentCollapsed ? '\u25b8' : '\u25be';
      // Original document+clock icon (SPE-61-adjacent polish), not a
      // copy of any existing stock icon, replaces the stopwatch emoji
      // that was here before with something that reads more clearly as
      // "recently used" at this size.
      const icon = document.createElement('span');
      icon.style.cssText = 'display:inline-flex;width:14px;height:14px;flex:0 0 auto;';
      icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M14 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V8.5L14 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v4.5a1 1 0 0 0 1 1h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="8" y1="16.5" x2="13.5" y2="16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="8" y1="19" x2="12" y2="19" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="9.5" r="5.5" fill="var(--bg)" stroke="currentColor" stroke-width="1.6"/><path d="M8 6.3V9.5l2.3 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const label = document.createElement('span');
      label.textContent = 'Recent';
      header.appendChild(arrow);
      header.appendChild(icon);
      header.appendChild(label);
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
// SPE-65: soft warning for a group/world-readable key file, real
// OpenSSH refuses to use one outright, Specter warns but lets the user
// proceed, since it's their key and Specter didn't create the file.
function showKeyPermWarning(opts: { path: string; mode: string; onProceed: () => void; onCancel: () => void }) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1e1e1e;border:2px solid #d29922;border-radius:8px;padding:24px;max-width:480px;color:#ddd;font-family:sans-serif;';
  box.innerHTML = `
    <h3 style="margin-top:0;color:#d29922;">Key file permissions are too open</h3>
    <p><strong>Path:</strong> <code style="word-break:break-all;">${opts.path}</code></p>
    <p><strong>Mode:</strong> <code>${opts.mode}</code></p>
    <p>This private key is readable by other users on this system. OpenSSH itself would refuse to use a key like this. You can proceed anyway, but consider running <code>chmod 600 ${opts.path}</code>.</p>
  `;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { document.body.removeChild(overlay); opts.onCancel(); };
  const proceedBtn = document.createElement('button');
  proceedBtn.textContent = 'Use it anyway';
  proceedBtn.style.cssText = 'background:#d29922;color:#1e1e1e;';
  proceedBtn.onclick = () => { document.body.removeChild(overlay); opts.onProceed(); };
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(proceedBtn);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

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
function wireSSHEvents(session: Session, sessionId: string, req: ConnectRequest) {
  runtime.EventsOn('ssh:data:' + sessionId, (data: unknown) => writeToTerminal(session, data as string));
  runtime.EventsOn('ssh:closed:' + sessionId, (payload: unknown) => {
    showDisconnectPanel(session, (payload as SessionClosedEvent).message);
  });
  session.reconnect = () => reconnectSSH(session, req);
}

// reconnectSSH re-runs Connect() on an already-live tab (as opposed to
// connectActiveTab, which targets a fresh pending tab and creates a new
// terminal). Reuses the existing terminal/container so scrollback from
// the dead session, including the disconnect message, stays visible.
// SPE-99: shown after a successful connect/reconnect that only worked
// via the automatic legacy-algorithm fallback. Not something the
// person requested or predicted in advance, an honest one-time notice
// so "connected automatically" never means "silently weaker security
// without you knowing."
function notifyLegacyCompat(host: string) {
  alert(`Connected to ${host} using legacy compatibility mode: this device only supports older SSH algorithms, so this connection uses reduced security compared to Specter's normal defaults.`);
}

async function reconnectSSH(session: Session, req: ConnectRequest): Promise<void> {
  session.status = 'connecting';
  renderTabBar();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    showDisconnectPanel(session, String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { reconnectSSH(session, { ...req, passphrase }); },
      onCancel: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { reconnectSSH(session, { ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await reconnectSSH(session, req);
      },
      onReject: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.sessionId) {
    session.backendId = result.sessionId;
    session.status = 'connected';
    renderTabBar();
    session.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
    wireSSHEvents(session, result.sessionId, req);
    if (result.legacyCompat) notifyLegacyCompat(req.host);
  }
}

// SPE-92: connects into pendingPaneTarget if the New Session picker was
// opened via openSplitPanePicker (targets a specific split pane),
// otherwise into the active tab's own primary session, exactly as
// before this feature existed. Everything else (password cache,
// passphrase/trust/key-perm prompts, save-session prompt) is unchanged.
async function connectActiveTab(req: ConnectRequest) {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.status = 'connecting';
  target.label = `${req.user}@${req.host}`;
  renderTabBar();
  clearConnectError();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    target.status = 'disconnected';
    renderTabBar();
    showConnectError(String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { connectActiveTab({ ...req, passphrase }); },
      onCancel: () => { target.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { connectActiveTab({ ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => { target.status = 'disconnected'; renderTabBar(); },
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
      onReject: () => { target.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.sessionId) {
    target.mode = 'ssh';
    target.backendId = result.sessionId;
    target.status = 'connected';
    createTerminalForSession(target, ownerTab);
    wireSSHEvents(target, result.sessionId, req);
    if (result.connectDurationMs) {
      target.term?.write(`\r\n\x1b[90mSSH connected in ${result.connectDurationMs} ms.\x1b[0m\r\n`);
    }
    switchToTab(ownerTab.id);
    closeSessionPicker();
    if (target === focusedSession(ownerTab)) refreshFileList('.', result.sessionId);
    if (result.legacyCompat) notifyLegacyCompat(req.host);

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({ id: '', name, host: req.host, port: req.port, user: req.user, keyPath: req.keyPath, useAgent: req.useAgent, internalAgent: req.internalAgent, deviceKind: currentDeviceKind() });
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
    const useAgent = (document.getElementById('use-ssh-agent') as HTMLInputElement).checked;
    const internalAgent = (document.getElementById('use-internal-agent') as HTMLInputElement).checked;
    req = { host, port: 22, user, keyPath, passphrase, useAgent, internalAgent };
  } else {
    const password = (document.getElementById('password') as HTMLInputElement).value;
    req = { host, port: 22, user, password };
  }

  // SPE-92: the same session connectActiveTab just used, a split pane
  // if the picker was opened via openSplitPanePicker, otherwise the
  // active tab's own primary session, exactly as before this feature
  // existed.
  const connectedTarget: Session | undefined = pendingPaneTarget ?? tabs.get(activeTabId!);

  await connectActiveTab(req);

  if (authMode !== 'key') {

    if (connectedTarget && connectedTarget.status === 'connected') {

      const password = (document.getElementById('password') as HTMLInputElement).value;

      passwordCache.set(passwordCacheKey(host, 22, user), password);

    }

  }
  if (pendingSessionName) {

    if (connectedTarget) {

      connectedTarget.label = pendingSessionName;

      renderTabBar();

    }

    pendingSessionName = null;

  }
  // Bug fix: this used to unconditionally call closeSessionPicker()
  // here, but connectActiveTab legitimately returns early (still
  // "in progress" from the user's perspective) when it needs a
  // passphrase/trust/key-permission confirmation via a modal. Closing
  // the picker at that point yanked it shut mid-flow, before success
  // or failure was even known, silently hiding the eventual error
  // (showConnectError correctly wrote it into the picker's own DOM,
  // just inside a container the user could no longer see). Closing on
  // success now happens inside connectActiveTab itself, right where
  // success is actually determined, not here.
});

// SPE-31: pre-1809 Windows (and any other local-shell startup failure)
// must show a clear error, not fail silently. Previously this had no
// error handling at all, a rejected StartLocalTerminal() call (e.g.
// ConPty's ErrConPtyUnsupported on old Windows) left the tab stuck in
// 'pending' forever with zero feedback, not a crash, but just as
// confusing for a first impression. Creates the terminal container up
// front so there's always somewhere to show the message, reuses the
// same disconnect panel SPE-59 built rather than a separate error UI.
async function startLocalShellInActiveTab(shell: string, label: string, dir = '') {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.label = label;
  target.mode = 'local';
  createTerminalForSession(target, ownerTab);
  switchToTab(ownerTab.id);

  let id: string;
  try {
    id = await App.StartLocalTerminal(shell, dir);
  } catch (err) {
    showDisconnectPanel(target, String(err));
    return;
  }

  target.backendId = id;
  target.status = 'connected';
  renderTabBar();
  runtime.EventsOn('local:data:' + id, (data: unknown) => writeToTerminal(target, data as string));
}

async function newLocalShellTab(shell: string, label: string, dir = '') {
  // SPE-92: always targets the fresh tab just created here, not a
  // pendingPaneTarget left over from an earlier split (this entry
  // point doesn't go through the session picker, the one place that
  // normally resets it).
  pendingPaneTarget = null;
  const tab = createPendingTab();
  switchToTab(tab.id);
  await startLocalShellInActiveTab(shell, label, dir);
}

// SPE: lets a local shell start somewhere other than Specter's own
// working directory. A native folder picker rather than a free-text
// path field, avoids typos and matches the existing SelectKeyFile/
// SelectAnyFile pattern. Cancelling the picker just skips launching,
// rather than falling back to the default silently, the person asked
// for a specific directory and getting a different one without any
// signal would be more confusing than nothing happening.
async function newLocalShellInDirectory() {
  const dir = await App.SelectDirectory();
  if (!dir) return;
  const label = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
  await newLocalShellTab('', label, dir);
}

// wireSerialEvents mirrors wireSSHEvents for serial console sessions,
// the direct-hardware-console analogue of a dropped SSH session (SPE-59).
function wireSerialEvents(session: Session, id: string, portName: string, baud: number) {
  runtime.EventsOn('serial:data:' + id, (data: unknown) => writeToTerminal(session, data as string));
  runtime.EventsOn('serial:closed:' + id, (payload: unknown) => {
    showDisconnectPanel(session, (payload as SessionClosedEvent).message);
  });
  session.reconnect = () => reconnectSerial(session, portName, baud);
}

async function reconnectSerial(session: Session, portName: string, baud: number): Promise<void> {
  session.status = 'connecting';
  renderTabBar();
  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showDisconnectPanel(session, String(err));
    return;
  }
  session.backendId = id;
  session.status = 'connected';
  renderTabBar();
  session.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
  wireSerialEvents(session, id, portName, baud);
}

// Same bug class as the SSH connect flow above and SPE-31's local-shell
// fix: no error handling at all previously, and the picker was closed
// before this even ran, so a bad port left the user with zero feedback
// anywhere. Now shows the error via showConnectError (picker stays
// open, matching the SSH flow) rather than an unhandled rejection.
// SPE-92: targets pendingPaneTarget (a split pane) if set, otherwise
// the active tab's own primary session, same pattern as connectActiveTab.
async function connectSerialInActiveTab(portName: string, baud: number) {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.label = portName;

  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showConnectError(String(err));
    return;
  }

  target.mode = 'serial';
  target.backendId = id;
  target.status = 'connected';
  createTerminalForSession(target, ownerTab);
  wireSerialEvents(target, id, portName, baud);
  switchToTab(ownerTab.id);
  closeSessionPicker();

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

document.addEventListener('keydown', (e) => {
  // Global fallback for when no terminal has focus (the "No session
  // yet" landing screen, sidebar search box, etc.), the per-terminal
  // version above only fires while an xterm instance actually has
  // focus. Same Ctrl+Shift+B, not plain Ctrl+B (tmux's prefix key).
  if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  // SPE-77 zoom, same global-fallback reasoning.
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    zoomBy(1);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    zoomBy(-1);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    applyFontSize(FONT_SIZE_DEFAULT);
  }
  if (e.key === 'F11') {
    e.preventDefault();
    toggleFullscreen();
  }
});

document.getElementById('font-size-select')!.addEventListener('change', (e) => {
  applyFontSize(Number((e.target as HTMLSelectElement).value));
});

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

// --- Init: start with one pending tab, or a local shell rooted at the
// launch directory (SPE-86: Windows Explorer's "Open in Specter") ---
document.getElementById('app')!.classList.add('editor-collapsed');
document.getElementById('editor-expand-btn')!.style.display = 'flex';
let remoteFilesCollapsed = false;
document.getElementById('remote-files-header')!.addEventListener('click', () => {
  remoteFilesCollapsed = !remoteFilesCollapsed;
  document.getElementById('file-list')!.style.display = remoteFilesCollapsed ? 'none' : 'block';
  document.getElementById('remote-files-label')!.textContent = (remoteFilesCollapsed ? '\u25b8 ' : '\u25be ') + 'Remote files';
});
document.getElementById('remote-files-label')!.textContent = '\u25be Remote files';

const initialTab = createPendingTab();
switchToTab(initialTab.id);
// GetStartupDir() resolves near-instantly (it's a field read, no real
// I/O), but is still async over the Wails bridge, so the empty pending
// tab above renders first either way and this just fills it in a beat
// later. Folder name alone as the tab label (not the full path), same
// brevity as every other tab label in this app.
App.GetStartupDir().then((dir) => {
  if (dir) {
    const label = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
    startLocalShellInActiveTab('', label, dir);
  }
});
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

// SPE-98: one-click toggle in the title bar, alongside applyTheme,
// keeping the Settings dropdown in sync so neither path shows a stale
// value if the other one was used most recently.
function toggleThemeQuick() {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  themeSelect.value = next;
}
document.getElementById('theme-toggle-btn')!.addEventListener('click', toggleThemeQuick);

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

// Check-for-updates (not auto-update): one GitHub releases API check on
// launch, dismissible per-version so it doesn't nag every time once
// acknowledged, re-appears if a further newer version comes out later.
// manual=true (from the Settings menu item) always shows a result, even
// "you're up to date", and ignores any prior dismissal, since an
// explicit click should never appear to do nothing.
async function checkForUpdate(manual = false) {
  let info: UpdateInfo;
  try {
    info = await App.CheckForUpdate();
  } catch (err) {
    if (manual) alert(`Could not check for updates: ${err}`);
    return;
  }
  if (!info.available) {
    if (manual) alert(`You're up to date (${info.currentVersion}).`);
    return;
  }
  if (!manual && localStorage.getItem('specter-update-dismissed') === info.latestVersion) return;

  const banner = document.getElementById('update-banner')!;
  document.getElementById('update-banner-text')!.textContent =
    `A new version of Specter is available: ${info.latestVersion} (you're on ${info.currentVersion})`;
  banner.style.display = 'flex';

  const downloadBtn = document.getElementById('update-banner-download') as HTMLButtonElement;
  downloadBtn.textContent = 'Download';
  downloadBtn.disabled = false;
  downloadBtn.addEventListener('click', async () => {
    if (!info.assetUrl) {
      // No matching asset found for this platform (shouldn't normally
      // happen, but a real release could legitimately be missing one,
      // exactly like the NSIS installer did once tonight). Fall back to
      // the browser rather than doing nothing.
      runtime.BrowserOpenURL(info.releaseUrl);
      return;
    }
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading\u2026';
    try {
      await App.DownloadAndInstallUpdate(info.assetUrl);
      downloadBtn.textContent = 'Downloaded';
      // On Windows this is genuinely done, the installer is now open on
      // top of Specter. On macOS/Linux, a file manager window just
      // opened showing the extracted files, there's no single-file
      // "launch" without a real installer format.
    } catch (err) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
      alert(`Update download failed: ${err}\n\nYou can also grab it manually from the releases page.`);
    }
  });
  document.getElementById('update-banner-dismiss')!.addEventListener('click', () => {
    localStorage.setItem('specter-update-dismissed', info.latestVersion);
    banner.style.display = 'none';
  });
}
checkForUpdate();

App.GetVersion().then((v) => {
  document.getElementById('menu-version')!.textContent = v === 'dev' ? '(dev build)' : v;
});
document.getElementById('menu-check-updates')!.addEventListener('click', () => {
  closeAllMenus();
  checkForUpdate(true);
});

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

const warnMultilinePasteToggle = document.getElementById('warn-multiline-paste-toggle') as HTMLInputElement;
warnMultilinePasteToggle.checked = warnMultilinePasteEnabled;
warnMultilinePasteToggle.addEventListener('change', () => {
  warnMultilinePasteEnabled = warnMultilinePasteToggle.checked;
  localStorage.setItem('specter-warn-multiline-paste', warnMultilinePasteEnabled ? 'on' : 'off');
});

// SPE-79: unlike the toggles above, this one lives in the Go-backed
// config.Settings (App.SaveSettings), not localStorage, since Connect()
// needs to read it fresh from settings.json at connect time, not just
// the frontend's own in-memory state.
const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
keepaliveToggle.addEventListener('change', () => {
  appSettings.sshKeepaliveDisabled = !keepaliveToggle.checked;
  App.SaveSettings(appSettings);
});

const keepOpenToggle = document.getElementById('keep-open-last-tab-toggle') as HTMLInputElement;
keepOpenToggle.addEventListener('change', () => {
  appSettings.keepOpenOnLastTab = keepOpenToggle.checked;
  App.SaveSettings(appSettings);
});

document.getElementById('session-log-browse')!.addEventListener('click', async () => {
  const directory = await App.SelectDirectory();
  if (!directory) return;
  appSettings.sessionLogDirectory = directory;
  await App.SaveSettings(appSettings);
  document.getElementById('session-log-clear-row')!.style.display = 'block';
});

document.getElementById('session-log-clear')!.addEventListener('click', async () => {
  appSettings.sessionLogDirectory = '';
  await App.SaveSettings(appSettings);
  document.getElementById('session-log-clear-row')!.style.display = 'none';
});

document.getElementById('menu-reset-settings')!.addEventListener('click', async () => {
  closeAllMenus();
  if (!confirm('Reset appearance settings to defaults? Saved sessions will not be changed.')) return;
  appSettings = { sshKeepaliveDisabled: appSettings.sshKeepaliveDisabled, keepOpenOnLastTab: appSettings.keepOpenOnLastTab };
  await App.SaveSettings(appSettings);
  await loadSettingsAndApply();
});

const showTabNumbersToggle = document.getElementById('show-tab-numbers-toggle') as HTMLInputElement;
showTabNumbersToggle.checked = showTabNumbersEnabled;
showTabNumbersToggle.addEventListener('change', () => {
  showTabNumbersEnabled = showTabNumbersToggle.checked;
  localStorage.setItem('specter-show-tab-numbers', showTabNumbersEnabled ? 'on' : 'off');
  renderTabBar();
});

const highlightToggle = document.getElementById('highlight-toggle') as HTMLInputElement;
highlightToggle.checked = highlightEnabled;
highlightToggle.addEventListener('change', () => {
  highlightEnabled = highlightToggle.checked;
  localStorage.setItem('specter-highlight', highlightEnabled ? 'on' : 'off');
});

// --- Local shell profiles (SPE-102) ---

function localShellProfileIcon(icon?: string): string {
  switch (icon) {
    case 'powershell': return '\ud83d\udd37';
    case 'cmd': return '\u2b1b';
    case 'wsl': return '\ud83d\udc27';
    default: return '>_';
  }
}

// SPE-92: same targeting rule as useSSHSession/useSerialSession above,
// launches into the focused pane if the active tab is split and that
// pane is empty, otherwise a plain new tab exactly as before.
async function launchLocalShellProfile(p: LocalShellProfile) {
  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
    await startLocalShellInActiveTab(p.command, p.tabTitle || p.name, p.startingDir || '');
  } else {
    await newLocalShellTab(p.command, p.tabTitle || p.name, p.startingDir || '');
  }
}

async function renderLocalShellProfileList() {
  const profiles = await App.ListLocalShellProfiles();
  const list = document.getElementById('local-shell-profile-list')!;
  list.innerHTML = '';
  for (const p of profiles) {
    const row = document.createElement('div');
    row.className = 'session-entry';
    row.style.paddingLeft = '18px';

    const label = document.createElement('span');
    label.textContent = localShellProfileIcon(p.icon) + ' ' + p.name;
    label.style.flex = '1';
    label.onclick = () => launchLocalShellProfile(p);
    row.appendChild(label);

    const edit = document.createElement('span');
    edit.textContent = '\u270e';
    edit.className = 'delete-btn';
    edit.title = 'Edit';
    edit.onclick = (e) => {
      e.stopPropagation();
      openLocalShellProfileEditor(p);
    };
    row.appendChild(edit);

    const del = document.createElement('span');
    del.textContent = '\u2715';
    del.className = 'delete-btn';
    del.title = 'Delete';
    del.onclick = async (e) => {
      e.stopPropagation();
      await App.DeleteLocalShellProfile(p.id);
      renderLocalShellProfileList();
      renderLocalShellProfilesMenu();
    };
    row.appendChild(del);

    list.appendChild(row);
  }
}

async function renderLocalShellProfilesMenu() {
  const profiles = await App.ListLocalShellProfiles();
  const container = document.getElementById('menu-local-shell-profiles')!;
  container.innerHTML = '';
  for (const p of profiles) {
    const item = document.createElement('div');
    item.className = 'item';
    item.textContent = localShellProfileIcon(p.icon) + ' ' + p.name;
    item.onclick = () => {
      closeAllMenus();
      launchLocalShellProfile(p);
    };
    container.appendChild(item);
  }
}

// Handles both "New" (profile undefined) and "Edit" (profile passed).
// Save/Cancel/close/browse handlers are reassigned via .onclick rather
// than addEventListener each open, so repeated opens don't accumulate
// duplicate handlers.
function openLocalShellProfileEditor(profile?: LocalShellProfile) {
  const overlay = document.getElementById('lsp-editor-overlay')!;
  const title = document.getElementById('lsp-editor-title')!;
  const nameInput = document.getElementById('lsp-name') as HTMLInputElement;
  const commandInput = document.getElementById('lsp-command') as HTMLInputElement;
  const dirInput = document.getElementById('lsp-dir') as HTMLInputElement;
  const iconSelect = document.getElementById('lsp-icon') as HTMLSelectElement;
  const tabTitleInput = document.getElementById('lsp-tabtitle') as HTMLInputElement;

  title.textContent = profile ? 'Edit local shell profile' : 'New local shell profile';
  nameInput.value = profile?.name ?? '';
  commandInput.value = profile?.command ?? '';
  dirInput.value = profile?.startingDir ?? '';
  iconSelect.value = profile?.icon ?? '';
  tabTitleInput.value = profile?.tabTitle ?? '';

  overlay.classList.add('open');

  const close = () => overlay.classList.remove('open');

  (document.getElementById('lsp-browse-dir') as HTMLButtonElement).onclick = async () => {
    const dir = await App.SelectDirectory();
    if (dir) dirInput.value = dir;
  };

  (document.getElementById('lsp-save') as HTMLButtonElement).onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    await App.SaveLocalShellProfile({
      id: profile?.id ?? '',
      name,
      command: commandInput.value.trim(),
      startingDir: dirInput.value,
      icon: iconSelect.value,
      tabTitle: tabTitleInput.value.trim(),
    });
    close();
    renderLocalShellProfileList();
    renderLocalShellProfilesMenu();
  };

  (document.getElementById('lsp-cancel') as HTMLButtonElement).onclick = close;
  (document.getElementById('lsp-editor-close') as HTMLSpanElement).onclick = close;
}

document.getElementById('lsp-add-btn')!.addEventListener('click', () => openLocalShellProfileEditor());
document.getElementById('lsp-editor-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('lsp-editor-overlay')) {
    document.getElementById('lsp-editor-overlay')!.classList.remove('open');
  }
});

// --- Menu bar ---

function closeAllMenus() {
  document.querySelectorAll('#menubar .menu-dropdown').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('#menubar .menu-item').forEach((el) => el.classList.remove('open'));
}

document.querySelectorAll('#menubar .menu-item').forEach((item) => {
  item.addEventListener('mouseenter', () => {
    const anyMenuOpen = document.querySelector('#menubar .menu-dropdown.open');
    const dropdown = item.querySelector('.menu-dropdown')!;
    if (!anyMenuOpen || dropdown.classList.contains('open')) return;
    closeAllMenus();
    dropdown.classList.add('open');
    item.classList.add('open');
  });
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

// Bug fix: clicking anything inside an open dropdown (a <select>, a
// checkbox, the wallpaper Browse button) bubbled up to the document-level
// closeAllMenus() listener below and closed the whole panel immediately,
// only the .menu-item click (opening it) was protected with
// stopPropagation, not the dropdown's own contents. Apparently invisible
// on Linux/WebKitGTK's native <select> popup timing, but immediately
// visible on Windows/WebView2, reported as dropdowns "disappearing
// immediately" there.
document.querySelectorAll('#menubar .menu-dropdown').forEach((dropdown) => {
  dropdown.addEventListener('click', (e) => e.stopPropagation());
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
document.getElementById('menu-new-local-shell-in-dir')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellInDirectory();
});
document.getElementById('menu-manage-local-shell-profiles')!.addEventListener('click', () => {
  closeAllMenus();
  openLocalShellProfileEditor();
});
document.getElementById('menu-close-tab')!.addEventListener('click', () => {
  closeAllMenus();
  if (activeTabId) closeTab(activeTabId);
});
document.getElementById('menu-disconnect-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) disconnectSession(focusedSession(tab));
});
document.getElementById('menu-clear-screen')!.addEventListener('click', async () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab) return;
  const session = focusedSession(tab);
  // Bug: term.clear() only wipes xterm.js's own rendered buffer, it
  // never reaches the shell or, on Windows, ConPTY. ConPTY maintains
  // its own screen-buffer state (that's its whole job, translating the
  // legacy Win32 console API to VT), so a later resize makes it
  // recompute and redraw its visible viewport from that untouched
  // buffer, silently "un-clearing" the screen. Confirmed reproducible:
  // Clear Screen, then resize the window, and the old content is back.
  // The real fix, for local shells, is running the shell's own native
  // clear command, the same thing every other terminal app's "Clear
  // Screen" does under the hood, not a client-only buffer wipe. This
  // also keeps the shell's own idea of its scrollback consistent with
  // what's on screen, not just a fix for the resize case.
  // SSH and serial sessions aren't confirmed to have this bug (SSH
  // doesn't go through ConPTY at all, and there's no report of it on
  // serial), so they're left on the previous behavior for now.
  if (session.mode === 'local' && session.backendId) {
    const platform = await platformPromise;
    App.WriteLocalTerminal(session.backendId, platform === 'windows' ? 'cls\r' : 'clear\r');
  } else {
    session.term?.clear();
  }
});

// Sessions menu
function resetPickerView() {
  document.getElementById('picker-grid')!.style.display = 'grid';
  document.getElementById('picker-ssh-fields')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'none';
}
function openSessionPicker() {
  // SPE-92: an ordinary New Session, targets the active tab's own
  // primary session, never a leftover split-pane target from earlier.
  pendingPaneTarget = null;
  resetPickerView();
  // SPE-83: pre-fill with the OS username, matching MobaXterm's "same
  // as Windows login" default, only if the field is currently empty,
  // never overwrite something the person already typed or a saved
  // session's own stored username.
  const userField = document.getElementById('user') as HTMLInputElement;
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
  document.getElementById('session-picker-overlay')!.classList.add('open');
}

// SPE-92: opens the same New Session picker, but targets a specific
// split pane instead of the active tab's own primary session. The
// picker itself (SSH/Shell/Serial icons and their flows) is entirely
// unchanged, only which Session object ends up connected differs.
function openSplitPanePicker(pane: Pane) {
  pendingPaneTarget = pane;
  resetPickerView();
  const userField = document.getElementById('user') as HTMLInputElement;
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
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
  await connectSerialInActiveTab(portName, baud);
});
document.getElementById('picker-shell')!.addEventListener('click', () => {
  // SPE-92: ensurePendingTab would wrongly create/switch to a whole new
  // tab when this picker was actually opened for a split pane, only
  // needed for the ordinary "New Session" flow.
  if (!pendingPaneTarget) ensurePendingTab();
  closeSessionPicker();
  startLocalShellInActiveTab('', 'Local shell');
});
document.getElementById('menu-new-folder')!.addEventListener('click', () => {
  closeAllMenus();
  createNewFolder();
});

// View menu
function toggleSidebar() {
  const app = document.getElementById('app')!;
  app.style.gridTemplateColumns = '';
  const collapsed = app.classList.toggle('sidebar-collapsed');
  app.style.setProperty('--sw', collapsed ? '0px' : (sidebarWidth ? `${sidebarWidth}px` : '220px'));
  app.style.setProperty('--rsw', collapsed ? '0px' : '5px');
  document.getElementById('sidebar-expand-btn')!.style.display = collapsed ? 'flex' : 'none';
  refitActiveTerminal();
}
document.getElementById('menu-toggle-sidebar')!.addEventListener('click', () => {
  closeAllMenus();
  toggleSidebar();
});

// SPE-92: split-pane layouts. Ctrl+Shift+D / Ctrl+Shift+Enter / Ctrl+Shift+W
// / Alt+Arrow also drive these, see the keyboard handler in
// createTerminalForSession.
function currentTabForLayout(): Tab | null {
  return activeTabId ? (tabs.get(activeTabId) ?? null) : null;
}
document.getElementById('menu-layout-single')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, 'single');
});
document.getElementById('menu-layout-2v')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '2v');
});
document.getElementById('menu-layout-2h')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '2h');
});
document.getElementById('menu-layout-4')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '4');
});

// SPE-95: distinct from window maximize, hides all chrome (menu bar,
// title bar) and uses the whole screen, matching F11 convention. F11
// itself is safe to claim globally, unlike some of the other shortcuts
// tonight (Ctrl+B/tmux etc.), it's not a meaningful readline/shell
// binding anywhere.
async function toggleFullscreen() {
  const isFull = await runtime.WindowIsFullscreen();
  if (isFull) runtime.WindowUnfullscreen();
  else runtime.WindowFullscreen();
}
document.getElementById('menu-toggle-fullscreen')!.addEventListener('click', () => {
  closeAllMenus();
  toggleFullscreen();
});

// SPE-91: viewable keyboard shortcuts reference. Built from a single
// source list here rather than duplicated across the View menu's
// inline hints, this list is the intentionally complete one (zoom,
// disconnect, paste, close pane, pane navigation, the disconnected-
// panel-only keys), several of which aren't shown anywhere else in the
// UI. Deliberately does NOT bind a new key (like a bare "?") to open
// this itself: Specter's whole surface is terminal input, and a bare
// single-key binding would swallow a character real shells/programs
// need to receive, the same reasoning already documented for why
// Ctrl+B isn't used bare for the sidebar toggle below. Menu-only is
// the safe choice here.
// Cmd label on macOS, Ctrl everywhere else, matching the actual
// runtime check (e.ctrlKey || e.metaKey) that treats them
// interchangeably throughout this file.
const SHORTCUT_MOD = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl';
const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Session',
    items: [
      [`${SHORTCUT_MOD}+Shift+X`, 'Disconnect active session'],
      [`${SHORTCUT_MOD}+Shift+V`, 'Paste'],
    ],
  },
  {
    title: 'View',
    items: [
      [`${SHORTCUT_MOD}+Shift+B`, 'Toggle sidebar'],
      [`${SHORTCUT_MOD}+= / ${SHORTCUT_MOD}+Plus`, 'Zoom in'],
      [`${SHORTCUT_MOD}+-`, 'Zoom out'],
      [`${SHORTCUT_MOD}+0`, 'Reset zoom'],
      ['F11', 'Toggle fullscreen'],
    ],
  },
  {
    title: 'Panes',
    items: [
      [`${SHORTCUT_MOD}+Shift+D`, 'Split vertical / 4-pane grid'],
      [`${SHORTCUT_MOD}+Shift+Enter`, 'Split horizontal / 4-pane grid'],
      [`${SHORTCUT_MOD}+Shift+W`, 'Close active pane'],
      ['Alt+Arrow keys', 'Move focus between panes'],
    ],
  },
  {
    title: 'Disconnected session panel',
    items: [
      ['R', 'Reconnect'],
      ['S', 'Save session output'],
      ['Enter', 'Close pane'],
    ],
  },
];

function renderShortcutsDialog() {
  const content = document.getElementById('shortcuts-content')!;
  content.innerHTML = '';
  for (const group of SHORTCUT_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'shortcut-group';
    const titleEl = document.createElement('div');
    titleEl.className = 'shortcut-group-title';
    titleEl.textContent = group.title;
    groupEl.appendChild(titleEl);
    for (const [keys, label] of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const keysEl = document.createElement('span');
      keysEl.className = 'shortcut-keys';
      keysEl.textContent = keys;
      row.appendChild(labelEl);
      row.appendChild(keysEl);
      groupEl.appendChild(row);
    }
    content.appendChild(groupEl);
  }
}

function openShortcutsDialog() {
  renderShortcutsDialog();
  document.getElementById('shortcuts-overlay')!.classList.add('open');
}
function closeShortcutsDialog() {
  document.getElementById('shortcuts-overlay')!.classList.remove('open');
}
document.getElementById('menu-keyboard-shortcuts')!.addEventListener('click', () => {
  closeAllMenus();
  openShortcutsDialog();
});
document.getElementById('shortcuts-close')!.addEventListener('click', closeShortcutsDialog);
document.getElementById('shortcuts-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('shortcuts-overlay')) closeShortcutsDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('shortcuts-overlay')!.classList.contains('open')) {
    closeShortcutsDialog();
  }
});

document.getElementById('sidebar-collapse-btn')!.addEventListener('click', toggleSidebar);
document.getElementById('sidebar-expand-btn')!.addEventListener('click', toggleSidebar);

// --- Config import/export (SPE-93) ---
document.getElementById('menu-export-config')!.addEventListener('click', async () => {
  closeAllMenus();
  try {
    const path = await App.ExportConfigFile();
    if (path) alert(`Exported configuration to:\n${path}`);
  } catch (err) {
    alert(`Export failed: ${err}`);
  }
});
document.getElementById('menu-import-config')!.addEventListener('click', async () => {
  closeAllMenus();
  // Settings (theme/font/wallpaper/etc.) gets replaced outright by an
  // import, unlike sessions/groups/local shell profiles which merge in
  // alongside what's already here (see config.ImportBundle), so this
  // is the one part of an import that can actually change something
  // the person didn't expect, worth confirming before it happens.
  if (!confirm('Import configuration? Saved sessions, folders, and local shell profiles will be merged in alongside your existing ones. Appearance settings (theme, font, wallpaper) will be replaced with the imported values.')) {
    return;
  }
  try {
    const path = await App.ImportConfigFile();
    if (!path) return;
    await Promise.all([
      loadSettingsAndApply(),
      renderSessionList(),
      renderLocalShellProfilesMenu(),
    ]);
    alert(`Imported configuration from:\n${path}`);
  } catch (err) {
    alert(`Import failed: ${err}`);
  }
});

// --- Restore from automatic backup (SPE-87) ---
// filenameToLabel parses the "specter-backup-YYYYMMDD-HHMMSS.json"
// format written by config.BackupIfDue (Go side) into a readable local
// date/time for display, purely cosmetic, doesn't affect which file
// actually gets restored (that's always the exact filename passed to
// App.RestoreBackup).
function backupFilenameToLabel(filename: string): string {
  const match = filename.match(/^specter-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
  if (!match) return filename;
  const [, y, mo, d, h, mi, s] = match;
  // The Go side writes these in UTC (time.Now().UTC()), constructed
  // here as a UTC instant too so toLocaleString() converts it to the
  // viewer's actual local time rather than misreading it as already-local.
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return date.toLocaleString();
}

async function openBackupRestoreDialog() {
  const list = document.getElementById('backup-restore-list')!;
  list.innerHTML = '';
  let backups: string[] = [];
  try {
    backups = await App.ListBackups();
  } catch {
    // No backups directory yet (fresh install, never reached the
    // 24h-since-last-backup mark) isn't an error worth surfacing,
    // just show the empty state below.
  }
  if (backups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'backup-empty';
    empty.textContent = 'No automatic backups yet. Specter creates one at most once a day.';
    list.appendChild(empty);
  } else {
    for (const filename of backups) {
      const row = document.createElement('div');
      row.className = 'backup-row';
      row.textContent = backupFilenameToLabel(filename);
      row.addEventListener('click', async () => {
        // Restoring REPLACES current Settings/Sessions/Groups/Local
        // shell profiles outright (config.RestoreBackup), unlike
        // Import Configuration's merge, so this confirm is
        // deliberately more blunt about what's about to happen.
        if (!confirm(`Restore this backup?\n\n${backupFilenameToLabel(filename)}\n\nThis replaces your current saved sessions, folders, local shell profiles, and appearance settings with what's in this backup. This cannot be undone.`)) {
          return;
        }
        try {
          await App.RestoreBackup(filename);
          await Promise.all([
            loadSettingsAndApply(),
            renderSessionList(),
            renderLocalShellProfilesMenu(),
          ]);
          closeBackupRestoreDialog();
          alert('Backup restored.');
        } catch (err) {
          alert(`Restore failed: ${err}`);
        }
      });
      list.appendChild(row);
    }
  }
  document.getElementById('backup-restore-overlay')!.classList.add('open');
}
function closeBackupRestoreDialog() {
  document.getElementById('backup-restore-overlay')!.classList.remove('open');
}
document.getElementById('menu-restore-backup')!.addEventListener('click', () => {
  closeAllMenus();
  openBackupRestoreDialog();
});
document.getElementById('backup-restore-close')!.addEventListener('click', closeBackupRestoreDialog);
document.getElementById('backup-restore-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('backup-restore-overlay')) closeBackupRestoreDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('backup-restore-overlay')!.classList.contains('open')) {
    closeBackupRestoreDialog();
  }
});

// Tools menu: platform-aware, hide Command Prompt/PowerShell on non-Windows
platformPromise.then((platform) => {
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
  const app = document.getElementById('app')!;
  app.classList.remove('editor-collapsed');
  app.style.setProperty('--ew', editorWidth ? `${editorWidth}px` : '1fr');
  app.style.setProperty('--rew', '5px');
  document.getElementById('editor-expand-btn')!.style.display = 'none';
  openFilePath = null;
  openFileSessionId = null;
  document.getElementById('editor-path')!.textContent = 'Untitled';
  editor.setValue('');
  monaco.editor.setModelLanguage(editor.getModel()!, 'plaintext');
});

renderSessionList();

let sidebarWidth: number | null = null;
let editorWidth: number | null = null;

function setupPaneResize(handleId: string, columnIndex: number, minWidth: number) {
  const handle = document.getElementById(handleId)!;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const app = document.getElementById('app')!;
    const startX = e.clientX;
    const variableName = columnIndex === 0 ? '--sw' : '--ew';
    const widthDirection = columnIndex === 0 ? 1 : -1;
    const paneId = columnIndex === 0 ? 'sidebar' : 'editor-pane';
    const startWidth = document.getElementById(paneId)!.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(minWidth, startWidth + widthDirection * delta);
      app.style.setProperty(variableName, `${newWidth}px`);
      if (columnIndex === 0) sidebarWidth = newWidth;
      else editorWidth = newWidth;
    };

    const finishResize = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', finishResize);
      handle.removeEventListener('pointercancel', finishResize);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      refitActiveTerminal();
    };
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
  });
}

setupPaneResize('resize-sidebar', 0, 150);
setupPaneResize('resize-editor', 4, 200);

renderSessionList();renderSessionList();
renderLocalShellProfileList();
renderLocalShellProfilesMenu();
