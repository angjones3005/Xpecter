import { describe, expect, it } from 'vitest';
import { DEFAULT_TAG_STYLES, isGuarded, parseTagStyles, serializeTagStyles, tagStyleFor } from './tags';

describe('parseTagStyles', () => {
  it('starts from the defaults', () => {
    const styles = parseTagStyles(null);
    expect(styles.prod).toEqual({ colour: '#e5484d', guard: true });
    expect(styles.dev.guard).toBe(false);
  });

  it('applies stored changes over the defaults and drops nulls', () => {
    const styles = parseTagStyles(JSON.stringify({
      Prod: { colour: '#AA00FF', guard: false },
      customer: { colour: '#123456', guard: true },
      dev: null,
      broken: { colour: 'red' },
    }));
    expect(styles.prod).toEqual({ colour: '#aa00ff', guard: false });
    expect(styles.customer).toEqual({ colour: '#123456', guard: true });
    expect(styles.dev).toBeUndefined();
    expect(styles.broken).toBeUndefined();
    expect(styles.staging).toEqual(DEFAULT_TAG_STYLES.staging);
  });

  it('survives garbage', () => {
    expect(parseTagStyles('{not json')).toEqual(DEFAULT_TAG_STYLES);
    expect(parseTagStyles('[1,2]')).toEqual(DEFAULT_TAG_STYLES);
  });
});

describe('serializeTagStyles', () => {
  it('stores only what differs from the defaults', () => {
    const styles = parseTagStyles(null);
    styles.prod = { colour: '#ff0000', guard: true };
    styles.customer = { colour: '#123456', guard: false };
    delete styles.lab;
    const stored = JSON.parse(serializeTagStyles(styles));
    expect(stored).toEqual({
      prod: { colour: '#ff0000', guard: true },
      customer: { colour: '#123456', guard: false },
      lab: null,
    });
    // And reads back to the same thing.
    expect(parseTagStyles(JSON.stringify(stored))).toEqual(styles);
  });
});

describe('tagStyleFor and isGuarded', () => {
  const styles = parseTagStyles(null);
  it('picks the first styled tag, case-insensitively', () => {
    expect(tagStyleFor(['datacentre', 'PROD'], styles)).toEqual({ tag: 'prod', style: DEFAULT_TAG_STYLES.prod });
    expect(tagStyleFor(['dev', 'prod'], styles)?.tag).toBe('dev');
    expect(tagStyleFor(['nothing'], styles)).toBeNull();
    expect(tagStyleFor(undefined, styles)).toBeNull();
  });
  it('guards a session tagged prod anywhere in its tags', () => {
    expect(isGuarded(['lab', 'Production'], styles)).toBe(true);
    expect(isGuarded(['lab', 'staging'], styles)).toBe(false);
    expect(isGuarded(undefined, styles)).toBe(false);
  });
});
