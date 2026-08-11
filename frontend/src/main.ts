import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import * as monaco from 'monaco-editor';
import '@xterm/xterm/css/xterm.css';
import type { RemoteFile } from '../wailsjs.d.ts';

const App = window.go.main.App;
const runtime = window.runtime;

let currentSessionId: string | null = null;
let currentMode: 'local' | 'ssh' | null = null;

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
    go: 'go',
    hs: 'haskell',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    md: 'markdown',
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

// --- Connection controls ---

document.getElementById('connect')!.addEventListener('click', async () => {
  const host = (document.getElementById('host') as HTMLInputElement).value;
  const user = (document.getElementById('user') as HTMLInputElement).value;
  const password = (document.getElementById('password') as HTMLInputElement).value;

  const id = await App.Connect({ host, port: 22, user, password });
  currentSessionId = id;
  currentMode = 'ssh';

  runtime.EventsOn('ssh:data:' + id, (data: unknown) => term.write(data as string));
  refreshFileList('.');
});

document.getElementById('local')!.addEventListener('click', async () => {
  await App.StartLocalTerminal();
  currentMode = 'local';
  runtime.EventsOn('local:data', (data: unknown) => term.write(data as string));
});
