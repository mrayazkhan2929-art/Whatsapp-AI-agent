# Phase 9 — execution evidence, audit and evaluation

The Master implementation prompt controls this phase. Current code and executed tests establish behavior; previous reports remain historical checkpoints. Read `PHASE_9_COMPLETION_REPORT.md` for final results, risks and rollback evidence. Phase 10 distributed device ownership is outside this phase.

## Inspecting a reply

Owners and administrators can open Execution Evidence at `/execution-traces`, an execution detail page at `/execution-traces/[id]`, or use the keyboard-reachable **Why this reply?** link on an AI message in the actual shared Inbox. `/execution-traces/message/[id]` resolves the owned message's retained execution. AI Studio also links to `/ai-studio/[id]/executions`; draft playground records remain a separate view.

Details show routing/intent/confidence/language, canonical extracted criteria, memory before/after, verified tool queries/results, property IDs, knowledge provenance, model attempts, validation gates, latency, token usage/cost where known, fallback/handoff, failure and transport outcomes, contextual IDs and the final result. Missing evidence is explicitly unavailable. Historical messages generated before this phase can have no retained trace; the API returns 404 rather than inventing an explanation from today's configuration.

History uses stable timestamp/UUID cursors, 30 records by default and a maximum of 100. Filters are server-authorized organization, agent, device, conversation and status. Client organization fields cannot expand scope. The audit tab shows action, outcome, response status and changed field names, without request values; the API also retains actor and resource IDs. Existing activity/configuration/handoff history remains intact.

## APIs and authorization

Backend `/api/v1/observability`, proxied by frontend `/api/observability`, has read-only routes:

- `GET /traces?limit=&cursor=&agentId=&deviceId=&conversationId=&status=`.
- `GET /traces/:id`.
- `GET /messages/:id`.
- `GET /audit?limit=&cursor=`.

Owners/admins can inspect; other authenticated roles receive 403. Foreign resources/filters return 404. Invalid bounds/cursors return 400. Every successful evidence read must first append an access audit event; unavailable access auditing returns 503. No browser route can create or alter evidence. Anonymous/authenticated Supabase REST has no table privileges. Service-role insert guards validate tenant parent context and nested property/knowledge references; stored trace/audit rows are immutable.

Authenticated backend mutations also append best-effort action records after response completion. They capture method, resource ID/type, outcome and field names, not bodies, bearer tokens, cookies or values. They are separate request-level records, not transactional database row diffs. Existing transactional configuration and handoff audit remains authoritative for those workflows. Failed generic audit persistence emits a structured `AUDIT_LOG_UNAVAILABLE` diagnostic and does not repeat business operations.

## Runtime behavior

`ExecutionTraceService` uses async-local context so parallel turns cannot share evidence. WhatsApp creates a root context covering durable inbound admission, claim, execution, prepared outbound, delivery and result. Duplicate/claimed messages, unsupported media and human-owned conversations retain skipped reasons without regenerating a reply. HTTP chat owns a root context; direct helper generation creates one only when no root already exists. Nested calls cannot change organization.

The same trace ID travels with prepared/saved AI-message metadata. Trace persistence occurs after the operation completes and validates each retained parent against the server organization. Trace storage failures emit `EXECUTION_TRACE_UNAVAILABLE` with only trace ID and do not change, regenerate or repeat a customer reply. Consequently, an outage or process death before final persistence can leave a message with no retained trace. This phase does not claim crash-proof transactional trace delivery.

Raw inbound text, history and compiled prompts are excluded. Canonical property criteria and bounded, pattern-redacted result previews are retained. Known secret/JWT/email/phone/URL patterns are redacted; actor/customer contact identifiers and arbitrary memory fields are excluded. Verified numeric property values are retained. This is finite pattern redaction, not universal identification of personal data in free-text criteria or generated responses. Review access/retention needs before production use. Records are append-only and retained; no destructive retention job is enabled.

## Model gateway and validation

