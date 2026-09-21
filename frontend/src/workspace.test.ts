import { describe, expect, it } from 'vitest';
import { describeWorkspace, parsePaneSpec, parseWorkspaceSnapshot, type WorkspaceSnapshot } from './workspace';

const sample: WorkspaceSnapshot = {
  version: 1,
  savedAt: '2026-09-21T09:00:00.000Z',
  activeTab: 1,
  tabs: [
    {
      label: 'core-sw1',
      layout: '2v',
      splitX: 0.4,
      splitY: 0.5,
      focusedPaneIndex: 1,
      panes: [
        { kind: 'ssh', label: 'core-sw1', host: '10.0.0.1', port: 22, user: 'admin', useAgent: true, sessionProfileId: 'abc' },
        { kind: 'local', label: 'PowerShell', shell: 'pwsh.exe', dir: 'C:\\Users\\me' },
      ],
    },
    {
      label: 'notes',
      layout: 'single',
      splitX: 0.5,
      splitY: 0.5,
      focusedPaneIndex: 0,
      panes: [{ kind: 'editor', label: 'notes', folder: 'C:\\notes', files: ['C:\\notes\\today.md'], activeFile: 'C:\\notes\\today.md' }],
    },
  ],
};

describe('parseWorkspaceSnapshot', () => {
  it('round-trips a snapshot through JSON', () => {
    expect(parseWorkspaceSnapshot(JSON.stringify(sample))).toEqual(sample);
  });

  it('answers null for nothing, garbage, another version, or no sessions', () => {
    expect(parseWorkspaceSnapshot(null)).toBeNull();
    expect(parseWorkspaceSnapshot('')).toBeNull();
    expect(parseWorkspaceSnapshot('{not json')).toBeNull();
    expect(parseWorkspaceSnapshot(JSON.stringify({ version: 2, tabs: [] }))).toBeNull();
    expect(parseWorkspaceSnapshot(JSON.stringify({ version: 1, tabs: [{ label: 'x', panes: [null] }] }))).toBeNull();
  });

  it('drops panes it cannot reopen and tabs left with nothing', () => {
    const json = JSON.stringify({
      version: 1,
      activeTab: 5,
      tabs: [
        { label: 'broken', layout: 'weird', panes: [{ kind: 'ssh' }, { kind: 'teleport' }] },
        { label: 'ok', layout: '2h', splitX: 2, focusedPaneIndex: 9, panes: [{ kind: 'serial', port: 'COM3', baud: 115200 }, { kind: 'nope' }] },
      ],
    });
    const parsed = parseWorkspaceSnapshot(json)!;
    expect(parsed.tabs).toHaveLength(1);
    expect(parsed.tabs[0].layout).toBe('2h');
    expect(parsed.tabs[0].splitX).toBe(0.9);
    expect(parsed.tabs[0].focusedPaneIndex).toBe(1);
    expect(parsed.tabs[0].panes).toEqual([
      { kind: 'serial', label: 'COM3', port: 'COM3', baud: 115200, sessionProfileId: null },
      null,
    ]);
    // An active index past the end falls back to the first tab.
    expect(parsed.activeTab).toBe(0);
  });
});

describe('parsePaneSpec', () => {
  it('fills defaults for an SSH pane and never carries a password', () => {
    const pane = parsePaneSpec({ kind: 'ssh', host: 'h', user: 'u', password: 'hunter2' });
    expect(pane).toEqual({
      kind: 'ssh', label: 'u@h', host: 'h', port: 22, user: 'u',
      keyPath: undefined, useAgent: undefined, internalAgent: undefined, forwardAgent: undefined, x11: undefined,
      jumpHost: undefined, terminalSpeed: undefined, sessionProfileId: null,
    });
    expect(JSON.stringify(pane)).not.toContain('hunter2');
  });

  it('needs a folder or a file for an editor pane', () => {
    expect(parsePaneSpec({ kind: 'editor', files: [] })).toBeNull();
    expect(parsePaneSpec({ kind: 'editor', files: ['C:\\a.txt'], activeFile: 'C:\\b.txt' })).toEqual({
      kind: 'editor', label: 'Editor', folder: null, files: ['C:\\a.txt'], activeFile: null,
    });
  });

  it('needs a host for a remote desktop pane', () => {
    expect(parsePaneSpec({ kind: 'rdp', profile: {} })).toBeNull();
    // With no label of its own, the pane is named after the host.
    expect(parsePaneSpec({ kind: 'vnc', profile: { id: '1', name: 'box', host: '10.0.0.9' } })?.label).toBe('10.0.0.9');
  });
});

describe('describeWorkspace', () => {
  it('names the first few tabs', () => {
    expect(describeWorkspace(sample)).toBe('2 tabs: core-sw1, notes');
    const many = { ...sample, tabs: Array.from({ length: 6 }, (_, i) => ({ ...sample.tabs[0], label: `t${i}` })) };
    expect(describeWorkspace(many)).toBe('6 tabs: t0, t1, t2, t3, and 2 more');
  });
});
