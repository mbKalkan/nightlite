# Security policy

Nightlite reads the files you open. It opens databases read-only, writes nothing to them or next
to them, loads no SQLite extensions, makes no network requests and shows data in a webview with a
strict Content Security Policy.

The one thing it writes is an MBTiles tileset's metadata, and only when you save changes you made
to it: on a connection of its own, closed right after, in one transaction, with Nightlite's own
parameterized statements, to the `metadata` table only. Metadata you type is bound as values,
never run as SQL.

The SQL Query page runs only statements that read: `SELECT`, `WITH … SELECT`, `VALUES`,
`EXPLAIN`, and `PRAGMA`s that report. Each statement is checked before it runs, one at a time,
so `ATTACH`, `VACUUM INTO` and everything that writes are turned down. Queries run on a
read-only connection of their own with `PRAGMA query_only` on, never on the connection that
saves metadata.

## Reporting a vulnerability

Please don't open a public issue for security problems. Report them privately with GitHub's
**Report a vulnerability** button on the repository's
[Security tab](https://github.com/mbKalkan/nightlite/security). Include the file or steps that
show the problem if you can.

You'll get a reply within a week. Fixes are released as soon as they're ready, and reporters are
credited unless they prefer not to be.

## Supported versions

Only the latest release receives fixes.