`ModelGateway` centralizes the existing Anthropic/Groq providers for production replies and explicit Studio model tests. Only previously approved model IDs and typed Studio settings are used. SDK retries are disabled. Requests use 15-second Anthropic and 12-second Groq SDK timeouts. Production Anthropic preserves the existing maximum of three validation attempts and rate-limit backoff; Groq has one attempt. Studio limits each candidate provider to one attempt. Explicit provider and `safe-response` policy prevent cross-provider fallback; automatic provider-chain mode allows the existing secondary provider.

Attempts retain provider/model, ordinal, latency, accepted/rejected/unavailable/failed/rate-limit outcome, actual usage where returned and validation gates. Raw provider errors are excluded. Usage remains null when absent; totals are available only when every attempted billable result supplies usage. Model behavior/quality was verified with stubs, not live paid calls.

`ResponseValidator` centralizes the existing legacy formatter/handoff/language/no-inventory-price concepts, empty output and platform-secret gates. Studio additionally rejects known unverified action claims. Deterministic property/company/team handlers continue to use verified records. These finite gates are independently testable; they are not a complete semantic hallucination or injection detector.

Optional platform environment `AI_COST_RATES_JSON` maps approved model IDs to nonnegative `inputPerMillion` and `outputPerMillion` USD rates. Each attempt retains the validated rate basis used for its estimate. These are operator-supplied estimates, not provider invoices. Invalid/missing rates or incomplete usage keep estimated cost null. There are no built-in price assumptions. Example synthetic local fixture rates used by tests are not production recommendations.

## Schema, evaluation and verification

Additive migrations are `028_ai_observability.sql` and `029_audit_logs.sql`; historical SQL is unchanged. The next free number is 030. They add private indexes/tables and ownership/immutability triggers without backfilling or altering historical rows. They were applied only to disposable local stacks.

`tests/fixtures/ai-evaluation.json` contains all 23 required categories: greeting, company, exact/area/budget/bedroom/multiple-constraint property search, no match, alternatives/another/more/rejection, agent, handoff, booking, media, ROI, knowledge, Arabic/mixed language, negative sentiment, injection and duplicate inbound. Database tests execute the cases through real application/runtime paths, assert governed behavior and record trace IDs/results. The corpus is a finite behavioral regression suite with synthetic inventory and stubbed providers; it is not a measured live-model quality score. Booking/ROI cases do not add a new automatic dispatcher or pretend those actions occurred.

Run `node scripts/phase9-verify.mjs` for clean install, application/test typechecks, lint, build, existing suite categories and `npm run test:observability:db`. Do not run install/build while database/browser workers are active on Windows. The DB harness refuses live environment files and uses digest-pinned Supabase `self-hosted/v0.8.2` database/Auth/REST services with loopback ports, generated credentials and isolated temporary storage. All active SQL replays in deterministic numeric/filename order, including both 011 files and excluding `legacy/`. Populated fingerprints verify that adding observability/audit leaves earlier rows exact.

An isolated development follow-up is `node scripts/phase9-db.mjs tests/tenant-db/observability.test.ts`; it is a subset of the full gate. Outbound provider/WhatsApp calls are stubbed and nonlocal calls are blocked. Final evidence promotes only sanitized files. `phase9-files.mjs` and the source-safety tests reject historical evidence/SQL drift. `phase9-environment.mjs` verifies that test resources are removed, prior user containers retain IDs/start times and development applications return to their initial stopped state.

## Recovery and boundary

`checkpoint.json` identifies the pre-edit archive and immutable source manifest. Verify its SHA-256, extract into a separate recovery directory and compare inventoried files before reverting. Retain additive tables, historical message/version/document/audit data and later customer writes. Prior applications can ignore the new message metadata and additive schema. Reinstall from the preserved lockfile and rebuild reverted sources; do not use a destructive down migration to simplify recovery.

Distributed Baileys device leases, takeover/fencing, queue rearchitecture and the Phase 10 reliability changes have not begun. No live migration, provider call, WhatsApp send or deployment is authorized/performed as part of local verification.
