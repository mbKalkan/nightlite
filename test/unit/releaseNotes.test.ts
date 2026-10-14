import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/release-notes.mjs');
const folder = mkdtempSync(join(tmpdir(), 'nightlite-notes-'));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

writeFileSync(
  join(folder, 'CHANGELOG.md'),
  [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.2.0] - 2026-11-01',
    '',
    '### Added',
    '',
    '- Tiles',
    '',
    '## [0.1.0] - 2026-10-20',
    '',
    '- First release',
    '',
    '[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0',
  ].join('\r\n'),
);

/** The release notes the release workflow would print for a version. */
const notes = (version: string) =>
  spawnSync(process.execPath, [SCRIPT, version], { cwd: folder, encoding: 'utf8' });

describe('release notes', () => {
  it("print a version's changelog section, without the links at the end", () => {
    expect(notes('0.2.0').stdout.trim()).toBe('### Added\n\n- Tiles');
    expect(notes('v0.1.0').stdout.trim()).toBe('- First release');
  });

  it('fail for a version the changelog has no section for', () => {
    const result = notes('9.9.9');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no section for version 9.9.9');
  });
});
