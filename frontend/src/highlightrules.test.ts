import { describe, expect, it } from 'vitest';
import { compileCustomRule, parseCustomRules } from './highlightrules';

describe('parseCustomRules', () => {
  it('keeps well-formed rules and drops the rest', () => {
    const rules = parseCustomRules(JSON.stringify([
      { pattern: 'CRIT', kind: 'word', category: 'bad' },
      { pattern: 'sw-core-\\d+', kind: 'regex', category: 'iface' },
      { pattern: '  ', kind: 'word', category: 'good' },
      { pattern: 'x', kind: 'word', category: 'purple' },
      { pattern: 'y', kind: 'anything', category: 'warn' },
      'nope',
    ]));
    expect(rules).toEqual([
      { pattern: 'CRIT', kind: 'word', category: 'bad' },
      { pattern: 'sw-core-\\d+', kind: 'regex', category: 'iface' },
      { pattern: 'y', kind: 'word', category: 'warn' },
    ]);
    expect(parseCustomRules(null)).toEqual([]);
    expect(parseCustomRules('{')).toEqual([]);
  });
});

describe('compileCustomRule', () => {
  it('matches words whole and escapes them', () => {
    const source = compileCustomRule({ pattern: 'up, c++ , setup', kind: 'word', category: 'good' })!;
    const re = new RegExp(source, 'gi');
    expect('link is up'.match(re)).toEqual(['up']);
    expect('setup done'.match(re)).toEqual(['setup']);
    expect('cupboard'.match(re)).toBeNull();
    expect('c++ rocks'.match(re)).toEqual(['c++']);
    expect('%SETUP-6-DONE'.match(re)).toBeNull();
    const symbolic = new RegExp(compileCustomRule({ pattern: '%ASA', kind: 'word', category: 'meta' })!, 'gi');
    expect('%ASA-6-302013: Built'.match(symbolic)).toBeNull();
    expect('saw %ASA today'.match(symbolic)).toEqual(['%ASA']);
  });

  it('rejects a broken regular expression and keeps a good one as written', () => {
    expect(compileCustomRule({ pattern: '(', kind: 'regex', category: 'bad' })).toBeNull();
    expect(compileCustomRule({ pattern: '(a|b)-(\\d+)', kind: 'regex', category: 'meta' })).toBe('(a|b)-(\\d+)');
    expect(compileCustomRule({ pattern: '', kind: 'word', category: 'meta' })).toBeNull();
    // An escaped parenthesis is a literal one and must stay that way.
    const literal = new RegExp(compileCustomRule({ pattern: '\\(config\\)', kind: 'regex', category: 'meta' })!, 'gi');
    expect('router(config)# '.match(literal)).toEqual(['(config)']);
    // Wrapped in a named group the way the highlighter does it, a
    // plain capturing group inside the rule changes nothing.
    const wrapped = new RegExp(`(?<h0>${compileCustomRule({ pattern: '(a|b)-(\\d+)', kind: 'regex', category: 'meta' })})`, 'gi');
    const match = wrapped.exec('port a-12 up');
    expect(match?.groups?.h0).toBe('a-12');
  });
});
