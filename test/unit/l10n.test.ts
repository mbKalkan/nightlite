import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return sourceFiles(join(dir, entry.name));
    }
    return entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [];
  });
}

const messages = sourceFiles('src/extension').flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/l10n\.t\(\s*(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]),
);

const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();

describe('localization bundle', () => {
  const turkish = JSON.parse(readFileSync('l10n/bundle.l10n.tr.json', 'utf8')) as Record<
    string,
    string
  >;

  it('finds the localized messages in the source', () => {
    expect(messages.length).toBeGreaterThan(5);
  });

  it('translates every message into Turkish', () => {
    expect(messages.filter((message) => !(message in turkish))).toEqual([]);
  });

  it('keeps the same placeholders in translations', () => {
    for (const message of messages) {
      expect(placeholders(turkish[message] ?? ''), message).toEqual(placeholders(message));
    }
  });

  it('has no translations left over from removed messages', () => {
    expect(Object.keys(turkish).filter((key) => !messages.includes(key))).toEqual([]);
  });
});
