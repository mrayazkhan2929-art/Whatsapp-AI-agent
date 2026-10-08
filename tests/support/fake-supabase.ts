type Row = Record<string, any>
type Filter = (row: Row) => boolean

// In-memory dependency double, not a PostgreSQL/RLS simulator. Used with real middleware/routes/router.
export function fakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables = structuredClone(seed)
  let sequence = 0
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = []
  const from = (table: string) => {
    tables[table] ??= []
    const filters: Filter[] = []
    const trace = { table, filters: [] as Array<[string, string, unknown]> }
    queries.push(trace)
    let action = 'read'
    let values: Row[] = []
    let conflict: string[] = []
    let max = Infinity
    let offset = 0
    let single = false
    const query: any = {
      select: () => query,
      order: () => query,
      limit: (count: number) => { max = count; return query },
      range: (start: number, end: number) => { offset=start; max=end-start+1; return query },
      eq: (key: string, value: unknown) => { filters.push((r) => r[key] === value); trace.filters.push(['eq', key, value]); return query },
      in: (key: string, value: unknown[]) => { filters.push((r) => value.includes(r[key])); return query },
      gte: (key: string, value: number) => { filters.push((r) => r[key] >= value); return query },
      lte: (key: string, value: number) => { filters.push((r) => r[key] <= value); return query },
      ilike: (key: string, value: string) => { filters.push((r) => String(r[key]).toLowerCase().includes(value.replaceAll('%', '').toLowerCase())); return query },
      insert: (input: Row | Row[]) => { action = 'insert'; values = Array.isArray(input) ? input : [input]; return query },
      upsert: (input: Row, options?: { onConflict: string }) => { action = 'upsert'; values = [input]; conflict = (options?.onConflict ?? 'id').split(','); return query },
      update: (input: Row) => { action = 'update'; values = [input]; return query },
      single: () => { single = true; return query },
      maybeSingle: () => { single = true; return query },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        try {
          let rows = tables[table].filter((row) => filters.every((filter) => filter(row)))
          if (action === 'insert' || action === 'upsert') {
            rows = values.map((value) => {
              const existing = action === 'upsert' ? tables[table].find((row) => conflict.every((key) => row[key] === value[key])) : undefined
              if (existing) { Object.assign(existing, value); return existing }
              const row = { id: `fixture-${++sequence}`, language: 'en', contact_memory: {}, ...value }
              tables[table].push(row)
              return row
            })
          } else if (action === 'update') rows.forEach((row) => Object.assign(row, values[0]))
          rows = rows.slice(offset, offset+max)
          return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }))
        } catch (error) { return Promise.resolve(reject(error)) }
      },
    }
    return query
  }
  return { from, tables, queries }
}
