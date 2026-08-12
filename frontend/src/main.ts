import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as monaco from 'monaco-editor';
import '@xterm/xterm/css/xterm.css';
import type { RemoteFile, ConnectRequest, SessionProfile, SessionGroup } from '../wailsjs.d.ts';

type ThemeName = 'dark' | 'light';

const XTERM_THEMES: Record<ThemeName, { background: string; foreground: string }> = {
  dark: { background: '#1e1e1e', foreground: '#dddddd' },
  light: { background: '#ffffff', foreground: '#1e1e1e' },
};

const MONACO_THEMES: Record<ThemeName, string> = {
  dark: 'vs-dark',
  light: 'vs',
};

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('specter-theme', name);

  for (const tab of tabs.values()) {
    if (tab.term) {
      tab.term.options.theme = XTERM_THEMES[name];
    }
  }

  if (typeof monaco !== 'undefined' && editor) {
    monaco.editor.setTheme(MONACO_THEMES[name]);
  }
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

type TabMode = 'pending' | 'local' | 'ssh';
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
    label.textContent = (tab.mode === 'local' ? '💻 ' : tab.mode === 'ssh' ? '🌐 ' : '') + tab.label;
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
  document.getElementById('connect-form')!.style.display = tab.mode === 'pending' ? 'flex' : 'none';

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

  if (tab.mode === 'ssh' && tab.backendId) await App.CloseSSH(tab.backendId);
  if (tab.mode === 'local' && tab.backendId) await App.CloseLocalTerminal(tab.backendId);
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
  container.style.cssText = 'height:100%;padding:4px;box-sizing:border-box;';
  document.getElementById('terminal')!.appendChild(container);

  const term = new Terminal({
    fontFamily: 'Menlo, Consolas, monospace',
    fontSize: 13,
    theme: XTERM_THEMES[currentTheme()],
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  term.onData((data) => {
    if (tab.mode === 'local' && tab.backendId) App.WriteLocalTerminal(tab.backendId, data);
    if (tab.mode === 'ssh' && tab.backendId) App.WriteSSH(tab.backendId, data);
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
  document.getElementById('app')!.classList.toggle('editor-collapsed');
});

document.getElementById('editor-toggle')!.addEventListener('click', () => {
  document.getElementById('app')!.classList.toggle('editor-collapsed');
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

async function refreshFileList(path = '.', sessionId?: string) {
  const id = sessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!id) return;
  const entries: RemoteFile[] = await App.ListRemoteDir(id, path);
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = (e.isDir ? '📁 ' : '📄 ') + e.name;
    div.onclick = () => (e.isDir ? refreshFileList(e.path, id) : openRemoteFile(id, e.path));
    list.appendChild(div);
  }
}

// --- Saved sessions ---

function setAuthMode(mode: 'password' | 'key') {
  const radio = document.querySelector(`input[name="authmode"][value="${mode}"]`) as HTMLInputElement;
  radio.checked = true;
  const isKey = mode === 'key';
  document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
  document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
}

let skipSavePrompt = false;

async function useSession(s: SessionProfile) {
  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });
  (document.getElementById('host') as HTMLInputElement).value = s.host;
  (document.getElementById('user') as HTMLInputElement).value = s.user;

  if (s.keyPath) {
    setAuthMode('key');
    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath;
    (document.getElementById('passphrase') as HTMLInputElement).value = '';
    skipSavePrompt = true;
    await connectActiveTab({ host: s.host, port: s.port, user: s.user, keyPath: s.keyPath });
    skipSavePrompt = false;
  } else {
    setAuthMode('password');
    const pwField = document.getElementById('password') as HTMLInputElement;
    pwField.value = '';
    pwField.focus();
  }
}

