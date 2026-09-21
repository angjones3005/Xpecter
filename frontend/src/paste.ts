// Splitting pasted text for a terminal. Kept out of main.ts so the
// arithmetic can be tested without a terminal.

// Line breaks as a terminal wants them: one carriage return per break,
// however the source wrote them. CRLF from anything Windows would
// otherwise arrive as "execute, then a stray LF", and a bare LF is not
// the key a terminal is waiting for at all.
export function normalizePasteNewlines(text: string): string {
  return text.replace(/\r\n|\n/g, '\r');
}

// How many lines a paste would type. A single trailing break is the
// end of the last line, not an extra empty one.
export function countPasteLines(text: string): number {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

// The chunks a delayed paste sends, one per line, each carrying its
// own carriage return so the pause falls after the Enter and before the
// next line, which is where a console that drops characters needs it.
// The last chunk has no return unless the text ended in one.
export function chunkPasteLines(normalized: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i] !== '\r') continue;
    chunks.push(normalized.slice(start, i + 1));
    start = i + 1;
  }
  if (start < normalized.length) chunks.push(normalized.slice(start));
  return chunks;
}
