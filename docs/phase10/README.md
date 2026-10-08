# Phase 10 — distributed device ownership and worker reliability

This document describes the implementation in the current repository. Phase 0–9 reports are immutable checkpoints; their runtime descriptions can be superseded by this phase. No Phase 11 work is included.

## Ownership and runtime flow

The database owns device admission. `device_runtime_lease` first locks the tenant-owned device, then checks a lease using the database clock. One socket incarnation receives an opaque owner UUID and increasing generation. A live competing owner is refused. Release, revoke or expired takeover advances generation. An expired handle cannot renew or resurrect itself.

Production leases last 30 seconds. Owners heartbeat every six seconds. A conservative monotonic deadline expires locally five seconds before the requested database TTL; request time counts against that deadline. Database failures invalidate the local handle, end the socket, stop owner queue consumption and unregister self-healing. Session writes and device/QR updates validate ownership inside the database transaction. Historical encrypted session data and AES-256-GCM format are preserved. Read failures no longer create fresh authentication credentials.

The gateway restores stored connected/connecting devices without resetting all devices on startup. A five-second restoration scan retries devices not locally owned. Graceful shutdown releases ownership and preserves stored reconnect status. Operator disconnect revokes the generation and marks the device disconnected; it works through a different API replica. Foreign IDs are checked before those controls.

Every application send renews and checks ownership immediately before calling Baileys, rechecks local socket identity/expiry and uses the stable persisted message ID where available. A transport timeout closes the socket and produces an uncertain outcome. WhatsApp cannot revoke a packet already admitted before lease loss. Acknowledgement loss is quarantined rather than retried automatically.

## Queue topology

Redis/BullMQ is a notification and execution aid; PostgreSQL stores correctness and recoverable work.

- `device-send-<device UUID>` carries only organization, device and durable request UUIDs. Only the current device owner creates a worker for that queue. A database owner poll also drains queued requests when Redis is absent or unavailable.
- `document-indexing` carries only organization and immutable document version UUIDs. Multiple replicas may consume; the existing database version claim admits one parser/embedder. Terminal queue notifications can be recreated when database recovery finds an expired parsing lease.
- Legacy synchronous ingestion helpers persist and index inline, avoiding a queued worker racing their completion result. Asynchronous upload/retry admission publishes the persisted version ID.
- HTTP sends, team notifications and nudges routed to another replica's device use a private durable relay row. A stable send identity prevents duplicate admission and conflicting content is rejected. Requests expire after 30 seconds; the HTTP caller waits at most 25 seconds. Queued timeouts are cancelled. Sending/uncertain requests are not replayed.
- Existing AI inbound execution and prepared-response/send claims remain authoritative. Owner takeover resumes prepared responses without generating another reply. Already admitted sends remain uncertain after a crash.

Tiny synchronous lookups remain synchronous. Existing analytics/evaluation/cleanup worker skeletons are not activated. Queue publication is bounded to two seconds. Producers have finite retries and no offline queue; worker connections support blocking consumption. Shutdown allows five seconds for active jobs, then disconnects. Redis loss does not authorize a second device owner or discard database work.

## Migration and authorization

`supabase/migrations/030_device_runtime_leases.sql` is the next unused number; 028 and 029 already belong to observability. It adds the composite tenant/device identity constraint, private lease/outbound tables and seven service-only RPCs. Both new tables have RLS and no anonymous/authenticated privileges. Composite foreign keys reject malformed cross-tenant parents. RPCs validate server-resolved organization/device ownership. The finish operation can record a prior generation's in-flight acknowledgement only for its previously claimed row; it cannot admit new sends and requires a matching stable receipt for success.

The device connect API preserves its envelope and returns 409 `DEVICE_LEASE_HELD` for another runtime, or 503 for unavailable/lost ownership. Existing frontend proxies preserve these statuses. No new public API, role expansion or broad UI redesign is introduced. The existing authenticated Devices workspace remains the operator interface.

The migration is applied only inside the disposable local test stack. It has not been applied to any live project. All 31 active SQL files, including both 011 files, replay in filename order; `legacy/` is excluded and replay errors fail visibly. The populated upgrade fingerprint verifies that 030 changes no historical rows. New test-only ledger tables are created by tests, not production migrations.

## Environment and operations

Use existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WA_SESSION_ENCRYPTION_KEY` (64 hex characters), and optional `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. No new secret, env-file change or dependency version is required. Test TTL/dependency injection applies only to the fixture; production defaults remain 30 seconds and real Baileys/provider adapters.

Before a future production rollout: back up/PITR, drain and stop every old backend, apply the additive migration, deploy matching code, then start a single replica and smoke-test QR/reconnect. Old unfenced binaries must not run alongside new fenced binaries. Expand only after live ownership/transport validation. Configure Redis persistence and no-eviction policy for production; the disposable test Redis deliberately has no persistence.

For `DEVICE_LEASE_HELD`, keep the running owner and avoid clearing its session. For database loss, restore infrastructure and let a new handle acquire after expiry. For `review_required` or stuck `sending`, inspect delivery evidence before manually sending a new customer message. Never reset these rows to queued automatically. Outbox rows retain message text privately; no destructive retention job is enabled in this phase.

## Verification and rollback

Run `node scripts/phase10-verify.mjs` for clean install, application/test typechecks, lint, build, all ordinary/strict/browser suites and the full Docker database suite. Use `npm run test:reliability:db` for all database regressions, or `node scripts/phase10-db.mjs tests/tenant-db/device-reliability.test.ts` for the new reliability suite. `--applications-only` refreshes application gates after an existing complete database run; `--database-only` refreshes the database gate after application verification. These modes preserve the other recorded command results; they do not substitute for initial complete verification. Do not build/reinstall while database browser/replica tests run. `node scripts/phase10-final.mjs` promotes sanitized evidence and verifies environment/source preservation after complete verification.

The disposable stack pins Supabase self-hosted/v0.8.2 database/Auth/REST images and Redis by digest, uses generated local credentials, loopback ports, isolated names and disposable storage. Tests run actual API/Next applications, real authenticated HTTP, real database/Redis claims and independent child replicas. Only WhatsApp and embedding provider boundaries are stubbed. Browser coverage verifies the existing device workspace. These results do not establish live WhatsApp reconnect, external-provider reliability, sustained load or production readiness.

The pre-edit checkpoint is `F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\phase10-pre-change-20261007-193927.zip`, SHA256 `3E772E0E0B3C101161514D2AF4F7E2C7673023FBC8ACA78C653E5667678672DF`. Verify it before restoring to a separate directory and compare against `source-manifest.json`. Preserve later user edits and current data. No local live DB rollback is needed. For a future deployed rollback, stop all replicas, preserve uncertain send records and restore the prior application as a single worker; leave additive tables in place until reconciled. Never drop leased/outbound state or run unfenced replicas concurrently as a rollback shortcut.

Phase 11 remains gated by the user's explicit next-phase instruction. Its proposed migration must use the next unused number, currently 031.
