import { describe, expect, it } from 'vitest';
import { quoteForShell } from './shellquote';

describe('quoteForShell', () => {
  it('single-quotes for POSIX shells so nothing inside is expanded', () => {
    expect(quoteForShell('/home/me/my script.sh', 'posix')).toBe(`'/home/me/my script.sh'`);
    expect(quoteForShell('/tmp/done!.sh', 'posix')).toBe(`'/tmp/done!.sh'`);
    expect(quoteForShell('/tmp/$(rm -rf x)/a.sh', 'posix')).toBe(`'/tmp/$(rm -rf x)/a.sh'`);
    expect(quoteForShell(`/tmp/it's.sh`, 'posix')).toBe(`'/tmp/it'\\''s.sh'`);
  });

  it('single-quotes for PowerShell with the quote doubled', () => {
    expect(quoteForShell(`C:\\Users\\me\\a b.ps1`, 'powershell')).toBe(`'C:\\Users\\me\\a b.ps1'`);
    expect(quoteForShell(`C:\\it's.py`, 'powershell')).toBe(`'C:\\it''s.py'`);
    expect(quoteForShell(`C:\\$env.py`, 'powershell')).toBe(`'C:\\$env.py'`);
  });

  it('double-quotes for cmd, which has nothing better', () => {
    expect(quoteForShell(`C:\\a b.bat`, 'cmd')).toBe(`"C:\\a b.bat"`);
  });
});
