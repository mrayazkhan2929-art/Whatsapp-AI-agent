import { runtimeConfigResolver as effectiveResolver } from '../config/RuntimeConfigResolver.js'

/** Foundation for runtime configuration. No cross-tenant or source-code fallback. */
export class RuntimeConfigResolver {
  async resolve(orgId: string) {
    return effectiveResolver.resolveCompany(orgId)
  }
}
export const runtimeConfigResolver = new RuntimeConfigResolver()
