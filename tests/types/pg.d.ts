// The existing pg runtime is used only for explicit role checks in the disposable DB.
declare module 'pg' {
  class Client {
    constructor(options: { connectionString: string })
    connect(): Promise<void>
    query(text: string, values?: unknown[]): Promise<{rows: Record<string, unknown>[]}>
    end(): Promise<void>
  }
  const pg: {Client: typeof Client}
  export default pg
}
