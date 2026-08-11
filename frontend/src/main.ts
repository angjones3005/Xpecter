import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as monaco from 'monaco-editor';
import '@xterm/xterm/css/xterm.css';
import type { RemoteFile, ConnectRequest, SessionProfile } from '../wailsjs.d.ts';

const App = window.go.main.App;
const runtime = window.runtime;

let currentSessionId: string | null = null;
let currentMode: 'local' | 'ssh' | null = null;
let skipSavePrompt = false; // true when connecting via an already-saved session

// --- Terminal setup ---

const term = new Terminal({
  fontFamily: 'Menlo, Consolas, monospace',
  fontSize: 13,
  theme: { background: '#1e1e1e' },
});
const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal')!);
fitAddon.fit();

window.addEventListener('resize', () => {
  fitAddon.fit();
  const { cols, rows } = term;
  if (currentMode === 'local') App.ResizeLocalTerminal(cols, rows);
  if (currentMode === 'ssh' && currentSessionId) App.ResizeSSH(currentSessionId, cols, rows);
});

term.onData((data) => {
  if (currentMode === 'local') App.WriteLocalTerminal(data);
  if (currentMode === 'ssh' && currentSessionId) App.WriteSSH(currentSessionId, data);
});

// --- Editor setup ---

const editor = monaco.editor.create(document.getElementById('editor')!, {
  value: '',
  language: 'plaintext',
  theme: 'vs-dark',
  automaticLayout: true,
});

let openFilePath: string | null = null;

async function openRemoteFile(path: string) {
  if (!currentSessionId) return;
  const content = await App.ReadRemoteFile(currentSessionId, path);
  openFilePath = path;
  document.getElementById('editor-path')!.textContent = path;
  const ext = path.split('.').pop() ?? '';
  const langMap: Record<string, string> = {
    go: 'go', hs: 'haskell', js: 'javascript', ts: 'typescript', json: 'json', md: 'markdown',
  };
  monaco.editor.setModelLanguage(editor.getModel()!, langMap[ext] ?? 'plaintext');
  editor.setValue(content);
}

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
  if (!currentSessionId || !openFilePath) return;
  await App.WriteRemoteFile(currentSessionId, openFilePath, editor.getValue());
});

// --- File browser ---

async function refreshFileList(path = '.') {
  if (!currentSessionId) return;
  const entries: RemoteFile[] = await App.ListRemoteDir(currentSessionId, path);
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'entry';
    div.textContent = (e.isDir ? '📁 ' : '📄 ') + e.name;
    div.onclick = () => (e.isDir ? refreshFileList(e.path) : openRemoteFile(e.path));
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

async function useSession(s: SessionProfile) {
  (document.getElementById('host') as HTMLInputElement).value = s.host;
  (document.getElementById('user') as HTMLInputElement).value = s.user;

  if (s.keyPath) {
    setAuthMode('key');
    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath;
    (document.getElementById('passphrase') as HTMLInputElement).value = '';
    skipSavePrompt = true;
    await attemptConnect({ host: s.host, port: s.port, user: s.user, keyPath: s.keyPath });
    skipSavePrompt = false;
  } else {
    setAuthMode('password');
    const pwField = document.getElementById('password') as HTMLInputElement;
    pwField.value = '';
    pwField.focus();
  }
}

async function renderSessionList() {
  const sessions = await App.ListSessions();
  const list = document.getElementById('session-list')!;
  list.innerHTML = '';
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'session-entry';

    const label = document.createElement('span');
    label.textContent = (s.keyPath ? '🔑 ' : '🔒 ') + s.name;
    label.onclick = () => useSession(s);

    const del = document.createElement('span');
    del.textContent = '✕';
    del.className = 'delete-btn';
    del.onclick = async (e) => {
      e.stopPropagation();
      await App.DeleteSession(s.id);
      renderSessionList();
    };

    row.appendChild(label);
    row.appendChild(del);
    list.appendChild(row);
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

  const title = opts.changed
    ? '⚠️ Host key has CHANGED — possible security risk'
    : 'Unknown host — verify before connecting';

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

async function attemptConnect(req: ConnectRequest) {
  const result = await App.Connect(req);

  if (result.needsPassphrase) {
    const passphrase = prompt('This key is encrypted. Enter its passphrase:');
    if (passphrase === null) {
      term.write('\r\n[Connection cancelled: passphrase required]\r\n');
      return;
    }
    await attemptConnect({ ...req, passphrase });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!,
      fingerprint: result.fingerprint!,
      keyType: result.keyType!,
      changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) {
          await App.TrustHostDespiteChange(result.host!);
        } else {
          await App.TrustHost(result.host!);
        }
        await attemptConnect(req); // retry now that the key is trusted
      },
      onReject: () => {
        term.write('\r\n[Connection cancelled: host key not trusted]\r\n');
      },
    });
    return;
  }

  if (result.sessionId) {
    currentSessionId = result.sessionId;
    currentMode = 'ssh';
    runtime.EventsOn('ssh:data:' + result.sessionId, (data: unknown) => term.write(data as string));
    refreshFileList('.');

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({
          id: '',
          name,
          host: req.host,
          port: req.port,
          user: req.user,
          keyPath: req.keyPath,
        });
        renderSessionList();
      }
    }
  }
}

// --- Auth mode toggle ---

const authRadios = document.querySelectorAll('input[name="authmode"]') as NodeListOf<HTMLInputElement>;
authRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    const isKey = radio.value === 'key' && radio.checked;
    document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
    document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
  });
});

document.getElementById('browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) {
    (document.getElementById('keyPath') as HTMLInputElement).value = path;
  }
});

// --- Connection controls ---

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

  await attemptConnect(req);
});

document.getElementById('local')!.addEventListener('click', async () => {
  await App.StartLocalTerminal();
  currentMode = 'local';
  runtime.EventsOn('local:data', (data: unknown) => term.write(data as string));
});

renderSessionList();
