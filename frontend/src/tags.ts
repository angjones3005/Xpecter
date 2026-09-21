// Tag colours, and the guard that goes with some of them.
//
// A session's tags were text in a filter box. Now a tag can carry a
// colour, which the tab, the pane header and the sidebar row wear, and
// a guard, which makes the terminal ask before a paste or a snippet
// runs there. Red on everything tagged prod is the cheapest safety
// feature a terminal can have.

export interface TagStyle {
  colour: string;
  guard: boolean;
}

export type TagStyles = Record<string, TagStyle>;

export const TAG_STYLES_STORAGE_KEY = 'xpecter-tag-styles';

// What a fresh install already understands. Overridden, extended or
// removed in Settings; a removed default is stored as an explicit null.
export const DEFAULT_TAG_STYLES: TagStyles = {
  prod: { colour: '#e5484d', guard: true },
  production: { colour: '#e5484d', guard: true },
  staging: { colour: '#f5a524', guard: false },
  dev: { colour: '#2ea043', guard: false },
  lab: { colour: '#2ea043', guard: false },
  test: { colour: '#2ea043', guard: false },
};

const COLOUR_RE = /^#[0-9a-f]{6}$/i;

export function normaliseTag(tag: string): string {
  return tag.trim().toLowerCase();
}

// The styles in effect: the defaults with the stored changes over
// them. A stored entry of null removes a default.
export function parseTagStyles(json: string | null): TagStyles {
  const styles: TagStyles = { ...DEFAULT_TAG_STYLES };
  if (!json) return styles;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return styles;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return styles;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const tag = normaliseTag(key);
    if (!tag) continue;
    if (value === null) {
      delete styles[tag];
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as { colour?: unknown; guard?: unknown };
    const colour = typeof entry.colour === 'string' && COLOUR_RE.test(entry.colour) ? entry.colour.toLowerCase() : null;
    if (!colour) continue;
    styles[tag] = { colour, guard: entry.guard === true };
  }
  return styles;
}

// What to store: only the differences from the defaults, so a default
// that changes in a later build reaches everyone who never touched it.
export function serializeTagStyles(styles: TagStyles): string {
  const out: Record<string, TagStyle | null> = {};
  for (const [tag, style] of Object.entries(styles)) {
    const base = DEFAULT_TAG_STYLES[tag];
    if (!base || base.colour !== style.colour || base.guard !== style.guard) out[tag] = style;
  }
  for (const tag of Object.keys(DEFAULT_TAG_STYLES)) {
    if (!(tag in styles)) out[tag] = null;
  }
  return JSON.stringify(out);
}

// The first of a session's tags that has a style, in the order the
// tags were given: that is the one the tab wears.
export function tagStyleFor(tags: string[] | undefined, styles: TagStyles): { tag: string; style: TagStyle } | null {
  for (const raw of tags ?? []) {
    const tag = normaliseTag(raw);
    const style = styles[tag];
    if (style) return { tag, style };
  }
  return null;
}

// Whether any of a session's tags asks for the paste guard.
export function isGuarded(tags: string[] | undefined, styles: TagStyles): boolean {
  return (tags ?? []).some((raw) => styles[normaliseTag(raw)]?.guard === true);
}
