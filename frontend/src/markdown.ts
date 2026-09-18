// Obsidian-flavoured Markdown, rendered to HTML.
//
// A .md file in the editor is read far more often than it is edited: a
// runbook you are following, the notes on a host, a vault of them. This
// is the reading view for those, and it reads the dialect people
// actually write in that kind of file, which is Obsidian's rather than
// plain CommonMark. On top of GFM (tables, task lists, strikethrough,
// autolinks) it understands:
//
//   [[Note]], [[Note|Alias]], [[Note#Heading]]   wikilinks
//   ![[image.png]], ![[Other note]]              embeds
//   > [!note] Title / > [!warning]- Folded      callouts
//   ==highlighted==                              highlight
//   #tag                                         tags
//   ---\nkey: value\n---                          front matter
//
// Everything here is pure: text in, HTML out, plus the facts the view
// needs (front matter, word count). Resolving a wikilink to a file,
// loading an image off disk and toggling a task back into the buffer
// all need the editor's state, so they live in main.ts and act on the
// data-* attributes this leaves behind. The HTML is not yet safe to
// insert — main.ts runs it through DOMPurify — so nothing here has to
// second-guess what a file is allowed to contain.

import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';

export type FrontMatterValue = string | string[];
export type FrontMatter = { key: string; value: FrontMatterValue }[];

export interface RenderedMarkdown {
  html: string;
  frontMatter: FrontMatter;
  wordCount: number;
}

// --- Front matter ---

// The YAML subset a note's properties are written in: scalars, inline
// lists, and block lists. A real YAML parser would be another dependency
// for a header that Obsidian itself keeps flat, and anything this cannot
// read is shown as the text it is rather than dropped.
export function splitFrontMatter(text: string): { frontMatter: FrontMatter; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { frontMatter: [], body: text };
  const lines = match[1].split(/\r?\n/);
  const frontMatter: FrontMatter = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const entry = /^([A-Za-z0-9_][\w .-]*?):[ \t]*(.*)$/.exec(line);
    if (!entry) continue;
    const key = entry[1];
    const rawValue = entry[2].trim();
    if (rawValue === '') {
      // A block list follows, or nothing does.
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const item = /^\s+-\s*(.*)$/.exec(lines[i + 1]);
        if (!item) break;
        items.push(unquote(item[1]));
        i += 1;
      }
      frontMatter.push({ key, value: items.length ? items : '' });
      continue;
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const items = rawValue.slice(1, -1).split(',').map((item) => unquote(item.trim())).filter(Boolean);
      frontMatter.push({ key, value: items });
      continue;
    }
    frontMatter.push({ key, value: unquote(rawValue) });
  }
  return { frontMatter, body: text.slice(match[0].length) };
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

// --- Headings ---

// The id a heading gets, so [[Note#Heading]] and [text](#heading) have
// something to land on. Obsidian matches headings by their text, so the
// same slug function is applied to both ends of a link.
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}

// --- Callouts ---

// One icon per callout type, the same set Obsidian ships. An unknown
// type falls back to the note icon rather than to nothing, so a
// [!custom] block still reads as a callout.
const CALLOUT_ICONS: Record<string, string> = {
  note: '✎', abstract: '☰', summary: '☰', tldr: '☰', info: 'ℹ', todo: '☑',
  tip: '✦', hint: '✦', important: '✦', success: '✓', check: '✓', done: '✓',
  question: '?', help: '?', faq: '?', warning: '⚠', caution: '⚠', attention: '⚠',
  failure: '✗', fail: '✗', missing: '✗', danger: '⚡', error: '⚡', bug: '☠',
  example: '≡', quote: '❝', cite: '❝',
};

// The colour family a callout type belongs to. Aliases share a family
// so [!hint] looks like [!tip], the way Obsidian draws them.
const CALLOUT_FAMILY: Record<string, string> = {
  abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
  tip: 'tip', hint: 'tip', important: 'tip',
  success: 'success', check: 'success', done: 'success',
  question: 'question', help: 'question', faq: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning',
  failure: 'failure', fail: 'failure', missing: 'failure',
  danger: 'danger', error: 'danger',
  bug: 'bug', example: 'example', quote: 'quote', cite: 'quote', info: 'info', todo: 'todo',
};

