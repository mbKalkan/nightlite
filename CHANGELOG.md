# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- SQLite databases (`.sqlite`, `.sqlite3`, `.db3`), MBTiles (`.mbtiles`) and GeoPackage (`.gpkg`)
  files open in Nightlite. It reads only the file's header, so even very large files open at
  once, and shows what kind of file it is, its size, pages, text encoding and journal mode.
  Files that aren't SQLite databases, or are encrypted or empty, are explained in plain words.
- A sidebar lists the database's tables, views, indexes and triggers, with how many of each.
  Pick one to see the statement that created it, with its traits (virtual, `WITHOUT ROWID`,
  `STRICT`, SQLite's own). Move through the list with the arrow keys or by typing a name, as in
  VS Code's own lists.
- **Go to Table…** (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>) finds a table, view, index or
  trigger as you type.
- Databases are opened read-only in a background thread, so VS Code stays responsive. Databases in
  write-ahead log mode open without creating `-wal` or `-shm` files next to them.
