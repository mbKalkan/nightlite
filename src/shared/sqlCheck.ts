/**
 * Whether a statement typed into the query page only reads (D-021). This is the gate: the
 * connection being read-only and `query_only` stop most writes, but not `VACUUM INTO`, which
 * writes a new file, nor `ATTACH`, which reads another one.
 */
export type QueryCheck = { ok: true } | { ok: false; reason: 'empty' | 'several' | 'writes' };

/** PRAGMAs that only report, read with no argument. */
const READ_PRAGMAS = new Set([
  'application_id',
  'auto_vacuum',
  'collation_list',
  'compile_options',
  'data_version',
  'database_list',
  'encoding',
  'foreign_keys',
  'freelist_count',
  'function_list',
  'journal_mode',
  'module_list',
  'page_count',
  'page_size',
  'pragma_list',
  'schema_version',
  'user_version',
]);

/** PRAGMAs that only report, and may name a table, an index or a limit. */
const ARGUMENT_PRAGMAS = new Set([
  'foreign_key_check',
  'foreign_key_list',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'quick_check',
  'table_info',
  'table_list',
  'table_xinfo',
]);

interface Token {
  kind: 'word' | 'name' | 'literal' | 'symbol';
  /** A word upper-cased, or the symbol; empty for quoted names and literals. */
  text: string;
}

export function checkQuery(sql: string): QueryCheck {
  const tokens = tokenize(sql);
  while (tokens.at(-1)?.text === ';') tokens.pop();
  if (tokens.length === 0) return { ok: false, reason: 'empty' };
  if (tokens.some((token) => token.text === ';')) return { ok: false, reason: 'several' };
  return reads(tokens) ? { ok: true } : { ok: false, reason: 'writes' };
}

function reads(tokens: Token[]): boolean {
  const first = tokens[0]?.text;
  switch (first) {
    case 'SELECT':
    case 'VALUES':
      return true;
    case 'WITH': {
      // The statement the common table expressions lead to is the first keyword outside them.
      let depth = 0;
      for (const { text } of tokens) {
        if (text === '(') depth++;
        else if (text === ')') depth--;
        else if (depth === 0 && /^(SELECT|VALUES|INSERT|UPDATE|DELETE|REPLACE)$/.test(text)) {
          return text === 'SELECT' || text === 'VALUES';
        }
      }
      return false;
    }
    case 'EXPLAIN': {
      const rest = tokens[1]?.text === 'QUERY' && tokens[2]?.text === 'PLAN' ? 3 : 1;
      return reads(tokens.slice(rest));
    }
    case 'PRAGMA':
      return readsPragma(tokens.slice(1));
    default:
      return false;
  }
}

/** `PRAGMA [schema.]name`, or `PRAGMA [schema.]name(argument)` for the ones that take one. */
function readsPragma(tokens: Token[]): boolean {
  const named = tokens[1]?.text === '.' ? tokens.slice(2) : tokens;
  const name = named[0]?.text.toLowerCase() ?? '';
  const rest = named.slice(1);
  if (rest.length === 0) return READ_PRAGMAS.has(name) || ARGUMENT_PRAGMAS.has(name);
  return (
    ARGUMENT_PRAGMAS.has(name) &&
    rest.length === 3 &&
    rest[0].text === '(' &&
    rest[1].kind !== 'symbol' &&
    rest[2].text === ')'
  );
}

/** SQLite's tokens, without whitespace and comments. */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      // Quotes are escaped by doubling them, so the next lone one closes.
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      tokens.push({ kind: c === "'" ? 'literal' : 'name', text: '' });
      i = j + 1;
    } else if (c === '[') {
      const end = sql.indexOf(']', i);
      tokens.push({ kind: 'name', text: '' });
      i = end < 0 ? sql.length : end + 1;
    } else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$\u0080-￿]/.test(sql[j])) j++;
      tokens.push({ kind: 'word', text: sql.slice(i, j).toUpperCase() });
      i = j;
    } else if (/[0-9.]/.test(c) && /[0-9]/.test(c === '.' ? (sql[i + 1] ?? '') : c)) {
      let j = i + 1;
      while (j < sql.length && /[0-9A-Za-z_.]/.test(sql[j])) j++;
      tokens.push({ kind: 'literal', text: '' });
      i = j;
    } else {
      tokens.push({ kind: 'symbol', text: c });
      i++;
    }
  }
  return tokens;
}
