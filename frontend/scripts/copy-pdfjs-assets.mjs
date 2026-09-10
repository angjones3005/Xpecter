// PDF.js loads the 14 standard PDF fonts (Helvetica, Times, Courier and
// their variants) as files at runtime, for the documents that name one
// without embedding it. They are data rather than code, so they are not
// something the bundler can reach: they have to exist as files under the
// served root, which for Vite means public/.
//
// Copied here at build time rather than committed, which keeps 800K of
// third-party font binaries out of the repository while still putting
// them somewhere both `vite` and `vite build` serve from. Both npm
// scripts run this first, so there is no way to build without them.
//
// Without these, a PDF that relies on a non-embedded standard font
// falls back to whatever the system has and renders with the wrong
// metrics, or on a machine missing those faces, does not render its
// text at all.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(frontend, 'node_modules/pdfjs-dist/standard_fonts');
const to = resolve(frontend, 'public/pdfjs/standard_fonts');

// Removed first so a pdfjs-dist upgrade that drops a file does not leave
// the old one behind to be served forever.
rmSync(to, { recursive: true, force: true });
mkdirSync(dirname(to), { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`pdfjs standard fonts -> ${to}`);
