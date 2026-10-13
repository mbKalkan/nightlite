import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount } from '../../src/shared/units';

describe('formatBytes', () => {
  it('uses the largest unit that keeps the number at or above one', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1023, 'en')).toBe('1,023 B');
    expect(formatBytes(4096, 'en')).toBe('4 KB');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(24.3 * 1024 ** 3, 'en')).toBe('24.3 GB');
  });

  it('writes numbers the way the locale does', () => {
    expect(formatBytes(1536, 'tr')).toBe('1,5 KB');
  });
});

describe('formatCount', () => {
  it('groups digits by locale', () => {
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
    expect(formatCount(1234567, 'tr')).toBe('1.234.567');
  });
});
