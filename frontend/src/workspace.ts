// What was open, so it can be reopened next launch.
//
// Nothing survived a restart except Home. The tabs, the split panes,
// the folder in the editor and the files in it were all gone, and the
// morning began by rebuilding yesterday. This is the record of what
// was open, written as the tab set changes and read back on the next
// launch. Only what is needed to start each thing again is kept: never
// a password, never terminal output.
//
// Pure data and validation live here so they can be tested; main.ts
// does the capturing and the reopening.

import type { SessionProfile } from '../wailsjs.d.ts';

export type PaneLayout = 'single' | '2v' | '2h' | '4';

export type PaneSpec =
  | {
    kind: 'ssh';
    label: string;
    host: string;
    port: number;
    user: string;
    keyPath?: string;
    useAgent?: boolean;
    internalAgent?: boolean;
    x11?: boolean;
    jumpHost?: string;
    terminalSpeed?: number;
    sessionProfileId: string | null;
  }
  | { kind: 'local'; label: string; shell: string; dir: string }
  | { kind: 'serial'; label: string; port: string; baud: number; sessionProfileId: string | null }
  | { kind: 'rdp' | 'vnc'; label: string; profile: SessionProfile }
  | { kind: 'editor'; label: string; folder: string | null; files: string[]; activeFile: string | null };

export interface TabSpec {
  label: string;
  layout: PaneLayout;
  splitX: number;
  splitY: number;
  focusedPaneIndex: number;
  // Index 0 is the tab's own session; the rest are its split panes. A
  // null is a pane that had nothing in it.
  panes: (PaneSpec | null)[];
}

export interface WorkspaceSnapshot {
  version: 1;
  savedAt: string;
  // Index into tabs of the one that was active, or -1 for Home.
  activeTab: number;
  tabs: TabSpec[];
}

export const WORKSPACE_STORAGE_KEY = 'xpecter-last-workspace';

const LAYOUTS: PaneLayout[] = ['single', '2v', '2h', '4'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// One pane as it was saved, or null when the record cannot be reopened
// as anything. Each kind checks the fields it cannot do without; the
// rest default, so a snapshot from an older build still reopens what
// it can.
export function parsePaneSpec(value: unknown): PaneSpec | null {
  if (!isRecord(value)) return null;
  const label = str(value.label, '');
  switch (value.kind) {
    case 'ssh': {
      const host = str(value.host);
      const user = str(value.user);
      if (!host) return null;
      return {
        kind: 'ssh',
        label: label || `${user}@${host}`,
        host,
        port: num(value.port, 22),
        user,
        keyPath: optStr(value.keyPath),
        useAgent: optBool(value.useAgent),
        internalAgent: optBool(value.internalAgent),
        x11: optBool(value.x11),
        jumpHost: optStr(value.jumpHost),
        terminalSpeed: typeof value.terminalSpeed === 'number' ? value.terminalSpeed : undefined,
        sessionProfileId: typeof value.sessionProfileId === 'string' ? value.sessionProfileId : null,
      };
    }
    case 'local':
      return { kind: 'local', label: label || 'Local shell', shell: str(value.shell), dir: str(value.dir) };
    case 'serial': {
      const port = str(value.port);
      if (!port) return null;
      return {
        kind: 'serial',
        label: label || port,
        port,
        baud: num(value.baud, 9600),
        sessionProfileId: typeof value.sessionProfileId === 'string' ? value.sessionProfileId : null,
      };
    }
    case 'rdp':
    case 'vnc': {
      if (!isRecord(value.profile) || !str(value.profile.host)) return null;
      return { kind: value.kind, label: label || str(value.profile.host), profile: value.profile as unknown as SessionProfile };
    }
    case 'editor': {
      const files = Array.isArray(value.files) ? value.files.filter((f): f is string => typeof f === 'string') : [];
      const folder = typeof value.folder === 'string' && value.folder ? value.folder : null;
      if (!folder && files.length === 0) return null;
      const activeFile = typeof value.activeFile === 'string' && files.includes(value.activeFile) ? value.activeFile : null;
      return { kind: 'editor', label: label || 'Editor', folder, files, activeFile };
    }
    default:
      return null;
  }
}

// The saved snapshot, or null when there is nothing worth offering:
// missing, unreadable, another version, or no tab with anything in it.
export function parseWorkspaceSnapshot(json: string | null): WorkspaceSnapshot | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tabs)) return null;
  const tabs: TabSpec[] = [];
  for (const entry of raw.tabs) {
    if (!isRecord(entry) || !Array.isArray(entry.panes)) continue;
    const panes = entry.panes.map(parsePaneSpec);
    if (!panes.some((pane) => pane !== null)) continue;
    const layout = LAYOUTS.includes(entry.layout as PaneLayout) ? (entry.layout as PaneLayout) : 'single';
    tabs.push({
      label: str(entry.label, panes.find((pane) => pane)?.label ?? 'Tab'),
      layout,
      splitX: clampFraction(num(entry.splitX, 0.5)),
      splitY: clampFraction(num(entry.splitY, 0.5)),
      focusedPaneIndex: Math.max(0, Math.min(panes.length - 1, Math.trunc(num(entry.focusedPaneIndex, 0)))),
      panes,
    });
  }
  if (tabs.length === 0) return null;
  const activeTab = Math.trunc(num(raw.activeTab, 0));
  return {
    version: 1,
    savedAt: str(raw.savedAt, ''),
    activeTab: activeTab >= -1 && activeTab < tabs.length ? activeTab : 0,
    tabs,
  };
}

function clampFraction(value: number): number {
  return Math.min(0.9, Math.max(0.1, value));
}

// A one-line description for the offer on Home: how many tabs, and the
// first few of their names.
export function describeWorkspace(snapshot: WorkspaceSnapshot): string {
  const count = snapshot.tabs.length;
  const names = snapshot.tabs.slice(0, 4).map((tab) => tab.label);
  const more = count > names.length ? `, and ${count - names.length} more` : '';
  return `${count} ${count === 1 ? 'tab' : 'tabs'}: ${names.join(', ')}${more}`;
}
