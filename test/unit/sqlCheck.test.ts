import { describe, expect, it } from 'vitest';
import { checkQuery } from '../../src/shared/sqlCheck';

const reason = (sql: string) => {
  const check = checkQuery(sql);
  return check.ok ? 'ok' : check.reason;
};

describe('checkQuery', () => {
  it('runs statements that read', () => {
    for (const sql of [
      'SELECT * FROM t',
      'select 1;',
      '  -- the first rows\n  SELECT * FROM "a;b" WHERE x = \';\' LIMIT 10 ;  ',
      'VALUES (1, 2), (3, 4)',
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT i FROM n',
      'WITH x AS MATERIALIZED (VALUES (1)) VALUES (2)',
      'EXPLAIN QUERY PLAN SELECT * FROM t WHERE id = 1',
      'EXPLAIN SELECT 1',
      'PRAGMA table_info("my table")',
      'PRAGMA main.index_list(t)',
      'PRAGMA table_info(şehir)',
      'pragma quick_check(10)',
      'PRAGMA integrity_check',
      'PRAGMA user_version;',
      '/* a comment; with a semicolon */ SELECT [odd;name] FROM `t;`',
    ]) {
      expect(reason(sql), sql).toBe('ok');
    }
  });

  it('turns down statements that write or reach other files', () => {
    for (const sql of [
      'DELETE FROM t',
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET x = 1',
      'DROP TABLE t',
      'CREATE TEMP TABLE z (a)',
      "VACUUM INTO 'copy.db'",
      "ATTACH 'other.db' AS other",
      'DETACH other',
      'BEGIN',
      'ANALYZE',
      'REINDEX',
      'WITH x AS (SELECT 1) DELETE FROM t',
      'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x',
      'EXPLAIN DELETE FROM t',
      'PRAGMA user_version = 3',
      'PRAGMA query_only = OFF',
      'PRAGMA query_only(0)',
      'PRAGMA journal_mode = DELETE',
      'PRAGMA wal_checkpoint',
      'PRAGMA optimize',
      'PRAGMA table_info(t, u)',
    ]) {
      expect(reason(sql), sql).toBe('writes');
    }
  });

  it('runs one statement at a time', () => {
    expect(reason('SELECT 1; SELECT 2')).toBe('several');
    expect(reason("SELECT 1; VACUUM INTO 'x.db'")).toBe('several');
    expect(reason('SELECT 1;; ')).toBe('ok');
  });

  it('needs a statement', () => {
    expect(reason('')).toBe('empty');
    expect(reason('  ;  -- nothing here\n /* nor here */')).toBe('empty');
  });
});
