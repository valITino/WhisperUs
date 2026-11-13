// Postgres speaks snake_case, the app speaks camelCase. Only top-level column names
// are converted: jsonb columns (layers, seen, reply, prefs) are authored by
// the app and stay camelCase inside.

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

export function snakeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[toSnake(k)] = v
  return out
}

export function camelKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v
  return out
}

/** Postgres returns numeric columns as strings through the API; bring them back to numbers. */
const NUMERIC_FIELDS: Record<string, readonly string[]> = {}

export function reviveRow(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const fields = NUMERIC_FIELDS[table]
  if (!fields) return row
  for (const f of fields) {
    if (typeof row[f] === 'string') row[f] = Number(row[f])
  }
  return row
}
