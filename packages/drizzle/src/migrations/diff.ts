/**
 * Snapshot diff.
 *
 * Produces a `SchemaDiff` describing how to transform `from` into `to`.
 * Tables and columns are matched by name; renames are NOT detected
 * (intentional — see the header comment on emitted migration files).
 *
 * Column equivalence is field-by-field: logical type, nullable,
 * default, primary key, and foreign key. Any difference in any of
 * those dimensions produces a `ColumnChange` with the specific
 * `kind`s populated so the emitter can choose the narrowest ALTER
 * statement per dialect.
 */

import type { ColumnDescriptor } from '../codegen/types.js';
import type {
  ColumnChange,
  ColumnChangeKind,
  RouterSnapshot,
  SchemaDiff,
  TableChange,
} from './types.js';

export function diffSnapshots(
  from: RouterSnapshot | null,
  to: RouterSnapshot,
): SchemaDiff {
  const diff: SchemaDiff = {
    tablesAdded: [],
    tablesDropped: [],
    tableChanges: [],
  };

  if (from === null) {
    diff.tablesAdded = [...to.tables];
    return diff;
  }

  const fromByName = new Map(from.tables.map((t) => [t.tableName, t]));
  const toByName = new Map(to.tables.map((t) => [t.tableName, t]));

  for (const [name, table] of toByName) {
    if (!fromByName.has(name)) {
      diff.tablesAdded.push(table);
    }
  }

  for (const [name, table] of fromByName) {
    if (!toByName.has(name)) {
      diff.tablesDropped.push(table);
    }
  }

  for (const [name, fromTable] of fromByName) {
    const toTable = toByName.get(name);
    if (!toTable) continue;
    const change = diffTable(name, fromTable.columns, toTable.columns);
    if (
      change.columnsAdded.length > 0 ||
      change.columnsDropped.length > 0 ||
      change.columnsChanged.length > 0
    ) {
      diff.tableChanges.push(change);
    }
  }

  return diff;
}

function diffTable(
  tableName: string,
  fromCols: readonly ColumnDescriptor[],
  toCols: readonly ColumnDescriptor[],
): TableChange {
  const change: TableChange = {
    table: tableName,
    columnsAdded: [],
    columnsDropped: [],
    columnsChanged: [],
  };

  const fromByName = new Map(fromCols.map((c) => [c.columnName, c]));
  const toByName = new Map(toCols.map((c) => [c.columnName, c]));

  for (const [name, col] of toByName) {
    if (!fromByName.has(name)) change.columnsAdded.push(col);
  }
  for (const [name, col] of fromByName) {
    if (!toByName.has(name)) change.columnsDropped.push(col);
  }
  for (const [name, fromCol] of fromByName) {
    const toCol = toByName.get(name);
    if (!toCol) continue;
    const kinds = columnDiffKinds(fromCol, toCol);
    if (kinds.length > 0) {
      const entry: ColumnChange = {
        name,
        from: fromCol,
        to: toCol,
        kind: kinds,
      };
      change.columnsChanged.push(entry);
    }
  }

  return change;
}

function columnDiffKinds(
  a: ColumnDescriptor,
  b: ColumnDescriptor,
): ColumnChangeKind[] {
  const kinds: ColumnChangeKind[] = [];
  if (a.logicalType !== b.logicalType || !sameEnumValues(a, b)) {
    kinds.push('type');
  }
  if (a.notNull !== b.notNull) kinds.push('nullable');
  if (!sameDefault(a, b)) kinds.push('default');
  if (a.primaryKey !== b.primaryKey) kinds.push('primaryKey');
  if ((a.references ?? null) !== (b.references ?? null)) {
    kinds.push('foreignKey');
  }
  return kinds;
}

function sameEnumValues(
  a: ColumnDescriptor,
  b: ColumnDescriptor,
): boolean {
  const av = a.enumValues;
  const bv = b.enumValues;
  if (!av && !bv) return true;
  if (!av || !bv) return false;
  if (av.length !== bv.length) return false;
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) return false;
  }
  return true;
}

function sameDefault(a: ColumnDescriptor, b: ColumnDescriptor): boolean {
  const ad = a.default;
  const bd = b.default;
  if (!ad && !bd) return true;
  if (!ad || !bd) return false;
  if (ad.kind !== bd.kind) return false;
  if (ad.kind === 'literal' && bd.kind === 'literal') {
    return ad.value === bd.value;
  }
  return true;
}
