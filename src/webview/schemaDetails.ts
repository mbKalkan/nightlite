import type { ObjectDetails, ViewerStrings } from '../shared/protocol';
import { element, format } from './views';

type Cell = string | { text: string; className: string };

/** An object's columns, indexes and foreign keys, as lists above its CREATE statement. */
export function detailsSections(details: ObjectDetails, strings: ViewerStrings): HTMLElement[] {
  const sections: HTMLElement[] = [];
  const code = (text: string): Cell => ({ text, className: 'nl-code' });
  const columns = details.columns ?? [];
  if (columns.length) {
    // A primary key over several columns numbers them in key order.
    const composite = columns.filter((column) => column.primaryKey > 0).length > 1;
    const rows = columns.map((column, index): Cell[] => {
      const constraints: string[] = [];
      if (column.primaryKey)
        constraints.push(composite ? `PRIMARY KEY ${column.primaryKey}` : 'PRIMARY KEY');
      if (column.notNull) constraints.push('NOT NULL');
      if (column.defaultValue !== null) constraints.push(`DEFAULT ${column.defaultValue}`);
      if (column.generated) constraints.push('GENERATED');
      if (column.hidden) constraints.push('HIDDEN');
      return [String(index + 1), code(column.name), code(column.type), constraints.join(' · ')];
    });
    sections.push(
      section(
        strings.columnsHeading,
        table(['#', strings.nameColumn, strings.typeColumn, strings.constraintsColumn], rows),
      ),
    );
  }
  const keyColumns = details.indexColumns ?? [];
  if (keyColumns.length) {
    const rows = keyColumns.map((column, index): Cell[] => {
      const traits: string[] = [];
      if (column.descending) traits.push('DESC');
      if (column.collation.toUpperCase() !== 'BINARY') traits.push(`COLLATE ${column.collation}`);
      return [String(index + 1), code(column.name ?? strings.expression), traits.join(' · ')];
    });
    sections.push(
      section(
        strings.columnsHeading,
        table(['#', strings.nameColumn, strings.constraintsColumn], rows),
      ),
    );
  }
  const indexes = details.indexes ?? [];
  if (indexes.length) {
    const rows = indexes.map((index): Cell[] => {
      const traits: string[] = [];
      if (index.unique) traits.push('UNIQUE');
      if (index.partial) traits.push(strings.partialIndex);
      if (index.origin !== 'c') {
        traits.push(
          format(strings.automaticIndex, index.origin === 'pk' ? 'PRIMARY KEY' : 'UNIQUE'),
        );
      }
      const names = index.columns.map((name) => name ?? strings.expression).join(', ');
      return [code(index.name), code(names), traits.join(' · ')];
    });
    sections.push(
      section(
        strings.indexes,
        table([strings.nameColumn, strings.columnsHeading, strings.constraintsColumn], rows),
      ),
    );
  }
  const keys = details.foreignKeys ?? [];
  if (keys.length) {
    const rows = keys.map((key): Cell[] => {
      const target = key.to.every((name) => name === null)
        ? key.table
        : `${key.table} (${key.to.map((name) => name ?? '?').join(', ')})`;
      const actions: string[] = [];
      if (key.onUpdate !== 'NO ACTION') actions.push(`ON UPDATE ${key.onUpdate}`);
      if (key.onDelete !== 'NO ACTION') actions.push(`ON DELETE ${key.onDelete}`);
      return [code(`${key.from.join(', ')} → ${target}`), actions.join(' · ')];
    });
    sections.push(
      section(
        strings.foreignKeysHeading,
        table([strings.columnsHeading, strings.constraintsColumn], rows),
      ),
    );
  }
  return sections;
}

function section(title: string, content: HTMLElement): HTMLElement {
  const part = element('section', 'nl-section');
  part.append(element('h2', 'nl-heading', title), content);
  return part;
}

function table(headers: string[], rows: Cell[][]): HTMLElement {
  const grid = element('table', 'nl-schema-table');
  const head = element('tr', '');
  for (const header of headers) head.append(element('th', '', header));
  const thead = element('thead', '');
  thead.append(head);
  const tbody = element('tbody', '');
  for (const row of rows) {
    const line = element('tr', '');
    for (const cell of row) {
      line.append(
        typeof cell === 'string'
          ? element('td', '', cell)
          : element('td', cell.className, cell.text),
      );
    }
    tbody.append(line);
  }
  grid.append(thead, tbody);
  return grid;
}
