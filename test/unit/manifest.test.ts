import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_EXTENSIONS } from '../../src/shared/formats';

const readJson = (path: string) =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const manifest = readJson('package.json') as {
  engines: { vscode: string };
  extensionKind: string[];
  contributes: {
    customEditors: { selector: { filenamePattern: string }[] }[];
    languages: { id: string; extensions: string[] }[];
  };
  keywords: string[];
  devDependencies: Record<string, string>;
};

describe('extension manifest', () => {
  it('targets the same VS Code API version as @types/vscode', () => {
    const engine = manifest.engines.vscode.replace(/^\^/, '');
    const types = manifest.devDependencies['@types/vscode'].replace(/^[\^~]/, '');
    expect(types).toBe(engine);
  });

  it('runs where the files are, since databases are read in place, not copied over', () => {
    expect(manifest.extensionKind[0]).toBe('workspace');
  });

  it('opens exactly the file types it supports by default', () => {
    const patterns = manifest.contributes.customEditors.flatMap((editor) =>
      editor.selector.map((selector) => selector.filenamePattern),
    );
    expect(patterns.sort()).toEqual(SUPPORTED_EXTENSIONS.map((ext) => `*${ext}`).sort());
  });

  it('declares the same file types as languages, so the Marketplace lists it for them', () => {
    const extensions = manifest.contributes.languages.flatMap((language) => language.extensions);
    expect(extensions.sort()).toEqual([...SUPPORTED_EXTENSIONS].sort());
  });

  it('uses language ids no other extension is likely to claim for text files', () => {
    expect(manifest.contributes.languages.map((language) => language.id)).not.toContain('sqlite');
  });

  it('stays within the Marketplace limit of 30 keywords', () => {
    expect(manifest.keywords.length).toBeLessThanOrEqual(30);
    expect(new Set(manifest.keywords).size).toBe(manifest.keywords.length);
  });

  it('defines every %placeholder% in each package.nls file', () => {
    const placeholders = [...JSON.stringify(manifest).matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]);
    expect(placeholders.length).toBeGreaterThan(0);
    for (const file of ['package.nls.json', 'package.nls.tr.json']) {
      const nls = readJson(file);
      for (const key of placeholders) {
        expect(nls, `${file} is missing "${key}"`).toHaveProperty([key]);
      }
    }
  });

  it('keeps the English and Turkish manifest strings in sync', () => {
    const en = Object.keys(readJson('package.nls.json')).sort();
    const tr = Object.keys(readJson('package.nls.tr.json')).sort();
    expect(tr).toEqual(en);
  });
});
