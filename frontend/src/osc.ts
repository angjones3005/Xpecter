// Two small readings of terminal output, kept pure for testing.

// OSC 7 is how a shell reports its working directory: "file://host/path",
// the path percent-encoded. Answers the path, or null for anything that
// is not one. A shell that emits the path bare (some do) is read too.
export function parseOsc7(data: string): string | null {
  const text = data.trim();
  if (!text) return null;
  let path = text;
  if (/^file:\/\//i.test(text)) {
    const rest = text.slice('file://'.length);
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    path = rest.slice(slash);
  }
  if (!path.startsWith('/')) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// A hex dump of a chunk, sixteen bytes to a line, for reading what a
// console actually sent rather than what a terminal made of it. Bytes
// beyond ASCII arrive here as the characters the bridge turned them
// into, so their code points are what is shown.
export function hexDump(text: string, offset = 0): string {
  const codes: number[] = [];
  for (const ch of text) codes.push(ch.codePointAt(0) ?? 0);
  const lines: string[] = [];
  for (let i = 0; i < codes.length; i += 16) {
    const row = codes.slice(i, i + 16);
    const hex = row.map((c) => (c > 0xff ? '??' : c.toString(16).padStart(2, '0'))).join(' ');
    const ascii = row.map((c) => (c >= 0x20 && c < 0x7f ? String.fromCodePoint(c) : '.')).join('');
    lines.push(`${(offset + i).toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\r\n') + (lines.length ? '\r\n' : '');
}
