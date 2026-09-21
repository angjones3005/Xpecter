import { describe, expect, it } from 'vitest';
import { hexDump, parseOsc7 } from './osc';

describe('parseOsc7', () => {
  it('reads the file URL a shell emits', () => {
    expect(parseOsc7('file://switch1/home/admin/configs')).toBe('/home/admin/configs');
    expect(parseOsc7('file:///var/log')).toBe('/var/log');
    expect(parseOsc7('file://host/with%20space/dir')).toBe('/with space/dir');
    expect(parseOsc7('/etc/nginx')).toBe('/etc/nginx');
  });
  it('refuses anything that is not a directory', () => {
    expect(parseOsc7('')).toBeNull();
    expect(parseOsc7('file://host')).toBeNull();
    expect(parseOsc7('C:\\Users')).toBeNull();
    expect(parseOsc7('relative/dir')).toBeNull();
  });
});

describe('hexDump', () => {
  it('lays out sixteen bytes per line with offsets and ascii', () => {
    const dump = hexDump('ABCDEFGHIJKLMNOPQ\x00\x7f');
    const lines = dump.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('00000000  41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50  ABCDEFGHIJKLMNOP');
    expect(lines[1]).toBe('00000010  51 00 7f                                         Q..');
    expect(hexDump('')).toBe('');
    expect(hexDump('x', 0x100).startsWith('00000100  78')).toBe(true);
  });
});
