// Quoting a path for the shell the editor's Run button types into.
//
// Double quotes were used for every shell, and they are not a quote in
// a POSIX shell so much as a suggestion: $, backtick and backslash stay
// live inside them, and interactive bash reads ! as history expansion,
// so a script called done!.sh failed with "event not found" and a
// directory named $(anything) ran it. Single quotes are the real thing
// on POSIX and in PowerShell; only cmd has nothing better than double
// quotes, and a Windows filename cannot contain one anyway.

export type ShellFlavour = 'posix' | 'powershell' | 'cmd';

export function quoteForShell(path: string, shell: ShellFlavour): string {
  switch (shell) {
    case 'posix':
      // A single quote cannot be escaped inside single quotes; the
      // string is closed, the quote given as '\'' and reopened.
      return `'${path.replace(/'/g, `'\\''`)}'`;
    case 'powershell':
      // A single quote is doubled inside a single-quoted string.
      return `'${path.replace(/'/g, "''")}'`;
    case 'cmd':
      return `"${path}"`;
  }
}
