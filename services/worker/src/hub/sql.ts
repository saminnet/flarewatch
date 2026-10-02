export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/** The part of Durable Object SQL storage the hub uses. Tests back it with node:sqlite. */
export interface Sql {
  exec<T extends SqlRow>(query: string, ...bindings: SqlValue[]): T[];
  /** Runs fn in one transaction and rolls it back if fn throws. fn must be synchronous. */
  transaction<T>(fn: () => T): T;
}

export function durableObjectSql(storage: DurableObjectStorage): Sql {
  return {
    exec: <T extends SqlRow>(query: string, ...bindings: SqlValue[]) =>
      storage.sql.exec<T>(query, ...bindings).toArray(),
    transaction: (fn) => storage.transactionSync(fn),
  };
}

/** A JSON column's value, or undefined when it is null or not JSON. */
export function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
