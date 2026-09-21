import { describe, expect, it } from 'vitest';
import { sgrLeavesColorActive } from './ansi';

const ESC = '\x1b';

describe('sgrLeavesColorActive', () => {
  it('turns a basic foreground on and a reset off', () => {
    expect(sgrLeavesColorActive(`${ESC}[31m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[1;32m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[0m`, true)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}[m`, true)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}[39m`, true)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}[93m`, false)).toBe(true);
  });

  it('leaves the state alone for anything that is not SGR', () => {
    expect(sgrLeavesColorActive(`${ESC}[2J`, true)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[?25l`, false)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}]0;title\x07`, true)).toBe(true);
  });

  it('reads a true-colour foreground with a 0 or 39 component as a colour', () => {
    // Pure green, pure blue, black: every one of these has a 0 in it.
    expect(sgrLeavesColorActive(`${ESC}[38;2;0;255;0m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[38;2;0;0;255m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[38;2;0;0;0m`, false)).toBe(true);
    // 39 as a red component.
    expect(sgrLeavesColorActive(`${ESC}[38;2;39;40;34m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[38:2:0:255:0m`, false)).toBe(true);
  });

  it('does not let a background colour touch the foreground state', () => {
    // A Monokai background, whose first component is 39.
    expect(sgrLeavesColorActive(`${ESC}[48;2;39;40;34m`, false)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}[48;2;39;40;34m`, true)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[48;5;0m`, true)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[58;2;0;0;0m`, true)).toBe(true);
  });

  it('reads palette colours and the codes that follow them', () => {
    expect(sgrLeavesColorActive(`${ESC}[38;5;0m`, false)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[38;5;196;1m`, false)).toBe(true);
    // A real reset after a colour still resets.
    expect(sgrLeavesColorActive(`${ESC}[38;2;0;255;0;0m`, false)).toBe(false);
    expect(sgrLeavesColorActive(`${ESC}[38;5;10;39m`, false)).toBe(false);
  });

  it('stops reading at a malformed extended colour instead of guessing', () => {
    expect(sgrLeavesColorActive(`${ESC}[38m`, true)).toBe(true);
    expect(sgrLeavesColorActive(`${ESC}[38;9;0m`, true)).toBe(true);
  });
});
