import { describe, expect, it } from 'vitest';
import { chunkPasteLines, countPasteLines, normalizePasteNewlines } from './paste';

describe('countPasteLines', () => {
  it('counts lines without treating a trailing break as an extra line', () => {
    expect(countPasteLines('ls')).toBe(1);
    expect(countPasteLines('ls\n')).toBe(1);
    expect(countPasteLines('ls\r\n')).toBe(1);
    expect(countPasteLines('a\nb')).toBe(2);
    expect(countPasteLines('a\r\nb\r\n')).toBe(2);
    expect(countPasteLines('a\n\nb')).toBe(3);
    expect(countPasteLines('')).toBe(1);
  });
});

describe('chunkPasteLines', () => {
  it('sends each line with its own carriage return', () => {
    expect(chunkPasteLines(normalizePasteNewlines('conf t\ninterface Gi1/0/1\nshutdown\n'))).toEqual([
      'conf t\r',
      'interface Gi1/0/1\r',
      'shutdown\r',
    ]);
  });

  it('leaves the last line unterminated when the paste was', () => {
    expect(chunkPasteLines('a\rb')).toEqual(['a\r', 'b']);
    expect(chunkPasteLines('single line')).toEqual(['single line']);
    expect(chunkPasteLines('')).toEqual([]);
  });

  it('keeps empty lines as their own chunk', () => {
    expect(chunkPasteLines('a\r\rb\r')).toEqual(['a\r', '\r', 'b\r']);
  });
});

describe('normalizePasteNewlines', () => {
  it('turns every line break into a carriage return', () => {
    expect(normalizePasteNewlines('a\r\nb\nc\rd')).toBe('a\rb\rc\rd');
  });
});