const CALLOUT_HEAD = /^\[!([A-Za-z0-9_-]+)\]([+-]?)[ \t]*(.*)$/;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// --- Inline extensions ---

// [[Target]], [[Target|Alias]], [[Target#Heading]], [[Target#Heading|Alias]],
// and the ![[...]] embed form. The target is left for main.ts to resolve:
// which file "Target" is depends on the folder the note lives in.
const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src) {
    const index = src.search(/!?\[\[/);
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^(!?)\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\|([^\]]*))?\]\]/.exec(src);
    if (!match) return undefined;
    const target = match[2].trim();
    const heading = (match[3] ?? '').trim();
    if (!target && !heading) return undefined;
    return {
      type: 'wikilink',
      raw: match[0],
      embed: match[1] === '!',
      target,
      heading,
      alias: (match[4] ?? '').trim(),
    };
  },
  renderer(token) {
    const target = token.target as string;
    const heading = token.heading as string;
    const alias = token.alias as string;
    const label = alias || (heading && !target ? heading : target + (heading ? ' › ' + heading : ''));
    const attrs = `data-target="${escapeAttr(target)}" data-heading="${escapeAttr(heading)}"`;
    if (token.embed && target && IMAGE_RE.test(target)) {
      // ![[image.png|300]] sizes the image, the way Obsidian reads it.
      const width = /^\d+$/.test(alias) ? ` width="${alias}"` : '';
      return `<img class="md-embed" data-src="${escapeAttr(target)}" alt="${escapeAttr(target)}"${width}>`;
    }
    const kind = token.embed ? 'md-wikilink md-embed-link' : 'md-wikilink';
    return `<a class="${kind}" href="#" ${attrs}>${token.embed ? '⤷ ' : ''}${escapeHtml(label)}</a>`;
  },
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;

// ==text== is Obsidian's highlight. Two equals signs are common enough
// in prose (a == b) that the rule wants text on both sides and no space
// just inside the markers, the same constraint Obsidian applies.
const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) {
    const index = src.indexOf('==');
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
    if (!match) return undefined;
    return {
      type: 'highlight',
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens as Tokens.Generic[])}</mark>`;
  },
};

// #tag, when it stands at the start of a line or after whitespace and
// has at least one letter in it. "#1" and "issue #42" stay text, and a
// heading's "# " never reaches here because it has a space after it.
const tag: TokenizerAndRendererExtension = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const match = /(^|\s)#[\p{L}\p{N}_/-]/u.exec(src);
    return match ? match.index + match[1].length : undefined;
  },
  tokenizer(src, tokens) {
    const match = /^#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)(?![\p{L}\p{N}_/-])/u.exec(src);
    if (!match) return undefined;
    // Only at the start of the text or after whitespace: "C#" and
    // "a#b" are not tags.
    const previous = tokens[tokens.length - 1];
    if (previous && previous.type === 'text' && !/\s$/.test((previous as Tokens.Text).raw)) return undefined;
    if (previous && previous.type !== 'text' && previous.type !== 'br') return undefined;
    return { type: 'tag', raw: match[0], text: match[1] };
  },
  renderer(token) {
    return `<span class="md-tag" data-tag="${escapeAttr(token.text as string)}">#${escapeHtml(token.text as string)}</span>`;
  },
};

// --- The instance ---

