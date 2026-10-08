# Phase 1 authorization and tenant isolation

Supabase Auth verifies the token. The backend `/api/v1/auth/me` resolves application membership, and frontend login, API handlers and protected pages consume that endpoint. Configure `BACKEND_URL` and the existing Supabase server/Auth variables for both applications. A missing/unreachable auth service returns 503; database lookup errors return 500. Invalid identities return 401. Missing mappings return 403 with `ONBOARDING_REQUIRED`; inactive or ambiguous membership returns 403.

A direct user-ID membership takes precedence and cannot fall through when disabled. Only when no direct mapping exists can a confirmed email resolve exactly one stored membership. Inactive duplicates also make that email ambiguous. Membership must be active, its organization must exist, and its role must be valid. Identity metadata and request organization fields do not authorize access. Resolution performs no mapping writes. Login sets its existing cookies only after membership authorization succeeds.

Tenant reads, counts, mutations and joins use the server organization. Related IDs are checked before writes or transport/provider calls. Normalized memory is scoped through its owning contact. Mixed-tenant conversation bulk requests fail before any mutation. Deletion guards return 409 when malformed legacy relationships could cascade into another tenant; foreign resource IDs return 404. These guards inspect only dependency ownership violations and expose no foreign row contents.

The privileged WhatsApp startup operation still enumerates configured devices to restore them; each subsequent operation uses that device's stored organization. Operator CSV import scripts are outside HTTP authentication and were not changed. Static company/team routing and later-phase AI, deduplication, handoff and distributed ownership work remain unchanged.

`017_tenant_data_api_guard.sql` closes inherited REST bypasses in `ai_agents`, `whatsapp_devices`, `conversation_flows` and `wa_session_keys` by using invoker security. Direct anonymous/authenticated access to `contact_memory` is revoked; service-role access remains available behind contact ownership checks. PostgreSQL 15+ is required. No live database was accessed or migrated. This additive migration was separately authorized by the user after reviewing a disposable-stack validation of the proposed SQL.

## Reproduce verification

Run `node scripts/phase1-verify.mjs` from the repository root. It collects actual results for clean installation, application/test typechecks, lint, build, all existing suites, browser tests, tenant strict gate and the database-backed HTTP suite. It deliberately exits nonzero for the inherited lint/full strict failures rather than hiding them. Individual gates are `npm run test:tenant:strict` and `npm run test:tenant:db`.

The database suite needs Docker Desktop with Linux containers. It uses the DB/Auth/REST images from Supabase `self-hosted/v0.8.2`, unique Compose names, loopback ports, temporary Docker storage and generated local credentials. It refuses live environment files, clears application environment variables in child processes, replays all active SQL in numeric/filename order and checks the additive migration against populated historical data without changing existing rows. Replay errors fail visibly. Outbound transport/provider seams are isolated. Real Auth tokens, PostgreSQL, REST and both application HTTP surfaces are exercised.

Only the suite's unique stack is removed in cleanup. Evidence and generated **local** credentials remain in ignored `test-results/phase1-db-*`; do not publish those raw configuration or container logs. Curated credential-free evidence is copied under `docs/phase1/logs`. No native CLI policy bypass is used.

The query inventory is a manual audit aid, not an automated security proof. Organization-table primary-key filters, initial membership lookups, memory parent checks, inserts with server-derived organization values and dependency-conflict probes need separate interpretation. Tests include malformed foreign joins and cascading links, positive own-tenant operations and byte-equivalent Tenant B snapshots after every case.

The Phase 0 manifest is immutable. Its preservation test checks the original manifest digest and allows only explicit Phase 1 production paths listed in `change-allowlist.json`. Historical SQL and the master prompt are preserved. Phase 2 is not implemented; its future migration numbering starts at `018`.
