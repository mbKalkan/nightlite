# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Metadata** for MBTiles, in the sidebar under the tile browser: the tileset's metadata as a
  form. Change, add or remove keys; values are checked against the MBTiles 1.3 spec as you type,
  and minzoom and maxzoom against the tiles, without stopping a save. Changes are marked and the
  editor tab shows them unsaved; **Save** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) writes them into the
  file in one transaction, **Undo** takes back a field's typing at once, **Revert** drops them,
  and VS Code keeps them if it closes before you save. If another program changed the file
  since, Nightlite asks first; if the file is locked or read-only, it says so and keeps your
  changes. This is the only time Nightlite writes to a file.
- A tile browser for MBTiles, in the sidebar under the overview. Pick a zoom level, type a
  tile's z/x/y, paste a tile URL, or pick a tile from the zoom level's list, which scrolls
  through millions of tiles. The arrow keys move to the neighboring tiles and <kbd>+</kbd> and
  <kbd>−</kbd> between zoom levels; rows are numbered as in tile URLs (XYZ) or as MBTiles stores
  them (TMS). The summary's zoom levels open the browser there.
- Vector tiles are drawn layer by layer, with each layer's features counted by geometry type;
  layers can be shown or hidden. Raster tiles show as images. Every tile shows its size as
  stored and, for compressed tiles, uncompressed.
- Point at a feature of a vector tile to see its attributes with their types, 64-bit integers
  to the last digit; every feature under the pointer is listed, topmost first. A click keeps
  them in view, <kbd>[</kbd> and <kbd>]</kbd> step through the tile's features, and
  <kbd>Escape</kbd> lets go.
- **Save Tile…** writes the tile shown to a file you pick, named by its address, like
  `14-8723-5412.pbf`: images as they are, vector tiles uncompressed, or gzip-compressed when the
  name ends in `.gz`. Nothing is written to the tileset.
- Cell details show a BLOB that holds an image (PNG, JPEG, WebP, GIF) as the picture, with its
  size in pixels, and one that holds text as the text, JSON indented and colored. **Hex** shows
  the bytes instead, and stays picked for the next BLOBs until you switch back.
- **Copy as Markdown Table**, in the grid's context menu and the Command Palette: the selected
  cells as a Markdown table headed by their column names, columns lined up and numbers aligned
  to the right, ready to paste into a README, an issue or a chat. A right click selects the cell
  it's on, unless it's on the selection.

## [0.1.0] - 2026-10-14

First preview release: SQLite databases, MBTiles and GeoPackages, read-only, at any size.

### Added

- SQLite databases (`.sqlite`, `.sqlite3`, `.db`, `.db3`), MBTiles (`.mbtiles`) and GeoPackage (`.gpkg`)
  files open in Nightlite. It reads only the file's header, so even very large files open at
  once, and shows what kind of file it is, its size, pages, text encoding and journal mode.
  Files that aren't SQLite databases, or are encrypted or empty, are explained in plain words,
  with **Reopen With…** at hand for a `.db` file that belongs to another program.
- A database opens on an overview: the file's facts, how many tables, views, indexes and triggers
  it holds, and every table with its rows and columns, counted in the background and drawn to
  scale. A table's name opens it.
- A sidebar lists the database's tables, views, indexes and triggers, with how many of each.
  Pick one to see its rows or the statement that created it, with its traits (virtual,
  `WITHOUT ROWID`, `STRICT`, SQLite's own). Move through the list with the arrow keys or by
  typing a name, as in VS Code's own lists.
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
- **Data** and **Schema** tabs switch between a table's rows and its schema. The Schema page lists
  the columns (type, primary key, NOT NULL, default, generated and hidden columns), the indexes
  (with their columns, UNIQUE, partial, and the ones SQLite made for a constraint) and the foreign
  keys, above the statement that created the table. An index's page lists its key columns.
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
  are recognized. Long values, like a legend with an embedded image, are cut short there; the
  metadata table shows them in full.
- Views that quote strings with double quotes, as GDAL writes them into GeoPackages
  (`st_geometry_columns`), read as they do in SQLite's own shell instead of failing.
- When the file changes on disk, the viewer reloads it and comes back to the same table, rows and
  selected cell. Each table also keeps its place while you look at others.
- Dark, light and high contrast themes, keyboard and screen reader support, and English and
  Turkish.

[Unreleased]: https://github.com/mbKalkan/nightlite/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mbKalkan/nightlite/releases/tag/v0.1.0