// Typed explicitly because the renderers below reach back into the
// instance (its lexer, its text renderer) while it is being built.
const md: Marked = new Marked({
  gfm: true,
  // Obsidian treats a newline in a paragraph as a line break by
  // default; a note written there wraps wrong without this.
  breaks: true,
  extensions: [wikilink, highlight, tag],
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = this.parser.parseInline(tokens, new (md.TextRenderer)());
      return `<h${depth} id="${escapeAttr(headingSlug(plain))}">${text}</h${depth}>\n`;
    },
    // Code is left plain here and coloured after insertion by Monaco's
    // colorizer, so a shell block in a runbook reads with the editor's
    // own highlighting rather than a second theme.
    code({ text, lang }) {
      const language = (lang ?? '').trim().split(/\s+/)[0];
      const attr = language ? ` data-lang="${escapeAttr(language)}"` : '';
      return `<pre class="md-code"><code${attr}>${escapeHtml(text)}</code></pre>\n`;
    },
    // A file on disk cannot be fetched by the webview, so a relative
    // image is left as data-src for main.ts to read and inline. Only a
    // real URL keeps src, and the element never asks the app's origin
    // for "images/foo.png" first.
    image({ href, title, text, tokens }): string {
      const alt: string = tokens ? this.parser.parseInline(tokens, new (md.TextRenderer)()) : text;
      const remote = /^(https?:|data:)/i.test(href);
      const src = `${remote ? 'src' : 'data-src'}="${escapeAttr(href)}"`;
      const caption = title ? ` title="${escapeAttr(title)}"` : '';
      return `<img ${src} alt="${escapeAttr(alt)}"${caption}>`;
    },
    blockquote({ tokens, raw }) {
      const callout = calloutOf(raw);
      if (!callout) return false;
      const { type, fold, title, body } = callout;
      const family = CALLOUT_FAMILY[type] ?? (CALLOUT_ICONS[type] ? type : 'note');
      const icon = CALLOUT_ICONS[type] ?? CALLOUT_ICONS.note;
      const heading = title ? this.parser.parseInline(md.Lexer.lexInline(title)) : escapeHtml(titleCase(type));
      const content = body.trim() ? this.parser.parse(md.lexer(body)) : '';
      // A foldable callout is a <details>, which folds without a line of
      // script and remembers nothing, which is also what Obsidian does.
      if (fold) {
        return `<details class="md-callout" data-callout="${escapeAttr(family)}"${fold === '+' ? ' open' : ''}>`
          + `<summary class="md-callout-title"><span class="md-callout-icon">${icon}</span><span>${heading}</span></summary>`
          + `<div class="md-callout-content">${content}</div></details>\n`;
      }
      void tokens;
      return `<div class="md-callout" data-callout="${escapeAttr(family)}">`
        + `<div class="md-callout-title"><span class="md-callout-icon">${icon}</span><span>${heading}</span></div>`
        + (content ? `<div class="md-callout-content">${content}</div>` : '')
        + '</div>\n';
    },
    // Rendered enabled rather than disabled: the reading view lets you
    // tick a task off, and main.ts writes the tick back into the buffer.
    checkbox({ checked }) {
      return `<input type="checkbox" class="md-task"${checked ? ' checked' : ''}> `;
    },
    // The lexer has already put a checkbox token at the front of a task
    // item's content, so this only has to mark the item so a ticked one
    // can be struck through.
    listitem(item) {
      const classes = item.task ? (item.checked ? ' class="md-task-item is-checked"' : ' class="md-task-item"') : '';
      return `<li${classes}>${this.parser.parse(item.tokens)}</li>\n`;
    },
  },
});

// Reads "> [!type]+ Title\n> body" out of a blockquote's raw text. Done
// on the raw text rather than the token tree because marked's inline
// lexer breaks "[!note]" into several text tokens, and reassembling
// them is more fragile than reading the line it came from.
function calloutOf(raw: string): { type: string; fold: string; title: string; body: string } | null {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const first = lines[0].replace(/^ {0,3}> ?/, '');
  const head = CALLOUT_HEAD.exec(first);
  if (!head) return null;
  const body = lines.slice(1).map((line) => line.replace(/^ {0,3}> ?/, '')).join('\n');
  return { type: head[1].toLowerCase(), fold: head[2], title: head[3].trim(), body };
}

// --- Entry point ---

export function renderMarkdown(text: string): RenderedMarkdown {
  const { frontMatter, body } = splitFrontMatter(text);
  const html = md.parse(body, { async: false }) as string;
  return { html, frontMatter, wordCount: countWords(body) };
}

// Obsidian's status-bar count: whitespace-separated runs, with fenced
// code left in because it is part of what you wrote.
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// The n-th task marker in a buffer, in document order, which is the
// same order the reading view renders checkboxes in. Fenced code is
// skipped so a "- [ ]" inside an example is not counted. Returns the
// zero-based line and the column of the character inside the brackets.
export function taskMarkerAt(text: string, index: number): { line: number; column: number; checked: boolean } | null {
  const lines = text.split(/\r?\n/);
  let fence: string | null = null;
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const task = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/.exec(line);
    if (!task) continue;
    if (seen === index) return { line: i, column: task[1].length, checked: task[2] !== ' ' };
    seen += 1;
  }
  return null;
}
