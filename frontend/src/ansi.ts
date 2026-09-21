// The one piece of ANSI reading the output highlighter has to get
// right: whether an SGR sequence leaves a foreground colour in effect.
// Kept out of main.ts so it can be tested on its own.

// True when an SGR sequence leaves a foreground colour in effect, false
// when it clears one. Anything that is not an SGR sequence leaves the
// current state alone.
//
// The extended-colour forms carry their own parameters: 38;5;N is one
// palette colour and 38;2;R;G;B one true colour, and every value after
// the 38 belongs to it. Reading those values as codes of their own is
// how a green (38;2;0;255;0) or a Monokai background (48;2;39;40;34)
// read as "colour cleared": the 0 and the 39 inside them were taken for
// resets, the highlighter then coloured inside the far end's run, and
// its trailing 39 reset the remote's foreground for the rest of the
// line.
export function sgrLeavesColorActive(sequence: string, current: boolean): boolean {
  if (!sequence.startsWith('\x1b[') || !sequence.endsWith('m')) return current;
  const params = sequence.slice(2, -1);
  if (params === '' || params === '0') return false;
  let active = current;
  // Both ';' and ':' separate parameters; the colon form is how some
  // terminals write the sub-parameters of an extended colour.
  const codes = params.split(/[;:]/).map((part) => (part === '' ? 0 : Number(part)));
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i];
    if (code === 38 || code === 48 || code === 58) {
      // Skip the colour's own parameters: one for a palette index,
      // three for an RGB triple. An unknown form ends the sequence's
      // reading rather than guessing at what follows.
      const mode = codes[i + 1];
      if (mode === 5) i += 2;
      else if (mode === 2) i += 4;
      else break;
      if (code === 38) active = true;
      continue;
    }
    if (code === 0 || code === 39) active = false;
    else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) active = true;
  }
  return active;
}
