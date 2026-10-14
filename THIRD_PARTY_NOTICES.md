# Third-party notices

The packaged Nightlite extension contains no third-party code.

It reads databases with [SQLite](https://sqlite.org/), through the `node:sqlite` module of the
Node.js runtime that ships with VS Code. SQLite is in the
[public domain](https://sqlite.org/copyright.html); it isn't bundled with the extension.

The development tools in `package.json` (TypeScript, esbuild, ESLint, Prettier, Vitest,
Playwright and others) are used to build and test Nightlite and aren't part of the package.
