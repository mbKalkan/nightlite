import type { SQLInputValue } from 'node:sqlite';
import type { ColumnInfo } from '../../shared/protocol';
import { parseFilter, type RowView } from '../../shared/rowFilter';
import { quote } from './rows';

/** A filter's value as SQLite should compare it: numbers as numbers, so `>9` passes 10. */
export function filterValue(text: string): SQLInputValue {
  if (/^[+-]?\d+$/.test(text)) {
    const big = BigInt(text);
    if (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(big);
    }
    // Beyond 64 bits SQLite holds it as a real anyway.
    return big >= -(2n ** 63n) && big < 2n ** 63n ? big : Number(text);
  }
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

/** A LIKE pattern for text anywhere in a value, its own % and _ taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * The WHERE and ORDER BY that show a table's rows as `view` asks (D-022). Per-column filters and
 * the search all apply; the search passes over BLOBs by their type, without reading them.
 */
export function viewClauses(
  columns: ColumnInfo[],
  view: RowView,
): { where: string; params: SQLInputValue[]; order: string } {
  const tests: string[] = [];
  const params: SQLInputValue[] = [];
  view.filters.forEach((text, index) => {
    const column = columns[index];
    const test = column && parseFilter(text);
    if (!test) return;
    const name = quote(column.name);
    switch (test.op) {
      case 'null':
        tests.push(`${name} IS NULL`);
        return;
      case 'notNull':
        tests.push(`${name} IS NOT NULL`);
        return;
      case 'contains':
        tests.push(`${name} LIKE ? ESCAPE '\\'`);
        params.push(contains(test.value));
        return;
      default:
        tests.push(`${name} ${test.op} ?`);
        params.push(filterValue(test.value));
    }
  });
  const search = view.search.trim();
  if (search && columns.length > 0) {
    const any = columns.map(({ name }) => {
      const c = quote(name);
      return `(typeof(${c}) <> 'blob' AND ${c} LIKE ? ESCAPE '\\')`;
    });
    tests.push(`(${any.join(' OR ')})`);
    params.push(...columns.map(() => contains(search)));
  }
  const sorted = view.order && columns[view.order.column];
  return {
    where: tests.length > 0 ? `WHERE ${tests.join(' AND ')}` : '',
    params,
    order: sorted ? `${quote(sorted.name)} ${view.order?.descending ? 'DESC' : 'ASC'}` : '',
  };
}
