import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import '@xterm/xterm/css/xterm.css';
// SPE-61: bundle real font files for the 3 open-source coding fonts so
// they render identically everywhere, rather than depending on the
// host OS having them installed. Consolas/Menlo/Courier New stay
// OS-dependent, they're proprietary (Microsoft/Apple), can't be
// bundled, Windows/Mac generally have them, stock Linux generally
// doesn't.
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/cascadia-code/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/700.css';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/victor-mono/400.css';
import '@fontsource/victor-mono/700.css';
import '@fontsource/ubuntu-mono/400.css';
import '@fontsource/ubuntu-mono/700.css';
import type { RemoteFile, LocalFile, Folder, ConnectRequest, SessionProfile, SessionGroup, SessionClosedEvent, Settings, UpdateInfo, LocalShellProfile } from '../wailsjs.d.ts';


// The app was renamed from Specter to Xpecter, and every localStorage
// key it uses is namespaced with that name. Renaming the keys without
// moving the existing values across would silently reset an upgrading
// user's theme, shortcuts, snippets, collapsed sections and the rest
// back to defaults. One-time: the old keys are removed as they're
// read, so later launches find nothing left to move.
//
// Position matters. Several preferences below are read at module
// level, as the module evaluates, so this has to run before any of
// them rather than from an init function called later.
(function migrateRenamedStorageKeys(): void {
  const legacyPrefix = 'specter-';
  try {
    // Object.keys snapshots up front, so removing inside the loop is safe.
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(legacyPrefix)) continue;
      const value = localStorage.getItem(key);
      const renamed = `xpecter-${key.slice(legacyPrefix.length)}`;
      // Never clobber a value already written under the new name: if
      // both exist, the new one is the more recent truth.
      if (value !== null && localStorage.getItem(renamed) === null) {
        localStorage.setItem(renamed, value);
      }
      localStorage.removeItem(key);
    }
  } catch {
    // Storage can throw outright (private mode, quota, blocked site
    // data). Losing preferences is bad, failing to start is worse.
  }
})();

type ThemeName = 'dark' | 'light';

const XTERM_THEMES: Record<ThemeName, Record<string, string>> = {
  dark: {
    background: '#1e1e1e', foreground: '#dddddd', cursor: '#dddddd',
    black: '#1e1e1e', red: '#e5484d', green: '#2ea043', yellow: '#d29922',
    blue: '#3178c6', magenta: '#bc7cf0', cyan: '#39c5cf', white: '#dddddd',
    brightBlack: '#666666', brightRed: '#ff6b6b', brightGreen: '#3fb950',
    brightYellow: '#e3b341', brightBlue: '#58a6ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1e1e1e', cursor: '#1e1e1e',
    black: '#1e1e1e', red: '#cf3d3e', green: '#1f8a3d', yellow: '#a06800',
    blue: '#3178c6', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#e5484d', brightGreen: '#2ea043',
    brightYellow: '#d29922', brightBlue: '#4184e4', brightMagenta: '#a475f9',
    brightCyan: '#3192aa', brightWhite: '#1e1e1e',
  },
};

// SPE-61: curated terminal color-scheme presets, separate from the
// dark/light UI chrome toggle above. A full 16-color ANSI palette each,
// same shape as XTERM_THEMES. 'dark'/'light' here alias the existing UI
// themes so picking neither preserves old behavior exactly.
type ColorScheme = ThemeName | 'dracula' | 'nord' | 'solarized-dark' | 'solarized-light' | 'gruvbox-dark' | 'one-dark' | 'tokyo-night';

const TERMINAL_COLOR_SCHEMES: Record<ColorScheme, Record<string, string>> = {
  ...XTERM_THEMES,
  dracula: {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  nord: {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'solarized-dark': {
    background: '#002b36', foreground: '#839496', cursor: '#839496',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'gruvbox-dark': {
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26',
    brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b',
    brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  },
  'one-dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#abb2bf',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
  'tokyo-night': {
    background: '#16161e', foreground: '#c0caf5', cursor: '#c0caf5',
    black: '#15161e', red: '#f7768e', green: '#41a6b5', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#ff899d', brightGreen: '#73daca',
    brightYellow: '#ff9e64', brightBlue: '#8db0ff', brightMagenta: '#c7a9ff',
    brightCyan: '#a4daff', brightWhite: '#c0caf5',
  },
};

// SPE-61: curated font list, not free text, so a user can't select a
// font that doesn't exist. Most of these are real bundled font files
// (imported above via @fontsource, actual .woff2s in the build output),
// guaranteed to render identically everywhere regardless of host OS.
// Menlo, Consolas, and Courier New are the exception: proprietary
// (Apple/Microsoft), can't be legally bundled, fall back to the OS's
// copy if present (Windows/Mac generally have them, stock Linux
// generally doesn't, so those 3 may look unchanged on Linux).
const FONT_OPTIONS: { value: string; stack: string }[] = [
  { value: 'menlo', stack: 'Menlo, Consolas, monospace' },
  { value: 'consolas', stack: 'Consolas, Menlo, monospace' },
  { value: 'cascadia', stack: '"Cascadia Code", Consolas, monospace' },
  { value: 'fira', stack: '"Fira Code", Consolas, monospace' },
  { value: 'jetbrains', stack: '"JetBrains Mono", Consolas, monospace' },
  { value: 'courier', stack: '"Courier New", Courier, monospace' },
  { value: 'ibmplex', stack: '"IBM Plex Mono", Consolas, monospace' },
  { value: 'sourcecodepro', stack: '"Source Code Pro", Consolas, monospace' },
  { value: 'inconsolata', stack: 'Inconsolata, Consolas, monospace' },
  { value: 'victor', stack: '"Victor Mono", Consolas, monospace' },
  { value: 'ubuntumono', stack: '"Ubuntu Mono", Consolas, monospace' },
];

function fontStack(fontId: string): string {
  return FONT_OPTIONS.find((f) => f.value === fontId)?.stack ?? FONT_OPTIONS[0].stack;
}

// SPE-103: custom themes rather than plain vs-dark/vs, so the editor's
// own chrome (gutter, current-line highlight, widgets) sits in
// Xpecter's palette instead of VS Code's inside a Xpecter window. The
// syntax colors themselves are inherited, there's no reason to
// re-invent those.
monaco.editor.defineTheme('xpecter-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e',
    'editorGutter.background': '#1e1e1e',
    'editor.lineHighlightBackground': '#ffffff0a',
    'editorLineNumber.foreground': '#5a5a5a',
    'editorLineNumber.activeForeground': '#bbbbbb',
    'editorIndentGuide.background1': '#2d2d2d',
    'editorWidget.background': '#252525',
    'editorWidget.border': '#333333',
    'editorCursor.foreground': '#dddddd',
  },
});
monaco.editor.defineTheme('xpecter-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorGutter.background': '#ffffff',
    'editor.lineHighlightBackground': '#0000000a',
    'editorLineNumber.foreground': '#9a9a9a',
    'editorLineNumber.activeForeground': '#333333',
    'editorIndentGuide.background1': '#e4e4e4',
    'editorWidget.background': '#f3f3f3',
    'editorWidget.border': '#d0d0d0',
    'editorCursor.foreground': '#1e1e1e',
  },
});

const MONACO_THEMES: Record<ThemeName, string> = {
  dark: 'xpecter-dark',
  light: 'xpecter-light',
};

// --- Functional languages (SPE-107) ---
// Monaco bundles 78 languages. Of the functional family it ships
// Clojure, Elixir, F#, Scala, Scheme and Julia, and misses the rest, so
// the editor's old hand-written extension map had an `hs: 'haskell'`
// entry pointing at an id that was never registered: .hs files quietly
// fell back to plaintext, and the map looked like support without being
// any. These fill the gap, and because they go into the same registry
// Monaco's own languages live in, languageForPath and the Set Language
// picker pick them up with no special-casing.

type LanguageSpec = {
  id: string;
  extensions: string[];
  aliases: string[];
  configuration: monaco.languages.LanguageConfiguration;
  tokenizer: monaco.languages.IMonarchLanguage;
};

function registerLanguage(spec: LanguageSpec) {
  monaco.languages.register({ id: spec.id, extensions: spec.extensions, aliases: spec.aliases });
  monaco.languages.setLanguageConfiguration(spec.id, spec.configuration);
  monaco.languages.setMonarchTokensProvider(spec.id, spec.tokenizer);
}

const CLOSING_PAIRS = [
  { open: '{', close: '}' },
  { open: '[', close: ']' },
  { open: '(', close: ')' },
  { open: '"', close: '"' },
];

// Haskell, PureScript, Idris and Elm share a syntax down to the
// two-dash line comment that must not swallow an operator like -->, and
// the nesting {- -} block comment. One tokenizer, four keyword lists.
function haskellFamilyTokenizer(postfix: string, keywords: string[]): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    tokenPostfix: postfix,
    keywords,
    // The reserved operators, which read as syntax rather than as a
    // function you could have defined yourself.
    operators: ['::', '->', '<-', '=>', '=', '|', '\\', '@', '~', '..', ':'],
    symbols: /[!#$%&*+./<=>?@\\^|\-~:]+/,
    // Numeric and \^X control escapes, plus the named ASCII ones (NUL,
    // ESC, DEL and friends) matched generically rather than enumerated:
    // getting that list subtly wrong is worse than matching it loosely.
    escapes: /\\(?:[abfnrtv\\"'0&]|x[0-9A-Fa-f]+|o[0-7]+|\d+|\^[A-Z@[\]\\^_]|[A-Z]{2,3})/,
    tokenizer: {
      root: [
        [/\{-#/, { token: 'metatag', next: '@pragma' }],
        [/\{-/, { token: 'comment', next: '@comment' }],
        // Two or more dashes start a comment only when what follows is
        // not another symbol character: --> and --| are operators.
        [/--+(?![!#$%&*+./<=>?@\\^|~:]).*$/, 'comment'],

        [/"/, { token: 'string.quote', next: '@string' }],
        [/'(?:[^\\']|@escapes)'/, 'string'],

        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/0[bB][01_]+/, 'number.binary'],
        [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],

        // Constructors, type names and module qualifiers are all the
        // capitalised half of the naming rule, and all read the same
        // way at a glance.
        [/[A-Z][\w']*/, 'type.identifier'],

        [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],

        [/[()[\]{}]/, '@brackets'],
        [/[,;`]/, 'delimiter'],

        [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': 'operator' } }],

        [/[ \t\r\n]+/, ''],
      ],

      // These block comments nest, unlike C's.
      comment: [
        [/[^{-]+/, 'comment'],
        [/\{-/, 'comment', '@push'],
        [/-\}/, 'comment', '@pop'],
        [/[{-]/, 'comment'],
      ],

      pragma: [
        [/#-\}/, { token: 'metatag', next: '@pop' }],
        [/[^#]+/, 'metatag'],
        [/#/, 'metatag'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  };
}

const HASKELL_CONFIGURATION: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '--', blockComment: ['{-', '-}'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: CLOSING_PAIRS,
  surroundingPairs: [...CLOSING_PAIRS, { open: "'", close: "'" }],
};

registerLanguage({
  id: 'haskell',
  extensions: ['.hs', '.lhs', '.hs-boot'],
  aliases: ['Haskell', 'haskell'],
  configuration: HASKELL_CONFIGURATION,
  tokenizer: haskellFamilyTokenizer('.hs', [
    'case', 'class', 'data', 'default', 'deriving', 'do', 'else', 'family',
    'forall', 'foreign', 'hiding', 'if', 'import', 'in', 'infix', 'infixl',
    'infixr', 'instance', 'let', 'mdo', 'module', 'newtype', 'of', 'proc',
    'qualified', 'rec', 'then', 'type', 'where',
  ]),
});

// PureScript and Idris get their own ids rather than being folded into
// Haskell's extension list: the grammar is close enough to share, but
// the status bar saying "Haskell" over a .purs file would be a small
// lie, and the Set Language picker should offer them by name.
registerLanguage({
  id: 'purescript',
  extensions: ['.purs'],
  aliases: ['PureScript', 'purescript'],
  configuration: HASKELL_CONFIGURATION,
  tokenizer: haskellFamilyTokenizer('.purs', [
    'ado', 'case', 'class', 'data', 'derive', 'do', 'else', 'false', 'forall',
    'foreign', 'hiding', 'if', 'import', 'in', 'infix', 'infixl', 'infixr',
    'instance', 'let', 'module', 'newtype', 'of', 'then', 'true', 'type',
    'where',
  ]),
});

registerLanguage({
  id: 'idris',
  extensions: ['.idr', '.lidr'],
  aliases: ['Idris', 'idris'],
  configuration: HASKELL_CONFIGURATION,
  tokenizer: haskellFamilyTokenizer('.idr', [
    'auto', 'case', 'class', 'data', 'do', 'dsl', 'else', 'export', 'if',
    'implementation', 'implicit', 'import', 'impossible', 'in', 'infix',
    'infixl', 'infixr', 'instance', 'interface', 'let', 'module', 'mutual',
    'namespace', 'of', 'parameters', 'partial', 'postulate', 'private',
    'public', 'record', 'rewrite', 'then', 'total', 'using', 'where', 'with',
  ]),
});

registerLanguage({
  id: 'elm',
  extensions: ['.elm'],
  aliases: ['Elm', 'elm'],
  configuration: HASKELL_CONFIGURATION,
  tokenizer: haskellFamilyTokenizer('.elm', [
    'alias', 'as', 'case', 'effect', 'else', 'exposing', 'if', 'import', 'in',
    'let', 'module', 'of', 'port', 'then', 'type', 'where',
  ]),
});

// OCaml and Standard ML share the (* *) comment, which also nests, and
// the ' that is a character quote in one position and a type variable
// in another.
function mlFamilyTokenizer(postfix: string, keywords: string[]): monaco.languages.IMonarchLanguage {
  return {
    defaultToken: '',
    tokenPostfix: postfix,
    keywords,
    operators: ['->', '<-', '::', ':=', '|>', '@@', '=', '|', '&&', '||', '^'],
    symbols: /[=><!~?:&|+\-*/^%@.#]+/,
    escapes: /\\(?:[\\"'ntbr ]|\d{3}|x[0-9A-Fa-f]{2}|o[0-3][0-7]{2})/,
    tokenizer: {
      root: [
        [/\(\*/, { token: 'comment', next: '@comment' }],

        // Standard ML's character literal and tuple projection. OCaml
        // spells neither, and its own # (method call) falls through to
        // the symbol rule below.
        [/#"(?:[^\\"]|@escapes)*"/, 'string'],
        [/#\d+/, 'operator'],

        [/"/, { token: 'string.quote', next: '@string' }],
        // The character literal has to be tried before the type
        // variable, since 'a' and 'a differ only by the closing quote.
        [/'(?:[^\\']|@escapes)'/, 'string'],
        [/'[a-z_][\w']*/, 'type.identifier'],
        [/`[A-Z][\w']*/, 'type.identifier'],
        [/[A-Z][\w']*/, 'type.identifier'],

        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[oO][0-7_]+/, 'number.octal'],
        [/0[bB][01_]+/, 'number.binary'],
        [/\d[\d_]*(\.[\d_]*)?([eE][-+]?\d+)?/, 'number'],

        [/[a-z_][\w']*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],

        [/[()[\]{}]/, '@brackets'],
        [/[;,]/, 'delimiter'],

        [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': 'operator' } }],

        [/[ \t\r\n]+/, ''],
      ],

      comment: [
        [/[^(*]+/, 'comment'],
        [/\(\*/, 'comment', '@push'],
        [/\*\)/, 'comment', '@pop'],
        [/[(*]/, 'comment'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  };
}

const ML_CONFIGURATION: monaco.languages.LanguageConfiguration = {
  comments: { blockComment: ['(*', '*)'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: CLOSING_PAIRS,
  surroundingPairs: CLOSING_PAIRS,
};

registerLanguage({
  id: 'ocaml',
  extensions: ['.ml', '.mli'],
  aliases: ['OCaml', 'ocaml'],
  configuration: ML_CONFIGURATION,
  tokenizer: mlFamilyTokenizer('.ml', [
    'and', 'as', 'assert', 'asr', 'begin', 'class', 'constraint', 'do',
    'done', 'downto', 'else', 'end', 'exception', 'external', 'false', 'for',
    'fun', 'function', 'functor', 'if', 'in', 'include', 'inherit',
    'initializer', 'land', 'lazy', 'let', 'lor', 'lsl', 'lsr', 'lxor',
    'match', 'method', 'mod', 'module', 'mutable', 'new', 'nonrec', 'object',
    'of', 'open', 'or', 'private', 'rec', 'sig', 'struct', 'then', 'to',
    'true', 'try', 'type', 'val', 'virtual', 'when', 'while', 'with',
  ]),
});

registerLanguage({
  id: 'sml',
  extensions: ['.sml', '.sig'],
  aliases: ['Standard ML', 'sml'],
  configuration: ML_CONFIGURATION,
  tokenizer: mlFamilyTokenizer('.sml', [
    'abstype', 'and', 'andalso', 'as', 'case', 'datatype', 'do', 'else',
    'end', 'eqtype', 'exception', 'false', 'fn', 'fun', 'functor', 'handle',
    'if', 'in', 'include', 'infix', 'infixr', 'let', 'local', 'nonfix', 'of',
    'op', 'open', 'orelse', 'raise', 'rec', 'sharing', 'sig', 'signature',
    'struct', 'structure', 'then', 'true', 'type', 'val', 'where', 'while',
    'with', 'withtype',
  ]),
});

registerLanguage({
  id: 'erlang',
  extensions: ['.erl', '.hrl', '.escript'],
  aliases: ['Erlang', 'erlang'],
  configuration: {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: CLOSING_PAIRS,
    surroundingPairs: CLOSING_PAIRS,
  },
  tokenizer: {
    defaultToken: '',
    tokenPostfix: '.erl',
    keywords: [
      'after', 'and', 'andalso', 'band', 'begin', 'bnot', 'bor', 'bsl', 'bsr',
      'bxor', 'case', 'catch', 'cond', 'div', 'else', 'end', 'fun', 'if',
      'let', 'maybe', 'not', 'of', 'or', 'orelse', 'receive', 'rem', 'try',
      'when', 'xor',
    ],
    operators: [
      '->', '<-', '=>', ':=', '||', '|', '++', '--', '==', '/=', '=<', '>=',
      '=:=', '=/=', '!', '=', '::',
    ],
    symbols: /[=><!~?:&|+\-*/^%#]+/,
    escapes: /\\(?:[abdefnrstv\\"']|\^[A-Za-z]|x[0-9A-Fa-f]{2}|x\{[0-9A-Fa-f]+\}|\d{1,3})/,
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],

        // Module attributes, spelled out rather than matched as
        // "minus then any atom": Monarch has no start-of-line anchor
        // mid-stream, and the loose version colours every binary minus
        // that happens to be followed by an atom.
        [/-\s*(?:author|behaviour|behavior|callback|compile|define|doc|else|endif|export_type|export|file|ifdef|ifndef|include_lib|include|import|moduledoc|module|on_load|opaque|optional_callbacks|record|spec|type|undef|vsn)\b/, 'keyword'],

        [/"/, { token: 'string.quote', next: '@string' }],
        // Quoted atoms, and the $c character literal.
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, 'string'],
        [/\$(?:@escapes|.)/, 'string'],

        // Variables are the capitalised half of Erlang's naming rule,
        // and _ on its own is the one everybody writes most.
        [/[A-Z_][\w@]*/, 'variable'],

        [/\d+#[0-9a-zA-Z]+/, 'number'],
        [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],

        [/[a-z][\w@]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],

        [/[()[\]{}]/, '@brackets'],
        [/[;,.]/, 'delimiter'],

        [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': 'operator' } }],

        [/[ \t\r\n]+/, ''],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  },
});

registerLanguage({
  id: 'nix',
  extensions: ['.nix'],
  aliases: ['Nix', 'nix'],
  configuration: {
    comments: { lineComment: '#', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: CLOSING_PAIRS,
    surroundingPairs: CLOSING_PAIRS,
  },
  tokenizer: {
    defaultToken: '',
    tokenPostfix: '.nix',
    keywords: [
      'assert', 'builtins', 'else', 'false', 'if', 'import', 'in', 'inherit',
      'let', 'null', 'or', 'rec', 'then', 'true', 'with',
    ],
    operators: ['=', ':', '?', '//', '++', '->', '&&', '||', '!', '==', '!=', '<=', '>='],
    symbols: /[=><!~?:&|+\-*/@]+/,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\/\*/, { token: 'comment', next: '@comment' }],

        // The indented string comes first: '' opens one, and would
        // otherwise read as an empty single-quoted nothing.
        [/''/, { token: 'string.quote', next: '@indentedString' }],
        [/"/, { token: 'string.quote', next: '@string' }],

        // <nixpkgs> lookups and literal paths, which are a real type in
        // this language rather than just strings that look like one.
        [/<[\w.+-]+(?:\/[\w.+-]+)*>/, 'string'],
        [/(?:\.{1,2}|~)?\/[\w.+-]+(?:\/[\w.+-]+)*/, 'string'],

        [/\d+(\.\d+)?/, 'number'],

        [/[a-zA-Z_][\w'-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],

        [/[()[\]{}]/, '@brackets'],
        [/[;,.]/, 'delimiter'],

        [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': 'operator' } }],

        [/[ \t\r\n]+/, ''],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, { token: 'comment', next: '@pop' }],
        [/[/*]/, 'comment'],
      ],

      string: [
        [/[^\\"$]+/, 'string'],
        [/\$\{/, { token: 'delimiter.bracket', next: '@interpolation' }],
        [/\\./, 'string.escape'],
        [/\$/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],

      indentedString: [
        [/[^'$]+/, 'string'],
        [/\$\{/, { token: 'delimiter.bracket', next: '@interpolation' }],
        [/''\$/, 'string.escape'],
        [/''/, { token: 'string.quote', next: '@pop' }],
        [/['$]/, 'string'],
      ],

      // Interpolation is ordinary Nix again, so it borrows root's rules
      // and only has to know where it ends.
      interpolation: [
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: '@root' },
      ],
    },
  },
});

registerLanguage({
  id: 'lisp',
  extensions: ['.lisp', '.cl', '.lsp', '.el', '.rkt'],
  aliases: ['Lisp', 'lisp', 'Common Lisp', 'Racket'],
  configuration: {
    comments: { lineComment: ';', blockComment: ['#|', '|#'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: CLOSING_PAIRS,
    surroundingPairs: CLOSING_PAIRS,
  },
  tokenizer: {
    defaultToken: '',
    tokenPostfix: '.lisp',
    keywords: [
      'and', 'begin', 'case', 'cond', 'declare', 'defconstant', 'defclass',
      'define', 'define-record-type', 'define-struct', 'define-syntax',
      'defgeneric', 'defmacro', 'defmethod', 'defpackage', 'defparameter',
      'defstruct', 'defun', 'defvar', 'delay', 'do', 'else', 'flet', 'if',
      'in-package', 'labels', 'lambda', 'let', 'let*', 'let-values', 'letrec',
      'loop', 'macrolet', 'multiple-value-bind', 'nil', 'not', 'or', 'progn',
      'quasiquote', 'quote', 'require', 'return', 'return-from', 'set!',
      'setf', 'setq', 'struct', 't', 'unless', 'unwind-protect', 'when',
    ],
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/#\|/, { token: 'comment', next: '@blockComment' }],

        [/"/, { token: 'string.quote', next: '@string' }],
        // Character literals: #\a, #\newline.
        [/#\\(?:[a-zA-Z][a-zA-Z0-9-]*|.)/, 'string'],
        [/#[tf]\b/, 'keyword'],

        // Self-evaluating keywords, :like-this.
        [/:[\w+\-*/<>=!?.]+/, 'type.identifier'],

        [/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, 'number'],
        [/#[xX][0-9a-fA-F]+/, 'number.hex'],
        [/#[bB][01]+/, 'number.binary'],
        [/#[oO][0-7]+/, 'number.octal'],

        [/[()[\]]/, '@brackets'],
        [/['`,@]/, 'operator'],

        // Everything that is not whitespace, a bracket or a reader
        // character is a symbol, which is as close as this language
        // gets to an identifier rule.
        [/[^\s()[\]"';`,]+/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],

        [/[ \t\r\n]+/, ''],
      ],

      blockComment: [
        [/[^#|]+/, 'comment'],
        [/#\|/, 'comment', '@push'],
        [/\|#/, 'comment', '@pop'],
        [/[#|]/, 'comment'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  },
});

registerLanguage({
  id: 'agda',
  extensions: ['.agda', '.lagda'],
  aliases: ['Agda', 'agda'],
  configuration: HASKELL_CONFIGURATION,
  tokenizer: haskellFamilyTokenizer('.agda', [
    'abstract', 'constructor', 'data', 'do', 'field', 'forall', 'hiding',
    'import', 'in', 'inductive', 'infix', 'infixl', 'infixr', 'instance',
    'let', 'macro', 'module', 'mutual', 'open', 'overlap', 'pattern',
    'postulate', 'primitive', 'private', 'public', 'quote', 'record',
    'renaming', 'rewrite', 'syntax', 'using', 'variable', 'where', 'with',
  ]),
});

// Lean is close to the Haskell family but not in it: the block comment
// is /- -/ rather than {- -}, the line comment has no operator
// exception to worry about, and tactic names are worth their own colour
// since a proof is mostly tactics.
registerLanguage({
  id: 'lean',
  extensions: ['.lean'],
  aliases: ['Lean', 'lean'],
  configuration: {
    comments: { lineComment: '--', blockComment: ['/-', '-/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: CLOSING_PAIRS,
    surroundingPairs: CLOSING_PAIRS,
  },
  tokenizer: {
    defaultToken: '',
    tokenPostfix: '.lean',
    keywords: [
      'abbrev', 'attribute', 'axiom', 'by', 'calc', 'class', 'def',
      'deriving', 'do', 'else', 'end', 'example', 'exists', 'extends', 'for',
      'from', 'fun', 'have', 'if', 'import', 'in', 'inductive', 'infix',
      'infixl', 'infixr', 'instance', 'let', 'macro', 'macro_rules', 'match',
      'mutual', 'namespace', 'noncomputable', 'notation', 'opaque', 'open',
      'partial', 'postfix', 'prefix', 'private', 'protected', 'return',
      'section', 'set_option', 'show', 'structure', 'syntax', 'theorem',
      'then', 'this', 'universe', 'unsafe', 'variable', 'where', 'while',
      'with', 'lemma', 'obtain', 'suffices', 'sorry',
    ],
    // A proof body is mostly these, so they read better as their own
    // category than as undifferentiated identifiers.
    tactics: [
      'apply', 'assumption', 'cases', 'constructor', 'contradiction',
      'decide', 'exact', 'induction', 'intro', 'intros', 'linarith', 'omega',
      'refine', 'rfl', 'ring', 'rintro', 'rw', 'simp', 'simpa', 'split',
      'subst', 'trivial', 'unfold', 'use',
    ],
    typeKeywords: ['Prop', 'Sort', 'Type'],
    operators: [
      '=>', '->', '<-', ':=', '|', '=', '<|>', '>>=', '$', '::', '++', '..',
      '↦', '→', '←', '∀', '∃', '∧', '∨', '¬', '≠', '≤', '≥', '∘', '×',
    ],
    symbols: /[=><!~?:&|+\-*/^%@.↦→←∀∃∧∨¬≠≤≥∘×]+/,
    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4})/,
    tokenizer: {
      root: [
        // The doc comment opens with the same two characters as the
        // ordinary one, so it has to be tried first.
        [/\/--/, { token: 'comment.doc', next: '@docComment' }],
        [/\/-/, { token: 'comment', next: '@comment' }],
        [/--.*$/, 'comment'],

        // Attributes: @[simp], @[inline].
        [/@\[/, { token: 'metatag', next: '@attribute' }],

        [/"/, { token: 'string.quote', next: '@string' }],
        [/'(?:[^\\']|@escapes)'/, 'string'],

        [/0[xX][0-9a-fA-F_]+/, 'number.hex'],
        [/0[bB][01_]+/, 'number.binary'],
        [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],

        // Anonymous constructors and other bracket-shaped notation.
        [/[⟨⟩]/, '@brackets'],

        [/[A-Z][\w'!?₀-₉]*/, {
          cases: { '@typeKeywords': 'keyword', '@default': 'type.identifier' },
        }],

        [/[a-zA-Z_][\w'!?₀-₉]*/, {
          cases: {
            '@keywords': 'keyword',
            '@tactics': 'keyword.control',
            '@default': 'identifier',
          },
        }],

        [/[()[\]{}]/, '@brackets'],
        [/[,;]/, 'delimiter'],

        [/@symbols/, { cases: { '@operators': 'keyword.operator', '@default': 'operator' } }],

        [/[ \t\r\n]+/, ''],
      ],

      // Lean's block comments nest, so the doc variant closes through
      // the same counter the ordinary one uses.
      comment: [
        [/[^/-]+/, 'comment'],
        [/\/-/, 'comment', '@push'],
        [/-\//, 'comment', '@pop'],
        [/[/-]/, 'comment'],
      ],

      docComment: [
        [/[^/-]+/, 'comment.doc'],
        [/\/-/, 'comment.doc', '@push'],
        [/-\//, 'comment.doc', '@pop'],
        [/[/-]/, 'comment.doc'],
      ],

      attribute: [
        [/\]/, { token: 'metatag', next: '@pop' }],
        [/[^\]]+/, 'metatag'],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  },
});

// --- Skald (SPE-120) ---
// A local DSL for switch configuration, so nothing ships with it and
// there is no upstream grammar to borrow. Every keyword below is one
// the parser actually accepts: they came from the `symbol` and `string`
// literals in haskell-dsl/src/Parser.hs rather than from the example
// files, so a keyword the language has but no example uses still
// highlights.

// The nine resource blocks a document is built from, and the three
// words that say how one of them meets the device. They are the
// skeleton you scan for when reading a policy, so they read differently
// from the settings inside them.
const SKALD_BLOCKS = [
  'interface', 'management', 'policy', 'port-mode', 'root-eligibility',
  'stp-guard', 'system', 'users', 'vlan-database',
  'augment', 'replace', 'within',
];

// Everything else the grammar names: statement heads, the settings they
// carry, and the bare flags that are a whole statement on their own.
const SKALD_SETTINGS = [
  'access', 'alerts', 'all', 'any-port', 'archive', 'attempts',
  'block-for', 'bpduguard', 'buffered', 'candidate', 'client', 'console',
  'contact', 'critical', 'debugging', 'delay', 'description',
  'domain-name', 'emergencies', 'enable-secret', 'env', 'errors',
  'exec-timeout', 'facility', 'from', 'guard', 'host', 'hostname',
  'http', 'https', 'informational', 'line', 'location', 'log-config',
  'log-on-failure', 'log-on-success', 'logging-synchronous', 'login',
  'loop', 'name', 'native', 'negotiable', 'never', 'no-bpduguard',
  'no-description', 'no-http', 'no-https', 'no-logging-synchronous',
  'no-pad', 'no-password-encryption', 'no-portfast',
  'no-timestamps-datetime', 'none', 'nonegotiable', 'notifications',
  'off', 'origin-id', 'pad', 'password-encryption', 'port', 'portfast',
  'privilege', 'root', 'secret', 'server', 'session-timeout', 'shutdown',
  'size', 'snmp', 'ssh', 'static-arp', 'syslog', 'telnet', 'timeout',
  'timestamps-datetime', 'transparent', 'transport-input',
  'transport-output', 'trunk', 'up', 'user', 'vlan', 'vlans', 'vtp',
  'vty', 'warnings',
];

registerLanguage({
  id: 'skald',
  extensions: ['.skald'],
  aliases: ['Skald', 'skald'],
  configuration: {
    // Line comments only, and no bracket but the brace: the language
    // has no block comment, and no list or call syntax to pair up.
    comments: { lineComment: '--' },
    brackets: [['{', '}']],
    autoClosingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }],
    surroundingPairs: [{ open: '{', close: '}' }, { open: '"', close: '"' }],
    // Hyphens and slashes are inside words here rather than between
    // them: no-portfast is one keyword and gi1/0/1 is one port. Monaco's
    // default pattern splits both, so double-click and word-wise motion
    // would select fragments that mean nothing on their own.
    wordPattern: /[A-Za-z0-9_][-A-Za-z0-9_/]*/,
  },
  tokenizer: {
    defaultToken: '',
    tokenPostfix: '.skald',
    blocks: SKALD_BLOCKS,
    settings: SKALD_SETTINGS,
    tokenizer: {
      root: [
        // These three take the rest of the line VERBATIM, so a '--' in
        // one is data rather than a comment, and quotes are part of the
        // value rather than delimiters around it. Parser.hs is explicit
        // about why: IOS stores a description exactly as typed, and a
        // quote-delimited literal would round-trip half of a real
        // switch's descriptions wrongly. Ahead of the comment rule so
        // the text keeps its colour all the way to end of line.
        [/(description|location|contact)([ \t]+)([^\n]*)/, ['type', '', 'string']],

        [/--.*$/, 'comment'],
        [/"/, { token: 'string.quote', next: '@string' }],

        // Addresses before numbers, or an IP tokenises as four separate
        // ones with stray dots left between them.
        [/[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}/, 'number.hex'],
        [/\d{1,3}(?:\.\d{1,3}){3}/, 'number.float'],

        // Ports, spelled the way IOS spells them, in the range forms the
        // parser accepts: gi1/0/1, te1/0/1-2, gi1/0/2-gi1/0/8. They are
        // the subject of most statements in the language, so they read
        // as their own thing rather than as identifiers.
        [/[A-Za-z]+\d+(?:\/\d+)+(?:-(?:[A-Za-z]+\d+(?:\/\d+)+|\d+))?/, 'variable'],

        // A VLAN or line range is one value: within 10-30, line vty 0-15.
        [/\d+(?:-\d+)?/, 'number'],

        [/[{}]/, '@brackets'],
        [/->/, 'operator'],
        [/,/, 'delimiter'],

        // Hyphens are word characters here: root-eligibility is one
        // keyword, and no-portfast is not a negated portfast.
        [/[A-Za-z_][\w-]*/, {
          cases: { '@blocks': 'keyword', '@settings': 'type', '@default': 'identifier' },
        }],

        [/[ \t\r\n]+/, ''],
      ],

      // No escape sequences: a quoted value is bytes on their way to a
      // switch, and the parser reads it exactly as written.
      string: [
        [/[^"]+/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  },
});

type MonacoWorkerEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker;
};

(globalThis as typeof globalThis & { MonacoEnvironment: MonacoWorkerEnvironment }).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// In-memory copy of backend-persisted settings.json (SPE-61), loaded
// once at startup via App.GetSettings(). Deliberately not localStorage,
// matches the file-on-disk decision made for the wallpaper image itself.
let appSettings: Settings = {};

function currentColorScheme(): ColorScheme {
  const s = appSettings.colorScheme;
  if (s && s in TERMINAL_COLOR_SCHEMES) return s as ColorScheme;
  return currentTheme();
}

function wallpaperActive(): boolean {
  return !!appSettings.wallpaperPath;
}

// Wallpaper mode uses xterm's canvas renderer, whose transparent theme can
// reveal the CSS image. WebGL owns an opaque canvas clear on WebView2, so it
// remains reserved for sessions without wallpaper rather than fighting the
// browser compositor.
function activeXtermTheme(): Record<string, string> {
  const base = TERMINAL_COLOR_SCHEMES[currentColorScheme()];
  if (!wallpaperActive()) return base;
  return { ...base, background: 'rgba(0, 0, 0, 0)' };
}

function refreshAllTerminalThemes() {
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      if (s.term) s.term.options.theme = activeXtermTheme();
    }
  }
}

function createWebglAddon(term: Terminal, onContextLoss?: () => void): WebglAddon | null {
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon.dispose();
      onContextLoss?.();
    });
    term.loadAddon(webglAddon);
    return webglAddon;
  } catch (error) {
    console.warn('WebGL terminal renderer unavailable; using the default renderer.', error);
    return null;
  }
}

// SPE-77: zoom drives the same persisted appSettings.fontSize shown in
// Settings, not a separate temporary zoom layer, confirmed choice.
// Applies to every live tab (font size is global, not per-tab, same
// reasoning as refreshAllTerminalThemes above), refitting and notifying
// the backend of the new terminal size for each, mirroring what
// refitActiveTerminal does for a single tab.
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 13;

function applyFontSize(size: number) {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(size)));
  appSettings.fontSize = clamped;
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      if (!s.term || !s.fitAddon) continue;
      s.term.options.fontSize = clamped;
      syncSessionSize(s);
    }
  }
  // SPE-78: editors share the same font size setting as the terminal,
  // confirmed choice, not an independent editor-specific size.
  updateAllEditors({ fontSize: clamped });
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;
  fontSizeSelect.value = String(clamped);
  App.SaveSettings(appSettings);
}

// SPE-127: the terminal is 80 columns wide. Always, whatever the window
// is doing.
//
// Deriving the column count from the pane is what every modern terminal
// does, and it is what made this one unusable on network gear. The
// column count decides two separate things, and following the window
// breaks both:
//
//   - What the remote lays its output out for. A FortiGate told it has
//     ~120 columns prints a table that needs ~170 and wraps every row
//     into a ragged pair; told 80 it prints a narrower table that fits.
//     There is a whole band of widths where its output cannot fit the
//     width it was given, and a window dragged to any size lands in it.
//   - How xterm draws what it already has. Changing the column count
//     reflows the entire buffer (Buffer._reflow runs whenever cols
//     differ, with no option to stop it), so every resize and every
//     zoom re-wrapped output that was already on screen and correct.
//
// 200 because this FortiGate's widest table runs to about 170
// characters and this clears it, so the whole thing lands on screen
// with nothing lost. Wider than most windows, which is fine: the pane
// scrolls sideways (see .pane-term-host). A grid wider than the view
// costs a scrollbar; a grid narrower than the output costs the columns
// past the edge, permanently, because of the wrap mode below.
//
// Rows still follow the pane: the row count reflows nothing, and
// pinning it would either waste the bottom of a tall window or walk the
// prompt off the bottom of a short one.
const TERMINAL_COLS = 200;

// SPE-132: auto-wrap (DECAWM), decided per session kind, because the two kinds
// want opposite things.
//
// A remote device session clips. Its output is tables, and a row that
// folds onto a second line takes every column out of alignment with the
// rows around it, which is what made a FortiGate's lease list
// unreadable. Clipping keeps one row per row.
//
// A local shell wraps, and must. The shell is told the PTY is this wide
// and does its own arithmetic on that: cmd.exe echoing a pasted
// 400-character command counts on the terminal moving to the next row
// at column 200, and when it doesn't, every cursor position after that
// is wrong. The line piles into the last cell, the redraw lands in the
// middle of the screen, and the prompt repeats down the pane. That is
// what turning this off globally did.
//
// The same hazard exists on the remote side, just far out of the way:
// typing or pasting a single line longer than 200 characters into a
// device session will misrender the same way, and needs a redraw to
// recover. 200 is long for a device CLI, and the tables this is here
// for are nowhere near it, so it is the better trade of the two.
const DECAWM_ON = '\x1b[?7h';
const DECAWM_OFF = '\x1b[?7l';

function applyWrapMode(session: Session) {
  session.term?.write(session.mode === 'local' ? DECAWM_ON : DECAWM_OFF);
}

// The one place a terminal's dimensions are decided. Returns null while
// the pane is still unmeasurable, which callers treat as "not yet".
function sizeTerminal(session: Session): { cols: number; rows: number } | null {
  if (!session.term || !session.fitAddon) return null;
  // proposeDimensions only for its rows, and because it is also the
  // signal that xterm has measured its cell size at all: it returns
  // undefined until then, and a resize before that would be based on
  // nothing.
  const proposed = session.fitAddon.proposeDimensions();
  if (!proposed || proposed.rows <= 0) return null;
  if (session.term.cols !== TERMINAL_COLS || session.term.rows !== proposed.rows) {
    session.term.resize(TERMINAL_COLS, proposed.rows);
    // Re-asserted rather than set once: a remote program is free to
    // change the mode itself, readline among them.
    applyWrapMode(session);
  }
  return { cols: session.term.cols, rows: session.term.rows };
}

function zoomBy(delta: number) {
  applyFontSize((appSettings.fontSize || FONT_SIZE_DEFAULT) + delta);
}

// SPE-125: refuse the webview's page zoom. Ctrl+wheel (and the trackpad
// pinch that arrives as the same event) scales the entire app, not the
// terminal, and it is far too easy to trigger while scrolling scrollback
// with a modifier still held. main.go turns the same thing off at the
// WebView2 level, which is the real fix but only covers Windows; this
// covers the Linux and macOS builds too, and is the only half of the
// pair that a `wails dev` browser tab ever sees.
// Deliberately not repurposed to change font size: zoomBy above is on
// Ctrl+= / Ctrl+- / Ctrl+0 for that, and a wheel that silently resizes
// text is the surprise this is here to remove.
// passive: false because a passive listener is forbidden to
// preventDefault; capture so it lands before anything downstream.
// SPE-127: and having refused it, do the thing people actually reach for
// the gesture to do, the same as Ctrl+= / Ctrl+- and the same as
// MobaXterm: resize the text. stopPropagation as well as preventDefault,
// so the wheel doesn't also scroll the scrollback out from under what is
// being read while zooming.
// deltaY is normalised because a wheel reports pixels, lines or pages
// depending on the device, and a line-mode wheel reports about 3 per
// notch: without this a mouse in line mode would never reach a step.
let ctrlWheelDelta = 0;
window.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  event.stopPropagation();
  const perUnit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
  ctrlWheelDelta += event.deltaY * perUnit;
  const steps = Math.trunc(ctrlWheelDelta / 100);
  if (steps === 0) return;
  ctrlWheelDelta -= steps * 100;
  zoomBy(-steps);
}, { passive: false, capture: true });

function applyColorScheme(name: ColorScheme) {
  appSettings.colorScheme = name;
  App.SaveSettings(appSettings);
  refreshAllTerminalThemes();
}

function applyFont(fontId: string) {
  appSettings.fontFamily = fontId;
  App.SaveSettings(appSettings);
  const stack = fontStack(fontId);
  // SPE-61 originally only touched the terminal itself; the picker
  // should also cover the rest of the app chrome (sidebar, menus, tab
  // bar), otherwise the terminal font visibly doesn't match everything
  // around it.
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  // SPE-103: editor sessions share the terminal's coding font, the same
  // reasoning as the shared font size.
  updateAllEditors({ fontFamily: stack });
  refitActiveTerminal();
}

// Renders the wallpaper on each terminal's fixed host rather than the
// scrollable .xterm-viewport. The viewport's scroll height changes when
// the font size changes, which makes background-size: cover recompute its
// scale and center position. The host stays fixed while terminal content
// resizes, so the image remains visually anchored.
function wallpaperBackgroundImage(): string {
  if (!appSettings.wallpaperDataUrl) return '';
  const opacity = appSettings.wallpaperOpacity ?? 0.15;
  const dim = 1 - opacity;
  return `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${appSettings.wallpaperDataUrl}")`;
}

// SPE-127: the still box behind a terminal, the one that doesn't move
// when the text is scrolled sideways. Everything anchored to a pane
// rather than to the text hangs off this.
function termFrameOf(session: Session): HTMLElement | null {
  const host = session.term?.element?.parentElement ?? null;
  return (host?.parentElement as HTMLElement | null) ?? null;
}

function applyWallpaperToSession(session: Session) {
  if (!session.term?.element) return;
  const termHost = termFrameOf(session);
  const viewport = session.term.element.querySelector('.xterm-viewport') as HTMLElement | null;
  const screen = session.term.element.querySelector('.xterm-screen') as HTMLElement | null;
  if (!termHost || !viewport) return;
  const bg = wallpaperBackgroundImage();
  if (bg) {
    termHost.style.backgroundImage = bg;
    termHost.style.backgroundSize = '100% 100%';
    termHost.style.backgroundPosition = '0 0';
    viewport.style.backgroundImage = '';
  } else {
    termHost.style.backgroundImage = '';
    viewport.style.backgroundImage = '';
  }
  viewport.style.backgroundColor = 'transparent';
  if (screen) screen.style.backgroundColor = 'transparent';
  session.term.element.style.backgroundColor = 'transparent';
}

function applyRendererMode(session: Session) {
  if (!session.term) return;
  const shouldUseWebgl = !wallpaperActive();
  if (shouldUseWebgl && !session.webglAddon) {
    session.webglAddon = createSessionWebglAddon(session);
  } else if (!shouldUseWebgl && session.webglAddon) {
    session.webglAddon.dispose();
    session.webglAddon = null;
  }
}

function createSessionWebglAddon(session: Session): WebglAddon | null {
  if (!session.term) return null;
  return createWebglAddon(session.term, () => {
    session.webglAddon = null;
    if (!wallpaperActive()) {
      window.setTimeout(() => {
        if (!wallpaperActive() && session.term && !session.webglAddon) {
          session.webglAddon = createSessionWebglAddon(session);
        }
      }, 250);
    }
  });
}

function applyWallpaperVisual() {
  for (const tab of tabs.values()) {
    for (const s of allSessions(tab)) {
      applyRendererMode(s);
      applyWallpaperToSession(s);
    }
  }
  document.getElementById('wallpaper-opacity-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  document.getElementById('wallpaper-clear-row')!.style.display = appSettings.wallpaperPath ? 'flex' : 'none';
  refreshAllTerminalThemes();
}

async function setWallpaper(path: string) {
  appSettings.wallpaperPath = path;
  appSettings.wallpaperDataUrl = await App.ReadImageFile(path);
  if (!appSettings.wallpaperOpacity) appSettings.wallpaperOpacity = 0.15;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function clearWallpaper() {
  appSettings.wallpaperPath = '';
  appSettings.wallpaperDataUrl = undefined;
  await App.SaveSettings(appSettings);
  applyWallpaperVisual();
}

async function loadSettingsAndApply() {
  appSettings = await App.GetSettings();
  if (appSettings.wallpaperPath) {
    try {
      appSettings.wallpaperDataUrl = await App.ReadImageFile(appSettings.wallpaperPath);
    } catch {
      // Wallpaper file moved/deleted since last launch, fall back to no
      // wallpaper rather than a broken image or a thrown error at startup.
      appSettings.wallpaperPath = '';
    }
  }
  const colorSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
  colorSelect.value = appSettings.colorScheme || currentTheme();
  const fontSelectEl = document.getElementById('font-select') as HTMLSelectElement;
  fontSelectEl.value = appSettings.fontFamily || FONT_OPTIONS[0].value;
  const opacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
  opacitySlider.value = String(Math.round((appSettings.wallpaperOpacity ?? 0.15) * 100));
  applyWallpaperVisual();

  const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
  keepaliveToggle.checked = !appSettings.sshKeepaliveDisabled;
  document.getElementById('session-log-clear-row')!.style.display = appSettings.sessionLogDirectory ? 'block' : 'none';

  const keepOpenToggle = document.getElementById('keep-open-last-tab-toggle') as HTMLInputElement;
  keepOpenToggle.checked = !!appSettings.keepOpenOnLastTab;

  const initialSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  const fontSizeSelect = document.getElementById('font-size-select') as HTMLSelectElement;
  fontSizeSelect.value = String(initialSize);

  // In case a tab was created before this async load resolved (race:
  // GetSettings is an IPC round-trip), reapply font to whatever's live.
  // refreshAllTerminalThemes (called by applyWallpaperVisual above)
  // already handles color.
  const stack = fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value);
  document.body.style.fontFamily = stack;
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontFamily = stack;
  }
  // Same race-condition reasoning for font SIZE: an editor pane or a
  // terminal tab may already exist by the time this async settings load
  // resolves, if one was opened or connected fast enough.
  const savedFontSize = appSettings.fontSize || FONT_SIZE_DEFAULT;
  updateAllEditors({ fontSize: savedFontSize });
  for (const tab of tabs.values()) {
    if (tab.term) tab.term.options.fontSize = savedFontSize;
  }
}

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('xpecter-theme', name);

  // Only follow the UI theme toggle for terminal ANSI colors when the
  // user hasn't explicitly picked a color-scheme preset (SPE-61);
  // once they have, dark/light and terminal colors are independent.
  if (!appSettings.colorScheme || appSettings.colorScheme === 'dark' || appSettings.colorScheme === 'light') {
    appSettings.colorScheme = name;
  }
  refreshAllTerminalThemes();

  // Monaco's theme is global rather than per-instance, so this covers
  // every open editor pane in one call.
  monaco.editor.setTheme(MONACO_THEMES[name]);
}

// SPE-126: xterm only measures its cell size once its element is really
// on screen, and it does that from an IntersectionObserver callback
// that lands after the current frame, not during it. Until then
// FitAddon.proposeDimensions() returns undefined, fit() is a no-op, and
// term.cols is still xterm's 80-column default. So anything that needs
// the true size - the PTY request that a remote formats a whole
// session's output to, or telling a live session how big its pane now
// is - has to wait for that measurement instead of reading whatever
// happens to be there the instant the pane is shown.
// Returns null if the pane never became measurable at all (still
// hidden, zero width), which callers treat as "don't claim to know".
async function measuredFit(session: Session, frames = 12): Promise<{ cols: number; rows: number } | null> {
  for (let attempt = 0; attempt < frames; attempt++) {
    const size = sizeTerminal(session);
    if (size) return size;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return null;
}

// Fit one pane and tell its backend the size, as soon as the pane is
// genuinely measurable. Fire-and-forget, but the fit itself still
// happens synchronously on the first pass for a terminal that has
// already been measured, so switching between live tabs resizes in the
// same frame it always did.
function syncSessionSize(session: Session) {
  void measuredFit(session).then((size) => {
    if (!size || !session.backendId) return;
    if (session.mode === 'ssh') App.ResizeSSH(session.backendId, size.cols, size.rows);
    if (session.mode === 'local') App.ResizeLocalTerminal(session.backendId, size.cols, size.rows);
  });
}

function refitActiveTerminal() {
  // CSS class toggles (sidebar/editor collapse) don't fire a browser
  // resize event, so xterm.js never re-measures its container on its
  // own. Force it after any layout change that affects terminal width.
  requestAnimationFrame(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;
    for (const s of allSessions(tab)) {
      if (!s.fitAddon || !s.term) continue;
      syncSessionSize(s);
      s.term.refresh(0, s.term.rows - 1);
    }
  });
}

function currentTheme(): ThemeName {
  const saved = localStorage.getItem('xpecter-theme');
  return saved === 'light' ? 'light' : 'dark';
}


const App = window.go.main.App;
const runtime = window.runtime;

// Fetched once and reused everywhere a platform check is needed
// (Tools menu, Clear Screen), rather than a fresh IPC round trip per
// use. Declared this early (right after the App binding) specifically
// so it's safe to reference from handlers defined earlier in this file
// too, a `let`/`const` referenced before its own declaration line has
// run throws a temporal-dead-zone error that silently halts all script
// execution after it, confirmed the hard way with a past bug in this
// same file (see the SPE-96 sidebar-position removal history).
const platformPromise = App.GetPlatform();

// --- Tab model ---
// Each tab owns its own xterm.js Terminal + backend session (SSH session ID
// or local terminal ID). 'pending' tabs show the connect form instead of a
// live terminal, until Connect/StartLocalTerminal resolves them.

type TabMode = 'pending' | 'local' | 'ssh' | 'serial' | 'editor';
type TabStatus = 'connecting' | 'connected' | 'disconnected';

// SPE-92: Session describes everything a single live terminal needs.
// Both Tab (a tab's own primary session) and Pane (an additional split
// pane) satisfy this shape structurally, so functions that only need
// to read/write one live terminal's own state (writeToTerminal,
// showDisconnectPanel, setupCustomScrollbar, the paste guard, keyboard
// handling, reconnect, etc.) take a Session and work identically
// whether called for a whole tab or one split pane inside it. No
// existing single-pane logic is rewritten, only its parameter type is
// widened.
interface Session {
  id: string;
  mode: TabMode;
  backendId: string | null; // sessionId (ssh) or local terminal id
  label: string;
  status: TabStatus;
  term: Terminal | null;
  fitAddon: FitAddon | null;
  webglAddon: WebglAddon | null;
  disposeScrollbar: (() => void) | null;
  container: HTMLDivElement | null;
  // SPE-59: true while showing the "session stopped" panel after an
  // unexpected disconnect. Gates keyboard input away from the dead PTY
  // and routes R/S/Enter to the panel's actions instead.
  stopped: boolean;
  overlay: HTMLDivElement | null;
  // Set once a session connects; re-runs the same connect call to
  // power the panel's "R to restart session" action. null for local
  // shell tabs (out of scope for SPE-59, see ticket).
  reconnect: (() => void | Promise<void>) | null;
  // The Tab (in the `tabs` map) this session lives inside, itself for
  // a Tab's own primary session. Looked up fresh every time rather
  // than storing a pane index directly, since closing a sibling pane
  // shifts indices, a stored index would go stale.
  ownerTabId: string;
  // Output can split ANSI sequences or highlightable tokens across backend
  // events. Keep only that incomplete tail until the next chunk arrives.
  highlightCarry: string;
  // SPE-104: opens a second, independent terminal on the same target,
  // into whichever pane it's handed. null for a session that never
  // connected, for editors, and for serial, where the port can only be
  // opened once. Distinct from reconnect above, which re-dials this
  // same Session in place.
  duplicate: ((target: Pane) => Promise<void>) | null;
  // SPE-100: the saved SessionProfile this terminal was launched from,
  // null for ad-hoc connects that were never saved. Lets the sidebar
  // show which saved sessions are live right now and jump to the tab
  // already running one instead of opening a duplicate.
  sessionProfileId: string | null;
  // SPE-128: true from the moment a connect starts until it resolves,
  // either way. A connect is several seconds of awaiting the backend,
  // and for all of it this Session still looks 'pending' to
  // ensurePendingTab and not-yet-'connected' to the sidebar, so a
  // second click (or a repeated Enter in the password field, which
  // picker-ssh-fields turns into a Connect click) dialled a whole
  // second connection into this same Session: two terminals stacked in
  // the one pane, each half height, with the first backend session
  // orphaned behind the overwritten backendId. Guards the connect
  // entry points so only one dial per Session is ever in flight.
  connecting: boolean;
}

// A split pane alongside a tab's primary session. Same shape as
// Session, kept as its own name for clarity at call sites.
type Pane = Session;

type Layout = 'single' | '2v' | '2h' | '4';

interface Tab extends Session {
  // 'single' (default): behaves exactly as before this feature
  // existed, just this tab's own Session fields above, no extraPanes.
  // '2v'/'2h'/'4' show extraPanes alongside it in a fixed CSS grid.
  layout: Layout;
  extraPanes: Pane[];
  // 0 = the tab's own primary session; 1..extraPanes.length index into
  // extraPanes. Drives which session receives keyboard input/paste and
  // which pane shows a focus outline.
  focusedPaneIndex: number;
  // Wrapping grid element for every session's pane-wrapper, created
  // once a tab's first session starts connecting. A 1-cell grid looks
  // identical to a plain block container, so this exists even for
  // 'single' tabs, one uniform code path rather than two.
  paneGrid: HTMLDivElement | null;
  // SPE-105: where the split sits, as a fraction of the grid. One
  // vertical and one horizontal value covers every layout here: the
  // 2x2 grid splits its columns once and its rows once, so there are
  // never more than two of these to keep track of.
  splitX: number;
  splitY: number;
  isHome: boolean;
}

const tabs = new Map<string, Tab>();
let activeTabId: string | null = null;
let tabCounter = 0;

function newTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function createPendingTab(): Tab {
  const id = newTabId();
  const tab: Tab = {
    id,
    mode: 'pending',
    backendId: null,
    label: 'New Tab',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    webglAddon: null,
    disposeScrollbar: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
    duplicate: null,
    ownerTabId: id,
    highlightCarry: '',
    sessionProfileId: null,
    connecting: false,
    layout: 'single',
    extraPanes: [],
    focusedPaneIndex: 0,
    paneGrid: null,
    splitX: 0.5,
    splitY: 0.5,
    isHome: false,
  };
  tabs.set(tab.id, tab);
  return tab;
}

function createHomeTab(): Tab {
  const tab = createPendingTab();
  tab.isHome = true;
  tab.label = 'Home';
  return tab;
}

// --- Pane helpers (SPE-92) ---

function allSessions(tab: Tab): Session[] {
  return [tab, ...tab.extraPanes];
}

function focusedSession(tab: Tab): Session {
  return tab.focusedPaneIndex === 0 ? tab : tab.extraPanes[tab.focusedPaneIndex - 1];
}

// 0 for the tab's own primary session, 1-based into extraPanes
// otherwise. Computed fresh every call rather than cached, see the
// ownerTabId comment on Session above.
function paneIndexOf(tab: Tab, session: Session): number {
  if (session === tab) return 0;
  return 1 + tab.extraPanes.indexOf(session as Pane);
}

// SPE-97: opt-in (defaults off), a numbered badge is a minor visual
// addition, not a safety/correctness feature, so it follows the
// opt-in convention rather than the default-on one.
let showTabNumbersEnabled = localStorage.getItem('xpecter-show-tab-numbers') === 'on';

function renderTabBar() {
  const bar = document.getElementById('tab-bar')!;
  bar.innerHTML = '';
  let tabIndex = 0;
  for (const tab of tabs.values()) {
    tabIndex++;
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
    el.draggable = true;
    el.dataset.tabId = tab.id;
    el.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/xpecter-tab-id', tab.id);
      event.dataTransfer?.setData('text/plain', tab.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      bar.querySelectorAll('.tab.drop-target').forEach((item) => item.classList.remove('drop-target'));
    });
    el.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('drop-target');
      const draggedId = event.dataTransfer?.getData('text/xpecter-tab-id') || event.dataTransfer?.getData('text/plain');
      if (draggedId && draggedId !== tab.id) reorderTabs(draggedId, tab.id);
    });
    el.onclick = () => switchToTab(tab.id);

    if (showTabNumbersEnabled) {
      const num = document.createElement('span');
      num.textContent = String(tabIndex);
      num.style.cssText = 'opacity:0.5;font-size:10px;margin-right:5px;';
      el.appendChild(num);
    }

    // SPE-99: Home has no connection to report, and a red
    // 'disconnected' dot on it reads as something being wrong with the
    // one tab that is always fine. SPE-103: an editor session has no
    // connection to report either, same reasoning.
    if (!tab.isHome && tab.mode !== 'editor') {
      const dot = document.createElement('span');
      dot.className = 'status-dot ' + tab.status;
      el.appendChild(dot);
    }

    const label = document.createElement('span');
      label.textContent = tab.isHome ? '⌂ Home' : tab.mode === 'editor' ? editorTabLabel(tab) : (tab.mode === 'local' ? '💻 ' : tab.mode === 'ssh' ? '🌐 ' : tab.mode === 'serial' ? '🔌 ' : '') + tab.label + editorDirtyMarker(tab);
    el.appendChild(label);

      if (!tab.isHome) {
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '✕';
        close.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
        el.appendChild(close);
      }

    bar.appendChild(el);
  }

  const addBtn = document.createElement('div');
  addBtn.className = 'tab-add';
  addBtn.textContent = '+';
  addBtn.onclick = () => {
    const tab = createPendingTab();
    switchToTab(tab.id);
  };
  bar.appendChild(addBtn);

  // SPE-104: splitting only means something once the tab holds
  // something to split away from.
  const activeForSplit = activeTabId ? tabs.get(activeTabId) : null;
  document.getElementById('tab-split-btn')!.style.display =
    activeForSplit && !activeForSplit.isHome && activeForSplit.mode !== 'pending' ? 'flex' : 'none';

  syncSidebarLiveState();

  // SPE-92: reactive re-render of the active tab's pane headers
  // (label/status/focus), same "just re-render on every call" pattern
  // as the tab-row loop above.
  const active = activeTabId ? tabs.get(activeTabId) : null;
  if (active) {
    allSessions(active).forEach((s, i) => {
      const wrapper = s.container;
      if (!wrapper) return;
      const labelEl = wrapper.querySelector('.pane-header-label');
      if (labelEl) {
        labelEl.textContent = (s.mode === 'local' ? '💻 ' : s.mode === 'ssh' ? '🌐 ' : s.mode === 'serial' ? '🔌 ' : '') + s.label;
      }
      wrapper.classList.toggle('focused', active.layout !== 'single' && i === active.focusedPaneIndex);
    });
  }
}

// SPE-100: the sidebar's live dots and Running group have to track
// every connect and disconnect. renderTabBar already runs on all of
// those, but it also runs on tab switches, drags and pane focus
// changes, and renderSessionList costs two backend calls. So compare
// the set of live profile ids first and only re-render when it actually
// changed.
let lastLiveSignature = '';

function syncSidebarLiveState() {
  const signature = Array.from(liveSessionsByProfile().keys()).sort().join(',');
  if (signature === lastLiveSignature) return;
  lastLiveSignature = signature;
  renderSessionList();
}

function reorderTabs(draggedId: string, targetId: string) {
  const ordered = Array.from(tabs.values());
  const draggedIndex = ordered.findIndex((tab) => tab.id === draggedId);
  if (draggedIndex < 0 || !ordered.some((tab) => tab.id === targetId)) return;
  const [dragged] = ordered.splice(draggedIndex, 1);
  ordered.splice(ordered.findIndex((tab) => tab.id === targetId), 0, dragged);
  tabs.clear();
  for (const tab of ordered) tabs.set(tab.id, tab);
  renderTabBar();
}

function switchToTab(id: string) {
  activeTabId = id;
  const tab = tabs.get(id)!;

  // Hide every tab's pane grid, show only the active one (or the
  // connect form if this tab hasn't connected yet).
  document.querySelectorAll('.tab-pane-grid').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  // SPE-99: Home renders its own surface now. #tab-landing stays the
  // small "No session yet" placeholder for ordinary un-connected tabs,
  // which is the only state that copy was ever true for.
  document.getElementById('tab-landing')!.style.display = !tab.isHome && tab.mode === 'pending' ? 'flex' : 'none';
  document.getElementById('home-view')!.style.display = tab.isHome ? 'flex' : 'none';
  // Set before the fit() calls below, which force a synchronous layout
  // read and so need #terminal's final display already applied.
  document.getElementById('terminal-pane')!.classList.toggle('home-active', tab.isHome);
  if (tab.isHome) renderHomeView().catch(() => {});

  if (tab.paneGrid) {
    tab.paneGrid.style.display = 'grid';
    for (const s of allSessions(tab)) {
      editorPanes.get(s.id)?.editor.layout();
      // SPE-126: was an inline fit() + Resize. A terminal being shown
      // for the very first time is not measurable yet in this frame, so
      // that sent the backend xterm's 80x24 default as if it were the
      // real size of the pane.
      syncSessionSize(s);
    }
  }

  const focused = focusedSession(tab);
  if (focused?.mode === 'ssh' && focused.backendId) {
    refreshFileList('.', focused.backendId);
  }
  // This tab's trees were not being watched while it was hidden, so
  // catch them up now rather than showing a stale listing until the
  // next tick.
  void runTreeWatchPass();

  renderTabBar();
  // So Ctrl+S works the moment you land on an editor tab, rather than
  // only after clicking into the buffer.
  focusPaneContents(tab);
}

// Shared backend-close + local cleanup for one Session, used by both
// closeTab (loops over every session in the tab) and closePane
// (closes just one split pane, leaving the tab and its other panes
// open).
async function closeSessionBackend(s: Session) {
  if (s.mode === 'editor') disposeEditorPane(s);
  if (s.mode === 'ssh' && s.backendId) {
    await App.CloseSSH(s.backendId);
    runtime.EventsOff('ssh:data:' + s.backendId, 'ssh:closed:' + s.backendId);
  }
  if (s.mode === 'local' && s.backendId) await App.CloseLocalTerminal(s.backendId);
  if (s.mode === 'serial' && s.backendId) {
    await App.CloseSerial(s.backendId);
    runtime.EventsOff('serial:data:' + s.backendId, 'serial:closed:' + s.backendId);
  }
  s.disposeScrollbar?.();
  s.disposeScrollbar = null;
  s.webglAddon?.dispose();
  s.webglAddon = null;
  s.overlay?.remove();
  s.term?.dispose();
  s.container?.remove();
}

async function closeTab(id: string) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.isHome) return;

  // SPE-103: an editor pane has no connection to lose, it has unsaved
  // buffers instead. Asked about before the connection prompt below,
  // since either answer can still call the whole close off.
  for (const session of allSessions(tab)) {
    if (session.mode !== 'editor') continue;
    if (!(await confirmCloseEditorSession(session))) return;
  }

  // SPE-81: only prompt if something in this tab is genuinely live, not
  // the disconnect panel's own "exit tab" action, and not a
  // pending/never-connected tab, matching the ticket's own scope note.
  const anyConnected = allSessions(tab).some((s) => s.status === 'connected' && !s.stopped);
  if (anyConnected) {
    const what = tab.extraPanes.length > 0 ? 'One or more panes are' : 'The session is';
    const proceed = confirm(`Close this tab? ${what} still connected (${tab.label}).`);
    if (!proceed) return;
  }

  for (const s of allSessions(tab)) await closeSessionBackend(s);
  tab.paneGrid?.remove();
  tabs.delete(id);

  if (activeTabId === id) {
    const remaining = Array.from(tabs.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    } else {
      const home = createHomeTab();
      switchToTab(home.id);
    }
  } else {
    renderTabBar();
  }
}

// SPE-92: closes one split pane, keeping the tab (and its other panes)
// open. paneIndex 0 always means the tab's own primary session, closing
// that closes the whole tab, same as closing any single-pane tab always
// has.
async function closePane(tab: Tab, paneIndex: number) {
  if (paneIndex === 0) {
    await closeTab(tab.id);
    return;
  }
  const pane = tab.extraPanes[paneIndex - 1];
  if (!pane) return;
  if (pane.mode === 'editor') {
    if (!(await confirmCloseEditorSession(pane))) return;
  } else if (pane.status === 'connected' && !pane.stopped) {
    const proceed = confirm(`Close this pane? The session is still connected (${pane.label}).`);
    if (!proceed) return;
  }
  await closeSessionBackend(pane);
  tab.extraPanes.splice(paneIndex - 1, 1);
  if (tab.extraPanes.length === 0) tab.layout = 'single';
  if (tab.focusedPaneIndex >= tab.extraPanes.length + 1) {
    tab.focusedPaneIndex = tab.extraPanes.length;
  }
  applyPaneGridLayout(tab);
  if (activeTabId === tab.id) switchToTab(tab.id);
  else renderTabBar();
}

// SPE-92: when set, the next New Session picker flow (SSH connect,
// local shell, or serial connect) targets this pane instead of the
// active tab's own primary session. Set by openSplitPanePicker, reset
// to null by openSessionPicker (the ordinary New-Session-from-menu
// flow), so a stale target can never leak into an unrelated later
// connect.
let pendingPaneTarget: Pane | null = null;

function createEmptyPane(tab: Tab): Pane {
  return {
    id: newTabId(),
    mode: 'pending',
    backendId: null,
    label: 'New Pane',
    status: 'disconnected',
    term: null,
    fitAddon: null,
    webglAddon: null,
    disposeScrollbar: null,
    container: null,
    stopped: false,
    overlay: null,
    reconnect: null,
    duplicate: null,
    ownerTabId: tab.id,
    highlightCarry: '',
    sessionProfileId: null,
    connecting: false,
  };
}

function ensurePaneGrid(tab: Tab) {
  if (tab.paneGrid) return;
  const grid = document.createElement('div');
  grid.className = 'tab-pane-grid';
  grid.style.display = 'none'; // switchToTab shows it once this tab is active
  document.getElementById('terminal')!.appendChild(grid);
  tab.paneGrid = grid;
}

// SPE-105: a pane's wrapper is a focus target and a drop target for
// another pane being dragged onto it. Shared, because a wrapper gets
// built in three places (empty pane, terminal, editor) and only one of
// them existed when the mousedown handler was first written.
const PANE_DRAG_TYPE = 'text/xpecter-pane-id';

function preparePaneWrapper(wrapper: HTMLDivElement, session: Session, tab: Tab) {
  wrapper.addEventListener('mousedown', () => focusPane(tab, paneIndexOf(tab, session)));
  wrapper.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(PANE_DRAG_TYPE)) return;
    // Stopped as well as prevented: a Monaco editor in this pane would
    // otherwise read the drag as text being dropped into the buffer.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    wrapper.classList.add('drop-target');
  });
  wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drop-target'));
  wrapper.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes(PANE_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    wrapper.classList.remove('drop-target');
    const draggedId = event.dataTransfer.getData(PANE_DRAG_TYPE);
    if (draggedId && draggedId !== session.id) swapPanes(tab, draggedId, session.id);
  });
}

// Swaps two panes by reordering their wrappers in the grid, leaving
// every Session object where it is. Moving the objects instead would
// mean moving a Tab's own primary session out of the Tab, which it
// structurally cannot be: a Tab *is* its first session.
function swapPanes(tab: Tab, draggedId: string, targetId: string) {
  const grid = tab.paneGrid;
  const sessions = allSessions(tab);
  const dragged = sessions.find((s) => s.id === draggedId);
  const target = sessions.find((s) => s.id === targetId);
  if (!grid || !dragged?.container || !target?.container) return;
  const draggedNext = dragged.container.nextSibling;
  const targetNext = target.container.nextSibling;
  if (draggedNext === target.container) {
    grid.insertBefore(target.container, dragged.container);
  } else if (targetNext === dragged.container) {
    grid.insertBefore(dragged.container, target.container);
  } else {
    grid.insertBefore(dragged.container, targetNext);
    grid.insertBefore(target.container, draggedNext);
  }
  applyPaneGridLayout(tab);
}

// Panes in the order they actually appear on screen, which stops
// matching their index order the moment two of them are swapped.
function visualPaneOrder(tab: Tab): Session[] {
  const sessions = allSessions(tab);
  if (!tab.paneGrid) return sessions;
  return Array.from(tab.paneGrid.children)
    .map((child) => sessions.find((s) => s.container === child))
    .filter((s): s is Session => !!s);
}

function buildPaneHeader(session: Session, tab: Tab): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'pane-header';
  header.style.display = tab.layout === 'single' ? 'none' : 'flex';
  // SPE-105: the header is the grab handle for moving this pane
  // elsewhere in the grid. Deliberately the header and not the pane
  // body, which belongs to a live terminal or an editor and has its own
  // ideas about dragging.
  header.draggable = true;
  header.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(PANE_DRAG_TYPE, session.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    session.container?.classList.add('pane-dragging');
  });
  header.addEventListener('dragend', () => {
    session.container?.classList.remove('pane-dragging');
    tab.paneGrid?.querySelectorAll('.pane-wrapper.drop-target')
      .forEach((el) => el.classList.remove('drop-target'));
  });
  const labelEl = document.createElement('span');
  labelEl.className = 'pane-header-label';
  labelEl.textContent = session.label;
  header.appendChild(labelEl);
  const closeEl = document.createElement('span');
  closeEl.className = 'pane-header-close';
  closeEl.textContent = '\u2715';
  closeEl.title = 'Close pane';
  closeEl.onclick = (e) => {
    e.stopPropagation();
    closePane(tab, paneIndexOf(tab, session));
  };
  header.appendChild(closeEl);
  return header;
}

// Empty placeholder for a freshly split pane: header + a "+ New
// Session" button, no live Terminal yet. createTerminalForSession
// reuses this same wrapper once a session is actually chosen, rather
// than creating a second one, so nothing needs tearing down.
function createPaneShell(pane: Pane, tab: Tab) {
  ensurePaneGrid(tab);
  const wrapper = document.createElement('div');
  wrapper.className = 'pane-wrapper';
  wrapper.appendChild(buildPaneHeader(pane, tab));

  const landing = document.createElement('div');
  landing.className = 'pane-landing';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pane-landing-btn';
  btn.textContent = '+ New Session';
  btn.onclick = () => openSplitPanePicker(pane);
  landing.appendChild(btn);
  wrapper.appendChild(landing);

  // No term-host here: this pane has no live session yet, and a
  // term-host with flex:1 would otherwise compete with the landing
  // placeholder above (both flex:1, both visible at once) for the same
  // space. createTerminalForSession creates the real term-host once a
  // session is actually chosen, removing this landing div then.
  preparePaneWrapper(wrapper, pane, tab);
  tab.paneGrid!.appendChild(wrapper);
  pane.container = wrapper;
}

function focusPane(tab: Tab, paneIndex: number) {
  const changed = tab.focusedPaneIndex !== paneIndex;
  tab.focusedPaneIndex = paneIndex;
  // Which pane is focused and where the keyboard actually points have
  // to move together. They used to not: this only repainted the focus
  // ring, so clicking an editor pane's header left the caret in the
  // terminal you clicked away from, and the Ctrl+S you meant for the
  // buffer reached that shell's PTY as XOFF and froze it.
  focusPaneContents(tab);
  if (changed) renderTabBar();
}

// Puts real DOM focus inside a tab's focused pane (SPE-119): the buffer for an
// editor, the terminal for a shell. Deferred a frame because the usual
// caller is a mousedown handler and the browser's own focus handling
// for that click runs after it, undoing anything set here first.
// Idempotent, so the extra call a click straight into Monaco or a
// terminal triggers costs nothing.
let paneFocusFrame: number | null = null;
function focusPaneContents(tab: Tab) {
  if (paneFocusFrame !== null) cancelAnimationFrame(paneFocusFrame);
  paneFocusFrame = requestAnimationFrame(() => {
    paneFocusFrame = null;
    if (activeTabId !== tab.id || tab.isHome) return;
    // A dialog, the quick pick or the session picker owns the keyboard
    // while it is up, and a pane grabbing it back would break them.
    if (document.querySelector('[id$="-overlay"].open, .dialog-overlay.open')) return;
    const session = focusedSession(tab);
    if (!session?.container) return;
    const active = document.activeElement as HTMLElement | null;
    // Already in the right pane, including its own chrome.
    if (active && session.container.contains(active)) return;
    // Somebody is typing in app chrome (the sidebar filter, a form
    // field). A pane only ever reclaims focus from another pane or from
    // nowhere at all. xterm's and Monaco's own hidden textareas sit
    // inside a pane wrapper, so they don't read as chrome here.
    if (active && active !== document.body && !active.closest('.pane-wrapper') && isTextEntry(active)) return;
    const pane = editorPanes.get(session.id);
    if (pane) pane.editor.focus();
    else session.term?.focus();
  });
}

function isTextEntry(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

// Pure layout-geometry update for a tab's paneGrid CSS grid-template.
// Never touches any session's term/container/backend, safe to call any
// time the layout or pane count changes.
// Matches the gap in .tab-pane-grid: the dividers straddle that gap, so
// they need to know how wide it is to sit centred on it.
const PANE_GRID_GAP = 2;

function paneGridTracks(tab: Tab) {
  return {
    columns: tab.layout === '2v' || tab.layout === '4' ? `${tab.splitX}fr ${1 - tab.splitX}fr` : '1fr',
    rows: tab.layout === '2h' || tab.layout === '4' ? `${tab.splitY}fr ${1 - tab.splitY}fr` : '1fr',
  };
}

// Where a divider sits: the fraction, less the share of the gap the
// first track gives up, plus half the gap to land on its centre.
function dividerOffset(fraction: number): string {
  return `calc(${(fraction * 100).toFixed(4)}% - ${(fraction * PANE_GRID_GAP).toFixed(3)}px + ${PANE_GRID_GAP / 2}px)`;
}

function applyPaneGridLayout(tab: Tab) {
  if (!tab.paneGrid) return;
  const tracks = paneGridTracks(tab);
  tab.paneGrid.style.gridTemplateColumns = tracks.columns;
  tab.paneGrid.style.gridTemplateRows = tracks.rows;
  for (const s of allSessions(tab)) {
    const header = s.container?.querySelector('.pane-header') as HTMLElement | null;
    if (header) header.style.display = tab.layout === 'single' ? 'none' : 'flex';
    const landing = s.container?.querySelector('.pane-landing') as HTMLElement | null;
    if (landing) landing.style.display = tab.layout === 'single' ? 'none' : 'flex';
    editorPanes.get(s.id)?.editor.layout();
  }
  renderPaneDividers(tab);
  if (activeTabId === tab.id) refitActiveTerminal();
}

// SPE-105: rebuilt rather than repositioned, so the divider count
// always matches the layout and appending them last keeps swapPanes'
// sibling arithmetic looking only at pane wrappers.
function renderPaneDividers(tab: Tab) {
  const grid = tab.paneGrid;
  if (!grid) return;
  grid.querySelectorAll('.pane-divider').forEach((el) => el.remove());
  if (tab.layout === '2v' || tab.layout === '4') grid.appendChild(buildPaneDivider(tab, 'vertical'));
  if (tab.layout === '2h' || tab.layout === '4') grid.appendChild(buildPaneDivider(tab, 'horizontal'));
}

function buildPaneDivider(tab: Tab, axis: 'vertical' | 'horizontal'): HTMLDivElement {
  const divider = document.createElement('div');
  divider.className = `pane-divider ${axis}`;
  divider.title = 'Drag to resize, double-click to even out';
  const place = (fraction: number) => {
    if (axis === 'vertical') divider.style.left = dividerOffset(fraction);
    else divider.style.top = dividerOffset(fraction);
  };
  place(axis === 'vertical' ? tab.splitX : tab.splitY);

  divider.addEventListener('dblclick', () => {
    if (axis === 'vertical') tab.splitX = 0.5;
    else tab.splitY = 0.5;
    applyPaneGridLayout(tab);
  });

  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const grid = tab.paneGrid;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    divider.classList.add('dragging');
    divider.setPointerCapture(e.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const raw = axis === 'vertical'
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      // A pane narrower than this has no usable terminal in it anyway.
      const fraction = Math.min(0.85, Math.max(0.15, raw));
      if (axis === 'vertical') tab.splitX = fraction;
      else tab.splitY = fraction;
      // Geometry only while dragging: re-fitting every xterm on each
      // pointer move is far too expensive, and they catch up on
      // release, which is the only moment the size is final anyway.
      const tracks = paneGridTracks(tab);
      grid.style.gridTemplateColumns = tracks.columns;
      grid.style.gridTemplateRows = tracks.rows;
      place(fraction);
    };

    const finishResize = () => {
      divider.classList.remove('dragging');
      divider.removeEventListener('pointermove', onPointerMove);
      divider.removeEventListener('pointerup', finishResize);
      divider.removeEventListener('pointercancel', finishResize);
      if (divider.hasPointerCapture(e.pointerId)) divider.releasePointerCapture(e.pointerId);
      applyPaneGridLayout(tab);
    };
    divider.addEventListener('pointermove', onPointerMove);
    divider.addEventListener('pointerup', finishResize);
    divider.addEventListener('pointercancel', finishResize);
  });

  return divider;
}

// Switches a tab to a fixed target layout (SPE-92: single / 2 vertical
// / 2 horizontal / 4-pane grid), creating empty panes as needed or
// closing extra ones from the end if shrinking. New panes start empty
// (mode 'pending', showing a small "+ New Session" placeholder) rather
// than auto-opening the New Session picker for each one, so switching
// straight to a 4-pane grid doesn't stack three modals on top of each
// other.
async function setTabLayout(tab: Tab, layout: Layout) {
  // A still-pending tab (never connected its own primary session) has
  // no paneGrid yet and shows the big #tab-landing view instead. That
  // view and a newly split pane's own landing would otherwise both be
  // visible at once, stacked, pushing the new pane down the page.
  // Simplest correct fix: require the tab's own session first, split
  // afterward.
  if (layout !== 'single' && tab.mode === 'pending') {
    alert('Connect a session in this tab first, then split it into panes.');
    return;
  }

  const targetCount = layout === 'single' ? 1 : layout === '4' ? 4 : 2;
  const currentCount = 1 + tab.extraPanes.length;

  if (targetCount < currentCount) {
    const removing = tab.extraPanes.slice(targetCount - 1);
    for (const pane of removing) {
      if (pane.mode !== 'editor') continue;
      if (!(await confirmCloseEditorSession(pane))) return;
    }
    const anyConnected = removing.some((p) => p.status === 'connected' && !p.stopped);
    if (anyConnected) {
      const proceed = confirm(`Switch layout? ${removing.length} connected pane(s) will be closed.`);
      if (!proceed) return;
    }
    for (const p of removing) await closeSessionBackend(p);
    tab.extraPanes = tab.extraPanes.slice(0, targetCount - 1);
  }

  tab.layout = layout;
  if (tab.focusedPaneIndex >= targetCount) tab.focusedPaneIndex = 0;

  ensurePaneGrid(tab);

  while (1 + tab.extraPanes.length < targetCount) {
    const pane = createEmptyPane(tab);
    tab.extraPanes.push(pane);
    createPaneShell(pane, tab);
  }

  applyPaneGridLayout(tab);
  if (activeTabId === tab.id) switchToTab(tab.id);
  else renderTabBar();
}

// Custom-drawn scrollbar (see the CSS comment above the .xterm-viewport
// rules for why this exists): the native scrollbar is hidden entirely,
// this is pure page content instead, so it looks and behaves
// identically across Linux/Windows/macOS regardless of what each
// platform's webview engine does or doesn't expose for native scrollbar
// styling.
function setupCustomScrollbar(session: Session) {
  if (!session.term || !session.container) return;
  const term = session.term;
  // Anchored to the term host (position:relative), not the outer pane
  // wrapper, since SPE-92 the wrapper also contains the pane header,
  // an absolutely-positioned track on the wrapper would overlay the
  // header too.
  const termHost = termFrameOf(session);
  if (!termHost) return;

  const track = document.createElement('div');
  track.className = 'custom-scrollbar-track';
  const thumb = document.createElement('div');
  thumb.className = 'custom-scrollbar-thumb';
  track.appendChild(thumb);
  termHost.appendChild(track);

  function update() {
    const buffer = term.buffer.active;
    const totalLines = buffer.length;
    const rows = term.rows;
    if (totalLines <= rows) {
      track.style.display = 'none';
      return;
    }
    track.style.display = 'block';
    const trackHeight = track.clientHeight;
    const thumbHeightPct = Math.max(rows / totalLines, 0.03);
    const scrollableRange = buffer.baseY;
    const scrollPct = scrollableRange > 0 ? buffer.viewportY / scrollableRange : 0;
    thumb.style.height = `${Math.max(thumbHeightPct * trackHeight, 20)}px`;
    const thumbHeightPx = thumb.getBoundingClientRect().height || thumbHeightPct * trackHeight;
    thumb.style.top = `${scrollPct * (trackHeight - thumbHeightPx)}px`;
  }

  term.onScroll(update);
  term.onResize(update);
  // New output can extend the scrollable range without necessarily
  // firing onScroll (e.g. output arriving while already at the
  // bottom), refresh after every write too.
  term.onWriteParsed(update);
  // Redundant safety net: xterm.js's own onScroll event apparently
  // doesn't fire reliably for touchpad-driven scroll on Windows/WebView2
  // (confirmed by testing, content scrolled correctly but the thumb
  // never moved), even though mouse wheel and thumb-drag both worked.
  // Listening directly to .xterm-viewport's real DOM scroll event should
  // catch it regardless of what triggered the scroll, wheel, touchpad,
  // keyboard, programmatic, since it's the browser's own native event,
  // not xterm's internal one.
  const viewport = term.element?.querySelector('.xterm-viewport');
  viewport?.addEventListener('scroll', update);

  let dragging = false;
  let dragStartY = 0;
  let dragStartScrollLine = 0;

  thumb.addEventListener('mousedown', (e) => {
    dragging = true;
    thumb.classList.add('dragging');
    dragStartY = e.clientY;
    dragStartScrollLine = term.buffer.active.viewportY;
    e.preventDefault();
  });
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const trackHeight = track.clientHeight;
    const thumbHeightPx = thumb.getBoundingClientRect().height;
    const usableTrack = Math.max(trackHeight - thumbHeightPx, 1);
    const deltaY = e.clientY - dragStartY;
    const deltaLines = (deltaY / usableTrack) * scrollableRange;
    const newLine = Math.round(dragStartScrollLine + deltaLines);
    term.scrollToLine(Math.min(scrollableRange, Math.max(0, newLine)));
  };
  const onMouseUp = () => {
    dragging = false;
    thumb.classList.remove('dragging');
  };
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Click on the track itself (not the thumb) jumps to that position,
  // standard scrollbar behavior.
  track.addEventListener('mousedown', (e) => {
    if (e.target !== track) return;
    const buffer = term.buffer.active;
    const scrollableRange = buffer.baseY;
    if (scrollableRange <= 0) return;
    const rect = track.getBoundingClientRect();
    const clickPct = (e.clientY - rect.top) / rect.height;
    term.scrollToLine(Math.round(clickPct * scrollableRange));
  });

  update();
  session.disposeScrollbar = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    viewport?.removeEventListener('scroll', update);
    track.remove();
  };
}

// SPE-80: warn before sending clipboard content containing multiple
// lines, since each line can execute as a separate command once it
// reaches a remote shell, a real safety net especially on network
// hardware where a pasted multi-line block could silently apply
// several config commands in sequence. Toggleable, matching the
// checkbox precedent this was modeled on; not everyone wants a prompt
// on every multi-line paste.
let warnMultilinePasteEnabled = localStorage.getItem('xpecter-warn-multiline-paste') !== 'off';

function writeToSession(session: Session, data: string) {
  if (session.mode === 'local' && session.backendId) App.WriteLocalTerminal(session.backendId, data);
  if (session.mode === 'ssh' && session.backendId) App.WriteSSH(session.backendId, data);
  if (session.mode === 'serial' && session.backendId) App.WriteSerial(session.backendId, data);
}

// A terminal's Enter is carriage return, not newline. Clipboard text
// carries whatever its source used: CRLF from anything Windows, bare LF
// from a Unix file or a web page. Sending those through untranslated is
// what mangles a pasted block. CRLF arrives as "execute, then a stray
// LF", which many shells count as a second empty line, and a bare LF is
// not the key a terminal is waiting for at all.
function newlinesToCarriageReturns(text: string): string {
  return text.replace(/\r\n|\n/g, '\r');
}

// Bracketed paste (DECSET 2004) is how a program says "tell me when
// text is pasted rather than typed". Wrapped in these markers, bash and
// zsh hold a multi-line block on the prompt instead of running each
// line as it arrives, and vim leaves autoindent off for the duration
// rather than indenting every line under the one above it, which is the
// staircase that pasted code turns into without this.
//
// xterm.js does this for pastes it handles itself, but the paste guard
// below deliberately intercepts before xterm sees the event, which had
// the side effect of dropping the brackets along with it.
function bracketPaste(session: Session, text: string): string {
  return session.term?.modes.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text;
}

// Returns false if the user backed out. Only asked for text that will
// actually be executed line by line: under bracketed paste the block
// lands on the prompt and waits, so the old warning's "each line may
// run as a separate command" was not true there. Where it is true, and
// on the network hardware this guard was written for, nothing has
// bracketed paste and the warning still appears.
function confirmMultiline(text: string, willExecuteEachLine: boolean): boolean {
  if (!warnMultilinePasteEnabled || !willExecuteEachLine) return true;
  const lines = text.split(/\r\n|\r|\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  if (lines.length <= 1) return true;
  return confirm(`You're about to send ${lines.length} lines. Each line may run as a separate command on the remote end. Continue?`);
}

// A clipboard paste: the text is what the user copied, and the program
// on the other end decides what to do with it.
function pasteIntoSession(session: Session, text: string) {
  const bracketed = !!session.term?.modes.bracketedPasteMode;
  if (!confirmMultiline(text, !bracketed)) return;
  writeToSession(session, bracketPaste(session, newlinesToCarriageReturns(text)));
}

// Text Xpecter is sending on the user's behalf to be run, currently
// command snippets. Never bracketed: brackets tell the shell to treat
// the text as literal input, which would leave a snippet sitting on the
// prompt unexecuted rather than running it.
function sendTextToSession(session: Session, text: string) {
  if (!confirmMultiline(text, true)) return;
  writeToSession(session, newlinesToCarriageReturns(text));
}

// SPE-128: tears down a session's terminal view (terminal, scrollbar,
// webgl addon, disconnect overlay, and the term host they all live in)
// without touching its backend session, which closeSessionBackend
// still owns. Only for a wrapper about to be handed a new terminal,
// which must not end up holding two.
function disposeTerminalView(session: Session) {
  session.disposeScrollbar?.();
  session.disposeScrollbar = null;
  session.webglAddon?.dispose();
  session.webglAddon = null;
  session.overlay?.remove();
  session.overlay = null;
  const termFrame = termFrameOf(session);
  session.term?.dispose();
  session.term = null;
  termFrame?.remove();
}

// SPE-92: creates (or fills in) the live xterm.js Terminal for one
// Session, whether that's a tab's own primary session (the original,
// unchanged behavior) or a split pane. If `session.container` already
// exists (a pane created via createPaneShell, still showing its "+ New
// Session" placeholder), that same wrapper/header is reused, its
// landing placeholder removed, rather than creating a second wrapper.
function createTerminalForSession(session: Session, tab: Tab) {
  ensurePaneGrid(tab);

  let wrapper = session.container;
  if (wrapper) {
    // Reused from createPaneShell's empty-landing placeholder: keep the
    // header, drop the landing button, the real term-host below is
    // always created fresh either way.
    wrapper.querySelector('.pane-landing')?.remove();
    // SPE-128: belt to the connecting guard's braces. Every term host
    // appended below is flex:1, so a second one doesn't replace the
    // first, it halves the pane and sits under it. If a caller ever
    // reaches here with a live terminal already in this wrapper, drop
    // that view rather than grow a second one beside it. View only:
    // the backend session still belongs to the caller.
    disposeTerminalView(session);
  } else {
    wrapper = document.createElement('div');
    wrapper.className = 'pane-wrapper';
    wrapper.appendChild(buildPaneHeader(session, tab));
    preparePaneWrapper(wrapper, session, tab);
    tab.paneGrid!.appendChild(wrapper);
  }

  // SPE-127: a frame that stays still, and a host inside it that
  // scrolls. The grid is wider than the pane now, and anything painted
  // on the scrolling box travelled sideways with the text: the
  // wallpaper stretched across the full 200 columns instead of the
  // visible part, and the scrollbar wandered into the middle of the
  // window. Those belong to the frame; only the terminal scrolls.
  const termFrame = document.createElement('div');
  termFrame.className = 'pane-term-frame';
  const termHost = document.createElement('div');
  termHost.className = 'pane-term-host term-instance';
  termHost.style.cssText = 'padding:4px;box-sizing:border-box;';
  termFrame.appendChild(termHost);
  wrapper.appendChild(termFrame);
  const container = termHost;

  const term = new Terminal({
    allowTransparency: true,
    fontFamily: fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value),
    fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
    theme: activeXtermTheme(),
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  const webglAddon = wallpaperActive() ? null : createSessionWebglAddon(session);
  // Starts at the pinned width rather than a measured one. xterm's own
  // default happens to be 80x24 too, so this is really just saying so
  // out loud; sizeTerminal sets the rows once the pane is measurable.
  term.resize(TERMINAL_COLS, term.rows);
  // session.mode is already set by every caller that gets this far
  // (local, ssh, serial), which is what decides the wrap mode.
  term.write(session.mode === 'local' ? DECAWM_ON : DECAWM_OFF);

  // OSC 52: let remote programs (xclip, pbcopy, tmux, vim, etc.) sync
  // their copy into the local OS clipboard, gated by osc52Enabled since
  // this lets a remote process silently write to the local clipboard.
  term.parser.registerOscHandler(52, (data: string) => {
    if (!osc52Enabled) return true;
    const parts = data.split(';');
    if (parts.length < 2) return true;
    try {
      const text = atob(parts[1]);
      navigator.clipboard.writeText(text).catch(() => {});
    } catch {
      // ignore malformed OSC 52 payloads
    }
    return true;
  });

  // Auto-copy on selection (classic X11/xterm/PuTTY-style behavior),
  // gated by copyOnSelectEnabled toggle since not everyone wants this.
  term.onSelectionChange(() => {
    if (!copyOnSelectEnabled) return;
    const sel = term.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  });

  // Explicit paste keybind (Ctrl+Shift+V / Cmd+Shift+V), separate from
  // native browser paste, as a reliable fallback across platforms/webviews.
  // Ctrl+Shift+X disconnects the active session (see disconnectTab):
  // deliberately NOT plain Ctrl+C, since that's the real SIGINT keystroke
  // needed constantly on a live switch session, and NOT plain Ctrl+X
  // either, since bash/readline and Emacs both use that as a prefix key.
  // Also handles the SPE-59 disconnected-session panel: while a session is
  // stopped, R/S/Enter drive the panel's actions and everything else is
  // swallowed rather than typed into a dead PTY.
  // SPE-92: split/close/focus-pane shortcuts, checked against every
  // existing binding (Ctrl+Shift+X/B/V, Ctrl+/-/0, F11), no collisions.
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    // Belt to focusPaneContents' braces: once logical focus has moved
    // to another pane this terminal must not act on the keystroke, even
    // if it somehow still holds DOM focus. Ctrl+S is the one that
    // hurts, reaching the PTY as XOFF and freezing the shell, but the
    // disconnected-panel keys below are just as wrong to fire here.
    // The existence check matters: a pane index left pointing at
    // nothing during a close must not turn into a terminal that
    // swallows every key you type into it.
    const focusedPane = focusedSession(tab);
    if (e.type === 'keydown' && focusedPane && focusedPane !== session) {
      focusPaneContents(tab);
      return false;
    }
    if (session.stopped) {
      if (e.type === 'keydown') {
        const key = e.key.toLowerCase();
        if (key === 'enter') closePane(tab, paneIndexOf(tab, session));
        else if (key === 'r') reconnectSession(session);
        else if (key === 's') saveSessionOutput(session);
      }
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'disconnect')) {
      disconnectSession(session);
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'saveOutput')) {
      // SPE-124: the stopped-session branch above already answers a
      // bare S for a dead pane, this is the live one.
      void saveSessionOutput(session);
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'sidebar')) {
      // Not plain Ctrl+B: that's tmux's default prefix key, binding it
      // globally would break every tmux user's workflow the moment
      // they're inside a session.
      toggleSidebar();
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'paste')) {
      navigator.clipboard.readText().then((text) => pasteIntoSession(session, text)).catch(() => {});
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'zoomIn')) {
      // SPE-77. Accepts both '=' and '+' since Plus is Shift+Equals on
      // most layouts, matching how browsers handle Ctrl+= zoom too.
      zoomBy(1);
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'zoomOut')) {
      zoomBy(-1);
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'resetZoom')) {
      applyFontSize(FONT_SIZE_DEFAULT);
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'fullscreen')) {
      toggleFullscreen();
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'splitVertical')) {
      setTabLayout(tab, tab.layout === '2h' ? '4' : '2v');
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'splitHorizontal')) {
      setTabLayout(tab, tab.layout === '2v' ? '4' : '2h');
      return false;
    }
    if (e.type === 'keydown' && shortcutMatches(e, 'closePane')) {
      closePane(tab, paneIndexOf(tab, session));
      return false;
    }
    if (e.type === 'keydown' && e.altKey && tab.layout !== 'single' && e.key.startsWith('Arrow')) {
      focusAdjacentPane(tab, e.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown');
      return false;
    }
    return true;
  });

  // Right-click to paste (toggleable), matching PuTTY/most Linux terminal convention.
  container.addEventListener('contextmenu', (e) => {
    if (!rightClickPasteEnabled) return;
    e.preventDefault();
    App.GetClipboardText().then((text) => pasteIntoSession(session, text)).catch(() => {});
  });

  // Native browser paste (Ctrl+V, middle-click on Linux, right-click ->
  // Paste in some contexts, etc.), xterm.js listens for this itself and
  // would otherwise feed it straight through to onData below with no
  // multi-line awareness at all. Intercepted here instead, at capture
  // phase so it runs before xterm's own listener, so it goes through
  // the same guard as the other two paste paths above.
  container.addEventListener('paste', (e) => {
    if (!e.clipboardData) return; // let default handling proceed if unavailable
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text');
    if (text) pasteIntoSession(session, text);
  }, true);

  term.onData((data) => {
    if (session.mode === 'local' && session.backendId) App.WriteLocalTerminal(session.backendId, data);
    if (session.mode === 'ssh' && session.backendId) App.WriteSSH(session.backendId, data);
    if (session.mode === 'serial' && session.backendId) App.WriteSerial(session.backendId, data);
  });

  session.term = term;
  session.fitAddon = fitAddon;
  session.webglAddon = webglAddon;
  session.disposeScrollbar = null;
  session.container = wrapper;
  applyWallpaperToSession(session);
  setupCustomScrollbar(session);
}

// SPE-92: Alt+Arrow moves focus between panes by rough screen
// direction. With at most 4 panes in a fixed 2x2 grid, a simple
// left/right/up/down split on the current index covers every case,
// no real geometry needed.
// SPE-105: works in visual order rather than pane-index order, which
// stop being the same thing as soon as two panes are swapped.
function focusAdjacentPane(tab: Tab, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') {
  const order = visualPaneOrder(tab);
  const i = order.indexOf(focusedSession(tab));
  if (i < 0) return;
  let next = i;
  if (tab.layout === '2v') {
    if (key === 'ArrowLeft' || key === 'ArrowRight') next = i === 0 ? 1 : 0;
  } else if (tab.layout === '2h') {
    if (key === 'ArrowUp' || key === 'ArrowDown') next = i === 0 ? 1 : 0;
  } else if (tab.layout === '4') {
    // Grid order: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
    if (key === 'ArrowLeft') next = i % 2 === 1 ? i - 1 : i;
    if (key === 'ArrowRight') next = i % 2 === 0 ? i + 1 : i;
    if (key === 'ArrowUp') next = i >= 2 ? i - 2 : i;
    if (key === 'ArrowDown') next = i < 2 ? i + 2 : i;
  }
  const target = order[next];
  if (target) focusPane(tab, paneIndexOf(tab, target));
}

let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (!tab) return;
    for (const s of allSessions(tab)) {
      if (!s.fitAddon || !s.term) continue;
      // Columns don't move, so this only ever adjusts rows. Kept
      // because a taller window really should show more lines.
      syncSessionSize(s);
    }
  }, 100);
});

// --- Text editor sessions (SPE-103) ---
// The editor used to be a fixed right-hand pane holding exactly one
// file for the whole app: it competed with the terminal for width, it
// could not hold two files at once, and closing it was the only way to
// get that width back. It's a session kind now, living in the same pane
// grid as terminals. So an editor can be a whole tab, or one pane of a
// split sitting next to a live shell, and it gets a real editing
// surface either way (document tabs, quick open, command palette,
// status bar) instead of a viewer bolted onto the side.

interface EditorDoc {
  id: string;
  // What the document tab shows: the file's basename, or "Untitled-N"
  // for a buffer that has never been written anywhere.
  title: string;
  path: string | null;
  // false means the file lives on the host behind remoteSessionId and
  // saving goes back out over SFTP.
  isLocal: boolean;
  remoteSessionId: string | null;
  model: monaco.editor.ITextModel;
  viewState: monaco.editor.ICodeEditorViewState | null;
  // model.getAlternativeVersionId() as of the last open or save. Monaco
  // walks this value back on undo, so undoing every edit clears the
  // dirty marker rather than leaving it stuck on forever.
  savedVersionId: number;
  // Cached isDocDirty() result: the content listener fires on every
  // keystroke and only a flip is worth a re-render.
  dirty: boolean;
  // The editor pane holding this document, by its Session id.
  ownerPaneId: string;
}

// One live editor surface. Each gets its own Monaco instance rather
// than sharing one and swapping models: two editor panes can be on
// screen at the same time now, which a single instance can't do.
interface EditorPane {
  session: Session;
  editor: monaco.editor.IStandaloneCodeEditor;
  docIds: string[];
  activeDocId: string | null;
  root: HTMLDivElement;
  docBar: HTMLDivElement;
  // SPE-105: the folder opened as this pane's workspace, and the tree
  // showing it. null when the pane is just holding loose files.
  folder: string | null;
  tree: HTMLDivElement;
  expanded: Set<string>;
  // One listing per directory, so collapsing and re-expanding a folder
  // doesn't go back to disk. Dropped wholesale by the refresh action.
  treeCache: Map<string, LocalFile[]>;
  recentBox: HTMLDivElement;
  statusBar: HTMLDivElement;
  // The cursor readout inside statusBar, rewritten in place as you
  // type rather than rebuilding the whole bar.
  positionEl: HTMLElement | null;
}

const editorPanes = new Map<string, EditorPane>();
const editorDocs = new Map<string, EditorDoc>();
let editorDocCounter = 0;
let untitledCounter = 0;
// Where an "open this file" action lands when nothing in the active tab
// is an editor: the editor pane used last, so opening file after file
// from the remote browser keeps filling the same one instead of
// spraying new tabs across the bar.
let lastEditorPaneId: string | null = null;

// Editor preferences are per-person, not per-document, and live in
// localStorage alongside the other frontend-only toggles (highlighting,
// copy-on-select) rather than in backend settings.json, which is for
// things the Go side also reads.
type EditorPrefs = {
  wordWrap: boolean;
  minimap: boolean;
  whitespace: boolean;
  tabSize: number;
  insertSpaces: boolean;
};

const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  wordWrap: false,
  minimap: true,
  whitespace: false,
  tabSize: 4,
  insertSpaces: true,
};

function loadEditorPrefs(): EditorPrefs {
  try {
    return { ...DEFAULT_EDITOR_PREFS, ...JSON.parse(localStorage.getItem('xpecter-editor-prefs') || '{}') };
  } catch {
    return { ...DEFAULT_EDITOR_PREFS };
  }
}

const editorPrefs = loadEditorPrefs();

function saveEditorPrefs() {
  localStorage.setItem('xpecter-editor-prefs', JSON.stringify(editorPrefs));
}

// Applies whatever the preference toggles changed to every open editor,
// the same way refreshAllTerminalThemes fans a change out to every live
// terminal.
function updateAllEditors(options: monaco.editor.IEditorOptions) {
  for (const pane of editorPanes.values()) pane.editor.updateOptions(options);
}

// Recently opened local files, most recent first. Remote files are
// deliberately not remembered: reopening one needs the SSH session it
// came from to still be up, and a list of paths that mostly fail to
// open is worse than no list at all.
const RECENT_FILES_LIMIT = 12;

function loadRecentFiles(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-editor-recent') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function rememberRecentFile(path: string) {
  const next = [path, ...loadRecentFiles().filter((entry) => entry !== path)].slice(0, RECENT_FILES_LIMIT);
  localStorage.setItem('xpecter-editor-recent', JSON.stringify(next));
}

// Handles both separators deliberately: local paths are Windows-shaped
// on Windows, remote paths are always POSIX, and both land here.
function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '.';
}

// Monaco already ships an extension and filename table for every
// language it bundles, so ask it rather than maintaining a hand-written
// map that quietly falls back to plaintext for whatever nobody
// remembered to add. The map this replaces covered six extensions.
function languageForPath(path: string | null): string {
  if (!path) return 'plaintext';
  const name = baseName(path).toLowerCase();
  const languages = monaco.languages.getLanguages();
  for (const lang of languages) {
    if (lang.filenames?.some((filename) => filename.toLowerCase() === name)) return lang.id;
  }
  if (!name.includes('.')) return 'plaintext';
  const ext = name.slice(name.lastIndexOf('.'));
  for (const lang of languages) {
    if (lang.extensions?.some((entry) => entry.toLowerCase() === ext)) return lang.id;
  }
  return 'plaintext';
}

function languageLabel(id: string): string {
  return monaco.languages.getLanguages().find((lang) => lang.id === id)?.aliases?.[0] || id;
}

// Transient message in the app's own status bar. The remote file
// browser reports through this too, and it can fire before any editor
// exists, so it deliberately lives outside the editor surface.
let statusFlashTimer: ReturnType<typeof setTimeout> | null = null;
function flashStatus(message: string, isError = false) {
  const el = document.getElementById('statusbar')!;
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  if (statusFlashTimer) clearTimeout(statusFlashTimer);
  statusFlashTimer = setTimeout(() => {
    el.textContent = 'Xpecter';
    el.style.color = '';
  }, 2600);
}

// --- Editor pane lifecycle ---

// The editor counterpart of createTerminalForSession: turns one Session
// (a whole tab's primary session, or a split pane) into a live editor,
// reusing the wrapper and header a split pane already has.
function createEditorForSession(session: Session, tab: Tab) {
  ensurePaneGrid(tab);

  let wrapper = session.container;
  if (wrapper) {
    wrapper.querySelector('.pane-landing')?.remove();
  } else {
    wrapper = document.createElement('div');
    wrapper.className = 'pane-wrapper';
    wrapper.appendChild(buildPaneHeader(session, tab));
    preparePaneWrapper(wrapper, session, tab);
    tab.paneGrid!.appendChild(wrapper);
  }

  const root = document.createElement('div');
  root.className = 'editor-view empty';

  const docBar = document.createElement('div');
  docBar.className = 'editor-doc-bar';

  const body = document.createElement('div');
  body.className = 'editor-body';
  const host = document.createElement('div');
  host.className = 'editor-host';
  const empty = document.createElement('div');
  empty.className = 'editor-empty';
  const blurb = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = 'Text editor';
  const sub = document.createElement('p');
  sub.textContent = 'Edit files on this machine, or on any host you have connected.';
  blurb.append(heading, sub);
  const actions = document.createElement('div');
  actions.className = 'editor-empty-actions';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.textContent = 'New File';
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'secondary';
  openBtn.textContent = 'Open File…';
  const folderBtn = document.createElement('button');
  folderBtn.type = 'button';
  folderBtn.className = 'secondary';
  folderBtn.textContent = 'Open Folder…';
  actions.append(newBtn, openBtn, folderBtn);
  const recentBox = document.createElement('div');
  recentBox.className = 'editor-recent';
  empty.append(blurb, actions, recentBox);
  body.append(host, empty);

  // SPE-105: the workspace tree lives beside the buffer, inside the
  // pane, so a split can hold a folder on one side and a shell on the
  // other without either borrowing space from the app chrome.
  const tree = document.createElement('div');
  tree.className = 'editor-tree';
  const main = document.createElement('div');
  main.className = 'editor-main';
  main.append(tree, body);

  const statusBar = document.createElement('div');
  statusBar.className = 'editor-statusbar';

  root.append(docBar, main, statusBar);
  wrapper.appendChild(root);

  const instance = monaco.editor.create(host, {
    // No model until a document is actually opened. The empty state
    // covers that case; a blank untitled buffer conjured up front would
    // sit in every new editor whether or not it was wanted.
    model: null,
    theme: MONACO_THEMES[currentTheme()],
    automaticLayout: true,
    // SPE-78: shares appSettings.fontSize with the terminal, a
    // confirmed choice rather than an independent editor font size.
    fontSize: appSettings.fontSize || FONT_SIZE_DEFAULT,
    fontFamily: fontStack(appSettings.fontFamily || FONT_OPTIONS[0].value),
    fontLigatures: true,
    minimap: { enabled: editorPrefs.minimap },
    wordWrap: editorPrefs.wordWrap ? 'on' : 'off',
    renderWhitespace: editorPrefs.whitespace ? 'all' : 'selection',
    tabSize: editorPrefs.tabSize,
    insertSpaces: editorPrefs.insertSpaces,
    // A file that already uses a different indent style keeps it,
    // rather than the preference silently reformatting somebody else's
    // config the first time you press Tab in it.
    detectIndentation: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    multiCursorModifier: 'alt',
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    stickyScroll: { enabled: true },
    linkedEditing: true,
    padding: { top: 6, bottom: 6 },
    scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11, useShadows: false },
    find: { addExtraSpaceOnTop: false, seedSearchStringFromSelection: 'selection' },
  });

  const pane: EditorPane = {
    session,
    editor: instance,
    docIds: [],
    activeDocId: null,
    root,
    docBar,
    folder: null,
    tree,
    expanded: new Set<string>(),
    treeCache: new Map<string, LocalFile[]>(),
    recentBox,
    statusBar,
    positionEl: null,
  };
  editorPanes.set(session.id, pane);

  session.mode = 'editor';
  session.label = 'Editor';
  session.container = wrapper;
  if (session === tab) tab.label = 'Editor';

  newBtn.onclick = () => { newUntitledDoc(pane); };
  openBtn.onclick = () => { void openLocalFile(undefined, pane); };
  folderBtn.onclick = () => { void chooseFolder(pane); };

  instance.onDidChangeCursorPosition(() => updateStatusPosition(pane));
  instance.onDidChangeCursorSelection(() => updateStatusPosition(pane));
  instance.onDidChangeModelLanguage(() => renderEditorStatusBar(pane));
  instance.onDidChangeModelOptions(() => renderEditorStatusBar(pane));
  instance.onDidFocusEditorText(() => {
    lastEditorPaneId = session.id;
    const owner = tabs.get(session.ownerTabId);
    if (owner) focusPane(owner, paneIndexOf(owner, session));
  });
  registerEditorKeybindings(pane);

  renderDocBar(pane);
  applyActiveDoc(pane);
  renderTabBar();
}

// Called from closeSessionBackend, which already handles every other
// session kind's teardown.
function disposeEditorPane(session: Session) {
  const pane = editorPanes.get(session.id);
  if (!pane) return;
  pane.editor.setModel(null);
  for (const docId of pane.docIds) {
    const doc = editorDocs.get(docId);
    if (!doc) continue;
    editorDocs.delete(docId);
    doc.model.dispose();
  }
  pane.editor.dispose();
  editorPanes.delete(session.id);
  if (lastEditorPaneId === session.id) lastEditorPaneId = null;
  // Closing an editor pane retires whatever folder it was showing, and
  // with it any watch nothing else still needs.
  syncWatchedDirs();
}

// Every unsaved buffer in one editor pane, asked about one at a time.
// Returns false the moment one is cancelled, leaving the pane and
// everything in it exactly as it was.
async function confirmCloseEditorSession(session: Session): Promise<boolean> {
  const pane = editorPanes.get(session.id);
  if (!pane) return true;
  for (const docId of [...pane.docIds]) {
    const doc = editorDocs.get(docId);
    if (!doc || !doc.dirty) continue;
    setActiveDoc(pane, doc.id);
    const answer = await confirmDiscard(doc);
    if (answer === 'cancel') return false;
    if (answer === 'save' && !(await saveDoc(doc))) return false;
  }
  return true;
}

// The editor a keyboard command or the quick pick acts on: the focused
// pane of the active tab, when that pane happens to be an editor.
function focusedEditorPane(): EditorPane | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  // focusedPaneIndex can outlive the pane it points at for a tick while
  // one is closing, and this runs from a document-wide keydown
  // listener, where a throw would take every editor shortcut with it.
  const session = tab ? focusedSession(tab) : null;
  return session ? editorPanes.get(session.id) ?? null : null;
}


function isDocDirty(doc: EditorDoc): boolean {
  return doc.model.getAlternativeVersionId() !== doc.savedVersionId;
}

// A dirty buffer anywhere in a tab is worth a marker on the tab itself,
// including when the editor is one pane of a split next to a shell and
// its own pane header is off screen behind another tab.
function editorDirtyMarker(tab: Tab): string {
  const dirty = allSessions(tab).some((session) => {
    const pane = editorPanes.get(session.id);
    return !!pane && pane.docIds.some((docId) => editorDocs.get(docId)?.dirty);
  });
  return dirty ? ' •' : '';
}

function editorTabLabel(tab: Tab): string {
  return `\u{1F4DD} ${tab.label}`;
}

function revealEditorPane(pane: EditorPane) {
  const tab = tabs.get(pane.session.ownerTabId);
  if (!tab) return;
  switchToTab(tab.id);
  focusPane(tab, paneIndexOf(tab, pane.session));
  pane.editor.focus();
}

// A whole tab that is an editor, reusing the blank tab a New Session
// flow just created rather than leaving an empty "New Tab" beside it.
function newEditorTabPane(): EditorPane {
  const current = activeTabId ? tabs.get(activeTabId) : null;
  const tab = current && current.mode === 'pending' && !current.isHome && current.extraPanes.length === 0
    ? current
    : createPendingTab();
  switchToTab(tab.id);
  createEditorForSession(tab, tab);
  switchToTab(tab.id);
  return editorPanes.get(tab.id)!;
}

// Where an open-file action should land.
function editorPaneForOpening(): EditorPane {
  const focused = focusedEditorPane();
  if (focused) return focused;
  const last = lastEditorPaneId ? editorPanes.get(lastEditorPaneId) : null;
  if (last) {
    revealEditorPane(last);
    return last;
  }
  for (const pane of editorPanes.values()) {
    revealEditorPane(pane);
    return pane;
  }
  return newEditorTabPane();
}

// --- Documents ---

function createDoc(pane: EditorPane, opts: {
  title: string;
  path: string | null;
  isLocal: boolean;
  remoteSessionId: string | null;
  content: string;
}): EditorDoc {
  editorDocCounter += 1;
  const model = monaco.editor.createModel(opts.content, languageForPath(opts.path));
  const doc: EditorDoc = {
    id: `doc-${editorDocCounter}`,
    title: opts.title,
    path: opts.path,
    isLocal: opts.isLocal,
    remoteSessionId: opts.remoteSessionId,
    model,
    viewState: null,
    savedVersionId: model.getAlternativeVersionId(),
    dirty: false,
    ownerPaneId: pane.session.id,
  };
  editorDocs.set(doc.id, doc);
  pane.docIds.push(doc.id);
  model.onDidChangeContent(() => {
    // Fires on every keystroke, so only a genuine flip between clean
    // and dirty is worth the re-renders below.
    const dirty = isDocDirty(doc);
    if (dirty === doc.dirty) return;
    doc.dirty = dirty;
    renderDocBar(pane);
    renderEditorStatusBar(pane);
    renderTabBar();
  });
  return doc;
}

// Parks the outgoing document's cursor and scroll position so coming
// back to it lands where you left it rather than at line 1.
function stashViewState(pane: EditorPane) {
  const previous = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  if (previous && pane.editor.getModel() === previous.model) previous.viewState = pane.editor.saveViewState();
}

function setActiveDoc(pane: EditorPane, docId: string | null) {
  if (pane.activeDocId === docId) {
    pane.editor.focus();
    return;
  }
  stashViewState(pane);
  pane.activeDocId = docId;
  applyActiveDoc(pane);
  renderDocBar(pane);
  renderTabBar();
}

function applyActiveDoc(pane: EditorPane) {
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  pane.root.classList.toggle('empty', !doc);
  if (doc) {
    pane.editor.setModel(doc.model);
    if (doc.viewState) pane.editor.restoreViewState(doc.viewState);
  } else {
    pane.editor.setModel(null);
    renderRecentFiles(pane);
  }
  // Drives both the pane header and, for a whole editor tab, the tab
  // bar entry, so the filename is visible wherever the editor is.
  pane.session.label = doc ? doc.title : 'Editor';
  const tab = tabs.get(pane.session.ownerTabId);
  if (tab && pane.session === tab) tab.label = pane.session.label;
  renderEditorStatusBar(pane);
}

function findOpenDoc(path: string, isLocal: boolean, remoteSessionId: string | null): EditorDoc | null {
  for (const doc of editorDocs.values()) {
    if (doc.path !== path || doc.isLocal !== isLocal) continue;
    if (!isLocal && doc.remoteSessionId !== remoteSessionId) continue;
    return doc;
  }
  return null;
}

// A file is only ever open in one place: opening one that's already
// open reveals it rather than building a second model for the same
// path, which would let two panes silently diverge and race on save.
function revealDoc(doc: EditorDoc) {
  const pane = editorPanes.get(doc.ownerPaneId);
  if (!pane) return;
  revealEditorPane(pane);
  setActiveDoc(pane, doc.id);
}

function newUntitledDoc(pane: EditorPane): EditorDoc {
  untitledCounter += 1;
  const doc = createDoc(pane, {
    title: `Untitled-${untitledCounter}`,
    path: null,
    isLocal: true,
    remoteSessionId: null,
    content: '',
  });
  setActiveDoc(pane, doc.id);
  return doc;
}

async function openLocalFile(path?: string, into?: EditorPane) {
  // Opens in the workspace when there is one, so Open File inside a
  // folder doesn't start wherever the OS dialog was last.
  const startIn = into?.folder ?? focusedEditorPane()?.folder ?? '';
  const target = path ?? await App.SelectFileIn(startIn);
  if (!target) return; // cancelled
  const already = findOpenDoc(target, true, null);
  if (already) {
    revealDoc(already);
    return;
  }
  let content: string;
  try {
    content = await App.ReadLocalFile(target);
  } catch (err) {
    flashStatus(`Open failed: ${err}`, true);
    return;
  }
  const pane = into ?? editorPaneForOpening();
  const doc = createDoc(pane, {
    title: baseName(target),
    path: target,
    isLocal: true,
    remoteSessionId: null,
    content,
  });
  rememberRecentFile(target);
  setActiveDoc(pane, doc.id);
}

async function openRemoteFile(sessionId: string, path: string) {
  const already = findOpenDoc(path, false, sessionId);
  if (already) {
    revealDoc(already);
    return;
  }
  const content = await App.ReadRemoteFile(sessionId, path);
  const pane = editorPaneForOpening();
  const doc = createDoc(pane, {
    title: baseName(path),
    path,
    isLocal: false,
    remoteSessionId: sessionId,
    content,
  });
  setActiveDoc(pane, doc.id);
}

function markDocSaved(doc: EditorDoc) {
  doc.savedVersionId = doc.model.getAlternativeVersionId();
  doc.dirty = false;
  const pane = editorPanes.get(doc.ownerPaneId);
  if (pane) {
    renderDocBar(pane);
    renderEditorStatusBar(pane);
  }
  renderTabBar();
}

// Points a document at a new home after Save As. Both callers have
// already written the bytes by the time they get here.
function retargetDoc(doc: EditorDoc, to: { path: string; isLocal: boolean; remoteSessionId: string | null }) {
  doc.path = to.path;
  doc.isLocal = to.isLocal;
  doc.remoteSessionId = to.remoteSessionId;
  doc.title = baseName(to.path);
  monaco.editor.setModelLanguage(doc.model, languageForPath(to.path));
  markDocSaved(doc);
  const pane = editorPanes.get(doc.ownerPaneId);
  if (pane && pane.activeDocId === doc.id) applyActiveDoc(pane);
}

async function saveDoc(doc: EditorDoc): Promise<boolean> {
  // Nothing written anywhere yet (Untitled), so Save behaves like Save
  // As rather than silently doing nothing, matching every editor's
  // convention.
  if (!doc.path) return saveDocAs(doc);
  try {
    if (doc.isLocal) await App.WriteLocalFile(doc.path, doc.model.getValue());
    else if (doc.remoteSessionId) await App.WriteRemoteFile(doc.remoteSessionId, doc.path, doc.model.getValue());
    else return saveDocAs(doc);
  } catch (err) {
    flashStatus(`Save failed: ${err}`, true);
    return false;
  }
  markDocSaved(doc);
  flashStatus(`Saved ${doc.title}`);
  return true;
}

async function saveDocAs(doc: EditorDoc): Promise<boolean> {
  const pane = editorPanes.get(doc.ownerPaneId);
  const suggested = doc.path ? baseName(doc.path) : (doc.title.includes('.') ? doc.title : `${doc.title}.txt`);
  // The pane's workspace first, then wherever this file already lives,
  // then the OS default. Saving into the folder you have open is what
  // Save As is for most of the time.
  const startIn = pane?.folder ?? (doc.path && doc.isLocal ? dirName(doc.path) : '');
  const path = await App.SaveTextFileIn(startIn, suggested, doc.model.getValue());
  if (!path) return false; // cancelled
  retargetDoc(doc, { path, isLocal: true, remoteSessionId: null });
  rememberRecentFile(path);
  flashStatus(`Saved ${doc.title}`);
  return true;
}

// Save As, but onto a host: the replacement for the old editor pane's
// "Save As -> Remote path" menu, now a command like everything else.
async function saveDocToRemote(doc: EditorDoc): Promise<boolean> {
  const sessionId = doc.remoteSessionId ?? remoteTargetSessionId();
  if (!sessionId) {
    alert('No connected SSH session to save to. Connect one first, then try again.');
    return false;
  }
  const suggested = doc.path && !doc.isLocal
    ? doc.path
    : (currentRemotePath === '.' ? doc.title : `${currentRemotePath}/${doc.title}`);
  const path = prompt('Save to remote path:', suggested);
  if (!path) return false; // cancelled
  try {
    await App.WriteRemoteFile(sessionId, path, doc.model.getValue());
  } catch (err) {
    flashStatus(`Save failed: ${err}`, true);
    return false;
  }
  retargetDoc(doc, { path, isLocal: false, remoteSessionId: sessionId });
  flashStatus(`Saved ${doc.title}`);
  return true;
}

// Whichever host the file browser is currently pointed at, else any
// live SSH session, so "save to remote" from a scratch buffer still has
// somewhere obvious to go.
function remoteTargetSessionId(): string | null {
  if (currentRemoteSessionId) return currentRemoteSessionId;
  for (const tab of tabs.values()) {
    for (const session of allSessions(tab)) {
      if (session.mode !== 'ssh' || session.status !== 'connected' || session.stopped) continue;
      if (session.backendId) return session.backendId;
    }
  }
  return null;
}

async function reloadDoc(doc: EditorDoc) {
  if (!doc.path) return;
  if (!doc.isLocal && !doc.remoteSessionId) return;
  if (doc.dirty && !confirm(`Reload ${doc.title} from disk? Unsaved changes will be lost.`)) return;
  try {
    const content = doc.isLocal
      ? await App.ReadLocalFile(doc.path)
      : await App.ReadRemoteFile(doc.remoteSessionId!, doc.path);
    // Through the model rather than the editor, so this lands on the
    // right document even when it isn't the one on screen.
    doc.model.setValue(content);
    markDocSaved(doc);
    flashStatus(`Reloaded ${doc.title}`);
  } catch (err) {
    flashStatus(`Reload failed: ${err}`, true);
  }
}

// Three-way, the way every editor asks: save and close, discard and
// close, or don't close at all. confirm() only offers two of those, and
// the missing third is the one that protects the work.
function confirmDiscard(doc: EditorDoc): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    buildDialog({
      title: 'Unsaved changes',
      tone: 'warning',
      onDismiss: () => resolve('cancel'),
      fill: (body) => {
        dialogText(body, `${doc.title} has changes that have not been saved.`);
        if (doc.path) dialogField(body, doc.isLocal ? 'File' : 'Remote file', doc.path);
      },
      actions: [
        { label: 'Discard', kind: 'danger', run: () => resolve('discard') },
        { label: 'Cancel', kind: 'secondary', run: () => resolve('cancel') },
        { label: 'Save', run: () => resolve('save') },
      ],
    });
  });
}

async function closeDoc(doc: EditorDoc): Promise<boolean> {
  if (doc.dirty) {
    const answer = await confirmDiscard(doc);
    if (answer === 'cancel') return false;
    if (answer === 'save' && !(await saveDoc(doc))) return false;
  }
  discardDoc(doc);
  return true;
}

// Removes a document with no prompting: used once closeDoc has settled
// the unsaved-changes question.
function discardDoc(doc: EditorDoc) {
  const pane = editorPanes.get(doc.ownerPaneId);
  editorDocs.delete(doc.id);
  if (pane) {
    const index = pane.docIds.indexOf(doc.id);
    if (index >= 0) pane.docIds.splice(index, 1);
    if (pane.activeDocId === doc.id) {
      // Whatever slid into its place, else the one before it, which is
      // what every editor does when you close the rightmost tab.
      pane.activeDocId = pane.docIds[Math.min(index, pane.docIds.length - 1)] ?? null;
      applyActiveDoc(pane);
    }
  }
  // Disposed only after the editor has been pointed somewhere else:
  // disposing a model that's still attached leaves Monaco holding a
  // dead reference.
  doc.model.dispose();
  if (!pane) return;
  renderDocBar(pane);
  renderTabBar();
}

function cycleDoc(pane: EditorPane, delta: number) {
  if (pane.docIds.length < 2) return;
  const current = pane.activeDocId ? pane.docIds.indexOf(pane.activeDocId) : -1;
  const next = (current + delta + pane.docIds.length) % pane.docIds.length;
  setActiveDoc(pane, pane.docIds[next]);
}

function reorderDocs(pane: EditorPane, draggedId: string, targetId: string) {
  const from = pane.docIds.indexOf(draggedId);
  if (from < 0 || !pane.docIds.includes(targetId)) return;
  pane.docIds.splice(from, 1);
  pane.docIds.splice(pane.docIds.indexOf(targetId), 0, draggedId);
  renderDocBar(pane);
}

// --- Editor pane rendering ---

function renderDocBar(pane: EditorPane) {
  pane.docBar.innerHTML = '';
  pane.docBar.appendChild(buildFolderButton(pane));
  for (const docId of pane.docIds) {
    const doc = editorDocs.get(docId);
    if (!doc) continue;
    pane.docBar.appendChild(buildDocTab(pane, doc, docId === pane.activeDocId));
  }
  const add = document.createElement('div');
  add.className = 'doc-add';
  add.textContent = '+';
  add.title = 'New file (Ctrl+N)';
  add.onclick = () => { newUntitledDoc(pane); };
  pane.docBar.appendChild(add);
  refreshTreeHighlights(pane);
}

function buildDocTab(pane: EditorPane, doc: EditorDoc, isActive: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'doc-tab' + (isActive ? ' active' : '') + (doc.dirty ? ' dirty' : '');
  el.draggable = true;
  el.title = doc.path ?? `${doc.title} (never saved)`;
  el.onclick = () => setActiveDoc(pane, doc.id);
  // Middle-click closes, the same gesture the remote file list already
  // uses for its own secondary action.
  el.onauxclick = (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    void closeDoc(doc);
  };
  el.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('text/xpecter-doc-id', doc.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    pane.docBar.querySelectorAll('.drop-target').forEach((item) => item.classList.remove('drop-target'));
  });
  el.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    el.classList.remove('drop-target');
    const draggedId = event.dataTransfer?.getData('text/xpecter-doc-id');
    if (draggedId && draggedId !== doc.id) reorderDocs(pane, draggedId, doc.id);
  });

  if (!doc.isLocal) {
    const remote = document.createElement('span');
    remote.className = 'doc-remote';
    remote.textContent = '\u{1F310}';
    remote.title = 'On a remote host';
    el.appendChild(remote);
  }

  const name = document.createElement('span');
  name.className = 'doc-name';
  name.textContent = doc.title;
  el.appendChild(name);

  const dot = document.createElement('span');
  dot.className = 'doc-dot';
  dot.textContent = '•';
  el.appendChild(dot);

  const close = document.createElement('span');
  close.className = 'doc-close';
  close.textContent = '✕';
  close.title = 'Close file (Ctrl+W)';
  close.onclick = (e) => {
    e.stopPropagation();
    void closeDoc(doc);
  };
  el.appendChild(close);
  return el;
}

function renderRecentFiles(pane: EditorPane) {
  pane.recentBox.innerHTML = '';
  const folders = loadRecentFolders().filter((folder) => folder !== pane.folder);
  if (folders.length > 0) {
    pane.recentBox.appendChild(recentHead('Recent folders', false));
    for (const folder of folders) {
      pane.recentBox.appendChild(recentRow(folder, '\u{1F4C1}', () => { void openFolder(pane, folder); }));
    }
  }
  const recent = loadRecentFiles();
  if (recent.length === 0) return;
  pane.recentBox.appendChild(recentHead('Recent files', folders.length > 0));
  for (const path of recent) {
    pane.recentBox.appendChild(recentRow(path, '', () => { void openLocalFile(path, pane); }));
  }
}

function recentHead(text: string, spaced: boolean): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'editor-recent-head';
  if (spaced) head.style.marginTop = '12px';
  head.textContent = text;
  return head;
}

function recentRow(path: string, glyph: string, run: () => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'editor-recent-row';
  row.title = path;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = glyph ? `${glyph} ${baseName(path)}` : baseName(path);
  const dir = document.createElement('span');
  dir.className = 'dir';
  dir.textContent = dirName(path);
  row.append(name, dir);
  row.onclick = run;
  return row;
}

// The status bar is the discoverable half of the editor: every readout
// on it is also the control that changes what it reports.
function renderEditorStatusBar(pane: EditorPane) {
  pane.statusBar.innerHTML = '';
  pane.positionEl = null;
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;

  const path = document.createElement('span');
  path.className = 'es-path';
  if (!doc) path.textContent = 'No file open';
  else if (!doc.path) path.textContent = `${doc.title} — not saved yet`;
  else path.textContent = doc.isLocal ? doc.path : `remote: ${doc.path}`;
  path.title = path.textContent;
  if (doc?.dirty) {
    const marker = document.createElement('span');
    marker.className = 'es-dirty';
    marker.textContent = ' • unsaved';
    path.appendChild(marker);
  }
  pane.statusBar.appendChild(path);
  if (!doc) return;

  pane.positionEl = statusItem(pane, '', 'Go to line (Ctrl+G)', () => runEditorAction(pane, 'editor.action.gotoLine'));
  updateStatusPosition(pane);
  statusItem(pane, indentLabel(doc), 'Change indentation', () => chooseIndentation(pane));
  statusItem(pane, doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF', 'Change line endings', () => chooseLineEndings(pane));
  statusItem(pane, languageLabel(doc.model.getLanguageId()), 'Change language', () => chooseLanguage(pane));
  statusItem(pane, editorPrefs.wordWrap ? 'Wrap' : 'No wrap', 'Toggle word wrap (Alt+Z)', toggleWordWrap);
}

function statusItem(pane: EditorPane, text: string, title: string, run: () => void): HTMLElement {
  const el = document.createElement('span');
  el.className = 'es-item';
  el.textContent = text;
  el.title = title;
  el.onclick = run;
  pane.statusBar.appendChild(el);
  return el;
}

function indentLabel(doc: EditorDoc): string {
  const options = doc.model.getOptions();
  return options.insertSpaces ? `Spaces: ${options.tabSize}` : `Tab width: ${options.tabSize}`;
}

// Only the cursor readout changes as you type, so it's written in place
// rather than rebuilding the whole bar on every keystroke.
function updateStatusPosition(pane: EditorPane) {
  if (!pane.positionEl) return;
  const position = pane.editor.getPosition();
  if (!position) {
    pane.positionEl.textContent = '';
    return;
  }
  const selection = pane.editor.getSelection();
  const model = pane.editor.getModel();
  const selected = selection && model && !selection.isEmpty()
    ? model.getValueInRange(selection).length
    : 0;
  pane.positionEl.textContent = `Ln ${position.lineNumber}, Col ${position.column}`
    + (selected ? ` (${selected} selected)` : '');
}

// --- Editor workspaces (SPE-105) ---
// A folder opened inside one editor pane, with a tree beside the
// buffer. Open File and Save As start there, and Go to File reaches
// anything the tree has already listed.

const RECENT_FOLDERS_LIMIT = 8;

function loadRecentFolders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-editor-recent-folders') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

function rememberRecentFolder(folder: string) {
  const next = [folder, ...loadRecentFolders().filter((entry) => entry !== folder)].slice(0, RECENT_FOLDERS_LIMIT);
  localStorage.setItem('xpecter-editor-recent-folders', JSON.stringify(next));
}

async function chooseFolder(pane: EditorPane) {
  const folder = await App.SelectFolder();
  if (!folder) return; // cancelled
  await openFolder(pane, folder);
}

async function openFolder(pane: EditorPane, folder: string) {
  pane.folder = folder;
  pane.expanded = new Set([folder]);
  pane.treeCache.clear();
  pane.root.classList.add('has-folder');
  rememberRecentFolder(folder);
  renderRecentFiles(pane);
  renderDocBar(pane);
  renderFolderList();
  await renderEditorTree(pane);
  pane.editor.layout();
}

function closeFolder(pane: EditorPane) {
  pane.folder = null;
  pane.expanded.clear();
  pane.treeCache.clear();
  pane.root.classList.remove('has-folder');
  pane.tree.innerHTML = '';
  renderRecentFiles(pane);
  renderDocBar(pane);
  renderFolderList();
  pane.editor.layout();
  // Closing the last open folder is what drops the final watch, so this
  // path has to report the new set too; it never reaches renderEditorTree.
  syncWatchedDirs();
}

async function refreshFolder(pane: EditorPane) {
  pane.treeCache.clear();
  await renderEditorTree(pane);
}

// Creating from the tree is how a folder you already have open grows.
// Every other local write path starts at an OS dialog, which answers
// "where should this buffer go" rather than "add a file to the folder I
// am working in", and a workspace needs the second one.
//
// The directory is a parameter rather than an assumption: the tree head
// creates at the workspace root, a folder row creates inside itself.
async function createInTree(pane: EditorPane, dir: string, kind: 'file' | 'folder') {
  const name = prompt(`New ${kind} in ${baseName(dir)}:`);
  if (name === null) return; // cancelled
  let path: string;
  try {
    path = kind === 'file'
      ? await App.CreateLocalFile(dir, name)
      : await App.CreateLocalDir(dir, name);
  } catch (err) {
    // The backend's own refusals arrive here alongside real IO errors:
    // a name already taken, or a name that is really a path. Both say
    // something worth reading, so neither is reworded.
    flashStatus(String(err), true);
    return;
  }
  // The new entry has to actually show up: its level is cached, and the
  // folder it landed in may have been collapsed.
  pane.expanded.add(dir);
  if (kind === 'folder') pane.expanded.add(path);
  await refreshFolder(pane);
  flashStatus(`Created ${baseName(path)}`);
  // A new file opens, because creating one is how you start writing it.
  if (kind === 'file') await openLocalFile(path, pane);
}

async function renderEditorTree(pane: EditorPane) {
  pane.tree.innerHTML = '';
  const folder = pane.folder;
  if (!folder) return;

  const head = document.createElement('div');
  head.className = 'editor-tree-head';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = baseName(folder);
  name.title = folder;
  head.appendChild(name);
  head.appendChild(treeAction('＋', `New file in ${baseName(folder)}`, () => { void createInTree(pane, folder, 'file'); }));
  head.appendChild(treeAction('⊞', `New folder in ${baseName(folder)}`, () => { void createInTree(pane, folder, 'folder'); }));
  head.appendChild(treeAction('⟳', 'Reread this folder from disk', () => { void refreshFolder(pane); }));
  head.appendChild(treeAction('\u{1F4C1}', 'Open a different folder', () => { void chooseFolder(pane); }));
  head.appendChild(treeAction('✕', 'Close this folder', () => closeFolder(pane)));
  pane.tree.appendChild(head);

  const body = document.createElement('div');
  pane.tree.appendChild(body);
  await appendTreeLevel(pane, body, folder, 0);
  // Every level the tree draws is cached by now, so this is the point
  // where the set of directories worth watching is actually known.
  syncWatchedDirs();
}

function treeAction(glyph: string, title: string, run: () => void): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'act';
  el.textContent = glyph;
  el.title = title;
  // Stopped as well as run: on a folder row this click would otherwise
  // reach the row and toggle it open or shut under the new entry.
  el.onclick = (e) => { e.stopPropagation(); run(); };
  return el;
}

function treeNote(text: string, depth: number): HTMLDivElement {
  const note = document.createElement('div');
  note.className = 'editor-tree-note';
  note.style.paddingLeft = `${12 + depth * 12}px`;
  note.textContent = text;
  return note;
}

async function appendTreeLevel(pane: EditorPane, parent: HTMLElement, dir: string, depth: number) {
  let entries = pane.treeCache.get(dir);
  if (!entries) {
    try {
      entries = await App.ListLocalDir(dir);
    } catch (err) {
      // A folder that can't be read is worth saying so in place, rather
      // than an empty level that looks like an empty directory.
      parent.appendChild(treeNote(String(err), depth));
      return;
    }
    pane.treeCache.set(dir, entries);
  }
  if (entries.length === 0) {
    parent.appendChild(treeNote('empty', depth));
    return;
  }
  const openPaths = new Set(Array.from(editorDocs.values(), (doc) => doc.path));
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'tree-row' + (!entry.isDir && openPaths.has(entry.path) ? ' open' : '');
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.title = entry.path;
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = entry.isDir ? (pane.expanded.has(entry.path) ? '▾' : '▸') : '';
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = entry.name;
    row.append(chev, label);
    // So a subfolder can be created in without first making it the
    // workspace root. Folders only: a file has nothing to create inside.
    if (entry.isDir) {
      row.appendChild(treeAction('＋', `New file in ${entry.name}`, () => { void createInTree(pane, entry.path, 'file'); }));
      row.appendChild(treeAction('⊞', `New folder in ${entry.name}`, () => { void createInTree(pane, entry.path, 'folder'); }));
    }
    row.onclick = () => {
      if (!entry.isDir) {
        void openLocalFile(entry.path, pane);
        return;
      }
      if (pane.expanded.has(entry.path)) {
        pane.expanded.delete(entry.path);
      } else {
        pane.expanded.add(entry.path);
        // The watcher only follows folders that are open, so this level
        // may have gone stale while it was shut. Drop it and pay for one
        // listing on expand rather than showing what was there before.
        pane.treeCache.delete(entry.path);
      }
      void renderEditorTree(pane);
    };
    parent.appendChild(row);
    if (entry.isDir && pane.expanded.has(entry.path)) {
      const child = document.createElement('div');
      parent.appendChild(child);
      await appendTreeLevel(pane, child, entry.path, depth + 1);
    }
  }
}

// Which tree rows are currently open as documents. Toggled in place
// rather than through a full re-render, since this runs every time a
// document is opened, closed or switched.
function refreshTreeHighlights(pane: EditorPane) {
  if (!pane.folder) return;
  const openPaths = new Set(Array.from(editorDocs.values(), (doc) => doc.path));
  pane.tree.querySelectorAll('.tree-row').forEach((row) => {
    const rowPath = (row as HTMLElement).title;
    row.classList.toggle('open', !!rowPath && openPaths.has(rowPath));
  });
}

// A folder that grows while you are looking at it should show the new
// file without being asked.
//
// The local tree is driven by real filesystem notifications: the
// backend watches exactly the directories drawn on screen and emits
// "fs:changed". The slow pass below is a backstop, not the mechanism.
// It stays because a watch can fail to register or miss an event
// without saying so (a network path, a filesystem with no notification
// support, the platform's watch limit), and the cost of being wrong
// about that is a tree that silently stops updating. Re-listing a
// handful of visible directories every fifteen seconds is cheap
// insurance against a failure mode with no other symptom.
//
// The remote browser has no equivalent and polls outright: it is SFTP,
// which has no watch verb at all.

const TREE_WATCH_INTERVAL_MS = 15000;

// Name, kind and size, in listing order. Size is deliberately left out
// for directories: on Linux a directory's own size changes when a file
// is created inside it, which would redraw the tree for a change in a
// folder that may not even be expanded. Shaped for both LocalFile and
// RemoteFile, since the two trees are the same shape.
function listingSignature(entries: Array<{ name: string; isDir: boolean; size: number }>): string {
  return entries.map((e) => (e.isDir ? `d:${e.name}` : `f:${e.name}:${e.size}`)).join('\n');
}

// The directories the tree is currently drawing: the root, plus every
// expanded folder reachable from it. Walked the same way appendTreeLevel
// walks, so the two can't drift. pane.expanded on its own is not the
// answer, it keeps entries for subfolders whose parent has since been
// collapsed, and those are not on screen.
function visibleTreeDirs(pane: EditorPane): string[] {
  const folder = pane.folder;
  if (!folder) return [];
  const dirs = [folder];
  const walk = (dir: string) => {
    for (const entry of pane.treeCache.get(dir) ?? []) {
      if (!entry.isDir || !pane.expanded.has(entry.path)) continue;
      dirs.push(entry.path);
      walk(entry.path);
    }
  };
  walk(folder);
  return dirs;
}

async function watchEditorTree(pane: EditorPane) {
  if (!pane.folder) return;
  let changed = false;
  for (const dir of visibleTreeDirs(pane)) {
    let entries: LocalFile[];
    try {
      entries = await App.ListLocalDir(dir);
    } catch {
      // The folder went away or stopped being readable. Drop its cached
      // level so the redraw re-reads it and reports the failure in
      // place, which is appendTreeLevel's job rather than the watcher's.
      if (pane.treeCache.delete(dir)) changed = true;
      continue;
    }
    // An absent cache entry counts as a change even against an empty
    // listing: that is the state the error path above leaves behind, and
    // a folder that becomes readable again while still empty has to
    // clear the error note it is currently showing.
    const cached = pane.treeCache.get(dir);
    if (cached && listingSignature(entries) === listingSignature(cached)) continue;
    pane.treeCache.set(dir, entries);
    changed = true;
  }
  if (!changed) return;
  // Every visible level is warm now, so the redraw is cache-only. Scroll
  // is restored because a file appearing three levels down must not
  // throw the view back to the root.
  const scrollTop = pane.tree.scrollTop;
  await renderEditorTree(pane);
  pane.tree.scrollTop = scrollTop;
}

// One pass at a time: on a mapped drive a listing can outlast the
// interval, and stacked ticks would queue round trips behind each other.
let treeWatchRunning = false;

async function runTreeWatchPass() {
  if (treeWatchRunning || document.hidden) return;
  treeWatchRunning = true;
  try {
    for (const pane of editorPanes.values()) {
      // Panes belonging to other tabs are display:none. Their trees are
      // re-read when the tab is switched to, which is soon enough.
      if (pane.folder && pane.session.ownerTabId === activeTabId) await watchEditorTree(pane);
    }
  } finally {
    treeWatchRunning = false;
  }
}

setInterval(() => { void runTreeWatchPass(); }, TREE_WATCH_INTERVAL_MS);
// Coming back to the window is the moment a folder is most likely to
// have changed behind the app's back, so don't wait out the interval.
window.addEventListener('focus', () => { void runTreeWatchPass(); });

// --- Filesystem notifications for the local tree ---

// Every directory any on-screen tree is drawing, across all panes. This
// is the set handed to the backend watcher, and the set an incoming
// change is matched against.
function watchedTreeDirs(): string[] {
  const dirs = new Set<string>();
  for (const pane of editorPanes.values()) {
    if (!pane.folder) continue;
    for (const dir of visibleTreeDirs(pane)) dirs.add(dir);
  }
  return Array.from(dirs);
}

// The last set sent, joined, so an unchanged set doesn't cross the
// bridge again. syncWatchedDirs runs after every render, which is often.
let sentWatchKey = ' ';

function syncWatchedDirs() {
  const dirs = watchedTreeDirs();
  const key = dirs.slice().sort().join('\n');
  if (key === sentWatchKey) return;
  sentWatchKey = key;
  void App.WatchLocalDirs(dirs).catch(() => {
    // Watching is an optimisation over the reconciliation pass, so a
    // backend that can't watch is not worth interrupting anyone about.
    // Clear the cached key so the next render tries again.
    sentWatchKey = ' ';
  });
}

runtime.EventsOn('fs:changed', (payload: unknown) => {
  const changed = new Set(Array.isArray(payload) ? (payload as string[]) : []);
  if (changed.size === 0) return;
  for (const pane of editorPanes.values()) {
    if (!pane.folder) continue;
    // Only panes actually showing one of the changed directories. A
    // change under a folder that this pane has collapsed is not its
    // business, and re-listing for it would undo the point of watching
    // a narrow set in the first place.
    if (!visibleTreeDirs(pane).some((dir) => changed.has(dir))) continue;
    void watchEditorTree(pane);
  }
});

// SPE-106: folders pinned to the sidebar are the editor's counterpart
// to saved sessions, so the two reach each other: pinning one opens it,
// and the editor's own folder menu lists them.

function folderLabel(folder: Folder): string {
  return folder.name || baseName(folder.path);
}

async function renderFolderList() {
  let folders: Folder[];
  try {
    folders = await App.ListFolders();
  } catch {
    return;
  }
  const list = document.getElementById('folder-list')!;
  list.innerHTML = '';

  // The filter field covers the whole panel, not just the Sessions
  // section, same as the local shells list above.
  const query = sessionSearchQuery.trim().toLowerCase();
  const visible = query
    ? folders.filter((f) => folderLabel(f).toLowerCase().includes(query) || f.path.toLowerCase().includes(query))
    : folders;

  document.getElementById('folders-count')!.textContent = String(folders.length);

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-empty';
    empty.textContent = query ? 'No folders match.' : 'No folders pinned yet.';
    list.appendChild(empty);
    return;
  }

  const openFolders = new Set(Array.from(editorPanes.values(), (pane) => pane.folder));
  for (const folder of visible) {
    list.appendChild(buildFolderRow(folder, openFolders.has(folder.path)));
  }
}

function buildFolderRow(folder: Folder, isOpen: boolean): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'side-row' + (isOpen ? ' folder-open' : '');
  row.tabIndex = -1;
  row.title = isOpen ? `${folder.path} — open in an editor` : folder.path;

  const icon = document.createElement('span');
  icon.className = 'side-dot';
  icon.style.cssText = 'box-shadow:none;background:transparent;width:auto;height:auto;font-size:10px;line-height:1;';
  icon.textContent = '\u{1F4C1}';
  row.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = folderLabel(folder);
  row.appendChild(name);

  const rename = document.createElement('span');
  rename.className = 'act neutral';
  rename.textContent = '✎';
  rename.title = 'Rename';
  rename.onclick = async (e) => {
    e.stopPropagation();
    const next = prompt('Name for this folder:', folderLabel(folder));
    if (next === null) return; // cancelled
    await App.SaveFolder({ ...folder, name: next.trim() });
    renderFolderList();
  };
  row.appendChild(rename);

  const unpin = document.createElement('span');
  unpin.className = 'act';
  unpin.textContent = '✕';
  // No confirmation: this is a bookmark, the folder itself is untouched
  // and re-pinning it is one click away.
  unpin.title = 'Unpin (the folder itself is left alone)';
  unpin.onclick = async (e) => {
    e.stopPropagation();
    await App.DeleteFolder(folder.id);
    renderFolderList();
  };
  row.appendChild(unpin);

  row.onclick = () => { void openFolderInEditor(folder.path); };
  return row;
}

// Opens a folder in whichever editor has focus, else the last one used,
// else a new editor session: the same way opening a file picks where it
// lands.
async function openFolderInEditor(path: string) {
  await openFolder(editorPaneForOpening(), path);
}

async function pinFolder() {
  const path = await App.SelectFolder();
  if (!path) return; // cancelled
  const existing = (await App.ListFolders()).find((folder) => folder.path === path);
  if (!existing) await App.SaveFolder({ id: '', path });
  await renderFolderList();
  await openFolderInEditor(path);
}

function buildFolderButton(pane: EditorPane): HTMLDivElement {
  const button = document.createElement('div');
  button.className = 'doc-folder' + (pane.folder ? ' active' : '');
  const glyph = document.createElement('span');
  glyph.textContent = '\u{1F4C1}';
  const label = document.createElement('span');
  label.textContent = pane.folder ? baseName(pane.folder) : 'Open Folder';
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▾';
  button.append(glyph, label, caret);
  button.title = pane.folder ?? 'Open a folder in this editor';
  button.onclick = (e) => {
    e.stopPropagation();
    void openFolderMenu(pane, button);
  };
  return button;
}

async function openFolderMenu(pane: EditorPane, anchor: HTMLElement) {
  document.getElementById('folder-menu')?.remove();
  // Fetched before the menu is built rather than after, so pinned
  // folders don't pop in underneath a menu that's already on screen.
  let pinned: Folder[] = [];
  try {
    pinned = await App.ListFolders();
  } catch {
    // The menu's own actions work with or without the pinned list.
  }

  const menu = document.createElement('div');
  menu.id = 'folder-menu';
  menu.className = 'popup-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.left = `${rect.left}px`;

  popupMenuItem(menu, '\u{1F4C1}', 'Open Folder…', () => { void chooseFolder(pane); });
  if (pane.folder) {
    popupMenuItem(menu, '⟳', 'Refresh folder', () => { void refreshFolder(pane); });
    popupMenuItem(menu, '\u{1F4CC}', 'Pin this folder to the sidebar', () => { void pinCurrentFolder(pane); });
    popupMenuItem(menu, '✕', 'Close folder', () => closeFolder(pane));
  }

  const others = pinned.filter((folder) => folder.path !== pane.folder);
  if (others.length > 0) {
    const separator = document.createElement('div');
    separator.className = 'separator';
    menu.appendChild(separator);
    for (const folder of others) {
      popupMenuItem(menu, '\u{1F4C1}', folderLabel(folder), () => { void openFolder(pane, folder.path); });
    }
  }

  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

async function pinCurrentFolder(pane: EditorPane) {
  const folder = pane.folder;
  if (!folder) return;
  const existing = (await App.ListFolders()).find((entry) => entry.path === folder);
  if (!existing) await App.SaveFolder({ id: '', path: folder });
  await renderFolderList();
  flashStatus(`Pinned ${baseName(folder)}`);
}

// --- Quick pick (SPE-103) ---
// One filtered list widget behind Go to File, the command palette and
// the language picker. Three near-copies of the same list is how they
// end up behaving differently from each other.

type QuickPickItem = {
  label: string;
  detail?: string;
  hint?: string;
  run: () => void;
};

let quickPickItems: QuickPickItem[] = [];
let quickPickMatches: QuickPickItem[] = [];
let quickPickSelected = 0;
// Focus goes back where it came from when the list is dismissed rather
// than acted on.
let quickPickReturnPane: EditorPane | null = null;

// Subsequence match with a bonus for consecutive characters and for
// matches at a word boundary, so "mts" finds "main.ts" and typing the
// start of a name still beats an incidental match buried in the middle
// of a longer one. -1 means no match at all.
function fuzzyScore(text: string, query: string): number {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of query.toLowerCase()) {
    const at = haystack.indexOf(char, from);
    if (at < 0) return -1;
    if (at === previous + 1) score += 5;
    if (at === 0 || /[^a-z0-9]/.test(haystack[at - 1])) score += 3;
    score += 1;
    previous = at;
    from = at + 1;
  }
  return score;
}

function quickPickIsOpen(): boolean {
  return document.getElementById('quickpick-overlay')!.classList.contains('open');
}

function openQuickPick(placeholder: string, items: QuickPickItem[]) {
  quickPickItems = items;
  quickPickSelected = 0;
  quickPickReturnPane = focusedEditorPane();
  const input = document.getElementById('quickpick-input') as HTMLInputElement;
  input.value = '';
  input.placeholder = placeholder;
  document.getElementById('quickpick-overlay')!.classList.add('open');
  renderQuickPick();
  input.focus();
}

function closeQuickPick(restoreFocus: boolean) {
  document.getElementById('quickpick-overlay')!.classList.remove('open');
  quickPickItems = [];
  quickPickMatches = [];
  const pane = quickPickReturnPane;
  quickPickReturnPane = null;
  if (restoreFocus && pane && editorPanes.has(pane.session.id)) pane.editor.focus();
}

function renderQuickPick() {
  const query = (document.getElementById('quickpick-input') as HTMLInputElement).value.trim();
  quickPickMatches = query
    ? quickPickItems
      .map((item) => ({ item, score: Math.max(fuzzyScore(item.label, query), fuzzyScore(item.detail ?? '', query) - 2) }))
      .filter((scored) => scored.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((scored) => scored.item)
    : quickPickItems.slice();
  if (quickPickSelected >= quickPickMatches.length) quickPickSelected = Math.max(0, quickPickMatches.length - 1);

  const list = document.getElementById('quickpick-list')!;
  list.innerHTML = '';
  if (quickPickMatches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'qp-empty';
    empty.textContent = 'No matches';
    list.appendChild(empty);
    return;
  }
  quickPickMatches.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'qp-row' + (index === quickPickSelected ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'qp-label';
    label.textContent = item.label;
    row.appendChild(label);
    if (item.detail) {
      const detail = document.createElement('span');
      detail.className = 'qp-detail';
      detail.textContent = item.detail;
      row.appendChild(detail);
    }
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'qp-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    // mousedown, not click: the input would lose focus first and the
    // overlay's own dismiss handler would race the selection.
    row.onmousedown = (e) => {
      e.preventDefault();
      runQuickPick(index);
    };
    list.appendChild(row);
  });
  list.querySelector('.qp-row.selected')?.scrollIntoView({ block: 'nearest' });
}

function runQuickPick(index: number) {
  const item = quickPickMatches[index];
  closeQuickPick(false);
  item?.run();
}

(() => {
  const input = document.getElementById('quickpick-input') as HTMLInputElement;
  input.addEventListener('input', () => {
    quickPickSelected = 0;
    renderQuickPick();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeQuickPick(true);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runQuickPick(quickPickSelected);
      return;
    }
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || quickPickMatches.length === 0) return;
    e.preventDefault();
    quickPickSelected = (quickPickSelected + step + quickPickMatches.length) % quickPickMatches.length;
    renderQuickPick();
  });
  const overlay = document.getElementById('quickpick-overlay')!;
  overlay.addEventListener('mousedown', (e) => {
    if (e.target !== overlay) return;
    closeQuickPick(true);
  });
})();

// --- Editor commands (SPE-103) ---

function runEditorAction(pane: EditorPane, id: string) {
  pane.editor.focus();
  void pane.editor.getAction(id)?.run();
}

function toggleWordWrap() {
  editorPrefs.wordWrap = !editorPrefs.wordWrap;
  saveEditorPrefs();
  updateAllEditors({ wordWrap: editorPrefs.wordWrap ? 'on' : 'off' });
  for (const pane of editorPanes.values()) renderEditorStatusBar(pane);
}

function toggleMinimap() {
  editorPrefs.minimap = !editorPrefs.minimap;
  saveEditorPrefs();
  updateAllEditors({ minimap: { enabled: editorPrefs.minimap } });
}

function toggleWhitespace() {
  editorPrefs.whitespace = !editorPrefs.whitespace;
  saveEditorPrefs();
  updateAllEditors({ renderWhitespace: editorPrefs.whitespace ? 'all' : 'selection' });
}

function chooseIndentation(pane: EditorPane) {
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  if (!doc) return;
  const items: QuickPickItem[] = [];
  for (const insertSpaces of [true, false]) {
    for (const size of [2, 4, 8]) {
      items.push({
        label: insertSpaces ? `Spaces: ${size}` : `Tab width: ${size}`,
        run: () => {
          doc.model.updateOptions({ insertSpaces, tabSize: size });
          editorPrefs.insertSpaces = insertSpaces;
          editorPrefs.tabSize = size;
          saveEditorPrefs();
          renderEditorStatusBar(pane);
        },
      });
    }
  }
  items.push(
    { label: 'Convert existing indentation to spaces', run: () => runEditorAction(pane, 'editor.action.indentationToSpaces') },
    { label: 'Convert existing indentation to tabs', run: () => runEditorAction(pane, 'editor.action.indentationToTabs') },
    { label: 'Detect indentation from the file', run: () => runEditorAction(pane, 'editor.action.detectIndentation') },
  );
  openQuickPick('Indentation', items);
}

function chooseLineEndings(pane: EditorPane) {
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  if (!doc) return;
  openQuickPick('Line endings', [
    {
      label: 'LF',
      detail: 'Unix, and what a Linux host expects',
      run: () => {
        doc.model.pushEOL(monaco.editor.EndOfLineSequence.LF);
        renderEditorStatusBar(pane);
      },
    },
    {
      label: 'CRLF',
      detail: 'Windows',
      run: () => {
        doc.model.pushEOL(monaco.editor.EndOfLineSequence.CRLF);
        renderEditorStatusBar(pane);
      },
    },
  ]);
}

function chooseLanguage(pane: EditorPane) {
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  if (!doc) return;
  const items = monaco.languages.getLanguages()
    .map((lang) => ({
      label: lang.aliases?.[0] || lang.id,
      detail: (lang.extensions ?? []).slice(0, 4).join(' '),
      run: () => {
        monaco.editor.setModelLanguage(doc.model, lang.id);
        renderEditorStatusBar(pane);
      },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  openQuickPick('Select a language', items);
}

function openGoToFile(pane: EditorPane) {
  const items: QuickPickItem[] = [];
  for (const docId of pane.docIds) {
    const doc = editorDocs.get(docId);
    if (!doc) continue;
    items.push({
      label: doc.title,
      detail: doc.path ? dirName(doc.path) : 'not saved yet',
      hint: doc.dirty ? 'unsaved' : 'open',
      run: () => setActiveDoc(pane, doc.id),
    });
  }
  const openPaths = new Set(Array.from(editorDocs.values(), (doc) => doc.path));
  // Everything the workspace tree has listed so far, so Go to File
  // reaches the folder you opened and not only what you've had open.
  const offered = new Set<string>();
  for (const entries of pane.treeCache.values()) {
    for (const entry of entries) {
      if (entry.isDir || openPaths.has(entry.path) || offered.has(entry.path)) continue;
      offered.add(entry.path);
      items.push({
        label: entry.name,
        detail: dirName(entry.path),
        hint: 'folder',
        run: () => { void openLocalFile(entry.path, pane); },
      });
    }
  }
  for (const path of loadRecentFiles()) {
    if (openPaths.has(path) || offered.has(path)) continue;
    items.push({
      label: baseName(path),
      detail: dirName(path),
      hint: 'recent',
      run: () => { void openLocalFile(path, pane); },
    });
  }
  items.push({ label: 'Open File…', hint: 'Ctrl+O', run: () => { void openLocalFile(undefined, pane); } });
  openQuickPick('Go to file', items);
}

function openCommandPalette(pane: EditorPane) {
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  const items: QuickPickItem[] = [
    { label: 'New File', hint: 'Ctrl+N', run: () => { newUntitledDoc(pane); } },
    { label: 'Open File…', hint: 'Ctrl+O', run: () => { void openLocalFile(undefined, pane); } },
    { label: 'Go to File…', hint: 'Ctrl+P', run: () => openGoToFile(pane) },
    { label: 'Open Folder…', detail: pane.folder ?? 'no folder open in this pane', run: () => { void chooseFolder(pane); } },
  ];
  if (pane.folder) {
    items.push(
      { label: 'Refresh Folder', detail: pane.folder, run: () => { void refreshFolder(pane); } },
      { label: 'Close Folder', detail: pane.folder, run: () => closeFolder(pane) },
    );
  }
  if (doc) {
    items.push(
      { label: 'Save', hint: 'Ctrl+S', run: () => { void saveDoc(doc); } },
      { label: 'Save As…', hint: 'Ctrl+Shift+S', run: () => { void saveDocAs(doc); } },
      { label: 'Save to Remote Host…', detail: 'write this buffer over SFTP', run: () => { void saveDocToRemote(doc); } },
      { label: 'Reload From Disk', detail: doc.path ?? 'nothing to reload from', run: () => { void reloadDoc(doc); } },
      { label: 'Close File', hint: 'Ctrl+W', run: () => { void closeDoc(doc); } },
      { label: 'Copy File Path', run: () => { if (doc.path) void navigator.clipboard.writeText(doc.path); } },
      { label: 'Find', hint: 'Ctrl+F', run: () => runEditorAction(pane, 'actions.find') },
      { label: 'Replace', hint: 'Ctrl+H', run: () => runEditorAction(pane, 'editor.action.startFindReplaceAction') },
      { label: 'Go to Line…', hint: 'Ctrl+G', run: () => runEditorAction(pane, 'editor.action.gotoLine') },
      { label: 'Go to Symbol…', run: () => runEditorAction(pane, 'editor.action.quickOutline') },
      { label: 'Format Document', hint: 'Shift+Alt+F', run: () => runEditorAction(pane, 'editor.action.formatDocument') },
      { label: 'Toggle Line Comment', hint: 'Ctrl+/', run: () => runEditorAction(pane, 'editor.action.commentLine') },
      { label: 'Trim Trailing Whitespace', run: () => trimTrailingWhitespace(pane, doc) },
      { label: 'Sort Lines Ascending', run: () => runEditorAction(pane, 'editor.action.sortLinesAscending') },
      { label: 'Sort Lines Descending', run: () => runEditorAction(pane, 'editor.action.sortLinesDescending') },
      { label: 'Transform to Uppercase', run: () => runEditorAction(pane, 'editor.action.transformToUppercase') },
      { label: 'Transform to Lowercase', run: () => runEditorAction(pane, 'editor.action.transformToLowercase') },
      { label: 'Fold All', run: () => runEditorAction(pane, 'editor.foldAll') },
      { label: 'Unfold All', run: () => runEditorAction(pane, 'editor.unfoldAll') },
      { label: 'Set Language…', detail: languageLabel(doc.model.getLanguageId()), run: () => chooseLanguage(pane) },
      { label: 'Set Indentation…', detail: indentLabel(doc), run: () => chooseIndentation(pane) },
      { label: 'Set Line Endings…', detail: doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF', run: () => chooseLineEndings(pane) },
    );
  }
  items.push(
    { label: `Word Wrap: ${editorPrefs.wordWrap ? 'on' : 'off'}`, hint: 'Alt+Z', run: toggleWordWrap },
    { label: `Minimap: ${editorPrefs.minimap ? 'on' : 'off'}`, run: toggleMinimap },
    { label: `Render Whitespace: ${editorPrefs.whitespace ? 'always' : 'in selection'}`, run: toggleWhitespace },
    { label: 'All Editor Commands…', detail: "Monaco's own palette, everything not listed here", hint: 'F1', run: () => runEditorAction(pane, 'editor.action.quickCommand') },
  );
  openQuickPick('Editor command', items);
}

// Monaco has no built-in action for this, and it's the one cleanup that
// actually matters when writing a config file straight onto a host.
function trimTrailingWhitespace(pane: EditorPane, doc: EditorDoc) {
  const model = doc.model;
  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
  for (let line = 1; line <= model.getLineCount(); line += 1) {
    const text = model.getLineContent(line);
    const trimmed = text.replace(/[ \t]+$/, '');
    if (trimmed.length === text.length) continue;
    edits.push({ range: new monaco.Range(line, trimmed.length + 1, line, text.length + 1), text: '' });
  }
  if (edits.length === 0) {
    flashStatus('No trailing whitespace');
    return;
  }
  model.pushEditOperations(null, edits, () => null);
  pane.editor.focus();
  flashStatus(`Trimmed ${edits.length} line${edits.length === 1 ? '' : 's'}`);
}

// Registered per editor instance rather than on the document, so they
// only fire while that editor genuinely has focus. The document-level
// fallback below covers the document strip and the empty state, where
// nothing in Monaco is focused.
let editorScopeSeq = 0;
function registerEditorKeybindings(pane: EditorPane) {
  // editor.addCommand reads as "bind this key on this editor", but it
  // registers on a keybinding service the whole page shares, and the
  // handler it stores closes over whichever pane bound it last. Two
  // editor panes open meant Ctrl+S saved the pane created second no
  // matter which one held the caret. Monaco's own answer is a context
  // key: createContextKey writes into this editor's scoped context
  // service, so the expression is only true while this editor has
  // focus, and the shared service resolves the key to the right pane.
  const scope = `xpecterEditorPane${editorScopeSeq += 1}`;
  pane.editor.createContextKey(scope, true);
  // Belt to that brace. The pane is resolved when the key is pressed
  // rather than when it is bound, so a registration that resolves to
  // the wrong pane, or outlives the pane it came from (addCommand
  // drops the disposable, so a closed pane's bindings stay registered),
  // still acts on the editor the caret is actually in.
  const bind = (keybinding: number, handler: (active: EditorPane) => void) => {
    pane.editor.addCommand(keybinding, () => handler(focusedEditorPane() ?? pane), scope);
  };
  const withDoc = (run: (doc: EditorDoc) => void) => (active: EditorPane) => {
    const doc = active.activeDocId ? editorDocs.get(active.activeDocId) : null;
    if (doc) run(doc);
  };
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, withDoc((doc) => { void saveDoc(doc); }));
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, withDoc((doc) => { void saveDocAs(doc); }));
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, withDoc((doc) => { void closeDoc(doc); }));
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, (active) => { newUntitledDoc(active); });
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, (active) => { void openLocalFile(undefined, active); });
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, (active) => openGoToFile(active));
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, (active) => openCommandPalette(active));
  bind(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, toggleWordWrap);
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageDown, (active) => cycleDoc(active, 1));
  bind(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageUp, (active) => cycleDoc(active, -1));
}

// Fallback for when an editor pane is focused but Monaco itself is not
// (the document strip, the empty state's buttons). Deliberately narrow:
// anything typed into a field elsewhere in the app, and anything at all
// while the quick pick is open, is none of the editor's business.
document.addEventListener('keydown', (e) => {
  const pane = focusedEditorPane();
  if (!pane || quickPickIsOpen() || pane.editor.hasTextFocus()) return;
  // The pane wrapper rather than pane.root: the pane header sits
  // outside the editor view, and Ctrl+S pressed with the header focused
  // is still aimed at this pane's buffer.
  const scope = pane.session.container ?? pane.root;
  const target = e.target as HTMLElement | null;
  if (target && target !== document.body && !scope.contains(target)) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const doc = pane.activeDocId ? editorDocs.get(pane.activeDocId) : null;
  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    if (key === 's' && doc) { e.preventDefault(); void saveDocAs(doc); }
    else if (key === 'p') { e.preventDefault(); openCommandPalette(pane); }
    return;
  }
  if (key === 's' && doc) { e.preventDefault(); void saveDoc(doc); }
  else if (key === 'n') { e.preventDefault(); newUntitledDoc(pane); }
  else if (key === 'o') { e.preventDefault(); void openLocalFile(undefined, pane); }
  else if (key === 'w' && doc) { e.preventDefault(); void closeDoc(doc); }
  else if (key === 'p') { e.preventDefault(); openGoToFile(pane); }
});

// Sessions menu and the New Session picker. From the split-pane picker
// this fills that pane, so an editor can sit beside a live shell;
// otherwise it becomes a whole editor tab.
function newEditorSession() {
  const target = pendingPaneTarget;
  if (!target) {
    newUntitledDoc(newEditorTabPane());
    return;
  }
  pendingPaneTarget = null;
  const tab = tabs.get(target.ownerTabId);
  if (!tab) return;
  createEditorForSession(target, tab);
  focusPane(tab, paneIndexOf(tab, target));
  switchToTab(tab.id);
  newUntitledDoc(editorPanes.get(target.id)!);
}

// Tools -> Text Editor: adds a file to the editor you already have
// rather than stacking up another one on every click.
function newFileInEditor() {
  newUntitledDoc(editorPaneForOpening());
}

// --- Splitting a tab into another terminal or an editor (SPE-104) ---
// Opening a second shell beside the one you're already in used to mean
// the whole New Session picker, or the View menu's layout commands
// followed by a picker inside the new pane. This is the one control
// that does the common cases directly, and it's also how an editor
// ends up next to a live terminal rather than in a tab of its own.

type SplitDirection = 'right' | 'below';

// Where a new terminal or editor should go: an empty pane the person
// already made if there is one (filling that beats growing the grid
// again beside it), otherwise one more cell.
async function claimSplitPane(tab: Tab, direction: SplitDirection): Promise<Pane | null> {
  const existing = tab.extraPanes.find((pane) => pane.mode === 'pending');
  if (existing) return existing;
  if (tab.layout === '4') {
    alert('This tab is already split four ways. Close a pane first, or use another tab.');
    return null;
  }
  await setTabLayout(tab, tab.layout === 'single' ? (direction === 'right' ? '2v' : '2h') : '4');
  return tab.extraPanes.find((pane) => pane.mode === 'pending') ?? null;
}

async function splitWithLocalShell(tab: Tab, direction: SplitDirection) {
  const pane = await claimSplitPane(tab, direction);
  if (!pane) return;
  // startLocalShellInActiveTab reads pendingPaneTarget synchronously
  // before its first await, so restoring it afterwards is safe.
  const previous = pendingPaneTarget;
  pendingPaneTarget = pane;
  try {
    await startLocalShellInActiveTab('', 'Local shell');
  } finally {
    pendingPaneTarget = previous;
  }
}

async function splitWithDuplicate(tab: Tab, direction: SplitDirection) {
  const source = focusedSession(tab);
  if (!source.duplicate) return;
  const pane = await claimSplitPane(tab, direction);
  if (!pane) return;
  await source.duplicate(pane);
}

async function splitWithEditor(tab: Tab, direction: SplitDirection) {
  const pane = await claimSplitPane(tab, direction);
  if (!pane) return;
  createEditorForSession(pane, tab);
  focusPane(tab, paneIndexOf(tab, pane));
  switchToTab(tab.id);
  newUntitledDoc(editorPanes.get(pane.id)!);
}

async function splitWithPicker(tab: Tab, direction: SplitDirection) {
  const pane = await claimSplitPane(tab, direction);
  if (!pane) return;
  openSplitPanePicker(pane);
}

function popupMenuItem(menu: HTMLElement, glyph: string, label: string, run: () => void) {
  const item = document.createElement('div');
  item.className = 'item';
  const icon = document.createElement('span');
  icon.className = 'glyph';
  icon.textContent = glyph;
  const text = document.createElement('span');
  text.textContent = label;
  item.append(icon, text);
  item.onclick = () => {
    menu.remove();
    run();
  };
  menu.appendChild(item);
}

function openSplitMenu(anchor: HTMLElement) {
  document.getElementById('split-menu')?.remove();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.isHome || tab.mode === 'pending') return;

  const menu = document.createElement('div');
  menu.id = 'split-menu';
  menu.className = 'popup-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;

  // A second connection to the same host is the single most common
  // reason to want another terminal, so it goes first when the focused
  // pane is something that can actually be dialled twice.
  const focused = focusedSession(tab);
  if (focused.duplicate) {
    popupMenuItem(menu, '⧉', 'Duplicate this session', () => { void splitWithDuplicate(tab, 'right'); });
  }
  popupMenuItem(menu, '❯', 'New local shell', () => { void splitWithLocalShell(tab, 'right'); });
  popupMenuItem(menu, '\u{1F310}', 'New session…', () => { void splitWithPicker(tab, 'right'); });
  popupMenuItem(menu, '\u{1F4DD}', 'Text editor', () => { void splitWithEditor(tab, 'right'); });

  const separator = document.createElement('div');
  separator.className = 'separator';
  menu.appendChild(separator);

  // The empty splits, for when you want the arrangement first and will
  // fill the pane from its own placeholder.
  popupMenuItem(menu, '▥', 'Split right (empty)', () => { void setTabLayout(tab, tab.layout === '2h' ? '4' : '2v'); });
  popupMenuItem(menu, '▤', 'Split below (empty)', () => { void setTabLayout(tab, tab.layout === '2v' ? '4' : '2h'); });

  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

(() => {
  const button = document.getElementById('tab-split-btn')!;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    openSplitMenu(button);
  });
})();

// --- File browser (scoped to whichever SSH tab is active) ---

let currentRemotePath = '.';
let currentRemoteSessionId: string | null = null;
// listingSignature of what the browser is currently showing, so the
// watcher below can tell a real change from an identical re-listing.
let remoteListingSignature = '';

// Computes the parent of a path built by ListDir's path.Join convention
// (plain relative strings, e.g. "logs", then "logs/subfolder", no
// leading "/" or "./"). Confirmed against the actual Go backend rather
// than assumed, this is exactly the kind of thing that's cheap to get
// wrong by guessing (see tonight's NSIS filename mismatch).
function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '.' : path.slice(0, idx);
}

async function refreshFileList(path = '.', sessionId?: string) {
  const id = sessionId ?? (activeTabId ? tabs.get(activeTabId)?.backendId : null);
  if (!id) return;
  currentRemotePath = path;
  currentRemoteSessionId = id;
  const entries: RemoteFile[] = await App.ListRemoteDir(id, path);
  // Clicking through folders faster than SFTP answers would otherwise
  // let an older listing land on top of the one just asked for.
  if (currentRemotePath !== path || currentRemoteSessionId !== id) return;
  remoteListingSignature = listingSignature(entries);
  renderFileList(entries, path, id);
}

// Split out of refreshFileList so the watcher below can draw a listing
// it has already fetched instead of asking the host for it twice.
function renderFileList(entries: RemoteFile[], path: string, id: string) {
  const list = document.getElementById('file-list')!;
  list.innerHTML = '';
  if (path !== '.') {
    const up = document.createElement('div');
    up.className = 'side-row';
    up.textContent = '\ud83d\udcc1 ..';
    up.style.opacity = '0.8';
    up.onclick = () => refreshFileList(parentPath(path), id);
    list.appendChild(up);
  }
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = 'side-row';
    // A label span rather than text set on the row itself: the row
    // carries action buttons now, and .side-row .name is what ellipsises
    // a long filename instead of shoving them off the edge.
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = (e.isDir ? '\ud83d\udcc1 ' : '\ud83d\udcc4 ') + e.name;
    div.appendChild(label);
    if (e.isDir) {
      div.onclick = () => refreshFileList(e.path, id);
      // The same two actions a folder row offers in the editor's tree,
      // so a subdirectory can be filled without navigating into it.
      div.appendChild(remoteAction('\uff0b', `New file in ${e.name}`, () => { void createInRemote(id, e.path, 'file'); }));
      div.appendChild(remoteAction('\u229e', `New folder in ${e.name}`, () => { void createInRemote(id, e.path, 'folder'); }));
    } else {
      div.title = 'Open in Xpecter; Shift-click to open with the system app';
      div.onauxclick = (event) => {
        if (event.button === 1) {
          void App.OpenRemoteFile(id, e.path).catch((err) => {
            flashStatus(`External open failed: ${err}`, true);
          });
        }
      };
      div.onclick = (event) => {
        if (event instanceof MouseEvent && event.shiftKey) {
          void App.OpenRemoteFile(id, e.path).catch((err) => {
            flashStatus(`External open failed: ${err}`, true);
          });
          return;
        }
        void openRemoteFile(id, e.path).catch((err) => {
          flashStatus(`Open failed: ${err}`, true);
        });
      };
    }
    div.appendChild(remoteAction('✎', `Rename ${e.name}`, () => { void renameRemote(id, e.path, e.name); }));
    list.appendChild(div);
  }
}

// SPE-105 parity: the remote browser gets the editor tree's three
// workspace actions. Everything else about remote files already routes
// through the same panes and the same save path; not being able to add
// a file to the host you are looking at was the last thing that made
// the browser feel read-only next to the local tree.

function remoteAction(glyph: string, title: string, run: () => void): HTMLSpanElement {
  const el = document.createElement('span');
  // 'neutral' keeps it off the danger colour that .side-row .act uses
  // for the delete affordances elsewhere in the sidebar.
  el.className = 'act neutral';
  el.textContent = glyph;
  el.title = title;
  // Stopped as well as run: the row underneath either navigates into a
  // folder or opens a file, and neither is what was clicked.
  el.onclick = (e) => { e.stopPropagation(); run(); };
  return el;
}

async function createInRemote(id: string, dir: string, kind: 'file' | 'folder') {
  const where = dir === '.' ? 'this directory' : baseName(dir);
  const name = prompt(`New ${kind} in ${where}:`);
  if (name === null) return; // cancelled
  let created: string;
  try {
    created = kind === 'file'
      ? await App.CreateRemoteFile(id, dir, name)
      : await App.CreateRemoteDir(id, dir, name);
  } catch (err) {
    // The backend's refusals arrive here alongside real SFTP errors: a
    // name already taken, a name that is really a path, a directory
    // that isn't writable. All of them say something worth reading.
    flashStatus(String(err), true);
    return;
  }
  flashStatus(`Created ${baseName(created)}`);
  await refreshFileList(currentRemotePath, id);
  // A new file opens, because creating one is how you start writing it.
  // Same as the local tree.
  if (kind === 'file') {
    await openRemoteFile(id, created).catch((err) => { flashStatus(`Open failed: ${err}`, true); });
  }
}

async function renameRemote(id: string, oldPath: string, currentName: string) {
  const next = prompt(`Rename ${currentName} to:`, currentName);
  if (next === null || next === currentName) return; // cancelled, or unchanged
  let renamed: string;
  try {
    renamed = await App.RenameRemoteEntry(id, oldPath, next);
  } catch (err) {
    flashStatus(String(err), true);
    return;
  }
  // A buffer opened from the old path would otherwise still be pointing
  // at it, and saving would recreate the name that was just renamed
  // away. Retarget it instead, which is what Save As already does.
  const doc = findOpenDoc(oldPath, false, id);
  if (doc) {
    retargetDoc(doc, { path: renamed, isLocal: false, remoteSessionId: id });
    flashStatus(`Renamed to ${baseName(renamed)}; the open buffer now points at it`);
  } else {
    flashStatus(`Renamed to ${baseName(renamed)}`);
  }
  await refreshFileList(currentRemotePath, id);
}

// The remote browser gets the same treatment as the workspace tree, on a
// slower clock: every ListRemoteDir opens a fresh SFTP subsystem on the
// connection, so this one is paid for over the wire.
const REMOTE_WATCH_INTERVAL_MS = 6000;

let remoteWatchRunning = false;

async function watchRemoteFileList() {
  if (remoteWatchRunning || document.hidden) return;
  const id = currentRemoteSessionId;
  if (!id) return;
  const list = document.getElementById('file-list')!;
  // Covers both a collapsed Remote files section and a hidden sidebar
  // without either one having to tell the watcher about it.
  if (!list.offsetParent) return;
  // The sidebar only ever shows the focused tab's host. Polling a
  // directory nobody is looking at spends a round trip for nothing.
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || focusedSession(tab)?.backendId !== id) return;

  const path = currentRemotePath;
  remoteWatchRunning = true;
  try {
    const entries = await App.ListRemoteDir(id, path);
    if (currentRemotePath !== path || currentRemoteSessionId !== id) return;
    const signature = listingSignature(entries);
    if (signature === remoteListingSignature) return;
    remoteListingSignature = signature;
    // #sidebar is the scroll container here, not #file-list, so this is
    // where a redraw would otherwise cost you your place.
    const sidebar = document.getElementById('sidebar');
    const scrollTop = sidebar?.scrollTop ?? 0;
    renderFileList(entries, path, id);
    if (sidebar) sidebar.scrollTop = scrollTop;
  } catch {
    // A connection that has dropped already reports itself through the
    // session's own close handling. The browser just stops updating
    // rather than throwing an error into the sidebar every six seconds.
  } finally {
    remoteWatchRunning = false;
  }
}

setInterval(() => { void watchRemoteFileList(); }, REMOTE_WATCH_INTERVAL_MS);
window.addEventListener('focus', () => { void watchRemoteFileList(); });

async function uploadFilesToCurrentDir(files: FileList) {
  if (!currentRemoteSessionId) return;
  const list = document.getElementById('file-list')!;
  const status = document.createElement('div');
  status.className = 'side-empty';
  status.style.opacity = '0.7';
  status.style.fontStyle = 'italic';
  list.appendChild(status);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = `Uploading ${file.name}...`;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
    const base64 = btoa(binary);
    const remotePath = currentRemotePath === '.' ? file.name : `${currentRemotePath}/${file.name}`;
    try {
      await App.UploadRemoteFile(currentRemoteSessionId, remotePath, base64, file.lastModified);
    } catch (err) {
      console.error('Upload failed for', file.name, err);
    }
  }

  refreshFileList(currentRemotePath, currentRemoteSessionId);
}

(() => {
  const fileList = document.getElementById('file-list')!;
  fileList.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    fileList.style.background = 'var(--hover)';
  });
  fileList.addEventListener('dragleave', () => {
    fileList.style.background = '';
  });
  fileList.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    fileList.style.background = '';
    uploadFilesToCurrentDir(e.dataTransfer.files);
  });
})();

// --- Saved sessions ---

function setAuthMode(mode: 'password' | 'key') {
  const radio = document.querySelector(`input[name="authmode"][value="${mode}"]`) as HTMLInputElement;
  radio.checked = true;
  const isKey = mode === 'key';
  document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
  document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
}

function setDeviceKind(kind: 'host' | 'switch' | 'firewall') {
  (document.getElementById('device-kind-select') as HTMLSelectElement).value = kind;
}

function currentDeviceKind(): 'host' | 'switch' | 'firewall' {
  const value = (document.getElementById('device-kind-select') as HTMLSelectElement).value;
  if (value === 'switch') return 'switch';
  if (value === 'firewall') return 'firewall';
  return 'host';
}

let skipSavePrompt = false;
let skipSerialSavePrompt = false;
let pendingSessionName: string | null = null;

// SPE-99: the picker has no port field and every ad-hoc connect through
// it has always been hardcoded to 22. Home's quick connect accepts
// host:port, so it parks the non-default port here for the picker's
// Connect handler to pick up. Cleared by resetPickerView, which runs on
// every picker open and close, so it can't leak into a later connect
// the same way pendingPaneTarget once could.
let pendingQuickPort: number | null = null;

// In-memory only, never persisted to disk, cleared on app restart.

// Distinct from the deliberate "never save passwords to disk" design

// principle in backend/config/sessions.go, this just avoids re-prompting

// within a single running session.

const passwordCache = new Map<string, string>();

function passwordCacheKey(host: string, port: number, user: string): string {

  return `${user}@${host}:${port}`;

}

// SPE-92: clicking a saved session in the sidebar targets the
// currently focused pane if the active tab is split AND that pane is
// genuinely empty (nothing live to silently replace); otherwise
// behaves exactly as before, connecting into a plain new/pending tab.
function targetEmptyFocusedPane(): Pane | null {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab || tab.layout === 'single') return null;
  const focused = focusedSession(tab);
  if (focused === tab) return null; // pane 0 is the tab itself, not a split pane
  if (focused.mode !== 'pending') return null; // already live, don't silently replace it
  return focused as Pane;
}

// SPE-100: stamps the profile onto whichever Session is about to take
// the connection, the split pane if one was targeted, otherwise the
// active tab's own primary session. Called before connecting so the
// sidebar's live dot is correct from the first render onward.
function markSessionProfile(paneTarget: Pane | null, profileId: string) {
  const target = paneTarget ?? (activeTabId ? tabs.get(activeTabId) : null);
  if (target) target.sessionProfileId = profileId;
}

// Every live (connected, not stopped) Session launched from a saved
// profile, keyed by that profile's id. Rebuilt per render rather than
// cached, same 'just re-render on every call' pattern the tab bar uses.
function liveSessionsByProfile(): Map<string, Session> {
  const live = new Map<string, Session>();
  for (const tab of tabs.values()) {
    for (const session of allSessions(tab)) {
      if (!session.sessionProfileId) continue;
      if (session.status !== 'connected' || session.stopped) continue;
      if (!live.has(session.sessionProfileId)) live.set(session.sessionProfileId, session);
    }
  }
  return live;
}

async function useSession(s: SessionProfile) {
  if (s.type === 'serial') {
    await useSerialSession(s);
    return;
  }
  await useSSHSession(s);
}

async function useSSHSession(s: SessionProfile) {

  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });

  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
  } else {
    pendingPaneTarget = null;
    ensurePendingTab();
  }
  markSessionProfile(paneTarget, s.id);

  (document.getElementById('host') as HTMLInputElement).value = s.host ?? '';

  (document.getElementById('user') as HTMLInputElement).value = s.user ?? '';

  setDeviceKind(s.deviceKind === 'switch' ? 'switch' : s.deviceKind === 'firewall' ? 'firewall' : 'host');



  skipSavePrompt = true;



  if (s.keyPath || s.useAgent || s.internalAgent) {

    setAuthMode('key');

    (document.getElementById('keyPath') as HTMLInputElement).value = s.keyPath ?? '';
    (document.getElementById('use-ssh-agent') as HTMLInputElement).checked = !!s.useAgent;
    (document.getElementById('use-internal-agent') as HTMLInputElement).checked = !!s.internalAgent;
    (document.getElementById('x11-toggle') as HTMLInputElement).checked = !!s.x11;

    (document.getElementById('passphrase') as HTMLInputElement).value = '';

    await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', keyPath: s.keyPath, useAgent: s.useAgent, internalAgent: s.internalAgent, x11: s.x11 });

    const connected = paneTarget ?? tabs.get(activeTabId!);

    if (connected) {

      connected.label = s.name;

      renderTabBar();

    }

  } else {

    setAuthMode('password');

    (document.getElementById('use-ssh-agent') as HTMLInputElement).checked = false;
    (document.getElementById('use-internal-agent') as HTMLInputElement).checked = false;

    const cacheKey = passwordCacheKey(s.host ?? '', s.port ?? 22, s.user ?? '');

    const cachedPassword = passwordCache.get(cacheKey);

    if (cachedPassword) {

      await connectActiveTab({ host: s.host ?? '', port: s.port ?? 22, user: s.user ?? '', password: cachedPassword });

      const connected = paneTarget ?? tabs.get(activeTabId!);

      if (connected) {

        connected.label = s.name;

        renderTabBar();

      }

    } else {

      pendingSessionName = s.name;

      openSessionPicker();

      // openSessionPicker() above always resets pendingPaneTarget to
      // null (it's the entry point for the ordinary New Session flow),
      // reassert the pane target here since this call is really the
      // "connect a saved session" flow reusing the picker's password
      // field, not a fresh New Session.
      pendingPaneTarget = paneTarget;

      document.getElementById('picker-grid')!.style.display = 'none';

      document.getElementById('picker-ssh-fields')!.style.display = 'flex';

      const pwField = document.getElementById('password') as HTMLInputElement;

      pwField.value = '';

      pwField.focus();

    }

  }

}

async function useSerialSession(s: SessionProfile) {
  await App.SaveSession({ ...s, lastUsed: new Date().toISOString() });
  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
  } else {
    pendingPaneTarget = null;
    ensurePendingTab();
  }
  markSessionProfile(paneTarget, s.id);
  skipSerialSavePrompt = true;
  await connectSerialInActiveTab(s.serialPort ?? '', s.baud ?? 9600);
}

// SPE-100: whole row is the click target. The old row bound click to
// its label <span> only, so most of the row was dead space, and it kept
// a delete X visible at half opacity on every row forever. Actions now
// appear on hover; delete still confirms via the context menu too.
function renderSessionRow(s: SessionProfile, depth: number, live: Map<string, Session>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'side-row';
  row.style.paddingLeft = `${6 + depth * 11}px`;
  row.draggable = true;
  row.dataset.sessionId = s.id;
  row.tabIndex = -1;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/xpecter-session-id', s.id);
  });

  const running = live.get(s.id) ?? null;
  if (s.pinned) {
    const star = document.createElement('span');
    star.textContent = '★';
    star.style.cssText = 'flex:0 0 auto;font-size:8px;color:var(--text-dim);opacity:0.7;';
    star.title = 'Pinned';
    row.appendChild(star);
  }
  const dot = document.createElement('span');
  dot.className = 'side-dot' + (running ? ' live' : '');
  row.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = s.name;
  row.appendChild(name);

  // The address is the sidebar's biggest source of clutter and its
  // least used column: you pick a session by the name you gave it, and
  // the tooltip below still carries the address for when you don't. The
  // one time it earns the space is while filtering, where the query may
  // have matched on the host and nothing else on the row would say so.
  if (sessionSearchQuery.trim()) {
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = sidebarSessionHost(s);
    row.appendChild(host);
  }

  row.title = running
    ? `${s.name} — ${sidebarSessionHost(s)} (running, click to switch to its tab)`
    : `${s.name} — ${sidebarSessionHost(s)}`;

  const del = document.createElement('span');
  del.className = 'act';
  del.textContent = '✕';
  del.title = 'Delete session';
  del.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete saved session "${s.name}"?`)) return;
    await App.DeleteSession(s.id);
    renderSessionList();
  };
  row.appendChild(del);

  row.onclick = () => activateSessionRow(s);
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showSessionContextMenu(e.clientX, e.clientY, s);
  });

  return row;
}

function sidebarSessionHost(s: SessionProfile): string {
  if (s.type === 'serial') return s.serialPort ? `${s.serialPort}@${s.baud ?? 9600}` : 'serial';
  if (!s.host) return '';
  const port = s.port && s.port !== 22 ? `:${s.port}` : '';
  return (s.user ? `${s.user}@` : '') + s.host + port;
}

// The habit this is built around: with a dozen tabs open you click a
// saved session to GET to it, not to open a second copy of it. So a
// session that's already running switches to its tab, and opening an
// additional connection to the same host stays available on the context
// menu. Deliberately different from the old behaviour, which always
// dialled a fresh connection.
// SPE-128: a session that is mid-connect isn't in liveSessionsByProfile
// yet, that map means "connected right now" and drives the sidebar's
// live dot. Clicking the row again during those seconds must still go
// to the tab already dialling it, not start a rival connection.
function connectingSessionForProfile(profileId: string): Session | null {
  for (const tab of tabs.values()) {
    for (const session of allSessions(tab)) {
      if (session.connecting && session.sessionProfileId === profileId) return session;
    }
  }
  return null;
}

function activateSessionRow(s: SessionProfile) {
  const running = liveSessionsByProfile().get(s.id) ?? connectingSessionForProfile(s.id);
  if (running) {
    switchToTab(running.ownerTabId);
    const owner = tabs.get(running.ownerTabId);
    if (owner) {
      const index = paneIndexOf(owner, running);
      if (index >= 0) owner.focusedPaneIndex = index;
      renderTabBar();
      running.term?.focus();
    }
    return;
  }
  useSession(s);
}
function attachMenuAutoClose(menu: HTMLElement) {
  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// SPE-62: single "Edit session" entry replaces the old Rename prompt()
// and Device-type flyout, both folded into the real edit dialog now.
function showSessionContextMenu(x: number, y: number, s: SessionProfile) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:120px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  // SPE-100: clicking the row itself switches to a running session
  // rather than dialling a second one, so the 'I really do want another
  // connection to this host' case lives here.
  const pinItem = document.createElement('div');
  pinItem.textContent = s.pinned ? 'Unpin' : 'Pin to top';
  pinItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  pinItem.onmouseenter = () => { pinItem.style.background = 'var(--hover)'; };
  pinItem.onmouseleave = () => { pinItem.style.background = ''; };
  pinItem.onclick = async () => {
    menu.remove();
    await App.SaveSession({ ...s, pinned: !s.pinned });
    renderSessionList();
  };

  const openItem = document.createElement('div');
  openItem.textContent = 'Open another session';
  openItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  openItem.onmouseenter = () => { openItem.style.background = 'var(--hover)'; };
  openItem.onmouseleave = () => { openItem.style.background = ''; };
  openItem.onclick = () => {
    menu.remove();
    useSession(s);
  };

  const editItem = document.createElement('div');
  editItem.textContent = 'Edit session';
  editItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  editItem.onmouseenter = () => { editItem.style.background = 'var(--hover)'; };
  editItem.onmouseleave = () => { editItem.style.background = ''; };
  editItem.onclick = () => {
    menu.remove();
    openSessionEditor(s);
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    await App.DeleteSession(s.id);
    renderSessionList();
  };

  menu.appendChild(pinItem);
  menu.appendChild(openItem);
  menu.appendChild(editItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);
  attachMenuAutoClose(menu);
}

// --- Edit session dialog (SPE-62) ---

let sessionEditorTarget: SessionProfile | null = null;

function switchSessionEditorTab(tab: 'basic' | 'advanced') {
  document.querySelectorAll('#session-editor .editor-tab').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
  });
  document.getElementById('session-editor-tab-basic')!.style.display = tab === 'basic' ? 'flex' : 'none';
  document.getElementById('session-editor-tab-advanced')!.style.display = tab === 'advanced' ? 'flex' : 'none';
}

document.querySelectorAll('#session-editor .editor-tab').forEach((el) => {
  el.addEventListener('click', () => switchSessionEditorTab((el as HTMLElement).dataset.tab as 'basic' | 'advanced'));
});

async function openSessionEditor(s: SessionProfile) {
  sessionEditorTarget = s;
  const isSerial = s.type === 'serial';

  switchSessionEditorTab('basic');

  (document.getElementById('se-name') as HTMLInputElement).value = s.name;

  document.getElementById('se-ssh-basic-fields')!.style.display = isSerial ? 'none' : 'flex';
  document.getElementById('se-serial-basic-fields')!.style.display = isSerial ? 'flex' : 'none';
  // Device kind / key path only apply to SSH sessions, serial always
  // shows its own icon (matches the pre-SPE-62 context menu behavior).
  document.getElementById('se-ssh-advanced-fields')!.style.display = isSerial ? 'none' : 'flex';

  if (isSerial) {
    (document.getElementById('se-serial-port') as HTMLInputElement).value = s.serialPort ?? '';
    (document.getElementById('se-baud') as HTMLSelectElement).value = String(s.baud ?? 9600);
  } else {
    (document.getElementById('se-host') as HTMLInputElement).value = s.host ?? '';
    (document.getElementById('se-port') as HTMLInputElement).value = String(s.port ?? 22);
    (document.getElementById('se-user') as HTMLInputElement).value = s.user ?? '';
    (document.getElementById('se-keypath') as HTMLInputElement).value = s.keyPath ?? '';
    (document.getElementById('se-use-ssh-agent') as HTMLInputElement).checked = !!s.useAgent;
    (document.getElementById('se-use-internal-agent') as HTMLInputElement).checked = !!s.internalAgent;

    const deviceKindSelect = document.getElementById('se-devicekind-select') as HTMLSelectElement;
    const current = s.deviceKind === 'switch' || s.deviceKind === 'firewall' ? s.deviceKind : 'host';
    deviceKindSelect.value = current;
  }

  const groupSelect = document.getElementById('se-group') as HTMLSelectElement;
  groupSelect.innerHTML = '<option value="">No folder</option>';
  const groups = await App.ListGroups();
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    groupSelect.appendChild(opt);
  }
  groupSelect.value = s.groupId ?? '';
  (document.getElementById('se-tags') as HTMLInputElement).value = (s.tags ?? []).join(', ');

  document.getElementById('session-editor-overlay')!.classList.add('open');
}

function closeSessionEditor() {
  document.getElementById('session-editor-overlay')!.classList.remove('open');
  sessionEditorTarget = null;
}

document.getElementById('session-editor-close')!.addEventListener('click', closeSessionEditor);
document.getElementById('se-cancel')!.addEventListener('click', closeSessionEditor);
document.getElementById('session-editor-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('session-editor-overlay')) closeSessionEditor();
});

document.getElementById('se-browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) (document.getElementById('se-keypath') as HTMLInputElement).value = path;
});
document.getElementById('se-clear-key')!.addEventListener('click', () => {
  (document.getElementById('se-keypath') as HTMLInputElement).value = '';
});

document.getElementById('se-save')!.addEventListener('click', async () => {
  const s = sessionEditorTarget;
  if (!s) return;
  const name = (document.getElementById('se-name') as HTMLInputElement).value.trim();
  if (!name) return;

  const groupId = (document.getElementById('se-group') as HTMLSelectElement).value;
  const tags = (document.getElementById('se-tags') as HTMLInputElement).value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index);
  const updated: SessionProfile = { ...s, name, groupId: groupId || undefined, tags: tags.length > 0 ? tags : undefined };

  if (s.type === 'serial') {
    updated.serialPort = (document.getElementById('se-serial-port') as HTMLInputElement).value.trim();
    updated.baud = parseInt((document.getElementById('se-baud') as HTMLSelectElement).value, 10);
  } else {
    updated.host = (document.getElementById('se-host') as HTMLInputElement).value.trim();
    updated.port = parseInt((document.getElementById('se-port') as HTMLInputElement).value, 10) || 22;
    updated.user = (document.getElementById('se-user') as HTMLInputElement).value.trim();
    const keyPath = (document.getElementById('se-keypath') as HTMLInputElement).value.trim();
    updated.keyPath = keyPath || undefined;
    updated.useAgent = (document.getElementById('se-use-ssh-agent') as HTMLInputElement).checked;
    updated.internalAgent = (document.getElementById('se-use-internal-agent') as HTMLInputElement).checked;
    updated.deviceKind = (document.getElementById('se-devicekind-select') as HTMLSelectElement).value as 'host' | 'switch' | 'firewall';
  }

  await App.SaveSession(updated);
  closeSessionEditor();
  renderSessionList();
});

function renderGroupNode(
  group: SessionGroup,
  groups: SessionGroup[],
  sessions: SessionProfile[],
  container: HTMLElement,
  depth: number,
  live: Map<string, Session>,
) {
  const isCollapsed = collapsedGroups.has(group.id);
  const childGroups = groups.filter((g) => g.parentId === group.id);
  const childSessions = sessions.filter((s) => s.groupId === group.id);

  const header = document.createElement('div');
  header.className = 'side-group';
  header.style.paddingLeft = `${6 + depth * 11}px`;

  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.textContent = isCollapsed ? '▸' : '▾';
  const icon = document.createElement('span');
  icon.textContent = '📁';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = group.name;
  const count = document.createElement('span');
  count.className = 'count';
  const liveHere = childSessions.filter((cs) => live.has(cs.id)).length;
  count.textContent = liveHere > 0 ? `${liveHere}/${childSessions.length}` : String(childSessions.length);
  count.title = liveHere > 0 ? `${liveHere} running of ${childSessions.length}` : `${childSessions.length} session(s)`;

  header.appendChild(chev);
  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(count);

  header.addEventListener('click', () => {
    if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id);
    else collapsedGroups.add(group.id);
    saveCollapsedGroups();
    renderSessionList();
  });
  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    header.classList.add('drop-target');
  });
  header.addEventListener('dragleave', () => {
    header.classList.remove('drop-target');
  });
  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    header.classList.remove('drop-target');
    const sessionId = e.dataTransfer?.getData('text/xpecter-session-id');
    if (!sessionId) return;
    const all = await App.ListSessions();
    const moved = all.find((x) => x.id === sessionId);
    if (!moved) return;
    await App.SaveSession({ ...moved, groupId: group.id });
    // Drop used to collapse the folder you just dropped into, hiding the
    // thing you were manipulating. Expand instead, so the move is visible.
    collapsedGroups.delete(group.id);
    saveCollapsedGroups();
    renderSessionList();
  });
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showGroupContextMenu(e.clientX, e.clientY, group);
  });
  container.appendChild(header);

  if (isCollapsed) return;
  for (const cg of childGroups) {
    renderGroupNode(cg, groups, sessions, container, depth + 1, live);
  }
  for (const cs of childSessions) {
    container.appendChild(renderSessionRow(cs, depth + 1, live));
  }
}
function showGroupContextMenu(x: number, y: number, group: SessionGroup) {
  const existing = document.getElementById('session-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'session-context-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-alt);border:1px solid var(--border);border-radius:4px;padding:4px 0;z-index:2000;min-width:140px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;

  const renameItem = document.createElement('div');
  renameItem.textContent = 'Rename folder';
  renameItem.style.cssText = 'padding:6px 12px;cursor:pointer;';
  renameItem.onmouseenter = () => { renameItem.style.background = 'var(--hover)'; };
  renameItem.onmouseleave = () => { renameItem.style.background = ''; };
  renameItem.onclick = async () => {
    menu.remove();
    const newName = prompt('Rename folder:', group.name);
    if (!newName || newName === group.name) return;
    await App.SaveGroup({ ...group, name: newName });
    renderSessionList();
  };

  const deleteItem = document.createElement('div');
  deleteItem.textContent = 'Delete folder';
  deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;color:var(--danger);';
  deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--hover)'; };
  deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
  deleteItem.onclick = async () => {
    menu.remove();
    if (!confirm(`Delete folder "${group.name}"? Sessions inside will be moved out, not deleted.`)) return;
    await App.DeleteGroup(group.id);
    renderSessionList();
  };

  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  document.body.appendChild(menu);

  const closeMenu = (ev: MouseEvent) => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

let sessionSearchQuery = '';
// SPE-100: folders now default to EXPANDED and remember what you
// collapsed. They used to be force-collapsed on every launch, which
// meant the panel opened showing folder names and nothing else.
const collapsedGroups = new Set<string>(loadCollapsedGroups());
let runningCollapsed = localStorage.getItem('xpecter-running-collapsed') === 'on';
let pinnedCollapsed = localStorage.getItem('xpecter-pinned-collapsed') === 'on';

function loadCollapsedGroups(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-collapsed-groups') || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveCollapsedGroups() {
  localStorage.setItem('xpecter-collapsed-groups', JSON.stringify(Array.from(collapsedGroups)));
}
// SPE-64: defaults OFF. OSC 52 lets whatever's running on the remote
// end write directly to the local OS clipboard with zero confirmation,
// including from a host you haven't decided to trust yet, the exact
// TOFU moment Xpecter's own host-key verification exists to gate.
// Opt-in via Settings for anyone who wants the convenience.
let osc52Enabled = localStorage.getItem('xpecter-osc52') === 'on';
let copyOnSelectEnabled = localStorage.getItem('xpecter-copy-on-select') === 'on';
let rightClickPasteEnabled = localStorage.getItem('xpecter-rclick-paste') !== 'off';
let highlightEnabled = localStorage.getItem('xpecter-highlight') !== 'off';

type ShortcutId = 'disconnect' | 'paste' | 'sidebar' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'fullscreen' | 'splitVertical' | 'splitHorizontal' | 'closePane' | 'saveOutput';
type ShortcutBinding = { ctrl: boolean; shift: boolean; alt: boolean; key: string };
const DEFAULT_SHORTCUTS: Record<ShortcutId, ShortcutBinding> = {
  disconnect: { ctrl: true, shift: true, alt: false, key: 'x' },
  paste: { ctrl: true, shift: true, alt: false, key: 'v' },
  sidebar: { ctrl: true, shift: true, alt: false, key: 'b' },
  zoomIn: { ctrl: true, shift: false, alt: false, key: '=' },
  zoomOut: { ctrl: true, shift: false, alt: false, key: '-' },
  resetZoom: { ctrl: true, shift: false, alt: false, key: '0' },
  fullscreen: { ctrl: false, shift: false, alt: false, key: 'F11' },
  splitVertical: { ctrl: true, shift: true, alt: false, key: 'd' },
  splitHorizontal: { ctrl: true, shift: true, alt: false, key: 'Enter' },
  closePane: { ctrl: true, shift: true, alt: false, key: 'w' },
  // SPE-124: the same chord an editor pane uses for Save As, doing the
  // same job one session type over. They can never collide: this one is
  // only reachable from inside a terminal, that one from inside Monaco.
  saveOutput: { ctrl: true, shift: true, alt: false, key: 's' },
};
let shortcuts: Record<ShortcutId, ShortcutBinding> = loadShortcuts();

function loadShortcuts(): Record<ShortcutId, ShortcutBinding> {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-shortcuts') || '{}');
    return Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([id, binding]) => [id, { ...binding, ...(parsed[id] || {}) }])) as Record<ShortcutId, ShortcutBinding>;
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function shortcutMatches(event: KeyboardEvent, id: ShortcutId): boolean {
  const binding = shortcuts[id];
  const modifier = event.ctrlKey || event.metaKey;
  return modifier === binding.ctrl && event.shiftKey === binding.shift && event.altKey === binding.alt && event.key.toLowerCase() === binding.key.toLowerCase();
}

function saveShortcuts() {
  localStorage.setItem('xpecter-shortcuts', JSON.stringify(shortcuts));
}

type CommandSnippet = { name: string; command: string };
let commandSnippets: CommandSnippet[] = loadCommandSnippets();

function loadCommandSnippets(): CommandSnippet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-command-snippets') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CommandSnippet =>
      !!item && typeof item.name === 'string' && typeof item.command === 'string');
  } catch {
    return [];
  }
}

function saveCommandSnippets() {
  localStorage.setItem('xpecter-command-snippets', JSON.stringify(commandSnippets));
}

function renderCommandSnippetsMenu() {
  const container = document.getElementById('menu-snippets')!;
  container.innerHTML = '';
  for (const snippet of commandSnippets) {
    const item = document.createElement('div');
    item.className = 'item';
    item.textContent = `Snippet: ${snippet.name}`;
    item.title = snippet.command;
    item.onclick = () => {
      closeAllMenus();
      const tab = activeTabId ? tabs.get(activeTabId) : null;
      if (!tab) return;
      const session = focusedSession(tab);
      if (session.status !== 'connected' || !session.backendId) return;
      sendTextToSession(session, `${snippet.command}\r`);
    };
    container.appendChild(item);
  }
}

function manageCommandSnippets() {
  const name = prompt('Snippet name:');
  if (!name?.trim()) return;
  const command = prompt('Command or configuration block:');
  if (!command?.trim()) return;
  commandSnippets.push({ name: name.trim(), command });
  saveCommandSnippets();
  renderCommandSnippetsMenu();
}

// --- Terminal output colouring (SPE-108) ---
// This started as four rules: three status words and an interface name.
// Real switch and server output has far more in it worth telling apart
// at a glance, so the rule set is much wider now, and two things about
// the old mechanics had to change to carry it.
//
//   1. It ran one .replace() per rule over the whole string, so each
//      pass saw the escape codes the previous passes had inserted. With
//      only word-boundary rules that was harmless. Add a rule that
//      matches digits and it starts colouring the "38;2;51;204;51"
//      inside an earlier rule's own escape, which corrupts the output.
//      The rules are one alternation now, applied in a single pass that
//      never sees what it emitted.
//
//   2. It used fixed RGB values, so the highlighting ignored whichever
//      colour scheme the person had picked. Categories map onto the
//      active scheme's own ANSI colours instead, so Gruvbox output
//      looks like Gruvbox.

// The word lists are the source for both the patterns below and the
// split-token check further down, so the two cannot drift apart.
const GOOD_WORDS = [
  'up', 'ok', 'okay', 'active', 'connected', 'established', 'enabled',
  'success', 'successful', 'successfully', 'complete', 'completed', 'passed',
  'valid', 'permit', 'permitted', 'allow', 'allowed', 'online', 'running',
  'healthy', 'reachable', 'synchronised', 'synchronized', 'available',
  'ready', 'true', 'yes', 'open', 'accept', 'accepted', 'forwarding',
  'full-duplex', 'inuse', 'trusted',
];

const BAD_WORDS = [
  'down', 'error', 'errors', 'errdisable', 'errdisabled', 'err-disabled',
  'fail', 'failed', 'failure', 'failures', 'denied', 'deny', 'drop',
  'dropped', 'drops', 'discard', 'discarded', 'discards', 'critical', 'crit',
  'alert', 'emergency', 'emerg', 'invalid', 'refused', 'unreachable',
  'timeout', 'timeouts', 'timed-out', 'disabled', 'inactive', 'offline',
  'dead', 'blocked', 'violation', 'reject', 'rejected', 'unavailable',
  'missing', 'corrupt', 'corrupted', 'abort', 'aborted', 'false', 'closed',
  'unknown', 'notconnect', 'suspended', 'denied.', 'crash', 'crashed',
];

const WARN_WORDS = [
  'warn', 'warning', 'warnings', 'notice', 'degraded', 'partial', 'pending',
  'retry', 'retries', 'retrying', 'deprecated', 'unstable', 'flapping',
  'congestion', 'throttled', 'throttling', 'half-duplex', 'blocking',
  'listening', 'learning', 'stale', 'idle',
];

// Configuration vocabulary. Deliberately network-flavoured and
// deliberately not generic English: colouring "show" or "source" would
// light up half of any shell session for no information at all.
const CONFIG_WORDS = [
  'interface', 'switchport', 'spanning-tree', 'portfast', 'bpduguard',
  'bpdufilter', 'loopguard', 'rootguard', 'channel-group', 'port-channel',
  'etherchannel', 'encapsulation', 'dot1q', 'nonegotiate', 'negotiation',
  'access-list', 'prefix-list', 'route-map', 'class-map', 'policy-map',
  'service-policy', 'storm-control', 'load-interval', 'snmp-server',
  'default-gateway', 'running-config', 'startup-config', 'address-family',
  'redistribute', 'neighbor', 'remote-as', 'router-id', 'passive-interface',
  'standby', 'vrrp', 'hsrp', 'preempt', 'authentication', 'authorization',
  'accounting', 'tacacs', 'radius', 'aaa', 'banner', 'hostname', 'shutdown',
  'description', 'duplex', 'speed', 'mtu', 'vlan', 'vrf', 'ospf', 'eigrp',
  'bgp', 'isis', 'lldp', 'cdp', 'udld', 'lacp', 'pagp', 'dhcp', 'snooping',
  'arp', 'nat', 'qos', 'trunk', 'native', 'allowed', 'permit', 'deny',
  'inside', 'outside', 'secondary', 'no', 'ip', 'ipv6',
];

// Longest first: the alternation takes the first branch that matches, so
// an unsorted list lets "fail" shadow "failure".
function wordPattern(words: string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return String.raw`\b(?:${sorted.join('|')})\b`;
}

type HighlightCategory =
  | 'good' | 'bad' | 'warn' | 'iface' | 'addr' | 'number'
  | 'string' | 'keyword' | 'meta' | 'path' | 'time';

// Order is priority order: at any position the first pattern that
// matches wins, so specific goes before general. A MAC address has to
// be tried before IPv6, which would otherwise happily read
// aa:bb:cc:dd:ee:ff as an address, and every number rule comes last,
// since nearly everything above it contains digits.
const HIGHLIGHT_RULES: { category: HighlightCategory; pattern: string }[] = [
  // Timestamps, in the shapes ISO-8601, syslog and IOS all use.
  { category: 'time', pattern: String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?` },
  { category: 'time', pattern: String.raw`\*?[A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}(?:\.\d+)?` },
  { category: 'time', pattern: String.raw`\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b` },

  // Hardware and network addresses.
  { category: 'addr', pattern: String.raw`\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b` },
  { category: 'addr', pattern: String.raw`\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b` },
  { category: 'addr', pattern: String.raw`\b(?:[0-9a-f]{1,4}:){2,7}(?::|[0-9a-f]{1,4})(?:\/\d{1,3})?` },
  { category: 'addr', pattern: String.raw`\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b` },

  // Interface names, long form and the abbreviations everybody types.
  { category: 'iface', pattern: String.raw`\b(?:Ten|Twenty|Forty|Fifty|Hundred|Gigabit|Fast|Ten-?Gigabit|Twenty-?Five|Four-?Hundred)?Ethernet\d+(?:\/\d+)*(?:\.\d+)?\b` },
  { category: 'iface', pattern: String.raw`\b(?:Port-channel|Bundle-Ether|Loopback|Tunnel|Serial|Vlan|Management|Multilink|Dialer|Async)\d+(?:\.\d+)?\b` },
  { category: 'iface', pattern: String.raw`\b(?:Gi|Te|Twe|Fo|Fi|Hu|Fa|Eth|Et|Po|Vl|Lo|Tu|Se|Ma|Bu)\d+(?:\/\d+)*(?:\.\d+)?\b` },
  { category: 'iface', pattern: String.raw`\b(?:eth|ens|enp|eno|wlan|wlp|bond|br|docker|veth|tun|tap|virbr)\d+[\w.]*\b` },

  // The %FACILITY-severity-MNEMONIC tag leading every IOS log line.
  { category: 'meta', pattern: String.raw`%[A-Z][A-Z0-9_]*-\d-[A-Z0-9_]+` },
  { category: 'meta', pattern: String.raw`\b(?:https?|ftps?|ssh|sftp|tftp|telnet|scp|rsync):\/\/[^\s"'<>]+` },

  // Filesystem paths, both conventions. Two segments minimum, so this
  // does not fight the interface rules over things shaped like 1/0/1.
  { category: 'path', pattern: String.raw`\b[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n ]+\\?)+` },
  { category: 'path', pattern: String.raw`(?:^|(?<=[\s=:(,]))~?\/[\w.@+-]+(?:\/[\w.@+-]+)+\/?` },

  { category: 'string', pattern: String.raw`"[^"\n]{0,200}"` },

  // Outcomes. These are the words the eye should find without reading.
  { category: 'good', pattern: wordPattern(GOOD_WORDS) },
  { category: 'bad', pattern: wordPattern(BAD_WORDS) },
  { category: 'warn', pattern: wordPattern(WARN_WORDS) },
  { category: 'keyword', pattern: wordPattern(CONFIG_WORDS) },

  // Sizes, rates and percentages read as one unit, not as a number that
  // happens to be followed by some letters.
  { category: 'number', pattern: String.raw`\b\d+(?:\.\d+)?\s?(?:[KMGTP]i?[Bb]|[KMGT]?bps|[KMGT]?pps|[num]?s)\b` },
  { category: 'number', pattern: String.raw`\b\d+(?:\.\d+)?%` },
  { category: 'number', pattern: String.raw`\b0x[0-9a-f]+\b` },
  { category: 'number', pattern: String.raw`\b\d+(?:\.\d+)?\b` },
];

// One alternation, one pass. The named groups say which rule won, and
// are generated rather than spelled out so the rules stay a plain list.
const HIGHLIGHT_RE = new RegExp(
  HIGHLIGHT_RULES.map((rule, index) => `(?<h${index}>${rule.pattern})`).join('|'),
  'gi',
);

// Which of the active scheme's ANSI colours each category borrows.
// Picked to stay distinguishable across every bundled scheme rather
// than being tuned to one of them.
const HIGHLIGHT_COLORS: Record<HighlightCategory, string> = {
  good: 'green',
  bad: 'red',
  warn: 'yellow',
  iface: 'cyan',
  addr: 'brightMagenta',
  number: 'magenta',
  string: 'brightYellow',
  keyword: 'blue',
  meta: 'brightCyan',
  path: 'brightBlue',
  time: 'brightBlack',
};

function ansiTruecolor(hex: string): string {
  const value = parseInt(hex.replace('#', ''), 16);
  return `38;2;${Math.floor(value / 65536) % 256};${Math.floor(value / 256) % 256};${value % 256}`;
}

// Rebuilt only when the scheme changes. This is read once per matched
// token, and parsing eleven hex values there would mean doing it
// thousands of times per screenful.
let highlightPaletteCache: { scheme: ColorScheme; codes: Record<HighlightCategory, string> } | null = null;

function highlightPalette(): Record<HighlightCategory, string> {
  const scheme = currentColorScheme();
  if (highlightPaletteCache?.scheme === scheme) return highlightPaletteCache.codes;
  const colors = TERMINAL_COLOR_SCHEMES[scheme];
  const codes = {} as Record<HighlightCategory, string>;
  for (const [category, name] of Object.entries(HIGHLIGHT_COLORS)) {
    codes[category as HighlightCategory] = ansiTruecolor(colors[name] ?? colors.white);
  }
  highlightPaletteCache = { scheme, codes };
  return codes;
}

// Matches existing escape sequences so they can be preserved untouched.
// Highlighting must never modify bytes inside these: doing so previously
// corrupted real prompts that use ANSI color codes (SPE-45).
//
// The byte ranges below are ECMA-48's, rather than a list of the finals we
// happen to have seen. CSI used to end at [a-zA-Z], which left out the
// insert-character sequence \x1b[1@ that readline sends for every keystroke
// typed into the middle of a recalled command line. The bare-number rule
// coloured the "1" inside it, the inserted colour broke the sequence in
// half, and the terminal drew a literal "1@" for every key pressed.
//   CSI:    \x1b[ then params 0x30-0x3f, intermediates 0x20-0x2f, final 0x40-0x7e
//   String: OSC, DCS, SOS, PM and APC, each running on to a BEL or an ST
//   Other:  \x1b, any intermediates, one final byte, and never an introducer
//           that the two cases above already own
// eslint-disable-next-line no-control-regex -- intentional: matching real escape sequences requires literal control chars
const ANSI_SEQUENCE_RE = /\x1b(?:[\]P^_X][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|(?![[\]P^_X])[ -/]*[0-~])/g;

function highlightPlainText(text: string): string {
  const palette = highlightPalette();
  return text.replace(HIGHLIGHT_RE, (match, ...args) => {
    const groups = args[args.length - 1] as Record<string, string | undefined> | undefined;
    if (!groups) return match;
    for (let index = 0; index < HIGHLIGHT_RULES.length; index += 1) {
      if (groups[`h${index}`] === undefined) continue;
      // 39 restores the default foreground and nothing else. A full 0m
      // reset would also clear bold, and any background the far end had
      // set around this run.
      return `\x1b[${palette[HIGHLIGHT_RULES[index].category]}m${match}\x1b[39m`;
    }
    return match;
  });
}

// True when an SGR sequence leaves a foreground colour in effect, false
// when it clears one. Anything that is not an SGR sequence leaves the
// current state alone.
function sgrLeavesColorActive(sequence: string, current: boolean): boolean {
  if (!sequence.startsWith('\x1b[') || !sequence.endsWith('m')) return current;
  const params = sequence.slice(2, -1);
  if (params === '' || params === '0') return false;
  let active = current;
  for (const part of params.split(';')) {
    const code = Number(part);
    if (code === 0 || code === 39) active = false;
    else if ((code >= 30 && code <= 38) || (code >= 90 && code <= 97)) active = true;
  }
  return active;
}

// Text the far end already coloured is left exactly as it sent it.
// Recolouring inside a coloured run is how a highlighter breaks somebody's
// prompt, their pager, or vim. A run that still holds an ESC is left alone
// for the same reason: that ESC belongs to a sequence the match above did
// not recognise, and a colour inserted inside one is what puts the
// sequence's own parameters on the screen as text.
function highlightRun(run: string, colorActive: boolean): string {
  if (colorActive || run.includes('\x1b')) return run;
  return highlightPlainText(run);
}

function applyOutputHighlighting(text: string): string {
  if (!highlightEnabled) return text;
  let result = '';
  let lastIndex = 0;
  let colorActive = false;
  for (const match of text.matchAll(ANSI_SEQUENCE_RE)) {
    const idx = match.index!;
    result += highlightRun(text.slice(lastIndex, idx), colorActive);
    result += match[0]; // pass existing escape sequences through untouched
    colorActive = sgrLeavesColorActive(match[0], colorActive);
    lastIndex = idx + match[0].length;
  }
  return result + highlightRun(text.slice(lastIndex), colorActive);
}

// The introducers whose sequence runs on until a terminator arrives,
// rather than ending at the next byte: OSC, DCS, SOS, PM and APC.
const STRING_SEQUENCE_INTRODUCERS = ']P^_X';

// A sequence is complete when its final byte has arrived, and still
// growing while only the bytes that legally precede one have.
// eslint-disable-next-line no-control-regex -- ANSI escape detection requires the literal ESC byte
const COMPLETE_CSI_RE = /^\x1b\[[0-?]*[ -/]*[@-~]/;
// eslint-disable-next-line no-control-regex -- ANSI escape detection requires the literal ESC byte
const PARTIAL_CSI_RE = /^\x1b\[[0-?]*[ -/]*$/;
// eslint-disable-next-line no-control-regex -- ANSI escape detection requires the literal ESC byte
const COMPLETE_ESCAPE_RE = /^\x1b[ -/]*[0-~]/;
// eslint-disable-next-line no-control-regex -- ANSI escape detection requires the literal ESC byte
const PARTIAL_ESCAPE_RE = /^\x1b[ -/]*$/;

function incompleteAnsiStart(text: string): number | null {
  const esc = text.lastIndexOf('\x1b');
  if (esc < 0) return null;
  const tail = text.slice(esc);
  if (tail.length === 1) return esc;
  if (STRING_SEQUENCE_INTRODUCERS.includes(tail[1])) {
    return tail.includes('\x07') || tail.includes('\x1b\\') ? null : esc;
  }
  const isCsi = tail[1] === '[';
  if ((isCsi ? COMPLETE_CSI_RE : COMPLETE_ESCAPE_RE).test(tail)) return null;
  // Held back only while the sequence could still grow into a real one. A
  // byte that cannot appear in an escape at all is not worth waiting on,
  // and waiting on one would hold the rest of the line back with it.
  return (isCsi ? PARTIAL_CSI_RE : PARTIAL_ESCAPE_RE).test(tail) ? esc : null;
}

// Every prefix of every word the rules can match. A token split across
// two backend events is held back only when it could still grow into
// one of them, which is what stops a prompt that happens to end
// mid-word from being swallowed and never drawn.
const HIGHLIGHT_WORD_PREFIXES = (() => {
  const prefixes = new Set<string>();
  for (const word of [...GOOD_WORDS, ...BAD_WORDS, ...WARN_WORDS, ...CONFIG_WORDS]) {
    for (let length = 2; length < word.length; length += 1) prefixes.add(word.slice(0, length));
  }
  return prefixes;
})();

function mayBeSplitHighlightToken(token: string): boolean {
  // One character is as likely to be the tail of a prompt as the start
  // of a word, and holding a prompt back is far worse than missing a
  // highlight. The upper bound is one character over a full IPv6
  // address, the longest thing worth waiting for.
  if (token.length < 2 || token.length > 40) return false;
  if (HIGHLIGHT_WORD_PREFIXES.has(token.toLowerCase())) return true;
  // A partly-arrived address. Both of these insist on a separator, so
  // an ordinary word or a bare number is never held back.
  if (/^\d{1,3}(?:\.\d{1,3}){1,3}\.?$/.test(token)) return true;
  if (/^[0-9a-f]{1,4}(?:[.:-][0-9a-f]{0,4})+$/i.test(token)) return true;
  // A partly-arrived interface name.
  return /^(?:Gi|Te|Twe|Fo|Fi|Hu|Fa|Eth|Et|Po|Vl|Lo|Tu|Se|Ma|Bu)\d*(?:\/\d*)*$/i.test(token);
}

function splitHighlightChunk(text: string): { ready: string; carry: string } {
  const ansiStart = incompleteAnsiStart(text);
  const ansiReady = ansiStart === null ? text : text.slice(0, ansiStart);
  const ansiCarry = ansiStart === null ? '' : text.slice(ansiStart);
  // Widened past letters so a half-arrived address can be held too.
  // Whether it actually is stays mayBeSplitHighlightToken's decision.
  const tokenMatch = ansiReady.match(/[A-Za-z0-9][A-Za-z0-9/._:-]*$/);
  if (!tokenMatch || !mayBeSplitHighlightToken(tokenMatch[0])) {
    return { ready: ansiReady, carry: ansiCarry };
  }
  const tokenStart = ansiReady.length - tokenMatch[0].length;
  return { ready: ansiReady.slice(0, tokenStart), carry: ansiReady.slice(tokenStart) + ansiCarry };
}

function writeToTerminal(session: Session, data: string) {
  const combined = highlightEnabled ? session.highlightCarry + data : data;
  const chunk = highlightEnabled ? splitHighlightChunk(combined) : { ready: combined, carry: '' };
  session.highlightCarry = chunk.carry;
  session.term!.write(applyOutputHighlighting(chunk.ready));
  if (appSettings.sessionLogDirectory && session.backendId) {
    App.AppendSessionLog(appSettings.sessionLogDirectory, session.backendId, session.label, data).catch((err) => {
      console.error('Session log append failed', err);
    });
  }
}

// --- Disconnected-session panel (SPE-59) ---
// Mirrors MobaXterm's disconnect UI (see design-reference comment on the
// Linear ticket): the failure message and a divider are written into the
// terminal's own scrollback, real content that scrolls, copies, and saves
// like everything else, and a small non-modal panel with Reconnect /
// Save Output / Close Tab is anchored to the bottom of the pane. R / S /
// Enter work as shortcuts while the panel is open, matching MobaXterm's
// keyboard-driven flow.

function terminalTextContent(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

// SPE-124: saving a pane's output stops being something only a dead
// session can do. This was written for the SPE-59 disconnect panel and
// reachable nowhere else, so the feature effectively didn't exist
// while a session was still worth reading. It always asked where to
// put the file (App.SaveTextFile opens the native Save dialog); what
// it lacked was a way in, and any word about what it did.
async function saveSessionOutput(session: Session) {
  if (!session.term) {
    flashStatus('Nothing to save: this pane has no terminal.', true);
    return;
  }
  const content = terminalTextContent(session.term);
  if (!content.trim()) {
    flashStatus('Nothing to save: this terminal is empty.', true);
    return;
  }
  // Local time, not toISOString's UTC: this string's whole job is to
  // match the clock on the wall of whoever reads the filename later.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  // Timestamped because saving the same session twice in an afternoon
  // is the normal case, and the default name is the only thing between
  // that and quietly overwriting the first file.
  const defaultName = `${session.label.replace(/[^a-zA-Z0-9._@-]+/g, '_')}-${stamp}.log`;
  try {
    // '' means the dialog was cancelled, which needs no announcement:
    // they just decided not to save.
    const savedTo = await App.SaveTextFile(defaultName, content);
    if (savedTo) flashStatus(`Saved terminal output to ${savedTo}`);
  } catch (err) {
    flashStatus(`Save failed: ${err}`, true);
  }
}

function clearDisconnectPanel(session: Session) {
  session.stopped = false;
  session.overlay?.remove();
  session.overlay = null;
}

async function reconnectSession(session: Session) {
  if (!session.reconnect) return;
  clearDisconnectPanel(session);
  await session.reconnect();
}

// Manual "Disconnect" (Terminal menu): closes the underlying session but
// keeps the tab open, showing the same SPE-59 panel a real drop would.
// Useful both as a real feature (deliberately kill a session without
// losing the tab/scrollback) and for testing the panel without having
// to pull a cable every time. Reuses CloseSSH/CloseSerial, which mark
// the close as deliberate on the backend (no ssh:closed/serial:closed
// event fires), so the panel is shown here on the frontend side instead.
async function disconnectSession(session: Session) {
  if (session.stopped) return;
  if (session.mode === 'ssh' && session.backendId) {
    await App.CloseSSH(session.backendId);
  } else if (session.mode === 'serial' && session.backendId) {
    await App.CloseSerial(session.backendId);
  } else {
    return; // nothing live to disconnect (pending or local shell sessions)
  }
  showDisconnectPanel(session, 'Disconnected.');
}

function showDisconnectPanel(session: Session, message: string) {
  if (!session.term || !session.container) return;
  session.stopped = true;
  session.status = 'disconnected';
  renderTabBar();

  const term = session.term;
  const cols = term.cols || 80;
  const divider = '-'.repeat(cols);
  // Red inline message + divider, written as real terminal content so it
  // scrolls, copies, and saves like everything else in the session.
  term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
  term.write(`\x1b[36m${divider}\x1b[0m\r\n`);

  session.overlay?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'disconnect-panel';

  const title = document.createElement('div');
  title.className = 'disconnect-title';
  title.textContent = 'Session stopped';
  overlay.appendChild(title);

  const ownerTab = tabs.get(session.ownerTabId)!;
  const actions: { key: string; label: string; run: () => void; enabled: boolean }[] = [
    { key: 'Enter', label: 'exit pane', run: () => closePane(ownerTab, paneIndexOf(ownerTab, session)), enabled: true },
    { key: 'R', label: 'restart session', run: () => { reconnectSession(session); }, enabled: !!session.reconnect },
    { key: 'S', label: 'save terminal output to file', run: () => { saveSessionOutput(session); }, enabled: true },
  ];

  for (const action of actions) {
    if (!action.enabled) continue;
    const row = document.createElement('div');
    row.className = 'disconnect-action';
    const key = document.createElement('span');
    key.className = 'disconnect-key';
    key.textContent = action.key;
    row.appendChild(key);
    const label = document.createElement('span');
    label.textContent = `to ${action.label}`;
    row.appendChild(label);
    row.onclick = action.run;
    overlay.appendChild(row);
  }

  // Anchored to the term host (position:relative), same reasoning as
  // the custom scrollbar track above, the outer pane wrapper also
  // contains the header now.
  const termHost = termFrameOf(session) ?? session.container;
  termHost.appendChild(overlay);
  session.overlay = overlay;
}

function sessionMatchesQuery(s: SessionProfile, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (s.name.toLowerCase().includes(q)) return true;
  if (s.host && s.host.toLowerCase().includes(q)) return true;
  if (s.serialPort && s.serialPort.toLowerCase().includes(q)) return true;
  if (s.tags && s.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

async function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  await App.SaveGroup({ id: '', name, parentId: '' });
  renderSessionList();
}

async function renderSessionList() {
  const [sessions, groups] = await Promise.all([App.ListSessions(), App.ListGroups()]);
  const list = document.getElementById('session-list')!;
  list.innerHTML = '';

  const live = liveSessionsByProfile();
  const query = sessionSearchQuery.trim();
  const visibleSessions = sessions.filter((s) => sessionMatchesQuery(s, query));

  const countEl = document.getElementById('sessions-count')!;
  const liveCount = sessions.filter((s) => live.has(s.id)).length;
  countEl.textContent = liveCount > 0 ? `${liveCount}/${sessions.length}` : String(sessions.length);
  countEl.title = liveCount > 0 ? `${liveCount} running of ${sessions.length} saved` : `${sessions.length} saved session(s)`;

  // While filtering, the folder tree is noise: show a flat ranked list of
  // what matched and nothing else.
  if (query) {
    if (visibleSessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'side-empty';
      empty.textContent = 'No sessions match.';
      list.appendChild(empty);
    } else {
      for (const s of visibleSessions) list.appendChild(renderSessionRow(s, 0, live));
    }
    renderLocalShellProfileList();
    renderFolderList();
    if (homeIsActive()) renderHomeView().catch(() => {});
    return;
  }

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-empty';
    empty.textContent = 'No saved sessions yet.';
    list.appendChild(empty);
  }

  // Pinned first, then running. Pinned answers "the things I always
  // need", running answers "the things I am in". Both sit above the
  // tree because both are shortcuts past it.
  const pinned = sessions.filter((s) => s.pinned);
  if (pinned.length > 0) {
    const head = document.createElement('div');
    head.className = 'side-group';
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = pinnedCollapsed ? '▸' : '▾';
    const icon = document.createElement('span');
    icon.textContent = '★';
    icon.style.cssText = 'font-size:10px;';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = 'Pinned';
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(pinned.length);
    head.appendChild(chev);
    head.appendChild(icon);
    head.appendChild(name);
    head.appendChild(count);
    head.onclick = () => {
      pinnedCollapsed = !pinnedCollapsed;
      localStorage.setItem('xpecter-pinned-collapsed', pinnedCollapsed ? 'on' : 'off');
      renderSessionList();
    };
    list.appendChild(head);
    if (!pinnedCollapsed) {
      for (const s of pinned) list.appendChild(renderSessionRow(s, 1, live));
    }
  }

  // Running sessions first, so the panel answers "what am I in right
  // now" before it answers "what could I open". Skipped entirely when
  // nothing is live, rather than showing an empty header.
  const running = sessions.filter((s) => live.has(s.id));
  if (running.length > 0) {
    const head = document.createElement('div');
    head.className = 'side-group';
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = runningCollapsed ? '▸' : '▾';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = 'Running';
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(running.length);
    head.appendChild(chev);
    head.appendChild(name);
    head.appendChild(count);
    head.onclick = () => {
      runningCollapsed = !runningCollapsed;
      localStorage.setItem('xpecter-running-collapsed', runningCollapsed ? 'on' : 'off');
      renderSessionList();
    };
    list.appendChild(head);
    if (!runningCollapsed) {
      for (const s of running) list.appendChild(renderSessionRow(s, 1, live));
    }
  }

  const topGroups = groups.filter((g) => !g.parentId);
  for (const g of topGroups) {
    renderGroupNode(g, groups, visibleSessions, list, 0, live);
  }

  const ungrouped = visibleSessions.filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId));
  for (const s of ungrouped) {
    list.appendChild(renderSessionRow(s, 0, live));
  }

  renderLocalShellProfileList();
  renderFolderList();

  // Home shows the same session data from a different angle, so keep it
  // in step with every mutation that already funnels through here
  // (save, delete, new folder, rename).
  if (homeIsActive()) renderHomeView().catch(() => {});
}

// SPE-100: keyboard navigation over whatever the sidebar is currently
// showing, sessions and shell profiles alike, driven from the filter
// field. Same idiom as Home's quick connect so the two don't need
// separate muscle memory.
let sidebarSelected = -1;

function sidebarRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('#sidebar .side-row')) as HTMLElement[];
}

function highlightSidebarSelection() {
  const rows = sidebarRows();
  rows.forEach((row, i) => row.classList.toggle('selected', i === sidebarSelected));
  if (sidebarSelected >= 0 && rows[sidebarSelected]) {
    rows[sidebarSelected].scrollIntoView({ block: 'nearest' });
  }
}

function moveSidebarSelection(delta: number) {
  const rows = sidebarRows();
  if (rows.length === 0) { sidebarSelected = -1; return; }
  sidebarSelected = sidebarSelected < 0
    ? (delta > 0 ? 0 : rows.length - 1)
    : (sidebarSelected + delta + rows.length) % rows.length;
  highlightSidebarSelection();
}
// --- Home view (SPE-99) ---
//
// The permanent Home tab gets its own surface instead of sharing
// #tab-landing with ordinary un-connected tabs. Almost nothing here is
// new capability: ListSessions, sessionMatchesQuery, useSession and
// launchLocalShellProfile all already existed. What was missing was a
// place to put them. Recents were computed but rendered collapsed by
// default inside a sidebar that can be hidden outright, and "quick
// connect" filtered a list rather than connecting to anything, while
// the whole terminal pane sat empty behind two centered widgets.

const HOME_RECENT_LIMIT = 8;
const HOME_QC_LIMIT = 8;

// Last-loaded session set, so quick-connect filtering is instant
// keystroke-to-keystroke instead of a Wails round trip per character.
// Refreshed by renderHomeView, which runs on every switch to Home and
// on every session mutation.
// Deliberately shorter than the session lists: this is a reminder of
// what you were editing, not a file manager.
const HOME_EDITOR_LIMIT = 5;

let homeSessions: SessionProfile[] = [];
let homeQuickQuery = '';
let homeQcActions: (() => void)[] = [];
let homeQcSelected = -1;

function homeIsActive(): boolean {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  return !!tab && tab.isHome;
}

function homeSessionIcon(s: SessionProfile): string {
  if (s.type === 'serial') return '🔌';
  if (s.deviceKind === 'switch') return '🔀';
  if (s.deviceKind === 'firewall') return '🛡️';
  return '🖥️';
}

function homeSessionSubtitle(s: SessionProfile): string {
  if (s.type === 'serial') {
    return s.serialPort ? `${s.serialPort} @ ${s.baud ?? 9600}` : 'Serial';
  }
  if (!s.host) return 'SSH';
  const port = s.port && s.port !== 22 ? `:${s.port}` : '';
  return (s.user ? `${s.user}@` : '') + s.host + port;
}

function homeRelativeTime(iso?: string): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString();
}

type QuickTarget = { user: string; host: string; port: number };

// Parses [user@]host[:port]. The bracketed [::1]:22 form is handled
// explicitly so an IPv6 literal's own colons aren't mistaken for a port
// separator. Returns null for anything that isn't plausibly a host, in
// which case the typed text stays a pure search term.
function parseQuickTarget(text: string): QuickTarget | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let user = '';
  let rest = trimmed;
  const at = trimmed.lastIndexOf('@');
  if (at >= 0) {
    user = trimmed.slice(0, at);
    rest = trimmed.slice(at + 1);
    if (!user || !/^[A-Za-z0-9._-]+$/.test(user)) return null;
  }
  if (!rest) return null;

  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 1) return null;
    const host = rest.slice(1, close);
    if (!/^[0-9A-Fa-f:.]+$/.test(host)) return null;
    const tail = rest.slice(close + 1);
    if (!tail) return { user, host, port: 22 };
    if (!tail.startsWith(':')) return null;
    const port = Number(tail.slice(1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { user, host, port };
  }

  let host = rest;
  let port = 22;
  const colon = rest.lastIndexOf(':');
  if (colon > 0) {
    const parsed = Number(rest.slice(colon + 1));
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
    port = parsed;
    host = rest.slice(0, colon);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(host)) return null;
  return { user, host, port };
}

// An ad-hoc target has no stored credentials, so this stops at the same
// picker every other unsaved SSH connection goes through rather than
// inventing a second auth path. Only the host/user/port legwork is done
// up front.
function startQuickConnect(target: QuickTarget) {
  ensurePendingTab();
  pendingPaneTarget = null;
  resetPickerView();
  // resetPickerView clears this, so it has to be set afterwards.
  pendingQuickPort = target.port === 22 ? null : target.port;

  const hostField = document.getElementById('host') as HTMLInputElement;
  const userField = document.getElementById('user') as HTMLInputElement;
  hostField.value = target.host;
  userField.value = target.user;
  setDeviceKind('host');
  setAuthMode('password');

  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-ssh-fields')!.style.display = 'flex';
  document.getElementById('session-picker-overlay')!.classList.add('open');

  const passwordField = document.getElementById('password') as HTMLInputElement;
  passwordField.value = '';
  passwordField.focus();

  // Same OS-username default as openSessionPicker (SPE-83), for the
  // plain "host" form where no user was typed.
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
}

function homeCard(s: SessionProfile): HTMLElement {
  const card = document.createElement('div');
  card.className = 'home-card';
  card.tabIndex = 0;
  card.title = `Connect to ${s.name}`;

  const title = document.createElement('div');
  title.className = 'home-card-title';
  const icon = document.createElement('span');
  icon.textContent = homeSessionIcon(s);
  const name = document.createElement('span');
  name.textContent = s.name;
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
  title.appendChild(icon);
  title.appendChild(name);

  const subtitle = document.createElement('div');
  subtitle.className = 'home-card-sub';
  const when = homeRelativeTime(s.lastUsed);
  subtitle.textContent = when
    ? `${homeSessionSubtitle(s)} · ${when}`
    : homeSessionSubtitle(s);

  card.appendChild(title);
  card.appendChild(subtitle);

  // The whole card is the hit target. The sidebar's own rows bind click
  // to their label <span> only, which leaves most of the row dead;
  // that's a bug to fix there, not a pattern to copy here.
  card.onclick = () => useSession(s);
  card.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      useSession(s);
    }
  };
  return card;
}

// One recent folder or file, styled as a saved-session row so the
// editor's half of Home doesn't look like a different product.
function homeEditorRow(glyph: string, path: string, kind: string, run: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'home-saved-row';
  row.tabIndex = 0;
  row.title = path;
  const name = document.createElement('span');
  name.textContent = `${glyph} ${baseName(path)}`;
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = kind === 'folder' ? dirName(path) : `${dirName(path)} · file`;
  row.append(name, sub);
  row.onclick = run;
  row.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    run();
  };
  return row;
}

function homeSavedRow(s: SessionProfile): HTMLElement {
  const row = document.createElement('div');
  row.className = 'home-saved-row';
  row.tabIndex = 0;
  row.title = `Connect to ${s.name}`;

  const icon = document.createElement('span');
  icon.textContent = homeSessionIcon(s);
  const name = document.createElement('span');
  name.textContent = s.name;
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const subtitle = document.createElement('span');
  subtitle.className = 'sub';
  subtitle.textContent = homeSessionSubtitle(s);

  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(subtitle);

  row.onclick = () => useSession(s);
  row.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      useSession(s);
    }
  };
  return row;
}

// Reads the live `shortcuts` map rather than DEFAULT_SHORTCUTS, so a
// rebound key (they're user-editable as of b73c808) shows its real
// binding here instead of a stale default.
function renderHomeHints() {
  const hints = document.getElementById('home-hints')!;
  hints.innerHTML = '';
  const entries: [string, string][] = [
    ['Enter', 'connect the highlighted result'],
    [formatShortcut(shortcuts.sidebar), 'toggle the sidebar'],
    [formatShortcut(shortcuts.splitVertical), 'split vertically'],
    [formatShortcut(shortcuts.splitHorizontal), 'split horizontally'],
    [formatShortcut(shortcuts.closePane), 'close the focused pane'],
  ];
  for (const [keys, description] of entries) {
    const item = document.createElement('span');
    const key = document.createElement('kbd');
    key.textContent = keys;
    item.appendChild(key);
    item.appendChild(document.createTextNode(' ' + description));
    hints.appendChild(item);
  }
}

function highlightHomeQcSelection() {
  const rows = document.querySelectorAll('#home-qc-results .home-qc-row');
  rows.forEach((row, i) => row.classList.toggle('selected', i === homeQcSelected));
}

// Clears the field before acting: connecting switches away from Home,
// and coming back to a stale query with its results still open reads as
// the app having lost track of what you did.
function runHomeQcAction(action: () => void) {
  const input = document.getElementById('home-quick-connect') as HTMLInputElement;
  input.value = '';
  homeQuickQuery = '';
  homeQcSelected = -1;
  renderHomeQuickResults();
  action();
}

function renderHomeQuickResults() {
  const box = document.getElementById('home-qc-results')!;
  box.innerHTML = '';
  homeQcActions = [];

  const query = homeQuickQuery.trim();
  if (!query) {
    box.classList.remove('open');
    homeQcSelected = -1;
    return;
  }

  const matches = homeSessions
    .filter((s) => sessionMatchesQuery(s, query))
    .slice(0, HOME_QC_LIMIT);

  for (const s of matches) {
    const row = document.createElement('div');
    row.className = 'home-qc-row';
    const icon = document.createElement('span');
    icon.textContent = homeSessionIcon(s);
    const name = document.createElement('span');
    name.textContent = s.name;
    const subtitle = document.createElement('span');
    subtitle.className = 'sub';
    subtitle.textContent = homeSessionSubtitle(s);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(subtitle);
    row.onclick = () => runHomeQcAction(() => useSession(s));
    homeQcActions.push(() => useSession(s));
    box.appendChild(row);
  }

  // Offered last, and suppressed when a listed saved session already
  // points at the same place, so the saved one (which carries its own
  // credentials and settings) always wins.
  const target = parseQuickTarget(query);
  const alreadySaved = target !== null && matches.some((s) =>
    (s.host ?? '').toLowerCase() === target.host.toLowerCase()
    && (s.port ?? 22) === target.port
    && (!target.user || (s.user ?? '').toLowerCase() === target.user.toLowerCase()));

  if (target && !alreadySaved) {
    const row = document.createElement('div');
    row.className = 'home-qc-row';
    const icon = document.createElement('span');
    icon.textContent = '→';
    const label = document.createElement('span');
    const shown = (target.user ? `${target.user}@` : '')
      + target.host
      + (target.port === 22 ? '' : `:${target.port}`);
    label.textContent = `Connect to ${shown}`;
    const subtitle = document.createElement('span');
    subtitle.className = 'sub';
    subtitle.textContent = 'SSH';
    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(subtitle);
    row.onclick = () => runHomeQcAction(() => startQuickConnect(target));
    homeQcActions.push(() => startQuickConnect(target));
    box.appendChild(row);
  }

  if (homeQcActions.length === 0) {
    const note = document.createElement('div');
    note.className = 'home-qc-note';
    note.textContent = 'No matching sessions.';
    box.appendChild(note);
  }

  box.classList.add('open');
  if (homeQcSelected >= homeQcActions.length) homeQcSelected = homeQcActions.length - 1;
  if (homeQcSelected < 0 && homeQcActions.length > 0) homeQcSelected = 0;
  highlightHomeQcSelection();
}

async function renderHomeView() {
  const [sessions, groups, shellProfiles] = await Promise.all([
    App.ListSessions(),
    App.ListGroups(),
    App.ListLocalShellProfiles(),
  ]);
  homeSessions = sessions;
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));

  // Same ordering the sidebar's own Recent block uses, just uncollapsed
  // and given room to breathe.
  const recent = sessions
    .filter((s) => s.lastUsed)
    .sort((a, b) => (b.lastUsed! > a.lastUsed! ? 1 : -1))
    .slice(0, HOME_RECENT_LIMIT);

  // Pinned leads on Home for the same reason it leads in the sidebar:
  // recents are empty or stale on the first launch of the day, which is
  // exactly when Home has to be useful.
  const pinned = sessions.filter((s) => s.pinned);

  const hasSessions = sessions.length > 0;
  document.getElementById('home-empty')!.style.display = hasSessions ? 'none' : 'flex';
  document.getElementById('home-pinned-section')!.style.display = pinned.length > 0 ? 'block' : 'none';
  document.getElementById('home-recent-section')!.style.display = recent.length > 0 ? 'block' : 'none';
  document.getElementById('home-saved-section')!.style.display = hasSessions ? 'block' : 'none';
  document.getElementById('home-shells-section')!.style.display = shellProfiles.length > 0 ? 'block' : 'none';

  const pinnedGrid = document.getElementById('home-pinned-grid')!;
  pinnedGrid.innerHTML = '';
  for (const s of pinned) pinnedGrid.appendChild(homeCard(s));

  const recentGrid = document.getElementById('home-recent-grid')!;
  recentGrid.innerHTML = '';
  for (const s of recent) recentGrid.appendChild(homeCard(s));

  const savedList = document.getElementById('home-saved-list')!;
  savedList.innerHTML = '';
  const byGroup = new Map<string, SessionProfile[]>();
  for (const s of sessions) {
    const key = s.groupId && groupNames.has(s.groupId) ? s.groupId : '';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(s);
    else byGroup.set(key, [s]);
  }
  const groupKeys = Array.from(byGroup.keys()).sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    return (groupNames.get(a) ?? '').localeCompare(groupNames.get(b) ?? '');
  });
  // A single ungrouped bucket needs no "Ungrouped" header to
  // distinguish it from anything.
  const showGroupHeads = !(groupKeys.length === 1 && groupKeys[0] === '');
  for (const key of groupKeys) {
    if (showGroupHeads) {
      const head = document.createElement('div');
      head.className = 'home-group-head';
      head.textContent = key ? `📁 ${groupNames.get(key)}` : 'Ungrouped';
      savedList.appendChild(head);
    }
    const inGroup = byGroup.get(key)!.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const s of inGroup) savedList.appendChild(homeSavedRow(s));
  }

  // SPE-105: the editor belongs on Home for the same reason sessions
  // do. Picking up the folder or file you had open yesterday is the
  // editor's version of reopening a connection, so it reads as one row
  // list rather than a button that starts from nothing.
  const editorFolders = loadRecentFolders();
  const editorFiles = loadRecentFiles();
  const editorList = document.getElementById('home-editor-list')!;
  editorList.innerHTML = '';
  document.getElementById('home-editor-section')!.style.display =
    editorFolders.length > 0 || editorFiles.length > 0 ? 'block' : 'none';
  for (const folder of editorFolders.slice(0, HOME_EDITOR_LIMIT)) {
    editorList.appendChild(homeEditorRow('\u{1F4C1}', folder, 'folder', () => {
      void openFolder(newEditorTabPane(), folder);
    }));
  }
  for (const path of editorFiles.slice(0, HOME_EDITOR_LIMIT)) {
    editorList.appendChild(homeEditorRow('\u{1F4C4}', path, 'file', () => {
      void openLocalFile(path, newEditorTabPane());
    }));
  }

  const chips = document.getElementById('home-shell-chips')!;
  chips.innerHTML = '';
  for (const p of shellProfiles) {
    const chip = document.createElement('div');
    chip.className = 'home-chip';
    chip.tabIndex = 0;
    chip.textContent = `${localShellProfileIcon(p.icon)} ${p.name}`;
    chip.onclick = () => launchLocalShellProfile(p);
    chip.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        launchLocalShellProfile(p);
      }
    };
    chips.appendChild(chip);
  }

  // Everything below runs after the awaits above, which matters:
  // switchToTab reaches this function during module evaluation (the
  // initial Home tab), and formatShortcut reads SHORTCUT_MOD, a const
  // declared further down the file. Awaiting first pushes this past the
  // end of module evaluation, clear of the temporal dead zone.
  renderHomeHints();
  renderHomeQuickResults();

  // Only claim focus if nothing else holds it. Home re-renders on every
  // session mutation, and stealing the caret mid-typing would be worse
  // than not autofocusing at all.
  if (homeIsActive()) {
    const input = document.getElementById('home-quick-connect') as HTMLInputElement;
    const focused = document.activeElement;
    if (!focused || focused === document.body) input.focus();
  }
}

document.getElementById('home-quick-connect')!.addEventListener('input', (e) => {
  homeQuickQuery = (e.target as HTMLInputElement).value;
  homeQcSelected = 0;
  renderHomeQuickResults();
});

document.getElementById('home-quick-connect')!.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (homeQcActions.length === 0) return;
    const step = e.key === 'ArrowDown' ? 1 : homeQcActions.length - 1;
    homeQcSelected = (Math.max(homeQcSelected, 0) + step) % homeQcActions.length;
    highlightHomeQcSelection();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const action = homeQcActions[homeQcSelected];
    if (action) runHomeQcAction(action);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    (e.target as HTMLInputElement).value = '';
    homeQuickQuery = '';
    homeQcSelected = -1;
    renderHomeQuickResults();
  }
});

// Two entry points on Home: the header button, always visible, and the
// one in the empty state for a first run with nothing saved yet.
for (const id of ['home-new-session-btn', 'home-new-session-top']) {
  document.getElementById(id)!.addEventListener('click', () => {
    ensurePendingTab();
    openSessionPicker();
  });
}

// --- Host key trust modal ---

// SPE-63: masked passphrase entry, replacing window.prompt() which has
// no password mode and showed the passphrase in cleartext on-screen
// while typing. Mirrors showTrustPrompt's modal pattern below.
// SPE-65: soft warning for a group/world-readable key file, real
// OpenSSH refuses to use one outright, Xpecter warns but lets the user
// proceed, since it's their key and Xpecter didn't create the file.
// SPE-101: one builder for the dialogs that are constructed in JS
// rather than declared in index.html. Each used to hardcode its own
// dark palette (#1e1e1e panel, #ddd text, #3a3a3a border), so all three
// rendered dark-on-dark for anyone using the light theme. They share
// the same tokenised .dialog styling as every declared dialog now, and
// pick up Escape and click-outside dismissal, which only the passphrase
// prompt previously had.
type DialogAction = {
  label: string;
  kind?: 'primary' | 'secondary' | 'danger' | 'warning';
  run: () => void;
};

function buildDialog(opts: {
  title: string;
  tone?: 'warning' | 'danger';
  fill: (body: HTMLDivElement) => void;
  actions: DialogAction[];
  onDismiss: () => void;
}) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay open';

  const dialog = document.createElement('div');
  dialog.className = 'dialog' + (opts.tone ? ` ${opts.tone}` : '');

  const head = document.createElement('div');
  head.className = 'dialog-head';
  const heading = document.createElement('strong');
  heading.textContent = opts.title;
  head.appendChild(heading);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const dismiss = () => {
    if (closed) return;
    close();
    opts.onDismiss();
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  const closeX = document.createElement('span');
  closeX.className = 'close';
  closeX.textContent = '✕';
  closeX.title = 'Cancel';
  closeX.onclick = dismiss;
  head.appendChild(closeX);

  const body = document.createElement('div');
  body.className = 'dialog-body';
  opts.fill(body);

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  for (const action of opts.actions) {
    const button = document.createElement('button');
    button.textContent = action.label;
    if (action.kind && action.kind !== 'primary') button.className = action.kind;
    button.onclick = () => {
      close();
      action.run();
    };
    actions.appendChild(button);
  }

  dialog.appendChild(head);
  dialog.appendChild(body);
  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) dismiss();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return { close };
}

// Label plus value on one line, with the value in a <code> chip. Built
// with textContent throughout: these dialogs display a hostname, a key
// type and a fingerprint that all arrive from the far end of a
// connection that has not been verified yet, and the trust prompt used
// to interpolate them straight into innerHTML. A hostile server could
// put markup in there and dress up the very dialog asking whether to
// trust it.
function dialogField(body: HTMLDivElement, label: string, value: string) {
  const line = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  const code = document.createElement('code');
  code.textContent = value;
  line.appendChild(strong);
  line.appendChild(code);
  body.appendChild(line);
}

function dialogText(body: HTMLDivElement, text: string, tone?: 'warn' | 'danger') {
  const para = document.createElement('p');
  if (tone) para.className = tone;
  para.textContent = text;
  body.appendChild(para);
}

// SPE-63: masked passphrase entry, replacing window.prompt() which has
// no password mode and showed the passphrase in cleartext on-screen
// while typing.
// SPE-65: soft warning for a group/world-readable key file, real
// OpenSSH refuses to use one outright, Xpecter warns but lets the user
// proceed, since it's their key and Xpecter didn't create the file.
function showKeyPermWarning(opts: { path: string; mode: string; onProceed: () => void; onCancel: () => void }) {
  buildDialog({
    title: 'Key file permissions are too open',
    tone: 'warning',
    onDismiss: opts.onCancel,
    fill: (body) => {
      dialogField(body, 'Path', opts.path);
      dialogField(body, 'Mode', opts.mode);
      dialogText(body, `This private key is readable by other users on this system. OpenSSH itself would refuse to use a key like this. You can proceed anyway, but consider running chmod 600 on ${opts.path}.`);
    },
    actions: [
      { label: 'Cancel', kind: 'secondary', run: opts.onCancel },
      { label: 'Use it anyway', kind: 'warning', run: opts.onProceed },
    ],
  });
}

function showPassphrasePrompt(opts: { onSubmit: (passphrase: string) => void; onCancel: () => void }) {
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'passphrase';
  input.style.cssText = 'width:100%;box-sizing:border-box;';

  const dialog = buildDialog({
    title: 'Encrypted key',
    onDismiss: opts.onCancel,
    fill: (body) => {
      dialogText(body, 'This private key is encrypted. Enter its passphrase to continue.');
      body.appendChild(input);
    },
    actions: [
      { label: 'Cancel', kind: 'secondary', run: opts.onCancel },
      { label: 'Continue', run: () => opts.onSubmit(input.value) },
    ],
  });

  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const passphrase = input.value;
    dialog.close();
    opts.onSubmit(passphrase);
  });
  input.focus();
}

function showTrustPrompt(opts: {
  host: string; fingerprint: string; keyType: string; changed: boolean;
  onAccept: () => void; onReject: () => void;
}) {
  buildDialog({
    title: opts.changed
      ? 'Host key has CHANGED — possible security risk'
      : 'Unknown host — verify before connecting',
    tone: opts.changed ? 'danger' : undefined,
    onDismiss: opts.onReject,
    fill: (body) => {
      dialogField(body, 'Host', opts.host);
      dialogField(body, 'Key type', opts.keyType);
      dialogField(body, 'Fingerprint', opts.fingerprint);
      if (opts.changed) {
        dialogText(body, 'This host previously presented a different key. This could mean the server was reinstalled — or that your connection is being intercepted. Only proceed if you are certain.', 'danger');
      } else {
        dialogText(body, 'Verify this fingerprint matches what the server administrator provided before trusting it.');
      }
    },
    actions: [
      { label: 'Cancel', kind: 'secondary', run: opts.onReject },
      opts.changed
        ? { label: 'I understand the risk — trust anyway', kind: 'danger' as const, run: opts.onAccept }
        : { label: 'Trust and connect', run: opts.onAccept },
    ],
  });
}

function showConnectError(message: string) {

  let el = document.getElementById('connect-error');

  if (!el) {

    el = document.createElement('div');

    el.id = 'connect-error';

    el.style.cssText = 'width:100%;color:var(--danger);font-size:12px;padding:2px 0;';

    document.getElementById('picker-ssh-fields')!.appendChild(el);

  }

  el.textContent = message;

}

function clearConnectError() {
  document.getElementById('connect-error')?.remove();
}

// --- Connect flow (targets the currently active pending tab) ---

// wireSSHEvents attaches the data/close listeners for a live SSH session
// and (re)installs the tab's reconnect closure, used both on first
// connect and after SPE-59's "R to restart session" action.
function wireSSHEvents(session: Session, sessionId: string, req: ConnectRequest) {
  runtime.EventsOn('ssh:data:' + sessionId, (data: unknown) => writeToTerminal(session, data as string));
  runtime.EventsOn('ssh:closed:' + sessionId, (payload: unknown) => {
    showDisconnectPanel(session, (payload as SessionClosedEvent).message);
  });
  session.reconnect = () => reconnectSSH(session, req);
}

// reconnectSSH re-runs Connect() on an already-live tab (as opposed to
// connectActiveTab, which targets a fresh pending tab and creates a new
// terminal). Reuses the existing terminal/container so scrollback from
// the dead session, including the disconnect message, stays visible.
// SPE-99: shown after a successful connect/reconnect that only worked
// via the automatic legacy-algorithm fallback. Not something the
// person requested or predicted in advance, an honest one-time notice
// so "connected automatically" never means "silently weaker security
// without you knowing."
function notifyLegacyCompat(host: string) {
  alert(`Connected to ${host} using legacy compatibility mode: this device only supports older SSH algorithms, so this connection uses reduced security compared to Xpecter's normal defaults.`);
}

async function reconnectSSH(session: Session, req: ConnectRequest): Promise<void> {
  session.status = 'connecting';
  renderTabBar();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    showDisconnectPanel(session, String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { reconnectSSH(session, { ...req, passphrase }); },
      onCancel: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { reconnectSSH(session, { ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await reconnectSSH(session, req);
      },
      onReject: () => showDisconnectPanel(session, 'Reconnect cancelled.'),
    });
    return;
  }

  if (result.sessionId) {
    session.backendId = result.sessionId;
    session.status = 'connected';
    renderTabBar();
    session.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
    wireSSHEvents(session, result.sessionId, req);
    // SPE-126: the easy case, the terminal this session is going back
    // into has been on screen all along, so its size is exact.
    const size = await measuredFit(session);
    try {
      await App.StartShellSSH(result.sessionId, size?.cols ?? 0, size?.rows ?? 0, !!req.x11);
    } catch (err) {
      showDisconnectPanel(session, String(err));
      return;
    }
    if (result.legacyCompat) notifyLegacyCompat(req.host);
  }
}

// SPE-92: connects into pendingPaneTarget if the New Session picker was
// opened via openSplitPanePicker (targets a specific split pane),
// otherwise into the active tab's own primary session, exactly as
// before this feature existed. Everything else (password cache,
// passphrase/trust/key-perm prompts, save-session prompt) is unchanged.
async function connectActiveTab(req: ConnectRequest) {
  const target: Session = pendingPaneTarget ?? tabs.get(activeTabId!)!;
  // SPE-128: one dial at a time per Session. The retry paths inside
  // runConnect (passphrase, key permissions, host trust) deliberately
  // re-enter through here, and still can: each of them returns out of
  // runConnect first, clearing the flag, and only then does the modal's
  // callback fire.
  if (target.connecting) return;
  target.connecting = true;
  setConnectButtonBusy(true);
  try {
    await runConnect(req);
  } finally {
    target.connecting = false;
    setConnectButtonBusy(false);
  }
}

// SPE-128: the picker's Connect button is dead space for the several
// seconds a connect takes, which is exactly what invites the second
// click the guard above now has to swallow. Say what it's doing.
function setConnectButtonBusy(busy: boolean) {
  const btn = document.getElementById('connect') as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'Connecting...' : 'Connect';
}

async function runConnect(req: ConnectRequest) {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.status = 'connecting';
  target.label = `${req.user}@${req.host}`;
  renderTabBar();
  clearConnectError();

  let result;
  try {
    result = await App.Connect(req);
  } catch (err) {
    target.status = 'disconnected';
    renderTabBar();
    showConnectError(String(err));
    return;
  }

  if (result.needsPassphrase) {
    showPassphrasePrompt({
      onSubmit: (passphrase) => { connectActiveTab({ ...req, passphrase }); },
      onCancel: () => { target.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsKeyPermConfirm) {
    showKeyPermWarning({
      path: result.keyPermPath!, mode: result.keyPermMode!,
      onProceed: () => { connectActiveTab({ ...req, ignoreKeyPermWarning: true }); },
      onCancel: () => { target.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.needsTrust) {
    showTrustPrompt({
      host: result.host!, fingerprint: result.fingerprint!, keyType: result.keyType!, changed: !!result.changed,
      onAccept: async () => {
        if (result.changed) await App.TrustHostDespiteChange(result.host!);
        else await App.TrustHost(result.host!);
        await connectActiveTab(req);
      },
      onReject: () => { target.status = 'disconnected'; renderTabBar(); },
    });
    return;
  }

  if (result.sessionId) {
    target.mode = 'ssh';
    target.status = 'connected';
    // SPE-126: backendId deliberately stays null until the shell is
    // actually open, a few lines down. It is the flag the rest of the
    // app reads as "this session is ready to be used", and switchToTab
    // acts on it immediately: it asks the file browser to list the
    // remote directory, which opens an SFTP channel on this very
    // connection. A Cisco switch allows one session channel at a time,
    // so that SFTP request took the only slot and the shell that
    // followed was refused with "ssh: rejected: resource shortage" -
    // every switch, first connect, every time, cleared by pressing R
    // because a reconnect doesn't switch tabs and so never raced.
    // Starting the shell inside Connect used to hide this by opening
    // the shell channel before the frontend knew the id at all.
    createTerminalForSession(target, ownerTab);
    wireSSHEvents(target, result.sessionId, req);
    // SPE-104: a second, independent connection to the same target for
    // the split menu's "Duplicate this session". Deliberately re-runs
    // Connect rather than opening another channel on this session, so
    // one dying doesn't take the other down with it.
    target.duplicate = async (pane) => {
      const previous = pendingPaneTarget;
      pendingPaneTarget = pane;
      skipSavePrompt = true;
      try {
        await connectActiveTab(req);
      } finally {
        pendingPaneTarget = previous;
      }
    };
    if (result.connectDurationMs) {
      target.term?.write(`\r\n\x1b[90mSSH connected in ${result.connectDurationMs} ms.\x1b[0m\r\n`);
    }
    // SPE-126: switch first, start the shell second. fit() can only
    // measure a pane that is actually on screen, and the PTY the remote
    // formats its output to is sized from that measurement, so the tab
    // has to be visible before the shell exists. Nothing is lost in the
    // meantime: wireSSHEvents above is already listening.
    switchToTab(ownerTab.id);
    closeSessionPicker();
    // 0 rather than a guess when the pane could not be measured: the
    // backend falls back to its own default instead of being told
    // something untrue.
    const size = await measuredFit(target);
    try {
      await App.StartShellSSH(result.sessionId, size?.cols ?? 0, size?.rows ?? 0, !!req.x11);
    } catch (err) {
      // Set even on failure: the session exists on the backend and
      // closing the tab has to be able to close it.
      target.backendId = result.sessionId;
      showDisconnectPanel(target, String(err));
      return;
    }
    // The shell has the channel it needs. Everything else that shares
    // this connection, the file browser included, can go now.
    target.backendId = result.sessionId;
    if (target === focusedSession(ownerTab)) refreshFileList('.', result.sessionId);
    if (result.legacyCompat) notifyLegacyCompat(req.host);

    if (!skipSavePrompt) {
      const name = `${req.user}@${req.host}`;
      if (confirm(`Save this session as "${name}"?`)) {
        await App.SaveSession({ id: '', name, host: req.host, port: req.port, user: req.user, keyPath: req.keyPath, useAgent: req.useAgent, internalAgent: req.internalAgent, x11: req.x11, deviceKind: currentDeviceKind() });
        renderSessionList();
      }
    }
    skipSavePrompt = false;
  }
}

document.getElementById('connect')!.addEventListener('click', async () => {
  const host = (document.getElementById('host') as HTMLInputElement).value;
  const user = (document.getElementById('user') as HTMLInputElement).value;
  const authMode = (document.querySelector('input[name="authmode"]:checked') as HTMLInputElement).value;
  // 22 unless Home's quick connect parsed an explicit port out of a
  // host:port entry (SPE-99).
  const port = pendingQuickPort ?? 22;

  let req: ConnectRequest;
  if (authMode === 'key') {
    const keyPath = (document.getElementById('keyPath') as HTMLInputElement).value;
    const passphrase = (document.getElementById('passphrase') as HTMLInputElement).value;
    const useAgent = (document.getElementById('use-ssh-agent') as HTMLInputElement).checked;
    const internalAgent = (document.getElementById('use-internal-agent') as HTMLInputElement).checked;
    const x11 = (document.getElementById('x11-toggle') as HTMLInputElement).checked;
    req = { host, port, user, keyPath, passphrase, useAgent, internalAgent, x11 };
  } else {
    const password = (document.getElementById('password') as HTMLInputElement).value;
    req = { host, port, user, password };
  }

  // SPE-92: the same session connectActiveTab just used, a split pane
  // if the picker was opened via openSplitPanePicker, otherwise the
  // active tab's own primary session, exactly as before this feature
  // existed.
  const connectedTarget: Session | undefined = pendingPaneTarget ?? tabs.get(activeTabId!);

  await connectActiveTab(req);

  if (authMode !== 'key') {

    if (connectedTarget && connectedTarget.status === 'connected') {

      const password = (document.getElementById('password') as HTMLInputElement).value;

      passwordCache.set(passwordCacheKey(host, 22, user), password);

    }

  }
  if (pendingSessionName) {

    if (connectedTarget) {

      connectedTarget.label = pendingSessionName;

      renderTabBar();

    }

    pendingSessionName = null;

  }
  // Bug fix: this used to unconditionally call closeSessionPicker()
  // here, but connectActiveTab legitimately returns early (still
  // "in progress" from the user's perspective) when it needs a
  // passphrase/trust/key-permission confirmation via a modal. Closing
  // the picker at that point yanked it shut mid-flow, before success
  // or failure was even known, silently hiding the eventual error
  // (showConnectError correctly wrote it into the picker's own DOM,
  // just inside a container the user could no longer see). Closing on
  // success now happens inside connectActiveTab itself, right where
  // success is actually determined, not here.
});

// SPE-31: pre-1809 Windows (and any other local-shell startup failure)
// must show a clear error, not fail silently. Previously this had no
// error handling at all, a rejected StartLocalTerminal() call (e.g.
// ConPty's ErrConPtyUnsupported on old Windows) left the tab stuck in
// 'pending' forever with zero feedback, not a crash, but just as
// confusing for a first impression. Creates the terminal container up
// front so there's always somewhere to show the message, reuses the
// same disconnect panel SPE-59 built rather than a separate error UI.
async function startLocalShellInActiveTab(shell: string, label: string, dir = '') {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.label = label;
  target.mode = 'local';
  createTerminalForSession(target, ownerTab);
  switchToTab(ownerTab.id);

  // Measured before the shell is spawned so the PTY is born the right
  // width. Without this the shell comes up at ConPTY's 80-column
  // default while the terminal draws TERMINAL_COLS, and lays every
  // redraw out against a width the screen doesn't have: a long or
  // multi-line command wraps where the shell thinks column 80 is and
  // overwrites its own prompt. Null when the pane isn't measurable yet,
  // which the backend answers with its own sensible default rather than
  // the library's.
  const initial = await measuredFit(target);

  let id: string;
  try {
    id = await App.StartLocalTerminal(shell, dir, initial?.cols ?? 0, initial?.rows ?? 0);
  } catch (err) {
    showDisconnectPanel(target, String(err));
    return;
  }

  target.backendId = id;
  target.status = 'connected';
  // syncSessionSize is what normally tells a backend its size, but every
  // earlier call this session made returned at the !backendId guard
  // above, because the id only exists now. Without this a local shell
  // kept whatever size it was spawned at until an unrelated tab switch
  // or window resize happened to correct it.
  syncSessionSize(target);
  // SPE-104: same shell, same starting directory, its own process.
  target.duplicate = async (pane) => {
    const previous = pendingPaneTarget;
    pendingPaneTarget = pane;
    try {
      await startLocalShellInActiveTab(shell, label, dir);
    } finally {
      pendingPaneTarget = previous;
    }
  };
  renderTabBar();
  runtime.EventsOn('local:data:' + id, (data: unknown) => writeToTerminal(target, data as string));
}

async function newLocalShellTab(shell: string, label: string, dir = '') {
  // SPE-92: always targets the fresh tab just created here, not a
  // pendingPaneTarget left over from an earlier split (this entry
  // point doesn't go through the session picker, the one place that
  // normally resets it).
  pendingPaneTarget = null;
  const tab = createPendingTab();
  switchToTab(tab.id);
  await startLocalShellInActiveTab(shell, label, dir);
}

async function newMoshSession() {
  const target = prompt('Mosh target (user@host):');
  if (!target?.trim()) return;
  const normalized = target.trim();
  await newLocalShellTab(`mosh ${normalized}`, `Mosh ${normalized}`);
}

async function newTelnetSession() {
  const host = prompt('Telnet host:');
  if (!host?.trim()) return;
  const port = Number(prompt('Telnet port:', '23'));
  if (!port) return;
  await newLocalShellTab(`telnet ${host.trim()} ${port}`, `Telnet ${host.trim()}`);
}

async function newLocalForward() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  const session = tab ? focusedSession(tab) : null;
  if (!session || session.mode !== 'ssh' || !session.backendId) {
    alert('Open an SSH session before creating a port forward.');
    return;
  }
  const localPort = Number(prompt('Local port:'));
  const remoteHost = prompt('Remote host (from the SSH server):', '127.0.0.1');
  const remotePort = Number(prompt('Remote port:'));
  if (!localPort || !remoteHost || !remotePort) return;
  try {
    const id = await App.StartLocalForward(session.backendId, localPort, remoteHost, remotePort);
    alert(`Forward active: 127.0.0.1:${localPort} -> ${remoteHost}:${remotePort}\nID: ${id}`);
  } catch (err) {
    alert(`Could not start port forward: ${err}`);
  }
}

// SPE: lets a local shell start somewhere other than Xpecter's own
// working directory. A native folder picker rather than a free-text
// path field, avoids typos and matches the existing SelectKeyFile/
// SelectAnyFile pattern. Cancelling the picker just skips launching,
// rather than falling back to the default silently, the person asked
// for a specific directory and getting a different one without any
// signal would be more confusing than nothing happening.
async function newLocalShellInDirectory() {
  const dir = await App.SelectDirectory();
  if (!dir) return;
  const label = dir.split(/[\\/]/).filter(Boolean).pop() || dir;
  await newLocalShellTab('', label, dir);
}

// wireSerialEvents mirrors wireSSHEvents for serial console sessions,
// the direct-hardware-console analogue of a dropped SSH session (SPE-59).
function wireSerialEvents(session: Session, id: string, portName: string, baud: number) {
  runtime.EventsOn('serial:data:' + id, (data: unknown) => writeToTerminal(session, data as string));
  runtime.EventsOn('serial:closed:' + id, (payload: unknown) => {
    showDisconnectPanel(session, (payload as SessionClosedEvent).message);
  });
  session.reconnect = () => reconnectSerial(session, portName, baud);
}

async function reconnectSerial(session: Session, portName: string, baud: number): Promise<void> {
  session.status = 'connecting';
  renderTabBar();
  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    showDisconnectPanel(session, String(err));
    return;
  }
  session.backendId = id;
  session.status = 'connected';
  renderTabBar();
  session.term!.write('\r\n\x1b[32mReconnected.\x1b[0m\r\n');
  wireSerialEvents(session, id, portName, baud);
}

// Same bug class as the SSH connect flow above and SPE-31's local-shell
// fix: no error handling at all previously, and the picker was closed
// before this even ran, so a bad port left the user with zero feedback
// anywhere. Now shows the error via showConnectError (picker stays
// open, matching the SSH flow) rather than an unhandled rejection.
// SPE-92: targets pendingPaneTarget (a split pane) if set, otherwise
// the active tab's own primary session, same pattern as connectActiveTab.
async function connectSerialInActiveTab(portName: string, baud: number) {
  const ownerTab = tabs.get(activeTabId!)!;
  const target: Session = pendingPaneTarget ?? ownerTab;
  target.label = portName;

  // SPE-128: the same one-dial-at-a-time guard the SSH path needs, for
  // the same reason: the tab stays 'pending' for the whole open, so a
  // second click put a second serial terminal in this same pane.
  if (target.connecting) return;
  target.connecting = true;

  let id: string;
  try {
    id = await App.ConnectSerial(portName, baud);
  } catch (err) {
    target.connecting = false;
    showConnectError(String(err));
    return;
  }
  target.connecting = false;

  target.mode = 'serial';
  target.backendId = id;
  target.status = 'connected';
  createTerminalForSession(target, ownerTab);
  wireSerialEvents(target, id, portName, baud);
  switchToTab(ownerTab.id);
  closeSessionPicker();

  if (!skipSerialSavePrompt) {
    if (confirm(`Save this serial session as "${portName}"?`)) {
      await App.SaveSession({ id: '', name: portName, type: 'serial', serialPort: portName, baud });
      renderSessionList();
    }
  }
  skipSerialSavePrompt = false;
}



function checkCapsLock(e: KeyboardEvent) {

  const isCapsOn = e.getModifierState && e.getModifierState('CapsLock');

  document.getElementById('caps-lock-warning')!.style.display = isCapsOn ? 'block' : 'none';

}

document.addEventListener('keydown', checkCapsLock);

document.addEventListener('keydown', (e) => {
  // Global fallback for when no terminal has focus (the "No session
  // yet" landing screen, sidebar search box, etc.), the per-terminal
  // version above only fires while an xterm instance actually has
  // focus. Same Ctrl+Shift+B, not plain Ctrl+B (tmux's prefix key).
  if (shortcutMatches(e, 'sidebar')) {
    e.preventDefault();
    toggleSidebar();
  }
  // SPE-77 zoom, same global-fallback reasoning.
  if (shortcutMatches(e, 'zoomIn')) {
    e.preventDefault();
    zoomBy(1);
  }
  if (shortcutMatches(e, 'zoomOut')) {
    e.preventDefault();
    zoomBy(-1);
  }
  if (shortcutMatches(e, 'resetZoom')) {
    e.preventDefault();
    applyFontSize(FONT_SIZE_DEFAULT);
  }
  if (shortcutMatches(e, 'fullscreen')) {
    e.preventDefault();
    toggleFullscreen();
  }
});

document.getElementById('font-size-select')!.addEventListener('change', (e) => {
  applyFontSize(Number((e.target as HTMLSelectElement).value));
});

document.addEventListener('keyup', checkCapsLock);

document.getElementById('password')!.addEventListener('focus', () => {

  // Chrome/WebKit don't expose getModifierState on a plain focus event,

  // so send a synthetic check on the next keydown; also immediately hide

  // any stale warning left over from before this field was focused.

  document.getElementById('caps-lock-warning')!.style.display = 'none';

});



document.getElementById('picker-ssh-fields')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('connect')!.click();
  }
});

document.getElementById('browse-key')!.addEventListener('click', async () => {
  const path = await App.SelectKeyFile();
  if (path) (document.getElementById('keyPath') as HTMLInputElement).value = path;
});

const authRadios = document.querySelectorAll('input[name="authmode"]') as NodeListOf<HTMLInputElement>;
authRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    const isKey = radio.value === 'key' && radio.checked;
    document.getElementById('auth-password-fields')!.style.display = isKey ? 'none' : 'inline';
    document.getElementById('auth-key-fields')!.style.display = isKey ? 'inline' : 'none';
  });
});

// --- Init: start with one pending tab, or a local shell rooted at the
// launch directory (SPE-86: Windows Explorer's "Open in Xpecter") ---
// SPE-100: all three sidebar sections collapse the same way and
// remember their state, replacing the one-off Remote-files toggle that
// hand-edited its own label text.
type SidebarSection = 'sessions' | 'shells' | 'folders' | 'files';

function loadCollapsedSections(): Set<SidebarSection> {
  try {
    const parsed = JSON.parse(localStorage.getItem('xpecter-sidebar-sections') || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

const collapsedSections = loadCollapsedSections();

function applySidebarSections() {
  document.querySelectorAll('#sidebar .side-section').forEach((el) => {
    const section = (el as HTMLElement).dataset.section as SidebarSection | undefined;
    if (!section) return;
    const isCollapsed = collapsedSections.has(section);
    el.classList.toggle('collapsed', isCollapsed);
    const chev = el.querySelector('.side-head .chev');
    if (chev) chev.textContent = isCollapsed ? '▸' : '▾';
  });
}

document.querySelectorAll('#sidebar .side-head').forEach((head) => {
  head.addEventListener('click', () => {
    const section = (head.parentElement as HTMLElement | null)?.dataset.section as SidebarSection | undefined;
    if (!section) return;
    if (collapsedSections.has(section)) collapsedSections.delete(section);
    else collapsedSections.add(section);
    localStorage.setItem('xpecter-sidebar-sections', JSON.stringify(Array.from(collapsedSections)));
    applySidebarSections();
  });
});

// Header buttons sit inside the header, which toggles the section, so
// each has to stop its click from reaching it.
function wireSidebarHeaderAction(id: string, run: () => void) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    run();
  });
}

wireSidebarHeaderAction('sidebar-new-session', () => {
  ensurePendingTab();
  openSessionPicker();
});
wireSidebarHeaderAction('sidebar-new-folder', () => { createNewFolder(); });
wireSidebarHeaderAction('folder-add-btn', () => { void pinFolder(); });
wireSidebarHeaderAction('sidebar-collapse-btn', toggleSidebar);

// The remote browser's header creates in whichever directory it is
// currently showing, the way the editor tree's header creates at the
// workspace root.
function withRemoteSession(run: (id: string) => void) {
  if (!currentRemoteSessionId) {
    flashStatus('Connect to a host first', true);
    return;
  }
  run(currentRemoteSessionId);
}
wireSidebarHeaderAction('remote-new-file', () => {
  withRemoteSession((id) => { void createInRemote(id, currentRemotePath, 'file'); });
});
wireSidebarHeaderAction('remote-new-folder', () => {
  withRemoteSession((id) => { void createInRemote(id, currentRemotePath, 'folder'); });
});
wireSidebarHeaderAction('remote-refresh', () => {
  withRemoteSession((id) => { void refreshFileList(currentRemotePath, id); });
});

applySidebarSections();

const initialTab = createHomeTab();
switchToTab(initialTab.id);
// GetStartupDir() resolves near-instantly (it's a field read, no real
// I/O), but is still async over the Wails bridge, so the empty pending
// tab above renders first either way and this just fills it in a beat
// later. Folder name alone as the tab label (not the full path), same
// brevity as every other tab label in this app.
App.GetStartupDir().then((dir) => {
  if (dir) {
    const label = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
    const tab = createPendingTab();
    switchToTab(tab.id);
    startLocalShellInActiveTab('', label, dir);
  }
});
// SPE-100: the old handler re-fetched every session AND every group
// from the backend on each keystroke. Debounced, and it now drives the
// shell list too, since one field filters the whole panel.
let sidebarSearchTimer: ReturnType<typeof setTimeout> | null = null;

document.getElementById('session-search')!.addEventListener('input', (e) => {
  sessionSearchQuery = (e.target as HTMLInputElement).value;
  sidebarSelected = -1;
  if (sidebarSearchTimer) clearTimeout(sidebarSearchTimer);
  sidebarSearchTimer = setTimeout(() => {
    sidebarSearchTimer = null;
    renderSessionList();
  }, 120);
});

document.getElementById('session-search')!.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moveSidebarSelection(e.key === 'ArrowDown' ? 1 : -1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const rows = sidebarRows();
    const row = sidebarSelected >= 0 ? rows[sidebarSelected] : rows[0];
    row?.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    (e.target as HTMLInputElement).value = '';
    sessionSearchQuery = '';
    sidebarSelected = -1;
    renderSessionList();
  }
});


const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
themeSelect.value = currentTheme();
applyTheme(currentTheme());
themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value as ThemeName);
});

// SPE-98: one-click toggle in the title bar, alongside applyTheme,
// keeping the Settings dropdown in sync so neither path shows a stale
// value if the other one was used most recently.
function toggleThemeQuick() {
  const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  themeSelect.value = next;
}
document.getElementById('theme-toggle-btn')!.addEventListener('click', toggleThemeQuick);

// SPE-61: terminal color scheme, font, and wallpaper. Loaded from the
// backend-persisted settings.json (loadSettingsAndApply), independent
// of the dark/light UI toggle above once the user explicitly picks one.
const colorSchemeSelect = document.getElementById('colorscheme-select') as HTMLSelectElement;
colorSchemeSelect.addEventListener('change', () => {
  applyColorScheme(colorSchemeSelect.value as ColorScheme);
});

const fontSelect = document.getElementById('font-select') as HTMLSelectElement;
fontSelect.addEventListener('change', () => {
  applyFont(fontSelect.value);
});

document.getElementById('wallpaper-browse')!.addEventListener('click', async () => {
  const path = await App.SelectImageFile();
  if (!path) return;
  await setWallpaper(path);
});

const wallpaperOpacitySlider = document.getElementById('wallpaper-opacity') as HTMLInputElement;
wallpaperOpacitySlider.addEventListener('input', () => {
  appSettings.wallpaperOpacity = Number(wallpaperOpacitySlider.value) / 100;
  applyWallpaperVisual();
});
wallpaperOpacitySlider.addEventListener('change', () => {
  App.SaveSettings(appSettings);
});

document.getElementById('wallpaper-clear')!.addEventListener('click', () => {
  clearWallpaper();
});

loadSettingsAndApply();

// Check-for-updates (not auto-update): one GitHub releases API check on
// launch, dismissible per-version so it doesn't nag every time once
// acknowledged, re-appears if a further newer version comes out later.
// manual=true (from the Settings menu item) always shows a result, even
// "you're up to date", and ignores any prior dismissal, since an
// explicit click should never appear to do nothing.
async function checkForUpdate(manual = false) {
  let info: UpdateInfo;
  try {
    info = await App.CheckForUpdate();
  } catch (err) {
    if (manual) alert(`Could not check for updates: ${err}`);
    return;
  }
  if (!info.available) {
    if (manual) alert(`You're up to date (${info.currentVersion}).`);
    return;
  }
  if (!manual && localStorage.getItem('xpecter-update-dismissed') === info.latestVersion) return;

  const banner = document.getElementById('update-banner')!;
  document.getElementById('update-banner-text')!.textContent =
    `A new version of Xpecter is available: ${info.latestVersion} (you're on ${info.currentVersion})`;
  banner.style.display = 'flex';

  const downloadBtn = document.getElementById('update-banner-download') as HTMLButtonElement;
  downloadBtn.textContent = 'Download';
  downloadBtn.disabled = false;
  downloadBtn.addEventListener('click', async () => {
    if (!info.assetUrl) {
      // No matching asset found for this platform (shouldn't normally
      // happen, but a real release could legitimately be missing one,
      // exactly like the NSIS installer did once tonight). Fall back to
      // the browser rather than doing nothing.
      runtime.BrowserOpenURL(info.releaseUrl);
      return;
    }
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading\u2026';
    try {
      await App.DownloadAndInstallUpdate(info.assetUrl);
      downloadBtn.textContent = 'Downloaded';
      // On Windows this is genuinely done, the installer is now open on
      // top of Xpecter. On macOS/Linux, a file manager window just
      // opened showing the extracted files, there's no single-file
      // "launch" without a real installer format.
    } catch (err) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = 'Download';
      alert(`Update download failed: ${err}\n\nYou can also grab it manually from the releases page.`);
    }
  });
  document.getElementById('update-banner-dismiss')!.addEventListener('click', () => {
    localStorage.setItem('xpecter-update-dismissed', info.latestVersion);
    banner.style.display = 'none';
  });
}
checkForUpdate();

App.GetVersion().then((v) => {
  document.getElementById('menu-version')!.textContent = v === 'dev' ? '(dev build)' : v;
});
document.getElementById('menu-check-updates')!.addEventListener('click', () => {
  closeAllMenus();
  checkForUpdate(true);
});

const osc52Toggle = document.getElementById('osc52-toggle') as HTMLInputElement;
osc52Toggle.checked = osc52Enabled;
osc52Toggle.addEventListener('change', () => {
  osc52Enabled = osc52Toggle.checked;
  localStorage.setItem('xpecter-osc52', osc52Enabled ? 'on' : 'off');
});

const copyOnSelectToggle = document.getElementById('copy-on-select-toggle') as HTMLInputElement;
copyOnSelectToggle.checked = copyOnSelectEnabled;
copyOnSelectToggle.addEventListener('change', () => {
  copyOnSelectEnabled = copyOnSelectToggle.checked;
  localStorage.setItem('xpecter-copy-on-select', copyOnSelectEnabled ? 'on' : 'off');
});

const rclickPasteToggle = document.getElementById('rclick-paste-toggle') as HTMLInputElement;
rclickPasteToggle.checked = rightClickPasteEnabled;
rclickPasteToggle.addEventListener('change', () => {
  rightClickPasteEnabled = rclickPasteToggle.checked;
  localStorage.setItem('xpecter-rclick-paste', rightClickPasteEnabled ? 'on' : 'off');
});

const warnMultilinePasteToggle = document.getElementById('warn-multiline-paste-toggle') as HTMLInputElement;
warnMultilinePasteToggle.checked = warnMultilinePasteEnabled;
warnMultilinePasteToggle.addEventListener('change', () => {
  warnMultilinePasteEnabled = warnMultilinePasteToggle.checked;
  localStorage.setItem('xpecter-warn-multiline-paste', warnMultilinePasteEnabled ? 'on' : 'off');
});

// SPE-79: unlike the toggles above, this one lives in the Go-backed
// config.Settings (App.SaveSettings), not localStorage, since Connect()
// needs to read it fresh from settings.json at connect time, not just
// the frontend's own in-memory state.
const keepaliveToggle = document.getElementById('ssh-keepalive-toggle') as HTMLInputElement;
keepaliveToggle.addEventListener('change', () => {
  appSettings.sshKeepaliveDisabled = !keepaliveToggle.checked;
  App.SaveSettings(appSettings);
});

const keepOpenToggle = document.getElementById('keep-open-last-tab-toggle') as HTMLInputElement;
keepOpenToggle.addEventListener('change', () => {
  appSettings.keepOpenOnLastTab = keepOpenToggle.checked;
  App.SaveSettings(appSettings);
});

document.getElementById('session-log-browse')!.addEventListener('click', async () => {
  const directory = await App.SelectDirectory();
  if (!directory) return;
  appSettings.sessionLogDirectory = directory;
  await App.SaveSettings(appSettings);
  document.getElementById('session-log-clear-row')!.style.display = 'block';
});

document.getElementById('session-log-clear')!.addEventListener('click', async () => {
  appSettings.sessionLogDirectory = '';
  await App.SaveSettings(appSettings);
  document.getElementById('session-log-clear-row')!.style.display = 'none';
});

document.getElementById('menu-reset-settings')!.addEventListener('click', async () => {
  closeAllMenus();
  if (!confirm('Reset all settings to defaults? Saved sessions will not be changed.')) return;
  for (const key of [
    'xpecter-theme',
    'xpecter-osc52',
    'xpecter-copy-on-select',
    'xpecter-rclick-paste',
    'xpecter-warn-multiline-paste',
    'xpecter-show-tab-numbers',
    'xpecter-highlight',
    'xpecter-command-snippets',
    'xpecter-shortcuts',
  ]) {
    localStorage.removeItem(key);
  }
  osc52Enabled = false;
  copyOnSelectEnabled = false;
  rightClickPasteEnabled = true;
  warnMultilinePasteEnabled = true;
  showTabNumbersEnabled = false;
  highlightEnabled = true;
  commandSnippets = [];
  shortcuts = { ...DEFAULT_SHORTCUTS };
  appSettings = {};
  await App.SaveSettings(appSettings);
  await loadSettingsAndApply();
  (document.getElementById('osc52-toggle') as HTMLInputElement).checked = false;
  (document.getElementById('copy-on-select-toggle') as HTMLInputElement).checked = false;
  (document.getElementById('rclick-paste-toggle') as HTMLInputElement).checked = true;
  (document.getElementById('warn-multiline-paste-toggle') as HTMLInputElement).checked = true;
  (document.getElementById('keep-open-last-tab-toggle') as HTMLInputElement).checked = false;
  (document.getElementById('show-tab-numbers-toggle') as HTMLInputElement).checked = false;
  (document.getElementById('highlight-toggle') as HTMLInputElement).checked = true;
  applyTheme('dark');
});

const showTabNumbersToggle = document.getElementById('show-tab-numbers-toggle') as HTMLInputElement;
showTabNumbersToggle.checked = showTabNumbersEnabled;
showTabNumbersToggle.addEventListener('change', () => {
  showTabNumbersEnabled = showTabNumbersToggle.checked;
  localStorage.setItem('xpecter-show-tab-numbers', showTabNumbersEnabled ? 'on' : 'off');
  renderTabBar();
});

const highlightToggle = document.getElementById('highlight-toggle') as HTMLInputElement;
highlightToggle.checked = highlightEnabled;
highlightToggle.addEventListener('change', () => {
  highlightEnabled = highlightToggle.checked;
  localStorage.setItem('xpecter-highlight', highlightEnabled ? 'on' : 'off');
});

document.getElementById('menu-manage-snippets')!.addEventListener('click', () => {
  closeAllMenus();
  manageCommandSnippets();
});
renderCommandSnippetsMenu();

// --- Local shell profiles (SPE-102) ---

function localShellProfileIcon(icon?: string): string {
  switch (icon) {
    case 'powershell': return '\ud83d\udd37';
    case 'cmd': return '\u2b1b';
    case 'wsl': return '\ud83d\udc27';
    default: return '>_';
  }
}

// SPE-92: same targeting rule as useSSHSession/useSerialSession above,
// launches into the focused pane if the active tab is split and that
// pane is empty, otherwise a plain new tab exactly as before.
async function launchLocalShellProfile(p: LocalShellProfile) {
  const paneTarget = targetEmptyFocusedPane();
  if (paneTarget) {
    pendingPaneTarget = paneTarget;
    await startLocalShellInActiveTab(p.command, p.tabTitle || p.name, p.startingDir || '');
  } else {
    await newLocalShellTab(p.command, p.tabTitle || p.name, p.startingDir || '');
  }
}

async function renderLocalShellProfileList() {
  const profiles = await App.ListLocalShellProfiles();
  const list = document.getElementById('local-shell-profile-list')!;
  list.innerHTML = '';

  // The filter field covers the whole panel, not just the Sessions
  // section, so a search that matches nothing here empties this list too
  // rather than leaving stale rows sitting under a filtered tree.
  const query = sessionSearchQuery.trim().toLowerCase();
  const visible = query
    ? profiles.filter((p) => p.name.toLowerCase().includes(query) || (p.command ?? '').toLowerCase().includes(query))
    : profiles;

  const countEl = document.getElementById('shells-count')!;
  countEl.textContent = String(profiles.length);

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-empty';
    empty.textContent = query ? 'No shells match.' : 'No shell profiles yet.';
    list.appendChild(empty);
    return;
  }

  for (const profile of visible) {
    const row = document.createElement('div');
    row.className = 'side-row';
    row.tabIndex = -1;
    row.title = profile.command ? `${profile.name} — ${profile.command}` : profile.name;

    const icon = document.createElement('span');
    icon.className = 'side-dot';
    icon.style.cssText = 'box-shadow:none;background:transparent;width:auto;height:auto;font-size:10px;line-height:1;';
    icon.textContent = localShellProfileIcon(profile.icon);
    row.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = profile.name;
    row.appendChild(name);

    const edit = document.createElement('span');
    edit.className = 'act neutral';
    edit.textContent = '✎';
    edit.title = 'Edit';
    edit.onclick = (e) => {
      e.stopPropagation();
      openLocalShellProfileEditor(profile);
    };
    row.appendChild(edit);

    const del = document.createElement('span');
    del.className = 'act';
    del.textContent = '✕';
    del.title = 'Delete';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete shell profile "${profile.name}"?`)) return;
      await App.DeleteLocalShellProfile(profile.id);
      renderLocalShellProfileList();
      renderLocalShellProfilesMenu();
    };
    row.appendChild(del);

    row.onclick = () => launchLocalShellProfile(profile);
    list.appendChild(row);
  }
}
async function renderLocalShellProfilesMenu() {
  const profiles = await App.ListLocalShellProfiles();
  const container = document.getElementById('menu-local-shell-profiles')!;
  container.innerHTML = '';
  for (const p of profiles) {
    const item = document.createElement('div');
    item.className = 'item';
    item.textContent = localShellProfileIcon(p.icon) + ' ' + p.name;
    item.onclick = () => {
      closeAllMenus();
      launchLocalShellProfile(p);
    };
    container.appendChild(item);
  }
}

// Handles both "New" (profile undefined) and "Edit" (profile passed).
// Save/Cancel/close/browse handlers are reassigned via .onclick rather
// than addEventListener each open, so repeated opens don't accumulate
// duplicate handlers.
function openLocalShellProfileEditor(profile?: LocalShellProfile) {
  const overlay = document.getElementById('lsp-editor-overlay')!;
  const title = document.getElementById('lsp-editor-title')!;
  const nameInput = document.getElementById('lsp-name') as HTMLInputElement;
  const commandInput = document.getElementById('lsp-command') as HTMLInputElement;
  const dirInput = document.getElementById('lsp-dir') as HTMLInputElement;
  const iconSelect = document.getElementById('lsp-icon') as HTMLSelectElement;
  const tabTitleInput = document.getElementById('lsp-tabtitle') as HTMLInputElement;

  title.textContent = profile ? 'Edit local shell profile' : 'New local shell profile';
  nameInput.value = profile?.name ?? '';
  commandInput.value = profile?.command ?? '';
  dirInput.value = profile?.startingDir ?? '';
  iconSelect.value = profile?.icon ?? '';
  tabTitleInput.value = profile?.tabTitle ?? '';

  overlay.classList.add('open');

  const close = () => overlay.classList.remove('open');

  (document.getElementById('lsp-browse-dir') as HTMLButtonElement).onclick = async () => {
    const dir = await App.SelectDirectory();
    if (dir) dirInput.value = dir;
  };

  (document.getElementById('lsp-save') as HTMLButtonElement).onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    await App.SaveLocalShellProfile({
      id: profile?.id ?? '',
      name,
      command: commandInput.value.trim(),
      startingDir: dirInput.value,
      icon: iconSelect.value,
      tabTitle: tabTitleInput.value.trim(),
    });
    close();
    renderLocalShellProfileList();
    renderLocalShellProfilesMenu();
  };

  (document.getElementById('lsp-cancel') as HTMLButtonElement).onclick = close;
  (document.getElementById('lsp-editor-close') as HTMLSpanElement).onclick = close;
}

document.getElementById('lsp-add-btn')!.addEventListener('click', (e) => {
  e.stopPropagation();
  openLocalShellProfileEditor();
});
document.getElementById('lsp-editor-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('lsp-editor-overlay')) {
    document.getElementById('lsp-editor-overlay')!.classList.remove('open');
  }
});

// --- Menu bar ---

function closeAllMenus() {
  document.querySelectorAll('#menubar .menu-dropdown').forEach((el) => el.classList.remove('open'));
  document.querySelectorAll('#menubar .menu-item').forEach((el) => el.classList.remove('open'));
}

document.querySelectorAll('#menubar .menu-item').forEach((item) => {
  // SPE-101: a menubar entry can now open a dialog instead of owning a
  // dropdown (Settings does), so the dropdown lookup has to tolerate
  // not finding one rather than assert it away.
  const dropdown = item.querySelector('.menu-dropdown') as HTMLElement | null;
  const opensDialog = (item as HTMLElement).dataset.opens;

  item.addEventListener('mouseenter', () => {
    if (!dropdown) return;
    const anyMenuOpen = document.querySelector('#menubar .menu-dropdown.open');
    if (!anyMenuOpen || dropdown.classList.contains('open')) return;
    closeAllMenus();
    dropdown.classList.add('open');
    item.classList.add('open');
  });
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    if (opensDialog) {
      closeAllMenus();
      document.getElementById(opensDialog)?.classList.add('open');
      return;
    }
    if (!dropdown) return;
    const wasOpen = dropdown.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) {
      dropdown.classList.add('open');
      item.classList.add('open');
    }
  });
});

// Settings is a dialog now, so it needs the dismissal the dropdown got
// for free from the document-level menu close.
const settingsOverlay = document.getElementById('settings-overlay')!;
function closeSettingsDialog() {
  settingsOverlay.classList.remove('open');
}
document.getElementById('settings-close')!.addEventListener('click', closeSettingsDialog);
settingsOverlay.addEventListener('mousedown', (e) => {
  if (e.target === settingsOverlay) closeSettingsDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) closeSettingsDialog();
});
// Anything that opens a file picker, swaps configuration or restarts a
// flow reads better with the panel out of the way first.
settingsOverlay.querySelectorAll('.settings-action').forEach((action) => {
  action.addEventListener('click', closeSettingsDialog);
});

// Bug fix: clicking anything inside an open dropdown (a <select>, a
// checkbox, the wallpaper Browse button) bubbled up to the document-level
// closeAllMenus() listener below and closed the whole panel immediately,
// only the .menu-item click (opening it) was protected with
// stopPropagation, not the dropdown's own contents. Apparently invisible
// on Linux/WebKitGTK's native <select> popup timing, but immediately
// visible on Windows/WebView2, reported as dropdowns "disappearing
// immediately" there.
document.querySelectorAll('#menubar .menu-dropdown').forEach((dropdown) => {
  dropdown.addEventListener('click', (e) => e.stopPropagation());
});

// Frameless window (no OS title bar): #menubar doubles as the title bar
// via --wails-draggable:drag in CSS, these are the real window controls.
document.getElementById('win-minimize')!.addEventListener('click', () => {
  runtime.WindowMinimise();
});
document.getElementById('win-maximize')!.addEventListener('click', () => {
  runtime.WindowToggleMaximise();
});
document.getElementById('win-close')!.addEventListener('click', () => {
  void quitWithUnsavedCheck();
});

// SPE-103: closing the window bypasses closeTab entirely, so it asks
// about every unsaved buffer itself. Silent when there are none, which
// is the ordinary case.
async function quitWithUnsavedCheck() {
  for (const tab of tabs.values()) {
    for (const session of allSessions(tab)) {
      const pane = editorPanes.get(session.id);
      if (!pane?.docIds.some((docId) => editorDocs.get(docId)?.dirty)) continue;
      // Only surfaced for an editor that actually has something to
      // lose: quitting a clean one should not tab-hop on the way out.
      switchToTab(tab.id);
      if (!(await confirmCloseEditorSession(session))) return;
    }
  }
  runtime.Quit();
}
document.getElementById('titlebar-spacer')!.addEventListener('dblclick', () => {
  runtime.WindowToggleMaximise();
});

document.addEventListener('click', () => closeAllMenus());

// Terminal menu
document.getElementById('menu-new-window')!.addEventListener('click', async () => {
  closeAllMenus();
  try {
    await App.OpenNewWindow();
  } catch (err) {
    alert(`Could not open a new window: ${err}`);
  }
});
document.getElementById('menu-new-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = createPendingTab();
  switchToTab(tab.id);
});
document.getElementById('menu-new-local-shell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Local shell');
});
document.getElementById('menu-new-mosh')!.addEventListener('click', () => {
  closeAllMenus();
  newMoshSession();
});
document.getElementById('menu-new-telnet')!.addEventListener('click', () => {
  closeAllMenus();
  newTelnetSession();
});
document.getElementById('menu-new-local-forward')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalForward();
});
document.getElementById('menu-new-local-shell-in-dir')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellInDirectory();
});
document.getElementById('menu-manage-local-shell-profiles')!.addEventListener('click', () => {
  closeAllMenus();
  openLocalShellProfileEditor();
});
document.getElementById('menu-close-tab')!.addEventListener('click', () => {
  closeAllMenus();
  if (activeTabId) closeTab(activeTabId);
});
document.getElementById('menu-disconnect-tab')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (tab) disconnectSession(focusedSession(tab));
});
// SPE-124: writes the focused pane's scrollback wherever the Save
// dialog is pointed. Deliberately the focused pane rather than the tab
// itself: in a split, "the terminal" means the one being looked at.
document.getElementById('menu-save-output')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab) return;
  void saveSessionOutput(focusedSession(tab));
});

document.getElementById('menu-clear-screen')!.addEventListener('click', async () => {
  closeAllMenus();
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab) return;
  const session = focusedSession(tab);
  // Bug: term.clear() only wipes xterm.js's own rendered buffer, it
  // never reaches the shell or, on Windows, ConPTY. ConPTY maintains
  // its own screen-buffer state (that's its whole job, translating the
  // legacy Win32 console API to VT), so a later resize makes it
  // recompute and redraw its visible viewport from that untouched
  // buffer, silently "un-clearing" the screen. Confirmed reproducible:
  // Clear Screen, then resize the window, and the old content is back.
  // The real fix, for local shells, is running the shell's own native
  // clear command, the same thing every other terminal app's "Clear
  // Screen" does under the hood, not a client-only buffer wipe. This
  // also keeps the shell's own idea of its scrollback consistent with
  // what's on screen, not just a fix for the resize case.
  // SSH and serial sessions aren't confirmed to have this bug (SSH
  // doesn't go through ConPTY at all, and there's no report of it on
  // serial), so they're left on the previous behavior for now.
  if (session.mode === 'local' && session.backendId) {
    const platform = await platformPromise;
    App.WriteLocalTerminal(session.backendId, platform === 'windows' ? 'cls\r' : 'clear\r');
  } else {
    session.term?.clear();
  }
});

// Sessions menu
function resetPickerView() {
  document.getElementById('picker-grid')!.style.display = 'grid';
  document.getElementById('picker-ssh-fields')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'none';
  pendingQuickPort = null;
}
// SPE-103: the picker is four choices, which is exactly the case where
// reaching for the mouse is the slow way round. 1-4 pick directly,
// arrows walk the grid, Escape backs out. Bound on the overlay so it
// only applies while the picker is actually open, and skipped once a
// protocol has been chosen and its fields are showing, where digits
// belong to whatever field has focus.
const PICKER_ITEM_IDS = ['picker-ssh', 'picker-shell', 'picker-serial', 'picker-telnet', 'picker-editor'];

function pickerGridVisible(): boolean {
  const overlay = document.getElementById('session-picker-overlay')!;
  const grid = document.getElementById('picker-grid')!;
  return overlay.classList.contains('open') && grid.style.display !== 'none';
}

document.getElementById('session-picker-overlay')!.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('session-picker-overlay')!;
  if (!overlay.classList.contains('open')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closeSessionPicker();
    return;
  }
  if (!pickerGridVisible()) return;

  const items = PICKER_ITEM_IDS.map((id) => document.getElementById(id)!);
  const choice = Number(e.key);
  if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
    e.preventDefault();
    items[choice - 1].click();
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const focused = items.indexOf(document.activeElement as HTMLElement);
    if (focused < 0) return;
    e.preventDefault();
    items[focused].click();
    return;
  }
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
    : 0;
  if (step === 0) return;
  e.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
  items[next].focus();
});

function openSessionPicker() {
  // SPE-92: an ordinary New Session, targets the active tab's own
  // primary session, never a leftover split-pane target from earlier.
  pendingPaneTarget = null;
  resetPickerView();
  // SPE-83: pre-fill with the OS username, matching MobaXterm's "same
  // as Windows login" default, only if the field is currently empty,
  // never overwrite something the person already typed or a saved
  // session's own stored username.
  const userField = document.getElementById('user') as HTMLInputElement;
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
  document.getElementById('session-picker-overlay')!.classList.add('open');
  document.getElementById('picker-ssh')!.focus();
}

// SPE-92: opens the same New Session picker, but targets a specific
// split pane instead of the active tab's own primary session. The
// picker itself (SSH/Shell/Serial icons and their flows) is entirely
// unchanged, only which Session object ends up connected differs.
function openSplitPanePicker(pane: Pane) {
  pendingPaneTarget = pane;
  resetPickerView();
  const userField = document.getElementById('user') as HTMLInputElement;
  if (!userField.value) {
    App.GetOSUsername().then((name) => {
      if (name && !userField.value) userField.value = name;
    }).catch(() => {});
  }
  document.getElementById('session-picker-overlay')!.classList.add('open');
}
function closeSessionPicker() {
  document.getElementById('session-picker-overlay')!.classList.remove('open');
  resetPickerView();
}
function ensurePendingTab() {
  // The picker always operates on the current tab if it's already
  // pending (opened from a tab's own landing view); otherwise it
  // creates a fresh pending tab first (opened from the Sessions menu).
  const current = activeTabId ? tabs.get(activeTabId) : null;
  if (current && current.mode === 'pending' && !current.isHome) return current;
  const tab = createPendingTab();
  switchToTab(tab.id);
  return tab;
}

document.getElementById('menu-new-session')!.addEventListener('click', () => {
  closeAllMenus();
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('home-new-editor-top')!.addEventListener('click', () => {
  newEditorSession();
});
document.getElementById('menu-new-editor')!.addEventListener('click', () => {
  closeAllMenus();
  newEditorSession();
});
document.getElementById('new-session-btn')!.addEventListener('click', () => {
  ensurePendingTab();
  openSessionPicker();
});
document.getElementById('session-picker-close')!.addEventListener('click', closeSessionPicker);
document.getElementById('session-picker-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('session-picker-overlay')) closeSessionPicker();
});
document.getElementById('picker-ssh')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-ssh-fields')!.style.display = 'flex';
});
document.getElementById('picker-serial')!.addEventListener('click', () => {
  document.getElementById('picker-grid')!.style.display = 'none';
  document.getElementById('picker-serial-fields')!.style.display = 'flex';
});
document.getElementById('picker-telnet')!.addEventListener('click', () => {
  closeSessionPicker();
  newTelnetSession();
});
document.getElementById('picker-editor')!.addEventListener('click', () => {
  closeSessionPicker();
  newEditorSession();
});
document.getElementById('serial-connect')!.addEventListener('click', async () => {
  const portName = (document.getElementById('serial-port') as HTMLInputElement).value;
  const baud = parseInt((document.getElementById('serial-baud') as HTMLSelectElement).value, 10);
  if (!portName) return;
  await connectSerialInActiveTab(portName, baud);
});
document.getElementById('picker-shell')!.addEventListener('click', () => {
  // SPE-92: ensurePendingTab would wrongly create/switch to a whole new
  // tab when this picker was actually opened for a split pane, only
  // needed for the ordinary "New Session" flow.
  if (!pendingPaneTarget) ensurePendingTab();
  closeSessionPicker();
  startLocalShellInActiveTab('', 'Local shell');
});
document.getElementById('menu-new-folder')!.addEventListener('click', () => {
  closeAllMenus();
  createNewFolder();
});

// View menu
function toggleSidebar() {
  const app = document.getElementById('app')!;
  app.style.gridTemplateColumns = '';
  const collapsed = app.classList.toggle('sidebar-collapsed');
  app.style.setProperty('--sw', collapsed ? '0px' : (sidebarWidth ? `${sidebarWidth}px` : '220px'));
  app.style.setProperty('--rsw', collapsed ? '0px' : '5px');
  document.getElementById('sidebar-expand-btn')!.style.display = collapsed ? 'flex' : 'none';
  refitActiveTerminal();
}
document.getElementById('menu-toggle-sidebar')!.addEventListener('click', () => {
  closeAllMenus();
  toggleSidebar();
});

// SPE-92: split-pane layouts. Ctrl+Shift+D / Ctrl+Shift+Enter / Ctrl+Shift+W
// / Alt+Arrow also drive these, see the keyboard handler in
// createTerminalForSession.
function currentTabForLayout(): Tab | null {
  return activeTabId ? (tabs.get(activeTabId) ?? null) : null;
}
document.getElementById('menu-layout-single')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, 'single');
});
document.getElementById('menu-layout-2v')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '2v');
});
document.getElementById('menu-layout-2h')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '2h');
});
document.getElementById('menu-layout-4')!.addEventListener('click', () => {
  closeAllMenus();
  const tab = currentTabForLayout();
  if (tab) setTabLayout(tab, '4');
});

// SPE-95: distinct from window maximize, hides all chrome (menu bar,
// title bar) and uses the whole screen, matching F11 convention. F11
// itself is safe to claim globally, unlike some of the other shortcuts
// tonight (Ctrl+B/tmux etc.), it's not a meaningful readline/shell
// binding anywhere.
async function toggleFullscreen() {
  const isFull = await runtime.WindowIsFullscreen();
  if (isFull) runtime.WindowUnfullscreen();
  else runtime.WindowFullscreen();
}
document.getElementById('menu-toggle-fullscreen')!.addEventListener('click', () => {
  closeAllMenus();
  toggleFullscreen();
});

// SPE-91: viewable keyboard shortcuts reference. Built from a single
// source list here rather than duplicated across the View menu's
// inline hints, this list is the intentionally complete one (zoom,
// disconnect, paste, close pane, pane navigation, the disconnected-
// panel-only keys), several of which aren't shown anywhere else in the
// UI. Deliberately does NOT bind a new key (like a bare "?") to open
// this itself: Xpecter's whole surface is terminal input, and a bare
// single-key binding would swallow a character real shells/programs
// need to receive, the same reasoning already documented for why
// Ctrl+B isn't used bare for the sidebar toggle below. Menu-only is
// the safe choice here.
// Cmd label on macOS, Ctrl everywhere else, matching the actual
// runtime check (e.ctrlKey || e.metaKey) that treats them
// interchangeably throughout this file.
const SHORTCUT_MOD = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl';
const SHORTCUT_GROUPS: { title: string; items: [ShortcutId | null, string][] }[] = [
  {
    title: 'Session',
    items: [
      ['disconnect', 'Disconnect active session'],
      ['paste', 'Paste'],
      ['saveOutput', 'Save terminal output to a file'],
    ],
  },
  {
    title: 'View',
    items: [
      ['sidebar', 'Toggle sidebar'],
      ['zoomIn', 'Zoom in'],
      ['zoomOut', 'Zoom out'],
      ['resetZoom', 'Reset zoom'],
      ['fullscreen', 'Toggle fullscreen'],
    ],
  },
  {
    title: 'Panes',
    items: [
      ['splitVertical', 'Split vertical / 4-pane grid'],
      ['splitHorizontal', 'Split horizontal / 4-pane grid'],
      ['closePane', 'Close active pane'],
    ],
  },
  {
    title: 'Text editor session',
    items: [
      [null, `New file (${SHORTCUT_MOD}+N)`],
      [null, `Open file (${SHORTCUT_MOD}+O)`],
      [null, `Save (${SHORTCUT_MOD}+S)`],
      [null, `Save as (${SHORTCUT_MOD}+Shift+S)`],
      [null, `Close file (${SHORTCUT_MOD}+W)`],
      [null, `Go to file (${SHORTCUT_MOD}+P)`],
      [null, `Command palette (${SHORTCUT_MOD}+Shift+P)`],
      [null, `Find / replace (${SHORTCUT_MOD}+F / ${SHORTCUT_MOD}+H)`],
      [null, `Go to line (${SHORTCUT_MOD}+G)`],
      [null, `Next / previous file (${SHORTCUT_MOD}+PageDown / PageUp)`],
      [null, 'Toggle word wrap (Alt+Z)'],
    ],
  },
  {
    title: 'Disconnected session panel',
    items: [
      [null, 'Reconnect (R)'],
      [null, 'Save session output (S)'],
      [null, 'Close pane (Enter)'],
    ],
  },
];

function renderShortcutsDialog() {
  const content = document.getElementById('shortcuts-content')!;
  content.innerHTML = '';
  for (const group of SHORTCUT_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'shortcut-group';
    const titleEl = document.createElement('div');
    titleEl.className = 'shortcut-group-title';
    titleEl.textContent = group.title;
    groupEl.appendChild(titleEl);
    for (const [id, label] of group.items) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const keysEl = document.createElement(id ? 'button' : 'span');
      keysEl.className = 'shortcut-keys';
      keysEl.textContent = id ? formatShortcut(shortcuts[id]) : label.match(/\(([^)]+)\)$/)?.[1] ?? '';
      if (id) {
        (keysEl as HTMLButtonElement).type = 'button';
        keysEl.title = 'Click to change shortcut';
        (keysEl as HTMLButtonElement).onclick = () => captureShortcut(id, keysEl as HTMLButtonElement);
      }
      row.appendChild(labelEl);
      row.appendChild(keysEl);
      groupEl.appendChild(row);
    }
    content.appendChild(groupEl);
  }
}

function formatShortcut(binding: ShortcutBinding): string {
  const parts = [];
  if (binding.ctrl) parts.push(SHORTCUT_MOD);
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  parts.push(binding.key === ' ' ? 'Space' : binding.key);
  return parts.join('+');
}

function captureShortcut(id: ShortcutId, button: HTMLButtonElement) {
  button.textContent = 'Press keys...';
  const capture = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      document.removeEventListener('keydown', capture, true);
      renderShortcutsDialog();
      return;
    }
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(event.key)) return;
    shortcuts[id] = {
      ctrl: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
      key: event.key,
    };
    saveShortcuts();
    document.removeEventListener('keydown', capture, true);
    renderShortcutsDialog();
  };
  document.addEventListener('keydown', capture, true);
}

function openShortcutsDialog() {
  renderShortcutsDialog();
  document.getElementById('shortcuts-overlay')!.classList.add('open');
}
function closeShortcutsDialog() {
  document.getElementById('shortcuts-overlay')!.classList.remove('open');
}
document.getElementById('menu-keyboard-shortcuts')!.addEventListener('click', () => {
  closeAllMenus();
  openShortcutsDialog();
});
document.getElementById('shortcuts-close')!.addEventListener('click', closeShortcutsDialog);
document.getElementById('shortcuts-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('shortcuts-overlay')) closeShortcutsDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('shortcuts-overlay')!.classList.contains('open')) {
    closeShortcutsDialog();
  }
});

document.getElementById('sidebar-expand-btn')!.addEventListener('click', toggleSidebar);

// --- Config import/export (SPE-93) ---
document.getElementById('menu-export-config')!.addEventListener('click', async () => {
  closeAllMenus();
  try {
    const path = await App.ExportConfigFile();
    if (path) alert(`Exported configuration to:\n${path}`);
  } catch (err) {
    alert(`Export failed: ${err}`);
  }
});
// An import is two different operations wearing one name, and confirm()
// can only offer one of them. Merge adds a file alongside what is here;
// Replace makes this machine match the file, which is what restoring
// actually means and the only one that is safe to repeat.
function askImportMode(): Promise<'merge' | 'replace' | 'cancel'> {
  return new Promise((resolve) => {
    buildDialog({
      title: 'Import configuration',
      tone: 'warning',
      onDismiss: () => resolve('cancel'),
      fill: (body) => {
        dialogText(body, 'Replace makes this machine match the file exactly. Everything saved here now is cleared first, so restoring the same file twice leaves the same result both times.');
        dialogText(body, 'Merge keeps what is already here and adds the file alongside it. Importing the same file twice this way leaves two of everything.');
        dialogText(body, 'Either way, appearance settings come from the file. Passwords are never written to a configuration file, so password-authenticated sessions will ask for theirs again.', 'warn');
      },
      actions: [
        { label: 'Replace', kind: 'danger', run: () => resolve('replace') },
        { label: 'Cancel', kind: 'secondary', run: () => resolve('cancel') },
        { label: 'Merge', run: () => resolve('merge') },
      ],
    });
  });
}

// Everything an import or reset can touch. renderFolderList was missing
// from these paths, so imported pinned folders only appeared after a
// restart.
async function refreshAfterConfigChange() {
  await Promise.all([
    loadSettingsAndApply(),
    renderSessionList(),
    renderLocalShellProfilesMenu(),
    renderFolderList(),
  ]);
}

document.getElementById('menu-import-config')!.addEventListener('click', async () => {
  closeAllMenus();
  const mode = await askImportMode();
  if (mode === 'cancel') return;
  try {
    const path = await App.ImportConfigFile(mode === 'replace');
    if (!path) return;
    await refreshAfterConfigChange();
    alert(`Imported configuration from:\n${path}`);
  } catch (err) {
    alert(`Import failed: ${err}`);
  }
});
document.getElementById('menu-export-encrypted-config')!.addEventListener('click', async () => {
  closeAllMenus();
  const passphrase = prompt('Passphrase for encrypted configuration:');
  if (!passphrase) return;
  try {
    const path = await App.ExportEncryptedConfigFile(passphrase);
    if (path) alert(`Exported encrypted configuration to:\n${path}`);
  } catch (err) {
    alert(`Encrypted export failed: ${err}`);
  }
});
document.getElementById('menu-import-encrypted-config')!.addEventListener('click', async () => {
  closeAllMenus();
  // Mode first, then the passphrase: asking for a passphrase and then
  // asking whether they meant it puts the irreversible question after
  // the tedious one.
  const mode = await askImportMode();
  if (mode === 'cancel') return;
  const passphrase = prompt('Passphrase for encrypted configuration:');
  if (!passphrase) return;
  try {
    const path = await App.ImportEncryptedConfigFile(passphrase, mode === 'replace');
    if (!path) return;
    await refreshAfterConfigChange();
    alert(`Imported encrypted configuration from:\n${path}`);
  } catch (err) {
    alert(`Encrypted import failed: ${err}`);
  }
});

// Erasing everything is the half of "move my sessions to another
// machine" that export/import never had: without it you can carry a
// config away but not hand the machine on clean, and a merge-only
// import onto a machine that still has the old data just duplicates it.
document.getElementById('menu-reset-all')!.addEventListener('click', () => {
  closeAllMenus();
  buildDialog({
    title: 'Erase all saved data',
    tone: 'danger',
    onDismiss: () => {},
    fill: (body) => {
      dialogText(body, 'This clears every saved session, session group, local shell profile and pinned folder, and returns appearance settings to their defaults.', 'danger');
      dialogText(body, 'A backup is written first and nothing is erased unless that succeeds, so this can be undone from Restore from backup.');
      dialogText(body, 'Open sessions are not disconnected, and nothing on any remote host is touched.');
    },
    actions: [
      {
        label: 'Erase everything',
        kind: 'danger',
        run: () => {
          void (async () => {
            try {
              const backup = await App.ResetConfiguration();
              await refreshAfterConfigChange();
              alert(`Xpecter has been reset.\n\nA backup was saved first, as:\n${backup}\n\nRestore from backup will put it all back.`);
            } catch (err) {
              alert(`Reset failed: ${err}`);
            }
          })();
        },
      },
      { label: 'Cancel', kind: 'secondary', run: () => {} },
    ],
  });
});
document.getElementById('menu-import-mobaxterm')!.addEventListener('click', async () => {
  closeAllMenus();
  try {
    const result = await App.ImportMobaXtermSessions();
    if (result.path) {
      await renderSessionList();
      alert(`Imported ${result.count} MobaXterm session(s). Passwords were not imported.`);
    }
  } catch (err) {
    alert(`MobaXterm import failed: ${err}`);
  }
});

// --- Restore from automatic backup (SPE-87) ---
// filenameToLabel parses the "xpecter-backup-YYYYMMDD-HHMMSS.json"
// format written by config.BackupIfDue (Go side) into a readable local
// date/time for display, purely cosmetic, doesn't affect which file
// actually gets restored (that's always the exact filename passed to
// App.RestoreBackup).
function backupFilenameToLabel(filename: string): string {
  const match = filename.match(/^xpecter-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/);
  if (!match) return filename;
  const [, y, mo, d, h, mi, s] = match;
  // The Go side writes these in UTC (time.Now().UTC()), constructed
  // here as a UTC instant too so toLocaleString() converts it to the
  // viewer's actual local time rather than misreading it as already-local.
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return date.toLocaleString();
}

async function openBackupRestoreDialog() {
  const list = document.getElementById('backup-restore-list')!;
  list.innerHTML = '';
  let backups: string[] = [];
  try {
    backups = await App.ListBackups();
  } catch {
    // No backups directory yet (fresh install, never reached the
    // 24h-since-last-backup mark) isn't an error worth surfacing,
    // just show the empty state below.
  }
  if (backups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'backup-empty';
    empty.textContent = 'No automatic backups yet. Xpecter creates one at most once a day.';
    list.appendChild(empty);
  } else {
    for (const filename of backups) {
      const row = document.createElement('div');
      row.className = 'backup-row';
      row.textContent = backupFilenameToLabel(filename);
      row.addEventListener('click', async () => {
        // Restoring REPLACES current Settings/Sessions/Groups/Local
        // shell profiles outright (config.RestoreBackup), unlike
        // Import Configuration's merge, so this confirm is
        // deliberately more blunt about what's about to happen.
        if (!confirm(`Restore this backup?\n\n${backupFilenameToLabel(filename)}\n\nThis replaces your current saved sessions, folders, local shell profiles, and appearance settings with what's in this backup. This cannot be undone.`)) {
          return;
        }
        try {
          await App.RestoreBackup(filename);
          await Promise.all([
            loadSettingsAndApply(),
            renderSessionList(),
            renderLocalShellProfilesMenu(),
          ]);
          closeBackupRestoreDialog();
          alert('Backup restored.');
        } catch (err) {
          alert(`Restore failed: ${err}`);
        }
      });
      list.appendChild(row);
    }
  }
  document.getElementById('backup-restore-overlay')!.classList.add('open');
}
function closeBackupRestoreDialog() {
  document.getElementById('backup-restore-overlay')!.classList.remove('open');
}
document.getElementById('menu-restore-backup')!.addEventListener('click', () => {
  closeAllMenus();
  openBackupRestoreDialog();
});
document.getElementById('backup-restore-close')!.addEventListener('click', closeBackupRestoreDialog);
document.getElementById('backup-restore-overlay')!.addEventListener('click', (e) => {
  if (e.target === document.getElementById('backup-restore-overlay')) closeBackupRestoreDialog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('backup-restore-overlay')!.classList.contains('open')) {
    closeBackupRestoreDialog();
  }
});

// Tools menu: platform-aware, hide Command Prompt/PowerShell on non-Windows
platformPromise.then((platform) => {
  if (platform !== 'windows') {
    document.getElementById('menu-tool-cmd')!.classList.add('disabled');
    document.getElementById('menu-tool-powershell')!.classList.add('disabled');
  }
});
document.getElementById('menu-tool-terminal')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('', 'Terminal');
});
document.getElementById('menu-tool-cmd')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('cmd.exe', 'Command Prompt');
});
document.getElementById('menu-tool-powershell')!.addEventListener('click', () => {
  closeAllMenus();
  newLocalShellTab('powershell.exe', 'PowerShell');
});
document.getElementById('menu-tool-text-editor')!.addEventListener('click', () => {
  closeAllMenus();
  newFileInEditor();
});

renderSessionList();

let sidebarWidth: number | null = null;

// SPE-103: the sidebar is the only resizable pane now, the editor's old
// right-hand column having become a session tab.
function setupSidebarResize(minWidth: number) {
  const handle = document.getElementById('resize-sidebar')!;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const app = document.getElementById('app')!;
    const startX = e.clientX;
    const startWidth = document.getElementById('sidebar')!.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      sidebarWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      app.style.setProperty('--sw', `${sidebarWidth}px`);
    };

    const finishResize = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', finishResize);
      handle.removeEventListener('pointercancel', finishResize);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      refitActiveTerminal();
    };
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', finishResize);
    handle.addEventListener('pointercancel', finishResize);
  });
}

setupSidebarResize(150);

renderSessionList();renderSessionList();
renderLocalShellProfileList();
renderFolderList();
renderLocalShellProfilesMenu();
