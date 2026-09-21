// User-defined output highlighting rules.
//
// The built-in rules know a network engineer's vocabulary. They cannot
// know a particular vendor's, or a particular team's: the word that
// means "this is fine" on one platform and the hostname prefix that
// means "careful" on another. These are the rules a person adds, kept
// in front of the built-in ones so they win where they overlap.

export type CustomRuleKind = 'word' | 'regex';

// The colour categories the highlighter already has; a custom rule
// borrows one rather than bringing a colour of its own, so it follows
// the colour scheme like everything else.
export const CUSTOM_RULE_CATEGORIES = ['good', 'bad', 'warn', 'keyword', 'meta', 'addr', 'number', 'string', 'path', 'time', 'iface'] as const;
export type CustomRuleCategory = typeof CUSTOM_RULE_CATEGORIES[number];

export interface CustomHighlightRule {
  pattern: string;
  kind: CustomRuleKind;
  category: CustomRuleCategory;
}

export const HIGHLIGHT_RULES_STORAGE_KEY = 'xpecter-highlight-rules';

function isCategory(value: unknown): value is CustomRuleCategory {
  return typeof value === 'string' && (CUSTOM_RULE_CATEGORIES as readonly string[]).includes(value);
}

export function parseCustomRules(json: string | null): CustomHighlightRule[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const rules: CustomHighlightRule[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { pattern, kind, category } = entry as { pattern?: unknown; kind?: unknown; category?: unknown };
    if (typeof pattern !== 'string' || !pattern.trim()) continue;
    if (!isCategory(category)) continue;
    rules.push({ pattern: pattern.trim(), kind: kind === 'regex' ? 'regex' : 'word', category });
  }
  return rules;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The regular expression source for one rule, or null when the rule
// cannot be compiled (a regex with a syntax error). A word is matched
// whole, so "up" does not colour the middle of "setup". Lookarounds
// rather than \b, because \b has no opinion at the end of "c++" or the
// start of "%ASA": a word boundary needs a word character on one side.
export function compileCustomRule(rule: CustomHighlightRule): string | null {
  if (rule.kind === 'word') {
    const words = rule.pattern.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return null;
    // Longest first, the same reason the built-in word lists sort.
    words.sort((a, b) => b.length - a.length);
    return String.raw`(?<![\w-])(?:${words.map(escapeRegex).join('|')})(?![\w-])`;
  }
  try {
    // Compiled once here to reject a bad expression before it is
    // spliced into the highlighter's single big alternation, where one
    // broken branch would take every rule down with it.
    new RegExp(rule.pattern, 'i');
  } catch {
    return null;
  }
  // The highlighter reads its matches by group name (h0, h1, …), so a
  // capturing group inside a custom rule shifts nothing and the pattern
  // goes in as written. Rewriting plain groups would have mangled an
  // escaped parenthesis or one inside a character class.
  return rule.pattern;
}
