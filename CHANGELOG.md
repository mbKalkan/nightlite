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
