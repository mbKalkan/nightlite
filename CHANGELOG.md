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
- Tables and views open on their rows: a grid that scrolls smoothly through millions of rows and
  jumps anywhere at once, even in files of tens of gigabytes, reading only the rows in view.
  Rowid tables show their rowids, other tables and views number their rows.
- Every value shows as it is stored: integers stay exact beyond 2^53, a REAL keeps its decimal
  point, NULL stands apart from text, line breaks and tabs show as symbols, long text is cut with
  an ellipsis, and BLOBs say what they hold (PNG, JPEG, WebP, gzip, GeoPackage geometry…) and how
  big they are.
- Column headers show each column's declared type and primary key.
- The status bar counts rows in the background and shows the estimate meanwhile.
- **Data** and **Schema** tabs switch between a table's rows and the statement that created it.
- Select cells as in a spreadsheet: click, <kbd>Shift</kbd>+click or drag; click a row or column
  header for the whole row or column, or the corner for everything. Move with the arrow keys,
  <kbd>Page Up</kbd>/<kbd>Page Down</kbd>, <kbd>Home</kbd>/<kbd>End</kbd> and <kbd>Ctrl</kbd> with
  any of them; add <kbd>Shift</kbd> to extend; <kbd>Ctrl</kbd>+<kbd>A</kbd> selects all.
- The status bar shows the selected cell's rowid, column, storage class and value, or the size of
  the selection.
- <kbd>Ctrl</kbd>+<kbd>C</kbd> copies the selection with full values, even where the grid cuts
  them short: one cell as it is, more as tab-separated text that spreadsheets paste into columns,
  BLOBs as hex. A copy holds up to a million rows or 16 MB.
- A cell detail panel beside the rows shows the selected cell in full: JSON indented and colored
  (numbers keep every digit), long text wrapped, BLOBs as a hex dump with what they hold, and a
  button to copy the value. Open it from the toolbar, with <kbd>Enter</kbd> or by double-clicking
  a cell; <kbd>Escape</kbd> goes back to the grid. Drag its edge to resize it; it remembers its
  width and whether it was open.
- MBTiles open on a summary of the tileset: its name, description and kind (vector or raster),
  tiles by zoom level counted in the background (71 million tiles in about a second and a half),
  its vector layers with their fields, zoom levels and, where the tileset records them, feature
  counts, and its metadata as the MBTiles 1.3 spec reads it. Missing or unreadable keys, and zoom
  levels the tiles contradict, are pointed out. Deduplicated tilesets, where `tiles` is a view,
  are recognized.
