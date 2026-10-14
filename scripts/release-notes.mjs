// Prints the CHANGELOG.md section of a version, for the GitHub release notes.
// Usage: node scripts/release-notes.mjs 0.1.0
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = version ? changelog.search(new RegExp(`^## \\[${escaped}\\]`, 'm')) : -1;
if (start < 0) {
  console.error(`CHANGELOG.md has no section for version ${version}`);
  process.exit(1);
}
const body = changelog.slice(changelog.indexOf('\n', start) + 1);
const end = body.search(/^## \[/m);
const section = end < 0 ? body : body.slice(0, end);
// The link definitions at the end of the file belong to no section.
console.log(section.replace(/^\[[^\]]+\]: .*$/gm, '').trim());