function renderSessionRow(s: SessionProfile, groups: SessionGroup[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'session-entry';
  row.style.paddingLeft = '18px';

  const label = document.createElement('span');
  label.textContent = (s.keyPath ? '\ud83d\udd11 ' : '\ud83d\udd12 ') + s.name;
  label.onclick = () => useSession(s);
  label.style.flex = '1';

  const groupSelect = document.createElement('select');
  groupSelect.style.cssText = 'font-size:11px;background:#1a1a1a;color:#999;border:1px solid #333;max-width:70px;margin-right:4px;';
  groupSelect.onclick = (e) => e.stopPropagation();
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  groupSelect.appendChild(noneOpt);
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    if (s.groupId === g.id) opt.selected = true;
    groupSelect.appendChild(opt);
  }
  groupSelect.onchange = async () => {
    await App.SaveSession({ ...s, groupId: groupSelect.value });
    renderSessionList();
  };

  const del = document.createElement('span');
  del.textContent = '\u2715';
  del.className = 'delete-btn';
  del.onclick = async (e) => {
    e.stopPropagation();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  row.appendChild(label);
  row.appendChild(groupSelect);
  row.appendChild(del);
  return row;
}

function renderGroupNode(
  group: SessionGroup,
  groups: SessionGroup[],
  sessions: SessionProfile[],
  container: HTMLElement,
) {
  const header = document.createElement('div');
  header.className = 'entry';
  header.style.fontWeight = 'bold';
  header.textContent = '\ud83d\udcc1 ' + group.name;
  container.appendChild(header);

  const childGroups = groups.filter((g) => g.parentId === group.id);
  const childSessions = sessions.filter((s) => s.groupId === group.id);

  for (const cg of childGroups) {
    renderGroupNode(cg, groups, sessions, container);
  }
  for (const s of childSessions) {
    container.appendChild(renderSessionRow(s, groups));
  }
}

let sessionSearchQuery = '';

function sessionMatchesQuery(s: SessionProfile, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.host.toLowerCase().includes(q)) return true;
  if (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

async function renderSessionList() {
  const [sessions, groups] = await Promise.all([App.ListSessions(), App.ListGroups()]);
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
      header.textContent = '\u23f1\ufe0f Recent';
      list.appendChild(header);
      for (const s of recent) {
        list.appendChild(renderSessionRow(s, groups));
      }
    }
  }

  const topGroups = groups.filter((g) => !g.parentId);
  for (const g of topGroups) {
    renderGroupNode(g, groups, visibleSessions, list);
  }

  const ungrouped = visibleSessions.filter((s) => !s.groupId);
  for (const s of ungrouped) {
    list.appendChild(renderSessionRow(s, groups));
  }

  if (!query) {
    const addFolder = document.createElement('div');
    addFolder.className = 'entry';
    addFolder.style.cssText = 'opacity:0.6;cursor:pointer;font-size:12px;';
    addFolder.textContent = '+ New folder';
    addFolder.onclick = async () => {
      const name = prompt('Folder name:');
      if (!name) return;
      await App.SaveGroup({ id: '', name, parentId: '' });
      renderSessionList();
    };
    list.appendChild(addFolder);
  }
}

// --- Host key trust modal ---

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
    document.getElementById('connect-form')!.appendChild(el);
  }
  el.textContent = message;
}

function clearConnectError() {
  document.getElementById('connect-error')?.remove();
}

// --- Connect flow (targets the currently active pending tab) ---

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
    const passphrase = prompt('This key is encrypted. Enter its passphrase:');
    if (passphrase === null) {
      tab.status = 'disconnected';
      renderTabBar();
      return;
    }
    await connectActiveTab({ ...req, passphrase });
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
    runtime.EventsOn('ssh:data:' + result.sessionId, (data: unknown) => tab.term!.write(data as string));
    switchToTab(tab.id);
    refreshFileList('.', result.sessionId);

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({ id: '', name, host: req.host, port: req.port, user: req.user, keyPath: req.keyPath });
        renderSessionList();
      }
    }
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
});

document.getElementById('local')!.addEventListener('click', async () => {
  const tab = tabs.get(activeTabId!)!;
  tab.label = 'Local shell';
  const id = await App.StartLocalTerminal();
  tab.mode = 'local';
  tab.backendId = id;
  tab.status = 'connected';
  createTerminalForTab(tab);
  runtime.EventsOn('local:data:' + id, (data: unknown) => tab.term!.write(data as string));
  switchToTab(tab.id);
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

renderSessionList();
