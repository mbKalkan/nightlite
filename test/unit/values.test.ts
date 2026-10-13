import { describe, expect, it } from 'vitest';
import { realText, tsvField } from '../../src/shared/values';

describe('realText', () => {
  it('keeps whole reals looking like reals', () => {
    expect(realText(14)).toBe('14.0');
    expect(realText(-3)).toBe('-3.0');
    expect(realText(0.1)).toBe('0.1');
    expect(realText(1e300)).toBe('1e+300');
    expect(realText(Infinity)).toBe('Infinity');
  });
});

describe('tsvField', () => {
  it('quotes only fields that would break the rows or columns', () => {
    expect(tsvField('plain text')).toBe('plain text');
    expect(tsvField('a\tb')).toBe('"a\tb"');
    expect(tsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(tsvField('say "hi"')).toBe('"say ""hi"""');
  });
});
